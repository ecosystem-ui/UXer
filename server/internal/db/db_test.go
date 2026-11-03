package db

import (
	"path/filepath"
	"testing"
)

func TestIsUniqueViolation(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.SQL.Close()

	insert := func(email string) error {
		_, err := d.SQL.Exec(
			`INSERT INTO users (id, email, name, password_hash, created_at)
			 VALUES (?, ?, 'n', 'h', '2026-01-01T00:00:00Z')`,
			NewID(), email,
		)
		return err
	}

	if err := insert("dup@example.com"); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	err = insert("dup@example.com")
	if err == nil {
		t.Fatal("expected duplicate key error")
	}
	if !IsUniqueViolation(err) {
		t.Fatalf("expected IsUniqueViolation to detect error, got %v", err)
	}
}
