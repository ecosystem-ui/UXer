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
// Origin-preserving proxying: the page is served under a persona-specific
// origin (scheme://<token>.<host>), so relative and root-relative references
// resolve correctly on their own. Only same-origin absolute URLs are mapped
// onto the persona origin.
func rewriteHTML(r io.Reader, origin, personaOrigin string, base *url.URL) ([]byte, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return nil, err
	}
	rewriteNode(doc, origin, personaOrigin)
	injectBridge(doc, origin, base)
	var buf bytes.Buffer
	if err := html.Render(&buf, doc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func rewriteNode(n *html.Node, origin, personaOrigin string) {
	if n.Type == html.ElementNode {
		attrs := make([]html.Attribute, 0, len(n.Attr))
		for _, a := range n.Attr {
			key := strings.ToLower(a.Key)
			switch key {
			case "src", "href", "action", "poster", "data-src", "data-href":
				a.Val = rewriteURL(a.Val, origin, personaOrigin)
			case "srcset":
				a.Val = rewriteSrcset(a.Val, origin, personaOrigin)
			case "style":
				a.Val = rewriteCSS(a.Val, origin, personaOrigin)
			case "integrity":
				continue // drop SRI: rewritten bytes no longer match
			case "nonce":
				continue // drop nonce: it would block the injected bridge
			}
			attrs = append(attrs, a)
		}
		n.Attr = attrs

		if n.DataAtom == atom.Style && n.FirstChild != nil && n.FirstChild.Type == html.TextNode {
			n.FirstChild.Data = rewriteCSS(n.FirstChild.Data, origin, personaOrigin)
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		rewriteNode(c, origin, personaOrigin)
	}
}

// injectBridge inserts the config script and the bridge <script> at the
// start of <head>. The bridge script is served at /__uxer__/bridge.js on the
// persona origin.
func injectBridge(n *html.Node, origin string, base *url.URL) {
	cfg := map[string]string{
		"origin": origin,
		"base":   base.String(),
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

	head := findNode(n, atom.Head)
	if head != nil {
		head.InsertBefore(srcScript, head.FirstChild)
		head.InsertBefore(cfgScript, head.FirstChild)
		return
	}
	if n.Type == html.ElementNode && n.DataAtom == atom.Html {
		n.InsertBefore(srcScript, n.FirstChild)
		n.InsertBefore(cfgScript, n.FirstChild)
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

// rewriteJS maps the design's own origin inside JavaScript string literals
// onto the persona origin. URLs built at runtime from window.location.origin
// already resolve to the persona origin and need no rewrite.
func rewriteJS(js []byte, origin, personaOrigin string) []byte {
	if origin == personaOrigin {
		return js
	}
	return bytes.ReplaceAll(js, []byte(origin), []byte(personaOrigin))
}

// rewriteURL maps same-origin absolute URLs onto the persona origin.
// Root-relative, relative, and cross-origin URLs are left untouched — they
// resolve against the persona origin (or, for genuinely external targets,
// leave the persona).
func rewriteURL(raw, origin, personaOrigin string) string {
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

	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if u.IsAbs() && (u.Scheme == "http" || u.Scheme == "https") && (u.Scheme+"://"+u.Host) == origin {
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
		return personaOrigin + p + qh
	}
	return raw
}

func rewriteSrcset(v, origin, personaOrigin string) string {
	parts := strings.Split(v, ",")
	for i, p := range parts {
		fields := strings.Fields(strings.TrimSpace(p))
		if len(fields) == 0 {
			continue
		}
		fields[0] = rewriteURL(fields[0], origin, personaOrigin)
		parts[i] = strings.Join(fields, " ")
	}
	return strings.Join(parts, ", ")
}

var cssURLRe = regexp.MustCompile(`url\(\s*([^)]+?)\s*\)`)

// rewriteCSS rewrites url(...) references inside CSS text.
func rewriteCSS(css, origin, personaOrigin string) string {
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
		return "url(" + quote + rewriteURL(inner, origin, personaOrigin) + quote + ")"
	})
}
