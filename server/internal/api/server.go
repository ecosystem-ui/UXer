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
	DB          *db.DB
	Auth        *auth.Manager
	Proxy       *proxy.Handler
	authLimiter *rateLimiter
}

func NewServer(d *db.DB, a *auth.Manager, p *proxy.Handler) *Server {
	return &Server{
		DB:          d,
		Auth:        a,
		Proxy:       p,
		authLimiter: newRateLimiter(time.Minute, 20),
	}
}

// Routes builds the full routing table. If static is non-nil it is used as
// the catch-all (production SPA serving); otherwise unknown paths 404.
func (s *Server) Routes(static http.Handler) http.Handler {
	mux := http.NewServeMux()

	// auth (no session required; signup/login are rate-limited)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/auth/signup", s.rateLimit(s.handleSignup))
	mux.HandleFunc("POST /api/auth/login", s.rateLimit(s.handleLogin))

	// projects
	mux.HandleFunc("GET /api/projects", s.requireUser(s.handleListProjects))
	mux.HandleFunc("POST /api/projects", s.requireUser(s.handleCreateProject))
	mux.HandleFunc("GET /api/projects/{id}", s.requireUser(s.handleGetProject))
	mux.HandleFunc("PATCH /api/projects/{id}", s.requireUser(s.handleUpdateProject))
	mux.HandleFunc("DELETE /api/projects/{id}", s.requireUser(s.handleDeleteProject))

	// project members (sharing)
	mux.HandleFunc("GET /api/projects/{id}/members", s.requireUser(s.handleListMembers))
	mux.HandleFunc("POST /api/projects/{id}/members", s.requireUser(s.handleAddMember))
	mux.HandleFunc("DELETE /api/projects/{id}/members/{userId}", s.requireUser(s.handleRemoveMember))

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

	// proxy (requires an authenticated session; SSRF guard is the defense
	// against internal-network access, see proxy package)
	mux.HandleFunc("GET /proxy", s.requireSession(s.Proxy.HandleProxy))
	mux.HandleFunc("GET /__uxer__/p/{b64}", s.requireSession(s.Proxy.HandlePath))
	mux.HandleFunc("GET /__uxer__/p/{b64}/{rest...}", s.requireSession(s.Proxy.HandlePath))
	mux.HandleFunc("GET /__uxer__/bridge.js", s.requireSession(s.Proxy.HandleBridge))

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

// requireSession guards a handler behind a valid, signed session cookie only.
// Unlike requireUser it does not hit the database, so it is suitable for
// high-frequency proxy subresource requests.
func (s *Server) requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.Auth.GetUserID(r); err != nil {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		next(w, r)
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

// projectRole returns the current user's role on a project: "owner",
// "viewer", or "" when the user has no access. A single query resolves both
// the owner and member cases.
func (s *Server) projectRole(r *http.Request, id string) string {
	u := userFrom(r)
	var role string
	err := s.DB.SQL.QueryRow(
		`SELECT CASE
			WHEN p.owner_id = ? THEN 'owner'
			ELSE COALESCE((SELECT m.role FROM project_members m
			               WHERE m.project_id = p.id AND m.user_id = ?), '')
		 END
		 FROM projects p WHERE p.id = ?`, u.ID, u.ID, id,
	).Scan(&role)
	if err != nil {
		return ""
	}
	return role
}

// ownedProject verifies the project is owned by the current user and returns
// its owner id.
func (s *Server) ownedProject(r *http.Request, id string) (string, bool) {
	if s.projectRole(r, id) != "owner" {
		return "", false
	}
	return userFrom(r).ID, true
}

// canViewProject reports whether the current user can access a project
// (owner or member).
func (s *Server) canViewProject(r *http.Request, id string) bool {
	return s.projectRole(r, id) != ""
}

// versionFor returns a version accessible to the current user. When ownerOnly
// is true, only the project owner is admitted; otherwise members are too.
func (s *Server) versionFor(r *http.Request, id string, ownerOnly bool) (*db.Version, bool) {
	u := userFrom(r)
	var v db.Version
	q := `SELECT v.id, v.project_id, v.label, v.url, v.seq, v.created_at
		 FROM versions v JOIN projects p ON p.id = v.project_id
		 WHERE v.id = ? AND (p.owner_id = ?`
	args := []any{id, u.ID}
	if !ownerOnly {
		q += ` OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = v.project_id AND m.user_id = ?)`
		args = append(args, u.ID)
	}
	q += `)`
	err := s.DB.SQL.QueryRow(q, args...).Scan(&v.ID, &v.ProjectID, &v.Label, &v.URL, &v.Seq, &v.CreatedAt)
	if err != nil {
		return nil, false
	}
	return &v, true
}

// commentFor returns a comment accessible to the current user (joined through
// its version). When ownerOnly is true, only the project owner is admitted.
func (s *Server) commentFor(r *http.Request, id string, ownerOnly bool) (*db.Comment, bool) {
	u := userFrom(r)
	var c db.Comment
	q := `SELECT c.id, c.version_id, c.selector, c.text_excerpt, c.step, c.x, c.y, c.body,
		        c.status, c.author_id, c.created_at, c.resolved_at, c.resolved_version_id
		 FROM comments c
		 JOIN versions v ON v.id = c.version_id
		 JOIN projects p ON p.id = v.project_id
		 WHERE c.id = ? AND (p.owner_id = ?`
	args := []any{id, u.ID}
	if !ownerOnly {
		q += ` OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = v.project_id AND m.user_id = ?)`
		args = append(args, u.ID)
	}
	q += `)`
	err := s.DB.SQL.QueryRow(q, args...).Scan(
		&c.ID, &c.VersionID, &c.Selector, &c.TextExcerpt, &c.Step, &c.X, &c.Y, &c.Body,
		&c.Status, &c.AuthorID, &c.CreatedAt, &c.ResolvedAt, &c.ResolvedVersionID,
	)
	if err != nil {
		return nil, false
	}
	return &c, true
}

// rateLimit throttles per-IP requests to sensitive endpoints (auth).
func (s *Server) rateLimit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authLimiter.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "too many requests, try again later")
			return
		}
		next(w, r)
	}
}

// maxBodyBytes caps JSON request bodies to prevent unbounded memory use.
const maxBodyBytes = 1 << 20 // 1 MiB

// decodeJSON decodes a JSON body with a size limit.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	return json.NewDecoder(r.Body).Decode(v)
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
