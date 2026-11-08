-- Re-key project membership by email so people can be invited before they
-- have an account. When they sign up with the invited address, the existing
-- membership row immediately grants access.
CREATE TABLE IF NOT EXISTS project_members_by_email (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, email)
);

INSERT OR IGNORE INTO project_members_by_email (project_id, email, role, created_at)
SELECT m.project_id, lower(u.email), m.role, m.created_at
FROM project_members m
JOIN users u ON u.id = m.user_id;

DROP TABLE project_members;
ALTER TABLE project_members_by_email RENAME TO project_members;

CREATE INDEX IF NOT EXISTS idx_project_members_email ON project_members(email);
