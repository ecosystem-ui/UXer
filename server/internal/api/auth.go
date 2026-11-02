package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

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

func (s *Server) handleGithubLogin(w http.ResponseWriter, r *http.Request) {
	if s.Auth.OAuth.ClientID == "" {
		writeError(w, http.StatusServiceUnavailable, "GITHUB_CLIENT_ID is not configured")
		return
	}
	state := randomState()
	if err := s.Auth.SetOAuthState(w, r, state); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist state")
		return
	}
	if err := s.Auth.SetOAuthPopup(w, r, r.URL.Query().Get("popup") == "1"); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist popup flag")
		return
	}
	http.Redirect(w, r, s.Auth.AuthCodeURL(state), http.StatusFound)
}

func (s *Server) handleGithubCallback(w http.ResponseWriter, r *http.Request) {
	want, err := s.Auth.GetOAuthState(r)
	if err != nil || want == "" {
		writeError(w, http.StatusBadRequest, "missing oauth state")
		return
	}
	got := r.URL.Query().Get("state")
	if got == "" || got != want {
		writeError(w, http.StatusBadRequest, "invalid oauth state")
		return
	}
	popup := s.Auth.GetOAuthPopup(r)
	_ = s.Auth.ClearOAuthState(w, r)
	_ = s.Auth.ClearOAuthPopup(w, r)

	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing code")
		return
	}

	token, err := s.Auth.Exchange(r.Context(), code)
	if err != nil {
		writeError(w, http.StatusBadGateway, "token exchange failed")
		return
	}
	gh, err := s.Auth.FetchUser(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to load GitHub profile")
		return
	}

	userID, err := s.upsertUser(gh)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save user")
		return
	}
	if err := s.Auth.SetUserID(w, r, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	if popup {
		writePopupSuccessPage(w)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

// writePopupSuccessPage renders a small page for the popup window that
// notifies the opener and closes itself.
func writePopupSuccessPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sign-in complete</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; text-align: center; padding-top: 48px; color: #333; }
</style>
</head>
<body>
<p>Sign-in complete. You can close this window.</p>
<script>
  (function () {
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'uxer-auth', ok: true }, window.location.origin);
      }
    } catch (e) {}
    window.close();
  })();
</script>
</body>
</html>`))
}

func (s *Server) upsertUser(gh *auth.GitHubUser) (string, error) {
	var id string
	err := s.DB.SQL.QueryRow(`SELECT id FROM users WHERE github_id = ?`, gh.ID).Scan(&id)
	if err == nil {
		// Existing user: refresh profile fields.
		_, uerr := s.DB.SQL.Exec(
			`UPDATE users SET login = ?, name = ?, avatar_url = ? WHERE id = ?`,
			gh.Login, gh.Name, gh.AvatarURL, id,
		)
		return id, uerr
	}

	id = db.NewID()
	_, err = s.DB.SQL.Exec(
		`INSERT INTO users (id, github_id, login, name, avatar_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, gh.ID, gh.Login, gh.Name, gh.AvatarURL, now(),
	)
	return id, err
}

func randomState() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "state"
	}
	return hex.EncodeToString(b)
}
