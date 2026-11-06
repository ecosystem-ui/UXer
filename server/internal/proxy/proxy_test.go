package proxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestValidateIPBlocksNonPublic(t *testing.T) {
	cases := []struct {
		name string
		ip   string
		ok   bool
	}{
		{"loopback v4", "127.0.0.1", false},
		{"loopback v6", "::1", false},
		{"rfc1918 10/8", "10.1.2.3", false},
		{"rfc1918 172.16/12", "172.16.0.1", false},
		{"rfc1918 192.168/16", "192.168.1.1", false},
		{"cgnat 100.64/10", "100.64.0.1", false},
		{"link-local 169.254", "169.254.169.254", false},
		{"benchmark 198.18/15", "198.18.0.1", false},
		{"test-net-1 192.0.2", "192.0.2.1", false},
		{"ietf 192.0.0/24", "192.0.0.1", false},
		{"multicast", "224.0.0.1", false},
		{"class e 240/4", "240.0.0.1", false},
		{"unspecified", "0.0.0.0", false},
		{"broadcast", "255.255.255.255", false},
		{"public v4", "8.8.8.8", true},
		{"public v6", "2606:4700:4700::1111", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIP(net.ParseIP(tc.ip))
			if tc.ok && err != nil {
				t.Fatalf("expected allowed, got %v", err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("expected blocked")
			}
		})
	}
}

func TestOriginTokenRoundTrip(t *testing.T) {
	h := NewHandler("secret-key")
	tok := h.encodeOriginToken("https://marketplace.visualstudio.com")
	origin, err := h.decodeOriginToken(tok)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if origin != "https://marketplace.visualstudio.com" {
		t.Fatalf("got %q", origin)
	}

	// The token must be two DNS-safe labels (no characters outside A-Z2-7 .).
	for _, c := range tok {
		if !(c == '.' || (c >= 'A' && c <= 'Z') || (c >= '2' && c <= '7')) {
			t.Fatalf("token %q contains non-DNS-safe character %q", tok, c)
		}
	}
}

func TestOriginTokenRejectsWrongKey(t *testing.T) {
	a := NewHandler("key-a")
	b := NewHandler("key-b")
	tok := a.encodeOriginToken("https://example.com")
	if _, err := b.decodeOriginToken(tok); err == nil {
		t.Fatal("expected signature verification error with mismatched key")
	}
}

func TestOriginTokenRejectsTamper(t *testing.T) {
	h := NewHandler("secret-key")
	tok := h.encodeOriginToken("https://example.com")

	// Flip a character in the payload label (before the "." separator).
	b := []byte(tok)
	for i := range b {
		if b[i] == '.' {
			break
		}
		if b[i] == 'A' {
			b[i] = 'B'
		} else {
			b[i] = 'A'
		}
		break
	}
	if _, err := h.decodeOriginToken(string(b)); err == nil {
		t.Fatal("expected signature verification error after tampering")
	}
}

func TestHandleProxyRedirectsToPersonaOrigin(t *testing.T) {
	t.Setenv("ALLOW_PRIVATE_HOSTS", "design.test")
	h := NewHandler("secret-key")

	const design = "http://design.test/app/vms"
	req := httptest.NewRequest(http.MethodGet, "/proxy?url="+url.QueryEscape(design), nil)
	req.Host = "localhost:5174"
	rec := httptest.NewRecorder()
	h.HandleProxy(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if loc == "" {
		t.Fatal("missing Location header")
	}

	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("bad Location %q: %v", loc, err)
	}
	if u.Scheme != "http" {
		t.Fatalf("scheme = %q, want http", u.Scheme)
	}
	if u.Path != "/app/vms" {
		t.Fatalf("path = %q, want /app/vms", u.Path)
	}

	labels := strings.Split(u.Hostname(), ".")
	if len(labels) != 3 {
		t.Fatalf("host = %q, want <payload>.<sig>.localhost", u.Hostname())
	}
	if labels[2] != "localhost" {
		t.Fatalf("base host = %q, want localhost", labels[2])
	}
	origin, err := h.decodeOriginToken(labels[0] + "." + labels[1])
	if err != nil {
		t.Fatalf("decode token from host: %v", err)
	}
	if origin != "http://design.test" {
		t.Fatalf("origin = %q, want http://design.test", origin)
	}
}

func TestOriginFromHost(t *testing.T) {
	h := NewHandler("secret-key")
	tok := h.encodeOriginToken("https://example.com")

	if origin, ok := h.OriginFromHost(tok + ".localhost:5174"); !ok || origin != "https://example.com" {
		t.Fatalf("got origin %q ok=%v", origin, ok)
	}
	if _, ok := h.OriginFromHost("localhost:5174"); ok {
		t.Fatal("plain host should not be a persona origin")
	}
	if _, ok := h.OriginFromHost("nottoken.nottoken.localhost"); ok {
		t.Fatal("unsigned token should not be a persona origin")
	}
}
