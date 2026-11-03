package db

import (
	"crypto/rand"
	"fmt"
)

// NewID returns a random RFC-4122-style UUID (v4) string.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	PasswordHash string `json:"-"`
	CreatedAt    string `json:"created_at"`
}

type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	OwnerID   string `json:"owner_id"`
	OwnerName string `json:"owner_name,omitempty"`
	Role      string `json:"role,omitempty"` // current user's role: "owner" | "viewer"
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type ProjectMember struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

type Version struct {
	ID            string `json:"id"`
	ProjectID     string `json:"project_id"`
	Label         string `json:"label"`
	URL           string `json:"url"`
	Seq           int    `json:"seq"`
	CreatedAt     string `json:"created_at"`
	OpenCount     int    `json:"open_count"`
	ResolvedCount int    `json:"resolved_count"`
}

type Reply struct {
	ID        string `json:"id"`
	CommentID string `json:"comment_id"`
	AuthorID  string `json:"author_id"`
	Author    *User  `json:"author,omitempty"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}

type Comment struct {
	ID                string  `json:"id"`
	VersionID         string  `json:"version_id"`
	Selector          string  `json:"selector"`
	TextExcerpt       string  `json:"text_excerpt"`
	PageURL           string  `json:"page_url"`
	Step              string  `json:"step"`
	X                 float64 `json:"x"`
	Y                 float64 `json:"y"`
	Body              string  `json:"body"`
	Status            string  `json:"status"`
	AuthorID          string  `json:"author_id"`
	Author            *User   `json:"author,omitempty"`
	CreatedAt         string  `json:"created_at"`
	ResolvedAt        *string `json:"resolved_at"`
	ResolvedVersionID *string `json:"resolved_version_id"`
	Replies           []Reply `json:"replies"`
}
