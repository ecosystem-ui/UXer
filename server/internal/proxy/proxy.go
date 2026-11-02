package proxy

import (
	"compress/gzip"
	"context"
	_ "embed"
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

// HandleProxy serves the top-level design page with the bridge injected.
func (h *Handler) HandleProxy(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, true)
}

// HandleRes serves a rewritten subresource (image/CSS/JS/HTML/font).
func (h *Handler) HandleRes(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, false)
}

func (h *Handler) serve(w http.ResponseWriter, r *http.Request, inject bool) {
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
	h.fetchAndRewrite(w, r, u, inject)
}

func (h *Handler) fetchAndRewrite(w http.ResponseWriter, r *http.Request, u *url.URL, inject bool) {
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

	switch mediaType {
	case "text/html":
		out, rerr := rewriteHTML(body, u, inject)
		if rerr != nil {
			http.Error(w, "rewrite failed", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	case "text/css":
		raw, _ := io.ReadAll(body)
		out := []byte(rewriteCSS(string(raw), u))
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(out)
	default:
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, body)
	}
}
