package auth

import (
	"errors"
	"net/http"
	"os"

	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

const SessionName = "uxer_session"

var ErrNoSession = errors.New("no session")

// Manager holds the signed-cookie session store.
type Manager struct {
	store sessions.Store
}

// NewManager builds a session store keyed by the provided secret. Callers
// are responsible for supplying a sufficiently long, random secret (see
// cmd/uxer/main.go for production enforcement).
func NewManager(secret string) *Manager {
	return &Manager{store: sessions.NewCookieStore([]byte(secret))}
}

// HashPassword hashes a plaintext password with bcrypt.
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CheckPassword reports whether the plaintext password matches the hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
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
