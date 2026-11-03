package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// rateLimiter is a simple in-memory sliding-window limiter keyed by an
// arbitrary string (typically the client IP + route). It is appropriate for a
// single-process deployment; a horizontally-scaled deployment should back it
// with a shared store (e.g. Redis).
type rateLimiter struct {
	mu      sync.Mutex
	window  time.Duration
	max     int
	entries map[string][]time.Time
}

func newRateLimiter(window time.Duration, max int) *rateLimiter {
	return &rateLimiter{
		window:  window,
		max:     max,
		entries: make(map[string][]time.Time),
	}
}

// allow reports whether the key may proceed, recording the attempt on success.
func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)
	hits := l.entries[key]

	// Prune timestamps outside the window in place.
	kept := hits[:0]
	for _, t := range hits {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.entries[key] = kept
		return false
	}
	l.entries[key] = append(kept, now)

	// Bound memory: when the table grows large, drop keys whose most recent
	// hit is already outside the window.
	if len(l.entries) > 10000 {
		for k, ts := range l.entries {
			if len(ts) == 0 || ts[len(ts)-1].Before(cutoff) {
				delete(l.entries, k)
			}
		}
	}
	return true
}

// clientIP extracts the remote IP from the request's RemoteAddr, ignoring the
// port. It does not trust X-Forwarded-For (which clients control) unless a
// trusted reverse proxy is configured to strip it.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
