package api

import (
	"net/http"
	"net/url"
	"strings"

	"uxer/internal/db"
)

func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if !s.canViewProject(r, projectID) {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	rows, err := s.DB.SQL.Query(
		`SELECT v.id, v.project_id, v.label, v.url, v.seq, v.created_at,
		        (SELECT COUNT(1) FROM comments c WHERE c.version_id = v.id AND c.status = 'open') AS open_count,
		        (SELECT COUNT(1) FROM comments c WHERE c.version_id = v.id AND c.status = 'resolved') AS resolved_count
		 FROM versions v WHERE v.project_id = ? ORDER BY v.seq ASC`, projectID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	versions := []db.Version{}
	for rows.Next() {
		var v db.Version
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.Label, &v.URL, &v.Seq, &v.CreatedAt, &v.OpenCount, &v.ResolvedCount); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		versions = append(versions, v)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, versions)
}

func (s *Server) handleCreateVersion(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if _, ok := s.ownedProject(r, projectID); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var body struct {
		Label string `json:"label"`
		URL   string `json:"url"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	label := strings.TrimSpace(body.Label)
	if label == "" {
		writeError(w, http.StatusBadRequest, "label is required")
		return
	}
	rawURL := strings.TrimSpace(body.URL)
	if rawURL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		writeError(w, http.StatusBadRequest, "url must be a valid http(s) URL")
		return
	}

	// Compute seq atomically inside a transaction so concurrent creates on the
	// same project cannot collide (enforced by idx_versions_project_seq).
	tx, err := s.DB.SQL.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	defer tx.Rollback()

	var maxSeq int
	if err := tx.QueryRow(
		`SELECT COALESCE(MAX(seq), 0) FROM versions WHERE project_id = ?`, projectID,
	).Scan(&maxSeq); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	id := db.NewID()
	ts := now()
	if _, err := tx.Exec(
		`INSERT INTO versions (id, project_id, label, url, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, projectID, label, rawURL, maxSeq+1, ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	writeJSON(w, http.StatusCreated, db.Version{
		ID: id, ProjectID: projectID, Label: label, URL: rawURL, Seq: maxSeq + 1, CreatedAt: ts,
	})
}

func (s *Server) handleUpdateVersion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	v, ok := s.versionFor(r, id, true)
	if !ok {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}

	var body struct {
		Label *string `json:"label"`
		URL   *string `json:"url"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	label := v.Label
	if body.Label != nil {
		label = strings.TrimSpace(*body.Label)
		if label == "" {
			writeError(w, http.StatusBadRequest, "label is required")
			return
		}
	}
	rawURL := v.URL
	if body.URL != nil {
		rawURL = strings.TrimSpace(*body.URL)
		parsed, err := url.Parse(rawURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			writeError(w, http.StatusBadRequest, "url must be a valid http(s) URL")
			return
		}
	}

	if _, err := s.DB.SQL.Exec(
		`UPDATE versions SET label = ?, url = ? WHERE id = ?`, label, rawURL, id,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "label": label, "url": rawURL})
}

func (s *Server) handleDeleteVersion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.versionFor(r, id, true); !ok {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}
	if _, err := s.DB.SQL.Exec(`DELETE FROM versions WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
