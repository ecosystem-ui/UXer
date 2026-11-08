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

	mgr := auth.NewManager("test-secret")
	srv := NewServer(d, mgr, proxy.NewHandler("test-secret"))
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
		`{"selector":"#hero > button","text_excerpt":"Get started","x":0.5,"y":0.5,"body":"Button color is off","state":"nav=Tenants","state_mode":"declarative"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create comment: %d %s", rec.Code, rec.Body.String())
	}
	var comment db.Comment
	_ = json.Unmarshal(rec.Body.Bytes(), &comment)
	if comment.State != "nav=Tenants" || comment.StateMode != "declarative" {
		t.Fatalf("state not persisted: %+v", comment)
	}

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
	if comments[0].State != "nav=Tenants" || comments[0].StateMode != "declarative" {
		t.Fatalf("state not returned on list: %+v", comments[0])
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

func TestMemberCanResolveComment(t *testing.T) {
	srv, h, ownerCookie := newTestServer(t)

	// Add a second user (viewer) to the database.
	if _, err := srv.DB.SQL.Exec(
		`INSERT INTO users (id, email, name, password_hash, created_at)
		 VALUES ('user-2', 'ben@example.com', 'Ben', 'hash', '2026-01-01T00:00:00Z')`,
	); err != nil {
		t.Fatalf("insert viewer: %v", err)
	}

	// Owner creates a project + version + comment.
	rec := do(h, ownerCookie, http.MethodPost, "/api/projects", `{"name":"Shared"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", rec.Code, rec.Body.String())
	}
	var project db.Project
	_ = json.Unmarshal(rec.Body.Bytes(), &project)

	rec = do(h, ownerCookie, http.MethodPost, "/api/projects/"+project.ID+"/versions",
		`{"label":"v1","url":"https://example.com"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create version: %d %s", rec.Code, rec.Body.String())
	}
	var version db.Version
	_ = json.Unmarshal(rec.Body.Bytes(), &version)

	rec = do(h, ownerCookie, http.MethodPost, "/api/versions/"+version.ID+"/comments",
		`{"selector":"#hero > button","text_excerpt":"Get started","x":0.5,"y":0.5,"body":"Button color is off"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create comment: %d %s", rec.Code, rec.Body.String())
	}
	var comment db.Comment
	_ = json.Unmarshal(rec.Body.Bytes(), &comment)

	// Owner shares the project with the viewer.
	rec = do(h, ownerCookie, http.MethodPost, "/api/projects/"+project.ID+"/members",
		`{"email":"ben@example.com"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("add member: %d %s", rec.Code, rec.Body.String())
	}

	// Issue a session cookie for the viewer.
	viewerRec := httptest.NewRecorder()
	viewerReq := httptest.NewRequest(http.MethodGet, "/", nil)
	if err := srv.Auth.SetUserID(viewerRec, viewerReq, "user-2"); err != nil {
		t.Fatalf("set viewer session: %v", err)
	}
	viewerCookies := viewerRec.Result().Cookies()
	if len(viewerCookies) == 0 {
		t.Fatal("no viewer session cookie issued")
	}

	// Viewer (member) can resolve the comment.
	rec = do(h, viewerCookies[0], http.MethodPatch, "/api/comments/"+comment.ID, `{"status":"resolved"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("viewer resolve comment: %d %s", rec.Code, rec.Body.String())
	}
	var resolved db.Comment
	_ = json.Unmarshal(rec.Body.Bytes(), &resolved)
	if resolved.Status != "resolved" {
		t.Fatalf("expected resolved, got %+v", resolved)
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

type fakeMailer struct {
	lastTo       string
	lastResetURL string
}

func (f *fakeMailer) SendPasswordReset(to, name, resetURL string) error {
	f.lastTo = to
	f.lastResetURL = resetURL
	return nil
}

func newTestServerWithMailer(t *testing.T) (*Server, http.Handler, *fakeMailer) {
	t.Helper()
	srv, h, _ := newTestServer(t)
	fm := &fakeMailer{}
	srv.Mailer = fm
	srv.AppURL = "http://localhost:8088"
	return srv, h, fm
}

func TestEmailValidationAndCaseInsensitiveUnique(t *testing.T) {
	_, h, _ := newTestServer(t)

	// Reject malformed emails at signup.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"not-an-email","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid email signup: expected 400, got %d", rec.Code)
	}

	// First signup with mixed-case email succeeds.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"Case@Example.com","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("mixed-case signup: %d %s", rec.Code, rec.Body.String())
	}

	// The same email in a different case must be treated as a duplicate.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"case@example.com","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("case-variant duplicate: expected 409, got %d", rec.Code)
	}
}

