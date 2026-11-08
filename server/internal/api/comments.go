package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"uxer/internal/db"
)

const maxMessageLength = 500

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	versionID := r.PathValue("id")
	v, ok := s.versionFor(r, versionID, false)
	if !ok {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}

	rows, err := s.DB.SQL.Query(
		`SELECT c.id, c.version_id, c.selector, c.text_excerpt, c.page_url, c.step, c.state, c.state_mode, c.x, c.y, c.body,
		        c.status, c.author_id, c.created_at, c.resolved_at, c.resolved_version_id,
		        u.email, u.name
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
		if err := rows.Scan(&c.ID, &c.VersionID, &c.Selector, &c.TextExcerpt, &c.PageURL, &c.Step, &c.State, &c.StateMode, &c.X, &c.Y, &c.Body,
			&c.Status, &c.AuthorID, &c.CreatedAt, &c.ResolvedAt, &c.ResolvedVersionID,
			&author.Email, &author.Name); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		author.ID = c.AuthorID
		c.Author = &author
		c.Replies = []db.Reply{}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
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
		        u.email, u.name
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
			&author.Email, &author.Name); err != nil {
			return err
		}
		author.ID = r.AuthorID
		r.Author = &author
		if c, ok := byID[r.CommentID]; ok {
			c.Replies = append(c.Replies, r)
		}
	}
	return rows.Err()
}

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	versionID := r.PathValue("id")
	v, ok := s.versionFor(r, versionID, false)
	if !ok {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}
	u := userFrom(r)

	var body struct {
		Selector    string  `json:"selector"`
		TextExcerpt string  `json:"text_excerpt"`
		PageURL     string  `json:"page_url"`
		Step        string  `json:"step"`
		State       string  `json:"state"`
		StateMode   string  `json:"state_mode"`
		X           float64 `json:"x"`
		Y           float64 `json:"y"`
		Body        string  `json:"body"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
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
	if utf8.RuneCountInString(strings.TrimSpace(body.Body)) > maxMessageLength {
		writeError(w, http.StatusBadRequest, "body must be 500 characters or fewer")
		return
	}

	id := db.NewID()
	ts := now()
	if _, err := s.DB.SQL.Exec(
		`INSERT INTO comments (id, version_id, selector, text_excerpt, page_url, step, state, state_mode, x, y, body, status, author_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
		id, v.ID, body.Selector, body.TextExcerpt, body.PageURL, body.Step, body.State, body.StateMode, body.X, body.Y, strings.TrimSpace(body.Body), u.ID, ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	created := s.loadComment(id, u)
	if created == nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleCreateReply(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("id")
	c, ok := s.commentFor(r, commentID, false)
	if !ok {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}
	u := userFrom(r)

	var body struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if strings.TrimSpace(body.Body) == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if utf8.RuneCountInString(strings.TrimSpace(body.Body)) > maxMessageLength {
		writeError(w, http.StatusBadRequest, "body must be 500 characters or fewer")
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
		ID: id, CommentID: c.ID, AuthorID: u.ID, Author: u, Body: strings.TrimSpace(body.Body), CreatedAt: ts,
	})
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("id")
	c, ok := s.commentFor(r, commentID, false)
	if !ok {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}

	var body struct {
		Status            string `json:"status"`
		ResolvedVersionID string `json:"resolved_version_id"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	if body.Status == "resolved" {
		resolvedVersionID := body.ResolvedVersionID
		if resolvedVersionID == "" {
			resolvedVersionID = c.VersionID // default: the version it lives on
		}
		if _, ok := s.versionFor(r, resolvedVersionID, false); !ok {
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
	c, ok := s.commentFor(r, commentID, false)
	if !ok {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}
	// Only the project owner or the comment author may delete a comment. This
	// makes the "viewer" (collaborator) role consistent: members can create,
	// reply to, and resolve comments, and may delete their own.
	isOwner := false
	if _, ok := s.commentFor(r, commentID, true); ok {
		isOwner = true
	}
	if !isOwner && c.AuthorID != userFrom(r).ID {
		writeError(w, http.StatusForbidden, "you can only delete your own comments")
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
		`SELECT c.id, c.version_id, c.selector, c.text_excerpt, c.page_url, c.step, c.state, c.state_mode, c.x, c.y, c.body,
		        c.status, c.author_id, c.created_at, c.resolved_at, c.resolved_version_id,
		        u.email, u.name
		 FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`, id,
	).Scan(&c.ID, &c.VersionID, &c.Selector, &c.TextExcerpt, &c.PageURL, &c.Step, &c.State, &c.StateMode, &c.X, &c.Y, &c.Body,
		&c.Status, &c.AuthorID, &c.CreatedAt, &c.ResolvedAt, &c.ResolvedVersionID,
		&author.Email, &author.Name)
	if err != nil {
		return nil
	}
	author.ID = c.AuthorID
	c.Author = &author
	c.Replies = []db.Reply{}

	// load replies
	rows, err := s.DB.SQL.Query(
		`SELECT r.id, r.comment_id, r.author_id, r.body, r.created_at,
		        u.email, u.name
		 FROM replies r JOIN users u ON u.id = r.author_id
		 WHERE r.comment_id = ? ORDER BY r.created_at ASC`, id,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r db.Reply
			var a db.User
			if rows.Scan(&r.ID, &r.CommentID, &r.AuthorID, &r.Body, &r.CreatedAt, &a.Email, &a.Name) == nil {
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
