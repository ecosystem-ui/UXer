package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// rewriteHTML parses, rewrites, and injects the annotation bridge into an
// HTML document.
//
// Path-preserving proxying: same-origin resources are rewritten to
// /__uxer__/p/<b64(origin)><path>, so relative references (JS import(),
// CSS url(), module URLs) resolve correctly inside the proxied document.
func rewriteHTML(r io.Reader, origin, prefix, proxiedBase string, base *url.URL) ([]byte, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return nil, err
	}
	removeBaseTags(doc)
	rewriteNode(doc, origin, prefix)
	injectBridge(doc, origin, prefix, proxiedBase, base)
	var buf bytes.Buffer
	if err := html.Render(&buf, doc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func rewriteNode(n *html.Node, origin, prefix string) {
	if n.Type == html.ElementNode {
		attrs := make([]html.Attribute, 0, len(n.Attr))
		for _, a := range n.Attr {
			key := strings.ToLower(a.Key)
			switch key {
			case "src", "href", "action", "poster", "data-src", "data-href":
				a.Val = rewriteURL(a.Val, origin, prefix)
			case "srcset":
				a.Val = rewriteSrcset(a.Val, origin, prefix)
			case "style":
				a.Val = rewriteCSS(a.Val, origin, prefix)
			case "integrity":
				continue // drop SRI: rewritten bytes no longer match
			case "nonce":
				continue // drop nonce: it would block the injected bridge
			}
			attrs = append(attrs, a)
		}
		n.Attr = attrs

		if n.DataAtom == atom.Style && n.FirstChild != nil && n.FirstChild.Type == html.TextNode {
			n.FirstChild.Data = rewriteCSS(n.FirstChild.Data, origin, prefix)
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		rewriteNode(c, origin, prefix)
	}
}

// injectBridge inserts a <base>, the config script, and the bridge <script>
// at the start of <head>.
func injectBridge(n *html.Node, origin, prefix, proxiedBase string, base *url.URL) {
	cfg := map[string]string{
		"origin": origin,
		"base":   base.String(),
		"prefix": prefix,
	}
	b, _ := json.Marshal(cfg)

	cfgScript := &html.Node{Type: html.ElementNode, Data: "script", DataAtom: atom.Script}
	cfgScript.AppendChild(&html.Node{Type: html.TextNode, Data: "window.__UXER__ = " + string(b) + ";"})

	srcScript := &html.Node{
		Type:     html.ElementNode,
		Data:     "script",
		DataAtom: atom.Script,
		Attr:     []html.Attribute{{Key: "src", Val: "/__uxer__/bridge.js"}},
	}

	// <base> points relative references at the proxied base directory so
	// they resolve through the proxy.
	baseTag := &html.Node{
		Type:     html.ElementNode,
		Data:     "base",
		DataAtom: atom.Base,
		Attr:     []html.Attribute{{Key: "href", Val: proxiedBase}},
	}

	head := findNode(n, atom.Head)
	if head != nil {
		head.InsertBefore(srcScript, head.FirstChild)
		head.InsertBefore(cfgScript, head.FirstChild)
		head.InsertBefore(baseTag, head.FirstChild)
		return
	}
	if n.Type == html.ElementNode && n.DataAtom == atom.Html {
		n.InsertBefore(srcScript, n.FirstChild)
		n.InsertBefore(cfgScript, n.FirstChild)
		n.InsertBefore(baseTag, n.FirstChild)
	}
}

// removeBaseTags strips existing <base> elements so our injected <base> is
// the only one (only the first <base> in a document is honored).
func removeBaseTags(n *html.Node) {
	for c := n.FirstChild; c != nil; {
		next := c.NextSibling
		if c.Type == html.ElementNode && c.DataAtom == atom.Base {
			n.RemoveChild(c)
		} else {
			removeBaseTags(c)
		}
		c = next
	}
}

func findNode(n *html.Node, a atom.Atom) *html.Node {
	if n.Type == html.ElementNode && n.DataAtom == a {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findNode(c, a); found != nil {
			return found
		}
	}
	return nil
}

// basePathOf returns the directory path (with a trailing slash) of a URL's
// path. This is the base the app was deployed under (e.g. a Vite `base`),
// which the router basename and root-relative asset paths are prefixed with.
func basePathOf(u *url.URL) string {
	p := u.Path
	if p == "" || p == "/" {
		return "/"
	}
	if strings.HasSuffix(p, "/") {
		return p
	}
	return p + "/"
}

// rewriteJS rewrites the app's deployment base path inside JavaScript text
// onto the path-preserving proxy base. This fixes two things at once:
//   - the SPA router basename (so it matches the proxied entry URL), and
//   - root-relative asset/API paths embedded in JS string literals.
//
// Root-deployed apps (base "/") need no rewrite.
func rewriteJS(js []byte, basePath, proxiedBase string) []byte {
	if basePath == "" || basePath == "/" {
		return js
	}
	return bytes.ReplaceAll(js, []byte(basePath), []byte(proxiedBase))
}

// rewriteURL maps same-origin absolute and root-relative URLs onto the
// path-preserving proxy. Relative URLs are left untouched — they resolve
// correctly via the injected <base> (HTML) or relative to the module /
// stylesheet URL (JS/CSS), which are themselves path-preserving.
func rewriteURL(raw, origin, prefix string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "#") {
		return raw
	}
	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "data:") ||
		strings.HasPrefix(lower, "javascript:") ||
		strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") ||
		strings.HasPrefix(lower, "blob:") ||
		strings.HasPrefix(lower, "about:") ||
		strings.HasPrefix(raw, "//") { // protocol-relative: leave direct
		return raw
	}

	// Root-relative path: map straight onto the proxy origin.
	if strings.HasPrefix(raw, "/") {
		return prefix + raw
	}

	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if u.IsAbs() {
		if (u.Scheme == "http" || u.Scheme == "https") && (u.Scheme+"://"+u.Host) == origin {
			p := u.Path
			if p == "" {
				p = "/"
			}
			qh := ""
			if u.RawQuery != "" {
				qh += "?" + u.RawQuery
			}
			if u.Fragment != "" {
				qh += "#" + u.Fragment
			}
			return prefix + p + qh
		}
		return raw
	}

	// Relative URL: leave as-is (resolved by <base> / module-relative).
	return raw
}

