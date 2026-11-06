package proxy

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	_ "embed"
	"encoding/base32"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// maxUpstreamBody caps how much of an upstream response we buffer for
// rewriting. Beyond this size the request is aborted to protect server
// memory from unbounded proxied responses.
const maxUpstreamBody = 16 << 20 // 16 MiB

//go:embed bridge.js
var bridgeJS []byte

// Handler proxies a design URL into an iframe-embeddable, rewritten page.
type Handler struct {
	client *http.Client
	allow  *allowlist
	key    []byte // HMAC key for signing route tokens
}

// NewHandler builds a proxy handler. secret is the shared signing key used to
// authenticate route tokens so clients cannot mint arbitrary proxy paths.
func NewHandler(secret string) *Handler {
	allow := newAllowlist(os.Getenv("ALLOW_PRIVATE_HOSTS"))
	return &Handler{
		client: &http.Client{
			Transport: safeTransport(allow),
			Timeout:   30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 6 {
					return errors.New("too many redirects")
				}
				return nil
			},
		},
		allow: allow,
		key:   []byte(secret),
	}
}

// safeTransport dials only validated addresses while preserving TLS SNI for
// the original hostname.
func safeTransport(allow *allowlist) *http.Transport {
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			if allow != nil && allow.allows(host) {
				return dialer.DialContext(ctx, network, addr)
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ipa := range ips {
				if err := validateIP(ipa.IP); err != nil {
					return nil, err
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
		},
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
	}
}

// HandleBridge serves the annotation bridge script.
func (h *Handler) HandleBridge(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(bridgeJS)
}

// HandleProxy is the entry point. The design URL is passed via ?url=. We mint
// a signed origin token and redirect to the persona's own origin
// (scheme://<token>.<host>/<path>), so the proxied page has a unique origin
// and the design's own routing works unchanged.
func (h *Handler) HandleProxy(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url parameter", http.StatusBadRequest)
		return
	}
	u, err := validateURL(r.Context(), target, h.allow)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	origin := u.Scheme + "://" + u.Host
	token := h.encodeOriginToken(origin)

	// Preserve the design path verbatim so its router matches the same route.
	p := u.Path
	if p == "" || p == "/" {
		p = "/"
	}

	dest := requestScheme(r) + "://" + token + "." + r.Host + p
	if u.RawQuery != "" {
		dest += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		dest += "#" + u.Fragment
	}
	http.Redirect(w, r, dest, http.StatusFound)
}

// HandleOrigin serves a request addressed to a persona origin. The proxied
// origin is recovered from the signed subdomain token; the token itself is
// the credential (its HMAC signature prevents forging arbitrary origins), so
// subresource requests work without the session cookie.
func (h *Handler) HandleOrigin(w http.ResponseWriter, r *http.Request, origin string) {
	if r.URL.Path == "/__uxer__/bridge.js" {
		h.HandleBridge(w, r)
		return
	}

	target := origin + r.URL.Path
	if q := r.URL.RawQuery; q != "" {
		target += "?" + q
	}

	u, err := validateURL(r.Context(), target, h.allow)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	h.serveURL(w, r, u, origin, requestScheme(r)+"://"+r.Host)
}

// requestScheme reports the external scheme for the request, honoring a
// reverse-proxy's X-Forwarded-Proto header.
func requestScheme(r *http.Request) string {
	if s := r.Header.Get("X-Forwarded-Proto"); s == "http" || s == "https" {
		return s
	}
	return "http"
}

