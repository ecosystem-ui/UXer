package api

import (
	"net/http"
	"strings"

	"uxer/internal/db"
)

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	email := normalizeEmail(u.Email)
	rows, err := s.DB.SQL.Query(
		`SELECT p.id, p.name, p.owner_id, ou.name, p.created_at, p.updated_at,
		        CASE WHEN p.owner_id = ? THEN 'owner' ELSE COALESCE(m.role, 'viewer') END AS role
		 FROM projects p
		 JOIN users ou ON ou.id = p.owner_id
		 LEFT JOIN project_members m ON m.project_id = p.id AND m.email = ?
		 WHERE p.owner_id = ? OR m.email = ?
		 ORDER BY p.updated_at DESC`,
		u.ID, email, u.ID, email,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	projects := []db.Project{}
	for rows.Next() {
		var p db.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.OwnerID, &p.OwnerName, &p.CreatedAt, &p.UpdatedAt, &p.Role); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
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
	role := s.projectRole(r, id)
	if role == "" {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	var p db.Project
	err := s.DB.SQL.QueryRow(
		`SELECT p.id, p.name, p.owner_id, ou.name, p.created_at, p.updated_at
		 FROM projects p JOIN users ou ON ou.id = p.owner_id WHERE p.id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.OwnerID, &p.OwnerName, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	p.Role = role
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
	if err := decodeJSON(w, r, &body); err != nil {
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

// handleListMembers lists the non-owner members (viewers) of a project.
// Memberships are keyed by email, so a member may not have signed up yet.
// Owner-only: only the project owner may manage sharing.
func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if _, ok := s.ownedProject(r, projectID); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	rows, err := s.DB.SQL.Query(
		`SELECT m.email, COALESCE(u.name, ''), m.role, m.created_at,
		        CASE WHEN u.id IS NULL THEN 1 ELSE 0 END AS pending
		 FROM project_members m LEFT JOIN users u ON lower(u.email) = m.email
		 WHERE m.project_id = ? ORDER BY m.created_at ASC`, projectID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	members := []db.ProjectMember{}
	for rows.Next() {
		var m db.ProjectMember
		if err := rows.Scan(&m.Email, &m.Name, &m.Role, &m.CreatedAt, &m.Pending); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// handleAddMember shares a project with an email address as a viewer. The
// address does not need to belong to an account: the membership is stored by
// email and takes effect automatically when that person signs up. Owner-only.
func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if _, ok := s.ownedProject(r, projectID); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	email := normalizeEmail(body.Email)
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if !validEmail(email) {
		writeError(w, http.StatusBadRequest, "a valid email is required")
		return
	}
	if email == normalizeEmail(userFrom(r).Email) {
		writeError(w, http.StatusBadRequest, "owner is already a member")
		return
	}

	// Include the display name when an account already exists. A missing
	// account is not an error — the invite is pending until signup.
	var name string
	pending := true
	if err := s.DB.SQL.QueryRow(
		`SELECT name FROM users WHERE lower(email) = ?`, email,
	).Scan(&name); err == nil {
		pending = false
	}

	ts := now()
	if _, err := s.DB.SQL.Exec(
		`INSERT INTO project_members (project_id, email, role, created_at) VALUES (?, ?, 'viewer', ?)
		 ON CONFLICT(project_id, email) DO UPDATE SET role = excluded.role`,
		projectID, email, ts,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "add member failed")
		return
	}
	writeJSON(w, http.StatusCreated, db.ProjectMember{
		Email: email, Name: name, Role: "viewer", CreatedAt: ts, Pending: pending,
	})
}

// handleRemoveMember revokes a member's access to a project by email, which
// also works for invitations that have not been accepted yet. Owner-only.
func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	email := normalizeEmail(r.PathValue("email"))
	if _, ok := s.ownedProject(r, projectID); !ok {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if _, err := s.DB.SQL.Exec(
		`DELETE FROM project_members WHERE project_id = ? AND email = ?`, projectID, email,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "remove member failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
