package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"uxer/internal/auth"
	"uxer/internal/db"
)

// resetTokenTTL is how long a password-reset token stays valid.
const resetTokenTTL = time.Hour

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
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	email := normalizeEmail(body.Email)
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
		// The UNIQUE(email) constraint catches a concurrent signup with the
		// same email that slipped past the pre-check.
		if db.IsUniqueViolation(err) {
			writeError(w, http.StatusConflict, "an account with this email already exists")
			return
		}
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
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	email := normalizeEmail(body.Email)

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

// handleForgotPassword accepts an email and, when it belongs to an account,
// stores a short-lived reset token and emails a reset link. The response is
// identical whether or not the account exists, to avoid user enumeration.
func (s *Server) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		writeError(w, http.StatusBadRequest, "a valid email is required")
		return
	}

	var u db.User
	err := s.DB.SQL.QueryRow(
		`SELECT id, email, name FROM users WHERE email = ?`, email,
	).Scan(&u.ID, &u.Email, &u.Name)
	if err == nil {
		raw, tokenHash, err := newResetToken()
		if err == nil {
			ts := now()
			expires := time.Now().UTC().Add(resetTokenTTL).Format(time.RFC3339)
			// Invalidate any outstanding tokens for this user, then store the
			// new one (hashed, never in plaintext).
			if _, err := s.DB.SQL.Exec(`DELETE FROM password_reset_tokens WHERE user_id = ?`, u.ID); err == nil {
				if _, err := s.DB.SQL.Exec(
					`INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at)
					 VALUES (?, ?, ?, ?)`,
					tokenHash, u.ID, ts, expires,
				); err == nil && s.Mailer != nil {
					_ = s.Mailer.SendPasswordReset(u.Email, u.Name, s.resetURL(raw))
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleResetPassword redeems a reset token and replaces the user's password.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(body.Password) < 6 {
		writeError(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}
	token := strings.TrimSpace(body.Token)
	if token == "" {
		writeError(w, http.StatusBadRequest, "reset token is required")
		return
	}

	tokenHash := hashResetToken(token)
	var userID, expires string
	err := s.DB.SQL.QueryRow(
		`SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?`, tokenHash,
	).Scan(&userID, &expires)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid or expired reset token")
		return
	}
	expiry, err := time.Parse(time.RFC3339, expires)
	if err != nil || time.Now().UTC().After(expiry) {
		_, _ = s.DB.SQL.Exec(`DELETE FROM password_reset_tokens WHERE token_hash = ?`, tokenHash)
		writeError(w, http.StatusBadRequest, "invalid or expired reset token")
		return
	}

	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}
	if _, err := s.DB.SQL.Exec(
		`UPDATE users SET password_hash = ? WHERE id = ?`, hash, userID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update password")
		return
	}
	// The token is single-use.
	_, _ = s.DB.SQL.Exec(`DELETE FROM password_reset_tokens WHERE token_hash = ?`, tokenHash)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// resetURL builds the public URL the reset token can be redeemed at.
func (s *Server) resetURL(token string) string {
	base := s.AppURL
	if base == "" {
		base = "http://localhost:8088"
	}
	return strings.TrimRight(base, "/") + "/reset-password?token=" + token
}

// newResetToken returns a cryptographically random token and its SHA-256
// hash. Only the hash is persisted, so a database leak doesn't reveal live
// reset tokens.
func newResetToken() (raw, tokenHash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	return raw, hashResetToken(raw), nil
}

func hashResetToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// normalizeEmail trims whitespace and lowercases an email address so that
// lookups and uniqueness checks are case-insensitive.
func normalizeEmail(e string) string {
	return strings.ToLower(strings.TrimSpace(e))
}

// validEmail reports whether e is a syntactically valid email address.
func validEmail(e string) bool {
	if len(e) < 3 || len(e) > 254 {
		return false
	}
	addr, err := mail.ParseAddress(e)
	if err != nil {
		return false
	}
	// ParseAddress accepts display names ("Jane <jane@example.com>"); require
	// the address itself to be the whole input so only bare emails pass.
	if !strings.EqualFold(addr.Address, e) {
		return false
	}
	// Require a dot in the domain (consistent with the previous validator).
	at := strings.LastIndex(addr.Address, "@")
	return at > 0 && at < len(addr.Address)-1 && strings.Contains(addr.Address[at+1:], ".")
}
