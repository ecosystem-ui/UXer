package db

import (
	"embed"
	"fmt"
	"sort"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func (d *DB) migrate() error {
	if _, err := d.SQL.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var exists int
		if err := d.SQL.QueryRow(
			`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, name,
		).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if err := d.applyMigration(name, string(body)); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) applyMigration(name, body string) error {
	tx, err := d.SQL.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, stmt := range splitStatements(body) {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
	}
	if _, err := tx.Exec(
		`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		name, time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return err
	}
	return tx.Commit()
}

// splitStatements splits a SQL file on semicolons, dropping blank chunks.
// It is intentionally simple: the bundled migrations contain no semicolons
// inside string literals.
func splitStatements(body string) []string {
	var out []string
	for _, part := range strings.Split(body, ";") {
		if s := strings.TrimSpace(part); s != "" {
			out = append(out, s)
		}
	}
	return out
}
