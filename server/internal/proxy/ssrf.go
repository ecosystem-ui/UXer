package proxy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"
)

var ErrBlocked = errors.New("blocked destination")

// allowlist is a set of hostnames that may bypass the SSRF guard (used to
// preview localhost targets during development).
type allowlist struct {
	hosts map[string]bool
}

func newAllowlist(csv string) *allowlist {
	m := map[string]bool{}
	for _, h := range strings.Split(csv, ",") {
		h = strings.ToLower(strings.TrimSpace(h))
		if h != "" {
			m[h] = true
		}
	}
	return &allowlist{hosts: m}
}

func (a *allowlist) allows(host string) bool {
	if a == nil {
		return false
	}
	return a.hosts[strings.ToLower(host)]
}

// validateURL parses the target and rejects non-http(s), credentialed, and
// non-public destinations. It also resolves DNS and validates every address.
func validateURL(raw string, allow *allowlist) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%w: scheme %q", ErrBlocked, u.Scheme)
	}
	if u.User != nil {
		return nil, fmt.Errorf("%w: credentials in URL not allowed", ErrBlocked)
	}
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("%w: empty host", ErrBlocked)
	}
	if allow != nil && allow.allows(host) {
		return u, nil
	}

	ips, err := net.DefaultResolver.LookupIPAddr(context.Background(), host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("%w: no addresses", ErrBlocked)
	}
	for _, ipa := range ips {
		if err := validateIP(ipa.IP); err != nil {
			return nil, err
		}
	}
	return u, nil
}

func validateIP(ip net.IP) error {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		addr = netip.MustParseAddr(ip.String())
	}
	addr = addr.Unmap()
	// Only global unicast is allowed: this excludes loopback, RFC1918
	// private ranges, link-local, multicast, and unspecified addresses.
	if !addr.IsGlobalUnicast() {
		return fmt.Errorf("%w: non-public address %s", ErrBlocked, addr)
	}
	return nil
}