func rewriteSrcset(v, origin, prefix string) string {
	parts := strings.Split(v, ",")
	for i, p := range parts {
		fields := strings.Fields(strings.TrimSpace(p))
		if len(fields) == 0 {
			continue
		}
		fields[0] = rewriteURL(fields[0], origin, prefix)
		parts[i] = strings.Join(fields, " ")
	}
	return strings.Join(parts, ", ")
}

var cssURLRe = regexp.MustCompile(`url\(\s*([^)]+?)\s*\)`)

// rewriteCSS rewrites url(...) references inside CSS text.
func rewriteCSS(css, origin, prefix string) string {
	return cssURLRe.ReplaceAllStringFunc(css, func(m string) string {
		sub := cssURLRe.FindStringSubmatch(m)
		if len(sub) < 2 {
			return m
		}
		inner := strings.TrimSpace(sub[1])
		quote := ""
		if len(inner) >= 2 {
			c := inner[0]
			if (c == '"' || c == '\'') && inner[len(inner)-1] == c {
				quote = string(c)
				inner = strings.TrimSpace(inner[1 : len(inner)-1])
			}
		}
		if inner == "" || strings.HasPrefix(strings.ToLower(inner), "data:") || strings.HasPrefix(inner, "#") {
			return m
		}
		return "url(" + quote + rewriteURL(inner, origin, prefix) + quote + ")"
	})
}
