package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"uxer/internal/api"
	"uxer/internal/auth"
	"uxer/internal/db"
	"uxer/internal/proxy"
)

func main() {
	loadDotEnv()

	port := getenv("UXER_PORT", "8080")
	dbPath := getenv("UXER_DB_PATH", "data/uxer.db")
	distDir := getenv("UXER_STATIC_DIR", "client/dist")

	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.SQL.Close()

	mgr := auth.NewManager()
	px := proxy.NewHandler()

	srv := api.NewServer(database, mgr, px)

	var static http.Handler
	if info, statErr := os.Stat(distDir); statErr == nil && info.IsDir() {
		static = spaHandler(distDir)
	}

	handler := srv.Routes(static)

	log.Printf("UXer listening on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

// spaHandler serves a built Vite SPA, falling back to index.html for
// client-side routes.
func spaHandler(dist string) http.Handler {
	fs := http.FileServer(http.Dir(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean("/" + r.URL.Path)
		full := filepath.Join(dist, clean)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dist, "index.html"))
	})
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadDotEnv locates a `.env` file and loads it without overriding variables
// already set in the environment. It searches the current working directory
// first, then walks up parent directories, so it works whether the server is
// run from `UXer/` or `UXer/server/`.
func loadDotEnv() {
	path := findDotEnv()
	if path == "" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		kv := strings.SplitN(line, "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.TrimSpace(kv[0])
		val := strings.Trim(strings.TrimSpace(kv[1]), `"'`)
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}

// findDotEnv returns the first `.env` found from the working directory up to
// the filesystem root, or "" if none exists.
func findDotEnv() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		candidate := filepath.Join(dir, ".env")
		if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
