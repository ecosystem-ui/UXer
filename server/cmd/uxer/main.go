package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"uxer/internal/api"
	"uxer/internal/auth"
	"uxer/internal/db"
	"uxer/internal/proxy"
)

func main() {
	loadDotEnv()

	port := getenv("UXER_PORT", "8088")
	dbPath := getenv("UXER_DB_PATH", "data/uxer.db")
	distDir := getenv("UXER_STATIC_DIR", "client/dist")

	secret := sessionSecret()

	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.SQL.Close()

	mgr := auth.NewManager(secret)
	px := proxy.NewHandler(secret)

	apiSrv := api.NewServer(database, mgr, px)

	var static http.Handler
	if info, statErr := os.Stat(distDir); statErr == nil && info.IsDir() {
		static = spaHandler(distDir)
	}

	handler := apiSrv.Routes(static)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Printf("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("graceful shutdown failed: %v", err)
		}
	}()

	log.Printf("UXer listening on http://localhost:%s", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// sessionSecret returns the signing key for session cookies and proxy route
// tokens. In production a missing or weak secret is fatal; in development a
// random ephemeral secret is used so sessions simply reset on restart.
func sessionSecret() string {
	secret := getenv("SESSION_SECRET", "")
	if secret != "" {
		if len(secret) < 32 {
			log.Fatalf("SESSION_SECRET is too short; use at least 32 bytes (e.g. `openssl rand -hex 32`)")
		}
		return secret
	}
	if getenv("UXER_ENV", "development") == "production" {
		log.Fatalf("SESSION_SECRET is required in production (set a long random value, e.g. `openssl rand -hex 32`)")
	}
	log.Printf("warning: SESSION_SECRET not set; using a random ephemeral secret (sessions will not survive restarts)")
	return randomSecret()
}

func randomSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("generate secret: %v", err)
	}
	return hex.EncodeToString(b)
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

// loadDotEnv reads a `.env` file from the working directory if present,
// without overriding variables already set in the environment.
func loadDotEnv() {
	data, err := os.ReadFile(".env")
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