func TestForgotAndResetPassword(t *testing.T) {
	_, h, fm := newTestServerWithMailer(t)

	// Known email returns a generic 200 and emails a reset link.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password",
		strings.NewReader(`{"email":"lia@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("forgot: %d %s", rec.Code, rec.Body.String())
	}
	if fm.lastTo != "lia@example.com" || !strings.Contains(fm.lastResetURL, "token=") {
		t.Fatalf("expected reset email to lia@example.com, got to=%q url=%q", fm.lastTo, fm.lastResetURL)
	}
	token := fm.lastResetURL[strings.LastIndex(fm.lastResetURL, "token=")+len("token="):]
	if token == "" {
		t.Fatal("empty reset token in email")
	}

	// Reset the password with the token.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/reset-password",
		strings.NewReader(`{"token":"`+token+`","password":"brand-new-pass"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body.String())
	}

	// Login succeeds with the new password.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"email":"lia@example.com","password":"brand-new-pass"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login after reset: %d %s", rec.Code, rec.Body.String())
	}

	// The token is single-use.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/reset-password",
		strings.NewReader(`{"token":"`+token+`","password":"another-pass"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("token reuse: expected 400, got %d", rec.Code)
	}

	// Unknown email is acknowledged identically (no enumeration) and sends no mail.
	fm.lastTo = ""
	fm.lastResetURL = ""
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password",
		strings.NewReader(`{"email":"nobody@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("forgot unknown: %d %s", rec.Code, rec.Body.String())
	}
	if fm.lastTo != "" || fm.lastResetURL != "" {
		t.Fatalf("expected no email for unknown account, got to=%q url=%q", fm.lastTo, fm.lastResetURL)
	}
}

// Inviting an address with no account stores a pending membership that grants
// viewer access automatically when that person signs up.
func TestInviteNonUserThenSignupGrantsAccess(t *testing.T) {
	_, h, ownerCookie := newTestServer(t)

	rec := do(h, ownerCookie, http.MethodPost, "/api/projects", `{"name":"Invite only"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", rec.Code, rec.Body.String())
	}
	var project db.Project
	_ = json.Unmarshal(rec.Body.Bytes(), &project)

	// Invite an address that has no account yet (casing is normalized).
	rec = do(h, ownerCookie, http.MethodPost, "/api/projects/"+project.ID+"/members",
		`{"email":"Future@Example.com"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("invite non-user: %d %s", rec.Code, rec.Body.String())
	}
	var member db.ProjectMember
	_ = json.Unmarshal(rec.Body.Bytes(), &member)
	if member.Email != "future@example.com" || !member.Pending {
		t.Fatalf("expected pending invite for future@example.com, got %+v", member)
	}

	// The invite is visible to the owner as pending.
	rec = do(h, ownerCookie, http.MethodGet, "/api/projects/"+project.ID+"/members", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list members: %d %s", rec.Code, rec.Body.String())
	}
	var members []db.ProjectMember
	_ = json.Unmarshal(rec.Body.Bytes(), &members)
	if len(members) != 1 || !members[0].Pending {
		t.Fatalf("expected one pending member, got %+v", members)
	}

	// The invited person signs up; signup issues a session cookie.
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"future@example.com","password":"secret123","name":"Future"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("signup: %d %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("no session cookie issued on signup")
	}
	memberCookie := cookies[0]

	// The previously pending membership now grants the new account access.
	rec = do(h, memberCookie, http.MethodGet, "/api/projects", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list projects: %d %s", rec.Code, rec.Body.String())
	}
	var projects []db.Project
	_ = json.Unmarshal(rec.Body.Bytes(), &projects)
	if len(projects) != 1 || projects[0].ID != project.ID || projects[0].Role != "viewer" {
		t.Fatalf("expected shared project with viewer role, got %+v", projects)
	}
	if rec := do(h, memberCookie, http.MethodGet, "/api/projects/"+project.ID, ""); rec.Code != http.StatusOK {
		t.Fatalf("viewer get project: %d %s", rec.Code, rec.Body.String())
	}

	// The membership is no longer pending, and only the owner may manage it.
	rec = do(h, ownerCookie, http.MethodGet, "/api/projects/"+project.ID+"/members", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &members)
	if len(members) != 1 || members[0].Pending {
		t.Fatalf("expected resolved member, got %+v", members)
	}
	if rec := do(h, memberCookie, http.MethodGet, "/api/projects/"+project.ID+"/members", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("viewer list members: expected 404, got %d", rec.Code)
	}

	// Revoking by email removes access, including pending invites.
	rec = do(h, ownerCookie, http.MethodDelete,
		"/api/projects/"+project.ID+"/members/future%40example.com", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("remove member: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(h, memberCookie, http.MethodGet, "/api/projects", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &projects)
	if len(projects) != 0 {
		t.Fatalf("expected access revoked, got %+v", projects)
	}
}

func TestStateChangingRequestsRejectCrossOrigin(t *testing.T) {
	_, h, cookie := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/projects", strings.NewReader(`{"name":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example.com")
	req.AddCookie(cookie)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin POST: expected 403, got %d %s", rec.Code, rec.Body.String())
	}

	// Same-origin mutations (matching Origin) are still allowed.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/projects", strings.NewReader(`{"name":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://"+req.Host)
	req.AddCookie(cookie)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("same-origin POST: expected 201, got %d %s", rec.Code, rec.Body.String())
	}

	// A different port on the same host (dev proxy rewriting Host to :8088
	// while the browser's Origin keeps :5174) is still same-site and allowed.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/projects", strings.NewReader(`{"name":"Y"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5174")
	req.Host = "localhost:8088"
	req.AddCookie(cookie)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("same-host different-port POST: expected 201, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestSignupRejectsOversizedPassword(t *testing.T) {
	_, h, _ := newTestServer(t)

	long := strings.Repeat("a", 73)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup",
		strings.NewReader(`{"email":"long@example.com","password":"`+long+`"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized password signup: expected 400, got %d %s", rec.Code, rec.Body.String())
	}
}
