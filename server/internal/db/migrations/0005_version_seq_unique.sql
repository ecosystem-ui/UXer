CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_project_seq ON versions(project_id, seq);
