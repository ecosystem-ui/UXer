package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"uxer/internal/db"
)

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	versionID := r.PathValue("id")
	v, ok := s.versionForUser(r, versionID)
	if !ok {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}

	rows, err := s.DB.SQL.Query(
		`SELECT c.id, c.version_id, c.selector, c.text_excerpt, c.x, c.y, c.body,
		        c.status, c.author_id, c.created_at, c.resolved_at, c.resolved_version_id,
		        u.login, u.name, u.avatar_url
		 FROM comments c JOIN users u ON u.id = c.author_id
		 WHERE c.version_id = ? ORDER BY c.created_at ASC`, v.ID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	comments := []db.Comment{}
	for rows.Next() {
		var c db.Comment
		var author db.User
		if err := rows.Scan(&c.ID, &c.VersionID, &c.Selector, &c.TextExcerpt, &c.X, &c.Y, &c.Body,
			&c.Status, &c.AuthorID, &c.CreatedAt, &c.ResolvedAt, &c.ResolvedVersionID,
			&author.Login, &author.Name, &author.AvatarURL); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		author.ID = c.AuthorID
		c.Author = &author
		comments = append(comments, c)
	}

	if len(comments) > 0 {
		if err := s.attachReplies(comments); err != nil {
			writeError(w, http.StatusInternalServerError, "query failed")
			return
		}
	}
	writeJSON(w, http.StatusOK, comments)
}

func (s *Server) attachReplies(comments []db.Comment) error {
	byID := map[string]*db.Comment{}
	ids := make([]string, 0, len(comments))
	for i := range comments {
		byID[comments[i].ID] = &comments[i]
		ids = append(ids, comments[i].ID)
	}

	rows, err := s.DB.SQL.Query(
		`SELECT r.id, r.comment_id, r.author_id, r.body, r.created_at,
		        u.login, u.name, u.avatar_url
		 FROM replies r JOIN users u ON u.id = r.author_id
		 WHERE r.comment_id IN (`+placeholders(len(ids))+`) ORDER BY r.created_at ASC`,
		argsAny(ids)...,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var r db.Reply
		var author db.User
		if err := rows.Scan(&r.ID, &r.CommentID, &r.AuthorID, &r.Body, &r.CreatedAt,
			&author.Login, &author.Name, &author.AvatarURL); err != nil {
			return err
		}
		author.ID = r.AuthorID
		r.Author = &author
		if c, ok := byID[r.CommentID]; ok {
			c.Replies = append(c.Replies, r)
		}
	}
	return nil
}

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	versionID := r.PathValue("id")
	v, ok := s.versionForUser(r, versionID)
	if !ok {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}
	u := userFrom(r)

	var body struct {
		Selector    string  `json:"selector"`
		TextExcerpt string  `json:"text_excerpt"`
		X           float64 `json:"x"`
		Y           float64 `json:"y"`
		Body        string  `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if strings.TrimSpace(body.Selector) == "" {
		writeError(w, http.StatusBadRequest, "selector is required")
		return
	}
	if strings.TrimSpace(body.Body) == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}

	id := db.NewID()
	ts := now()
	if _, err := s.DB.SQL.Exec(
		`INSERT INTO comments (id, version_id, selector, text_excerpt, x, y, body, status, author_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
		id, v.ID, body.Selector, body.TextExcerpt, body.X, body.Y, strings.TrimSpace(body.Body), u.ID, ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	writeJSON(w, http.StatusCreated, s.loadComment(id, u))
}

func (s *Server) handleCreateReply(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("id")
	c, ok := s.commentForUser(r, commentID)
	if !ok {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}
	u := userFrom(r)

	var body struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if strings.TrimSpace(body.Body) == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}

	id := db.NewID()
	ts := now()
	if _, err := s.DB.SQL.Exec(
		`INSERT INTO replies (id, comment_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, c.ID, u.ID, strings.TrimSpace(body.Body), ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	writeJSON(w, http.StatusCreated, db.Reply{
		ID: id, CommentID: c.ID, AuthorID: u.ID, Author: u, Body: body.Body, CreatedAt: ts,
	})
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("id")
	c, ok := s.commentForUser(r, commentID)
	if !ok {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}

	var body struct {
		Status             string `json:"status"`
		ResolvedVersionID  string `json:"resolved_version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	if body.Status == "resolved" {
		resolvedVersionID := body.ResolvedVersionID
		if resolvedVersionID == "" {
			resolvedVersionID = c.VersionID // default: the version it lives on
		}
		if _, ok := s.versionForUser(r, resolvedVersionID); !ok {
			writeError(w, http.StatusBadRequest, "invalid resolved_version_id")
			return
		}
		if _, err := s.DB.SQL.Exec(
			`UPDATE comments SET status = 'resolved', resolved_at = ?, resolved_version_id = ? WHERE id = ?`,
			now(), resolvedVersionID, c.ID,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "update failed")
			return
		}
	} else if body.Status == "open" {
		if _, err := s.DB.SQL.Exec(
			`UPDATE comments SET status = 'open', resolved_at = NULL, resolved_version_id = NULL WHERE id = ?`,
			c.ID,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "update failed")
			return
		}
	} else {
		writeError(w, http.StatusBadRequest, "status must be 'open' or 'resolved'")
		return
	}

	writeJSON(w, http.StatusOK, s.loadComment(c.ID, userFrom(r)))
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("id")
	if _, ok := s.commentForUser(r, commentID); !ok {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}
	if _, err := s.DB.SQL.Exec(`DELETE FROM comments WHERE id = ?`, commentID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// loadComment re-reads a single comment with author + replies.
func (s *Server) loadComment(id string, _ *db.User) *db.Comment {
	var c db.Comment
	var author db.User
	err := s.DB.SQL.QueryRow(
		`SELECT c.id, c.version_id, c.selector, c.text_excerpt, c.x, c.y, c.body,
		        c.status, c.author_id, c.created_at, c.resolved_at, c.resolved_version_id,
		        u.login, u.name, u.avatar_url
		 FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`, id,
	).Scan(&c.ID, &c.VersionID, &c.Selector, &c.TextExcerpt, &c.X, &c.Y, &c.Body,
		&c.Status, &c.AuthorID, &c.CreatedAt, &c.ResolvedAt, &c.ResolvedVersionID,
		&author.Login, &author.Name, &author.AvatarURL)
	if err != nil {
		return nil
	}
	author.ID = c.AuthorID
	c.Author = &author
	c.Replies = []db.Reply{}

	// load replies
	rows, err := s.DB.SQL.Query(
		`SELECT r.id, r.comment_id, r.author_id, r.body, r.created_at,
		        u.login, u.name, u.avatar_url
		 FROM replies r JOIN users u ON u.id = r.author_id
		 WHERE r.comment_id = ? ORDER BY r.created_at ASC`, id,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r db.Reply
			var a db.User
			if rows.Scan(&r.ID, &r.CommentID, &r.AuthorID, &r.Body, &r.CreatedAt, &a.Login, &a.Name, &a.AvatarURL) == nil {
				a.ID = r.AuthorID
				r.Author = &a
				c.Replies = append(c.Replies, r)
			}
		}
	}
	return &c
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func argsAny(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}
