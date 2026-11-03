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

// nonPublicPrefixes are address ranges that must never be reachable through
// the proxy, beyond what IsPrivate/IsGlobalUnicast already cover. netip's
// IsGlobalUnicast treats RFC1918 private space and ULA as "global unicast",
// so we enumerate the additional non-public ranges explicitly.
var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),          // "this" network
	netip.MustParsePrefix("100.64.0.0/10"),      // CGNAT / shared address space (RFC 6598)
	netip.MustParsePrefix("169.254.0.0/16"),     // link-local (explicit, for clarity)
	netip.MustParsePrefix("192.0.0.0/24"),       // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),       // TEST-NET-1 (RFC 5737)
	netip.MustParsePrefix("192.88.99.0/24"),     // 6to4 relay anycast (deprecated)
	netip.MustParsePrefix("198.18.0.0/15"),      // benchmarking (RFC 2544)
	netip.MustParsePrefix("198.51.100.0/24"),    // TEST-NET-2 (RFC 5737)
	netip.MustParsePrefix("203.0.113.0/24"),     // TEST-NET-3 (RFC 5737)
	netip.MustParsePrefix("224.0.0.0/4"),        // multicast (explicit, for clarity)
	netip.MustParsePrefix("240.0.0.0/4"),        // reserved / class E
	netip.MustParsePrefix("255.255.255.255/32"), // limited broadcast
}

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
// The request context is used so DNS lookups are cancelled when the client
// disconnects.
func validateURL(ctx context.Context, raw string, allow *allowlist) (*url.URL, error) {
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

	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
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

	// Reject anything that is not a routable public unicast address. This
	// covers loopback, unspecified, multicast, and link-local. It does NOT
	// exclude RFC1918/ULA, so we add explicit private and reserved-range
	// checks below.
	if !addr.IsValid() || !addr.IsGlobalUnicast() || addr.IsPrivate() ||
		addr.IsLoopback() || addr.IsMulticast() || addr.IsLinkLocalUnicast() {
		return fmt.Errorf("%w: non-public address %s", ErrBlocked, addr)
	}
	for _, p := range nonPublicPrefixes {
		if p.Contains(addr) {
			return fmt.Errorf("%w: non-public address %s", ErrBlocked, addr)
		}
	}
	return nil
}
