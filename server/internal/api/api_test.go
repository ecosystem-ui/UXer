package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"uxer/internal/auth"
	"uxer/internal/db"
	"uxer/internal/proxy"
)

func newTestServer(t *testing.T) (*Server, http.Handler, *http.Cookie) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { d.SQL.Close() })

	uid := "user-1"
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, email, name, password_hash, created_at)
		 VALUES (?, 'lia@example.com', 'Lia', 'hash', '2026-01-01T00:00:00Z')`,
		uid,
	); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	mgr := auth.NewManager()
	srv := NewServer(d, mgr, proxy.NewHandler())
	h := srv.Routes(nil)

	// Issue a session cookie for the test user.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if err := mgr.SetUserID(rec, req, uid); err != nil {
		t.Fatalf("set session: %v", err)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("no session cookie issued")
	}
	return srv, h, cookies[0]
}

func do(h http.Handler, cookie *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.AddCookie(cookie)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestEndToEndFlow(t *testing.T) {
	_, h, cookie := newTestServer(t)

	// Unauthenticated is rejected.
	if rec := httptest.NewRecorder(); true {
		req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 without session, got %d", rec.Code)
		}
	}

	// Create project.
	rec := do(h, cookie, http.MethodPost, "/api/projects", `{"name":"Homepage"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", rec.Code, rec.Body.String())
	}
	var project db.Project
	_ = json.Unmarshal(rec.Body.Bytes(), &project)
	if project.ID == "" {
		t.Fatal("project id missing")
	}

	// Create version.
	rec = do(h, cookie, http.MethodPost, "/api/projects/"+project.ID+"/versions",
		`{"label":"v1","url":"https://example.com"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create version: %d %s", rec.Code, rec.Body.String())
	}
	var version db.Version
	_ = json.Unmarshal(rec.Body.Bytes(), &version)

	// Create comment.
	rec = do(h, cookie, http.MethodPost, "/api/versions/"+version.ID+"/comments",
		`{"selector":"#hero > button","text_excerpt":"Get started","x":0.5,"y":0.5,"body":"Button color is off"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create comment: %d %s", rec.Code, rec.Body.String())
	}
	var comment db.Comment
	_ = json.Unmarshal(rec.Body.Bytes(), &comment)

	// List comments.
	rec = do(h, cookie, http.MethodGet, "/api/versions/"+version.ID+"/comments", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list comments: %d", rec.Code)
	}
	var comments []db.Comment
	_ = json.Unmarshal(rec.Body.Bytes(), &comments)
	if len(comments) != 1 || comments[0].Status != "open" {
		t.Fatalf("expected 1 open comment, got %+v", comments)
	}

	// Add a reply.
	rec = do(h, cookie, http.MethodPost, "/api/comments/"+comment.ID+"/replies", `{"body":"Agreed"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create reply: %d %s", rec.Code, rec.Body.String())
	}

	// Resolve the comment.
	rec = do(h, cookie, http.MethodPatch, "/api/comments/"+comment.ID, `{"status":"resolved"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("resolve comment: %d %s", rec.Code, rec.Body.String())
	}
	var resolved db.Comment
	_ = json.Unmarshal(rec.Body.Bytes(), &resolved)
	if resolved.Status != "resolved" || resolved.ResolvedVersionID == nil || *resolved.ResolvedVersionID != version.ID {
		t.Fatalf("expected resolved with resolved_version_id=%s, got %+v", version.ID, resolved)
	}

	// Version counts reflect the resolved state.
	rec = do(h, cookie, http.MethodGet, "/api/projects/"+project.ID+"/versions", "")
	var versions []db.Version
	_ = json.Unmarshal(rec.Body.Bytes(), &versions)
	if len(versions) != 1 || versions[0].OpenCount != 0 || versions[0].ResolvedCount != 1 {
		t.Fatalf("expected 0 open / 1 resolved, got %+v", versions[0])
	}

	// Reopen.
	rec = do(h, cookie, http.MethodPatch, "/api/comments/"+comment.ID, `{"status":"open"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reopen comment: %d", rec.Code)
	}
}

func TestSignupAndLogin(t *testing.T) {
	_, h, _ := newTestServer(t)

	// Signup creates a session and returns the user.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"new@example.com","password":"secret123","name":"New User"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("signup: %d %s", rec.Code, rec.Body.String())
	}
	var created db.User
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Email != "new@example.com" || created.Name != "New User" {
		t.Fatalf("unexpected signup response: %+v", created)
	}
	if created.PasswordHash != "" {
		t.Fatal("password hash must not be returned")
	}
	signupCookie := rec.Result().Cookies()[0]

	// Duplicate email is rejected.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"new@example.com","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate signup: expected 409, got %d", rec.Code)
	}

	// Login with the correct password works.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"email":"new@example.com","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}

	// Login with a wrong password is rejected.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"email":"new@example.com","password":"wrong"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad login: expected 401, got %d", rec.Code)
	}

	// /me returns the authenticated user via the signup cookie.
	rec = do(h, signupCookie, http.MethodGet, "/api/auth/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("me: %d", rec.Code)
	}
}
