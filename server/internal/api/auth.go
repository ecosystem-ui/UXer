package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"uxer/internal/auth"
	"uxer/internal/db"
)

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	uid, err := s.Auth.GetUserID(r)
	if err != nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	u, err := s.loadUser(uid)
	if err != nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	_ = s.Auth.ClearSession(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleSignup creates a new user with an email + password.
func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	email := strings.ToLower(strings.TrimSpace(body.Email))
	if !validEmail(email) {
		writeError(w, http.StatusBadRequest, "a valid email is required")
		return
	}
	if len(body.Password) < 6 {
		writeError(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = email // fall back to the email local part for display
	}

	var exists int
	_ = s.DB.SQL.QueryRow(`SELECT COUNT(1) FROM users WHERE email = ?`, email).Scan(&exists)
	if exists > 0 {
		writeError(w, http.StatusConflict, "an account with this email already exists")
		return
	}

	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	id := db.NewID()
	ts := now()
	if _, err := s.DB.SQL.Exec(
		`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, email, name, hash, ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}
	if err := s.Auth.SetUserID(w, r, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	writeJSON(w, http.StatusCreated, db.User{ID: id, Email: email, Name: name, CreatedAt: ts})
}

// handleLogin authenticates an email + password.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))

	var u db.User
	err := s.DB.SQL.QueryRow(
		`SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?`, email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.CreatedAt)
	if err != nil || !auth.CheckPassword(u.PasswordHash, body.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	if err := s.Auth.SetUserID(w, r, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	u.PasswordHash = ""
	writeJSON(w, http.StatusOK, u)
}

func validEmail(e string) bool {
	if len(e) < 3 || !strings.Contains(e, "@") {
		return false
	}
	parts := strings.SplitN(e, "@", 2)
	if len(parts) != 2 || parts[0] == "" || !strings.Contains(parts[1], ".") {
		return false
	}
	return true
}
