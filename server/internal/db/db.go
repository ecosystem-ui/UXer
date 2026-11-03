package db

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	sqlite "modernc.org/sqlite"
)

// DB wraps the SQLite handle and owns migrations.
type DB struct {
	SQL *sql.DB
}

// Open opens (creating if needed) the SQLite database at path, applies
// pragmas, and runs pending migrations.
func Open(path string) (*DB, error) {
	if path == "" {
		path = "data/uxer.db"
	}
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("mkdir data dir: %w", err)
		}
	}

	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	}
	for _, p := range pragmas {
		if _, err := sqlDB.Exec(p); err != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}

	d := &DB{SQL: sqlDB}
	if err := d.migrate(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

// IsUniqueViolation reports whether err is a SQLite UNIQUE (or PRIMARY KEY)
// constraint violation, so callers can map races to a 409 conflict instead of
// a generic 500.
func IsUniqueViolation(err error) bool {
	var se *sqlite.Error
	if !errors.As(err, &se) {
		return false
	}
	// SQLITE_CONSTRAINT (19), SQLITE_CONSTRAINT_UNIQUE (2067),
	// SQLITE_CONSTRAINT_PRIMARYKEY (1555)
	return se.Code() == 19 || se.Code() == 2067 || se.Code() == 1555
}