// serveURL fetches the target and rewrites it in place.
func (h *Handler) serveURL(w http.ResponseWriter, r *http.Request, u *url.URL, origin, personaOrigin string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Ask for an uncompressed body so we can rewrite it; handle gzip anyway.
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; UXer/1.0)")

	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, "upstream fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body := resp.Body
	if strings.EqualFold(resp.Header.Get("Content-Encoding"), "gzip") {
		gz, gerr := gzip.NewReader(resp.Body)
		if gerr != nil {
			http.Error(w, "bad upstream encoding", http.StatusBadGateway)
			return
		}
		defer gz.Close()
		body = gz
	}

	contentType := resp.Header.Get("Content-Type")
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))

	// Copy safe headers (no hop-by-hop, no framing/CSP headers, no length).
	for k, vs := range resp.Header {
		lk := strings.ToLower(k)
		switch lk {
		case "content-length", "content-encoding", "transfer-encoding", "connection",
			"keep-alive", "upgrade", "x-frame-options", "content-security-policy",
			"content-security-policy-report-only":
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")

	isJS := mediaType == "text/javascript" || mediaType == "application/javascript" ||
		mediaType == "application/x-javascript" || mediaType == "text/ecmascript" ||
		mediaType == "application/ecmascript" ||
		strings.HasSuffix(strings.ToLower(u.Path), ".js") ||
		strings.HasSuffix(strings.ToLower(u.Path), ".mjs")

	switch {
	case mediaType == "text/html":
		raw, over := readLimited(body, maxUpstreamBody)
		if over {
			http.Error(w, "upstream response too large", http.StatusBadGateway)
			return
		}
		out, rerr := rewriteHTML(bytes.NewReader(raw), origin, personaOrigin, u)
		if rerr != nil {
			http.Error(w, "rewrite failed", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	case isJS:
		raw, over := readLimited(body, maxUpstreamBody)
		if over {
			http.Error(w, "upstream response too large", http.StatusBadGateway)
			return
		}
		out := rewriteJS(raw, origin, personaOrigin)
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	case mediaType == "text/css":
		raw, over := readLimited(body, maxUpstreamBody)
		if over {
			http.Error(w, "upstream response too large", http.StatusBadGateway)
			return
		}
		out := []byte(rewriteCSS(string(raw), origin, personaOrigin))
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	default:
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, body)
	}
}

// readLimited reads up to limit bytes, returning (nil, true) when the stream
// exceeds the limit or errors, so callers can abort instead of buffering an
// unbounded response.
func readLimited(r io.Reader, limit int64) ([]byte, bool) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, true
	}
	if int64(len(data)) > limit {
		return nil, true
	}
	return data, false
}

// encodeOriginToken packs an origin into two DNS-safe subdomain labels
// (<payload>.<signature>) using base32 (alphabet A-Z2-7, no padding), which is
// valid in hostnames. The HMAC signature prevents clients from forging
// arbitrary proxy origins.
func (h *Handler) encodeOriginToken(origin string) string {
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	mac := hmac.New(sha256.New, h.key)
	mac.Write([]byte(origin))
	sig := mac.Sum(nil)
	return enc.EncodeToString([]byte(origin)) + "." + enc.EncodeToString(sig)
}

// decodeOriginToken unpacks and verifies a two-label origin token.
func (h *Handler) decodeOriginToken(token string) (string, error) {
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	token = strings.ToUpper(token)
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", errors.New("malformed origin token")
	}
	payload, err := enc.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	sig, err := enc.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, h.key)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return "", errors.New("invalid origin token signature")
	}

	origin := string(payload)
	if !strings.HasPrefix(origin, "http://") && !strings.HasPrefix(origin, "https://") {
		return "", errors.New("malformed origin")
	}
	return origin, nil
}

// OriginFromHost reports whether host is a persona origin (two signed DNS
// labels followed by the base host) and, if so, the proxied origin.
func (h *Handler) OriginFromHost(host string) (string, bool) {
	name := host
	if i := strings.IndexByte(name, ':'); i >= 0 {
		name = name[:i]
	}
	labels := strings.Split(name, ".")
	if len(labels) < 3 {
		return "", false
	}
	origin, err := h.decodeOriginToken(labels[0] + "." + labels[1])
	if err != nil {
		return "", false
	}
	return origin, true
}
