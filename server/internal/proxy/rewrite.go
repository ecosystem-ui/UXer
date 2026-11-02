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

const resPath = "/__uxer__/res?url="

// rewriteHTML parses, rewrites, and (optionally) injects the annotation
// bridge into an HTML document.
func rewriteHTML(r io.Reader, base *url.URL, inject bool) ([]byte, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return nil, err
	}
	rewriteNode(doc, base)
	if inject {
		injectBridge(doc, base)
	}
	var buf bytes.Buffer
	if err := html.Render(&buf, doc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func rewriteNode(n *html.Node, base *url.URL) {
	if n.Type == html.ElementNode {
		attrs := make([]html.Attribute, 0, len(n.Attr))
		for _, a := range n.Attr {
			key := strings.ToLower(a.Key)
			switch key {
			case "src", "href", "action", "poster", "data-src", "data-href":
				a.Val = rewriteURL(a.Val, base)
			case "srcset":
				a.Val = rewriteSrcset(a.Val, base)
			case "style":
				a.Val = rewriteCSS(a.Val, base)
			case "integrity":
				continue // drop SRI: rewritten bytes no longer match
			case "nonce":
				continue // drop nonce: it would block the injected bridge
			}
			attrs = append(attrs, a)
		}
		n.Attr = attrs

		if n.DataAtom == atom.Style && n.FirstChild != nil && n.FirstChild.Type == html.TextNode {
			n.FirstChild.Data = rewriteCSS(n.FirstChild.Data, base)
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		rewriteNode(c, base)
	}
}

// injectBridge inserts the config + bridge <script> at the start of <head>.
func injectBridge(n *html.Node, base *url.URL) {
	cfg := map[string]string{"base": base.String()}
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
	// No <head>: fall back to prepending inside <html>.
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

// rewriteURL maps same-origin URLs onto the subresource proxy. Relative
// URLs are resolved against base; cross-origin and non-http URLs pass
// through unchanged.
func rewriteURL(raw string, base *url.URL) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	lower := strings.ToLower(raw)
	if strings.HasPrefix(raw, "#") || strings.HasPrefix(lower, "data:") ||
		strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") || strings.HasPrefix(lower, "blob:") ||
		strings.HasPrefix(lower, "about:") {
		return raw
	}

	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if u.IsAbs() {
		if (u.Scheme == "http" || u.Scheme == "https") && u.Host == base.Host {
			return resPath + url.QueryEscape(u.String())
		}
		return raw
	}

	resolved := base.ResolveReference(u)
	if (resolved.Scheme == "http" || resolved.Scheme == "https") && resolved.Host == base.Host {
		return resPath + url.QueryEscape(resolved.String())
	}
	return raw
}

func rewriteSrcset(v string, base *url.URL) string {
	parts := strings.Split(v, ",")
	for i, p := range parts {
		fields := strings.Fields(strings.TrimSpace(p))
		if len(fields) == 0 {
			continue
		}
		fields[0] = rewriteURL(fields[0], base)
		parts[i] = strings.Join(fields, " ")
	}
	return strings.Join(parts, ", ")
}

var cssURLRe = regexp.MustCompile(`url\(\s*([^)]+?)\s*\)`)

// rewriteCSS rewrites url(...) references inside CSS text.
func rewriteCSS(css string, base *url.URL) string {
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
		return "url(" + quote + rewriteURL(inner, base) + quote + ")"
	})
}
