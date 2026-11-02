package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/gorilla/sessions"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

const SessionName = "uxer_session"

var ErrNoSession = errors.New("no session")

// GitHubUser is the subset of the GitHub /user response UXer needs.
type GitHubUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// Manager holds the OAuth config and the signed-cookie session store.
type Manager struct {
	OAuth *oauth2.Config
	store sessions.Store
}

func NewManager() *Manager {
	clientID := os.Getenv("GITHUB_CLIENT_ID")
	clientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	callback := os.Getenv("GITHUB_CALLBACK_URL")
	if callback == "" {
		callback = "http://localhost:5173/api/auth/github/callback"
	}
	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		secret = "dev-insecure-secret-change-me"
	}

	conf := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     github.Endpoint,
		RedirectURL:  callback,
		Scopes:       []string{"read:user"},
	}
	return &Manager{
		OAuth: conf,
		store: sessions.NewCookieStore([]byte(secret)),
	}
}

func (m *Manager) AuthCodeURL(state string) string {
	return m.OAuth.AuthCodeURL(state, oauth2.AccessTypeOnline)
}

func (m *Manager) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	return m.OAuth.Exchange(ctx, code)
}

// FetchUser loads the authenticated GitHub profile.
func (m *Manager) FetchUser(ctx context.Context, token *oauth2.Token) (*GitHubUser, error) {
	client := m.OAuth.Client(ctx, token)
	resp, err := client.Get("https://api.github.com/user")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var u GitHubUser
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

func (m *Manager) session(r *http.Request) (*sessions.Session, error) {
	return m.store.Get(r, SessionName)
}

// GetUserID returns the authenticated user id from the session cookie.
func (m *Manager) GetUserID(r *http.Request) (string, error) {
	sess, err := m.session(r)
	if err != nil {
		return "", err
	}
	v, ok := sess.Values["user_id"].(string)
	if !ok || v == "" {
		return "", ErrNoSession
	}
	return v, nil
}

// SetUserID persists the user id in a signed cookie.
func (m *Manager) SetUserID(w http.ResponseWriter, r *http.Request, userID string) error {
	sess, _ := m.session(r)
	sess.Options = &sessions.Options{
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("UXER_SECURE_COOKIE") == "1",
		MaxAge:   30 * 24 * 3600,
	}
	sess.Values["user_id"] = userID
	return sess.Save(r, w)
}

// ClearSession expires the cookie (logout).
func (m *Manager) ClearSession(w http.ResponseWriter, r *http.Request) error {
	sess, _ := m.session(r)
	sess.Options = &sessions.Options{Path: "/", MaxAge: -1, HttpOnly: true}
	return sess.Save(r, w)
}

// SetOAuthState persists a CSRF state value in the session cookie.
func (m *Manager) SetOAuthState(w http.ResponseWriter, r *http.Request, state string) error {
	sess, _ := m.session(r)
	sess.Options = &sessions.Options{Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode}
	sess.Values["oauth_state"] = state
	return sess.Save(r, w)
}

// GetOAuthState reads the persisted CSRF state.
func (m *Manager) GetOAuthState(r *http.Request) (string, error) {
	sess, err := m.session(r)
	if err != nil {
		return "", err
	}
	v, _ := sess.Values["oauth_state"].(string)
	return v, nil
}

// ClearOAuthState removes the CSRF state from the session cookie.
func (m *Manager) ClearOAuthState(w http.ResponseWriter, r *http.Request) error {
	sess, _ := m.session(r)
	delete(sess.Values, "oauth_state")
	return sess.Save(r, w)
}

// SetOAuthPopup records whether the login was initiated from a popup window.
func (m *Manager) SetOAuthPopup(w http.ResponseWriter, r *http.Request, popup bool) error {
	sess, _ := m.session(r)
	sess.Options = &sessions.Options{Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode}
	sess.Values["oauth_popup"] = popup
	return sess.Save(r, w)
}

// GetOAuthPopup reports whether the login was initiated from a popup window.
func (m *Manager) GetOAuthPopup(r *http.Request) bool {
	sess, err := m.session(r)
	if err != nil {
		return false
	}
	v, _ := sess.Values["oauth_popup"].(bool)
	return v
}

// ClearOAuthPopup removes the popup flag from the session cookie.
func (m *Manager) ClearOAuthPopup(w http.ResponseWriter, r *http.Request) error {
	sess, _ := m.session(r)
	delete(sess.Values, "oauth_popup")
	return sess.Save(r, w)
}
