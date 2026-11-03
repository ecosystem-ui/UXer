package proxy

import (
	"net"
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

func TestRouteTokenRoundTrip(t *testing.T) {
	h := NewHandler("secret-key")
	tok := h.encodeRoute("https://example.com", "/app/")
	origin, basePath, err := h.decodeRoute(tok)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if origin != "https://example.com" || basePath != "/app/" {
		t.Fatalf("got %q %q", origin, basePath)
	}
}

func TestRouteTokenRejectsWrongKey(t *testing.T) {
	a := NewHandler("key-a")
	b := NewHandler("key-b")
	tok := a.encodeRoute("https://example.com", "/")
	if _, _, err := b.decodeRoute(tok); err == nil {
		t.Fatal("expected signature verification error with mismatched key")
	}
}

func TestRouteTokenRejectsTamper(t *testing.T) {
	h := NewHandler("secret-key")
	tok := h.encodeRoute("https://example.com", "/")

	// Flip a character in the payload portion (before the '.' separator).
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
	if _, _, err := h.decodeRoute(string(b)); err == nil {
		t.Fatal("expected signature verification error after tampering")
	}
}
