package proxy

import (
	"compress/gzip"
	"context"
	_ "embed"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

//go:embed bridge.js
var bridgeJS []byte

// Handler proxies a design URL into an iframe-embeddable, rewritten page.
type Handler struct {
	client *http.Client
	allow  *allowlist
}

func NewHandler() *Handler {
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
		TLSHandshakeTimeout: 15 * time.Second,
	}
}

// HandleBridge serves the annotation bridge script.
func (h *Handler) HandleBridge(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(bridgeJS)
}

// HandleProxy is the entry point. The design URL is passed via ?url=. We
// redirect to a path-preserving URL so that the document's pathname carries
// the app's deployment base path — this lets the SPA router's basename match
// after the JS rewrite.
func (h *Handler) HandleProxy(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url parameter", http.StatusBadRequest)
		return
	}
	u, err := validateURL(target, h.allow)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	origin := u.Scheme + "://" + u.Host
	basePath := basePathOf(u)
	b64 := encodeRoute(origin, basePath)

	// Preserve the exact path so the SPA router matches the same route the
	// user was on. Only the app's base path itself gets a trailing slash,
	// so a bare directory URL (e.g. /osac-ux) matches the router basename.
	p := u.Path
	if p == "" || p == "/" {
		p = "/"
	} else if basePath != "/" && p == strings.TrimSuffix(basePath, "/") {
		p += "/"
	}

	dest := "/__uxer__/p/" + b64 + p
	if u.RawQuery != "" {
		dest += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		dest += "#" + u.Fragment
	}
	http.Redirect(w, r, dest, http.StatusFound)
}

// HandlePath serves a path-preserving subresource or nested page
// (/__uxer__/p/{b64}/{rest...}). The base64 blob encodes both the origin and
// the app's deployment base path (separated by a newline).
func (h *Handler) HandlePath(w http.ResponseWriter, r *http.Request) {
	b64 := r.PathValue("b64")
	rest := r.PathValue("rest")

	origin, basePath, err := decodeRoute(b64)
	if err != nil {
		http.Error(w, "invalid proxy path", http.StatusBadRequest)
		return
	}

	target := origin + "/" + rest
	if q := r.URL.RawQuery; q != "" {
		target += "?" + q
	}

	u, err := validateURL(target, h.allow)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	prefix := "/__uxer__/p/" + b64
	proxiedBase := prefix + basePath
	h.serveURL(w, r, u, origin, basePath, prefix, proxiedBase)
}

// serveURL fetches the target and rewrites it in place.
func (h *Handler) serveURL(w http.ResponseWriter, r *http.Request, u *url.URL, origin, basePath, prefix, proxiedBase string) {
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
		out, rerr := rewriteHTML(body, origin, prefix, proxiedBase, u)
		if rerr != nil {
			http.Error(w, "rewrite failed", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	case isJS:
		raw, _ := io.ReadAll(body)
		out := rewriteJS(raw, basePath, proxiedBase)
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	case mediaType == "text/css":
		raw, _ := io.ReadAll(body)
		out := []byte(rewriteCSS(string(raw), origin, prefix))
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	default:
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, body)
	}
}

// encodeRoute packs origin and base path into a URL-safe token.
func encodeRoute(origin, basePath string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(origin + "\n" + basePath))
}

// decodeRoute unpacks a route token into origin and base path.
func decodeRoute(b64 string) (origin, basePath string, err error) {
	raw, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		return "", "", err
	}
	parts := strings.SplitN(string(raw), "\n", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", errors.New("malformed route token")
	}
	if !strings.HasPrefix(parts[0], "http://") && !strings.HasPrefix(parts[0], "https://") {
		return "", "", errors.New("malformed route origin")
	}
	return parts[0], parts[1], nil
}
