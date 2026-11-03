package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"uxer/internal/auth"
	"uxer/internal/db"
	"uxer/internal/proxy"
)

type ctxKey string

const userKey ctxKey = "user"

// Server wires the database, auth manager, and proxy into an HTTP handler.
type Server struct {
	DB    *db.DB
	Auth  *auth.Manager
	Proxy *proxy.Handler
}

func NewServer(d *db.DB, a *auth.Manager, p *proxy.Handler) *Server {
	return &Server{DB: d, Auth: a, Proxy: p}
}

// Routes builds the full routing table. If static is non-nil it is used as
// the catch-all (production SPA serving); otherwise unknown paths 404.
func (s *Server) Routes(static http.Handler) http.Handler {
	mux := http.NewServeMux()

	// auth (no session required)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/auth/signup", s.handleSignup)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)

	// projects
	mux.HandleFunc("GET /api/projects", s.requireUser(s.handleListProjects))
	mux.HandleFunc("POST /api/projects", s.requireUser(s.handleCreateProject))
	mux.HandleFunc("GET /api/projects/{id}", s.requireUser(s.handleGetProject))
	mux.HandleFunc("PATCH /api/projects/{id}", s.requireUser(s.handleUpdateProject))
	mux.HandleFunc("DELETE /api/projects/{id}", s.requireUser(s.handleDeleteProject))

	// versions
	mux.HandleFunc("GET /api/projects/{id}/versions", s.requireUser(s.handleListVersions))
	mux.HandleFunc("POST /api/projects/{id}/versions", s.requireUser(s.handleCreateVersion))
	mux.HandleFunc("PATCH /api/versions/{id}", s.requireUser(s.handleUpdateVersion))
	mux.HandleFunc("DELETE /api/versions/{id}", s.requireUser(s.handleDeleteVersion))

	// comments + replies
	mux.HandleFunc("GET /api/versions/{id}/comments", s.requireUser(s.handleListComments))
	mux.HandleFunc("POST /api/versions/{id}/comments", s.requireUser(s.handleCreateComment))
	mux.HandleFunc("POST /api/comments/{id}/replies", s.requireUser(s.handleCreateReply))
	mux.HandleFunc("PATCH /api/comments/{id}", s.requireUser(s.handleUpdateComment))
	mux.HandleFunc("DELETE /api/comments/{id}", s.requireUser(s.handleDeleteComment))

	// proxy
	mux.HandleFunc("GET /proxy", s.Proxy.HandleProxy)
	mux.HandleFunc("GET /__uxer__/p/{b64}", s.Proxy.HandlePath)
	mux.HandleFunc("GET /__uxer__/p/{b64}/{rest...}", s.Proxy.HandlePath)
	mux.HandleFunc("GET /__uxer__/bridge.js", s.Proxy.HandleBridge)

	if static != nil {
		mux.Handle("/", static)
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.NotFound(w, r)
		})
	}

	return mux
}

// requireUser guards a handler behind a valid session, injecting the user.
func (s *Server) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := s.Auth.GetUserID(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		u, err := s.loadUser(uid)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		next(w, r.WithContext(ctx))
	}
}

func userFrom(r *http.Request) *db.User {
	u, _ := r.Context().Value(userKey).(*db.User)
	return u
}

func (s *Server) loadUser(id string) (*db.User, error) {
	var u db.User
	err := s.DB.SQL.QueryRow(
		`SELECT id, email, name, password_hash, created_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	u.PasswordHash = ""
	return &u, nil
}

// ownedProject verifies the project belongs to the current user and returns
// its owner id.
func (s *Server) ownedProject(r *http.Request, id string) (string, bool) {
	u := userFrom(r)
	var owner string
	err := s.DB.SQL.QueryRow(`SELECT owner_id FROM projects WHERE id = ?`, id).Scan(&owner)
	return owner, err == nil && owner == u.ID
}

// versionForUser returns a version only if it belongs to the current user's
// project.
func (s *Server) versionForUser(r *http.Request, id string) (*db.Version, bool) {
	u := userFrom(r)
	var v db.Version
	err := s.DB.SQL.QueryRow(
		`SELECT v.id, v.project_id, v.label, v.url, v.seq, v.created_at
		 FROM versions v JOIN projects p ON p.id = v.project_id
		 WHERE v.id = ? AND p.owner_id = ?`,
		id, u.ID,
	).Scan(&v.ID, &v.ProjectID, &v.Label, &v.URL, &v.Seq, &v.CreatedAt)
	if err != nil {
		return nil, false
	}
	return &v, true
}

// commentForUser returns a comment only if it belongs to the current user's
// project (joined through its version).
func (s *Server) commentForUser(r *http.Request, id string) (*db.Comment, bool) {
	u := userFrom(r)
	var c db.Comment
	err := s.DB.SQL.QueryRow(
		`SELECT c.id, c.version_id, c.selector, c.text_excerpt, c.x, c.y, c.body,
		        c.status, c.author_id, c.created_at, c.resolved_at, c.resolved_version_id
		 FROM comments c
		 JOIN versions v ON v.id = c.version_id
		 JOIN projects p ON p.id = v.project_id
		 WHERE c.id = ? AND p.owner_id = ?`,
		id, u.ID,
	).Scan(&c.ID, &c.VersionID, &c.Selector, &c.TextExcerpt, &c.X, &c.Y, &c.Body,
		&c.Status, &c.AuthorID, &c.CreatedAt, &c.ResolvedAt, &c.ResolvedVersionID)
	if err != nil {
		return nil, false
	}
	return &c, true
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
