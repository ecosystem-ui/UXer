package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"uxer/internal/db"
)

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	rows, err := s.DB.SQL.Query(
		`SELECT id, name, owner_id, created_at, updated_at
		 FROM projects WHERE owner_id = ? ORDER BY updated_at DESC`, u.ID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	projects := []db.Project{}
	for rows.Next() {
		var p db.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.OwnerID, &p.CreatedAt, &p.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		projects = append(projects, p)
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	id := db.NewID()
	ts := now()
	if _, err := s.DB.SQL.Exec(
		`INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		id, name, u.ID, ts, ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, db.Project{
		ID: id, Name: name, OwnerID: u.ID, CreatedAt: ts, UpdatedAt: ts,
	})
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.ownedProject(r, id); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	var p db.Project
	err := s.DB.SQL.QueryRow(
		`SELECT id, name, owner_id, created_at, updated_at FROM projects WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.OwnerID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.ownedProject(r, id); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if _, err := s.DB.SQL.Exec(
		`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`, name, now(), id,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "name": name})
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.ownedProject(r, id); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if _, err := s.DB.SQL.Exec(`DELETE FROM projects WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
