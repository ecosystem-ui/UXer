/* UXer bridge — runs inside the proxied design page. Communicates with the
 * parent React app over postMessage. Provides:
 *   - browse / comment modes
 *   - hover highlight + click-to-capture (selector, text, relative x/y)
 *   - Shadow DOM pins overlay
 *   - SPA proxying (fetch / XHR / history patches)
 */
(function () {
  'use strict';
  if (window.__UXER_BRIDGE__) return;
  window.__UXER_BRIDGE__ = true;

  var config = window.__UXER__ || {};
  var base = config.base || window.location.href;
  var origin = config.origin || (function () {
    try { return new URL(base).origin; } catch (e) { return window.location.origin; }
  })();
  var prefix = config.prefix || '/__uxer__/p/';
  var mode = 'browse';
  var pins = [];
  var activeHighlight = null;
  var highlightTimer = null;

  function post(type, data) {
    try {
      window.parent.postMessage(
        Object.assign({ source: 'uxer-bridge', type: type }, data || {}),
        '*'
      );
    } catch (e) {}
  }

  // Extract the pathname from any URL form (absolute, root-relative, or
  // relative), without query or hash.
  function pathOf(u) {
    try { return new URL(u, base).pathname; } catch (e) {
      var p = String(u);
      var q = p.indexOf('?'); if (q >= 0) p = p.slice(0, q);
      var h = p.indexOf('#'); if (h >= 0) p = p.slice(0, h);
      return p;
    }
  }

  // Is this URL already in path-preserving proxied form (path or absolute)?
  function isProxied(u) {
    return typeof u === 'string' && pathOf(u).indexOf(prefix) === 0;
  }

  // Map a URL back to the real origin design URL. Handles proxied absolute
  // URLs (e.g. window.location.href) and proxied paths alike.
  function designUrl(u) {
    if (typeof u !== 'string') return u;
    try {
      var a = new URL(u, base);
      var path = a.pathname;
      if (path.indexOf(prefix) === 0) {
        return origin + path.slice(prefix.length) + a.search + a.hash;
      }
      return a.href;
    } catch (e) { return u; }
  }

  // Normalize a design URL to a comparable key: origin + pathname (trailing
  // slash stripped) + search. Hash is ignored so in-page anchor changes keep
  // the same pins visible.
  function pageKey(u) {
    if (typeof u !== 'string' || !u) return '';
    try {
      var a = new URL(u, base);
      var p = a.pathname;
      if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
      return a.origin + p + a.search;
    } catch (e) { return String(u); }
  }

  // The design URL of the page currently shown in the iframe.
  function currentPage() {
    return pageKey(designUrl(window.location.href));
  }

  function isSameOrigin(u) {
    if (typeof u === 'string' && isProxied(u)) return true;
    try {
      return new URL(u, base).origin === origin;
    } catch (e) { return false; }
  }

  // Map a URL onto the path-preserving proxy; already-proxied and
  // cross-origin URLs pass through unchanged.
  function resUrl(u) {
    if (typeof u === 'string') {
      if (isProxied(u)) return u;
      if (u.charAt(0) === '/') {
        var a = new URL(u, base);
        if (a.origin === origin) return prefix + a.pathname + a.search;
        return u;
      }
    }
    try {
      var b = new URL(u, base);
      if (b.origin !== origin) return b.href;
      return prefix + b.pathname + b.search;
    } catch (e) { return u; }
  }

  /* ---------- selector + capture ---------- */

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function nthOfType(el) {
    var tag = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (!parent) return tag;
    var sibs = Array.prototype.filter.call(parent.children, function (c) {
      return c.tagName === el.tagName;
    });
    if (sibs.length <= 1) return tag;
    return tag + ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
  }

  function countMatches(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
  }

  function uniqueSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) {
      var s = '#' + cssEscape(el.id);
      if (countMatches(s) === 1) return s;
    }
    var dt = el.getAttribute && el.getAttribute('data-testid');
    if (dt) {
      var t = '[data-testid="' + String(dt).replace(/"/g, '\\"') + '"]';
      if (countMatches(t) === 1) return t;
    }

    // Path of nth-of-type segments up to the first stable ancestor.
    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      if (node.id) {
        path.unshift('#' + cssEscape(node.id));
        break;
      }
      path.unshift(nthOfType(node));
      node = node.parentElement;
    }
    var candidate = path.join(' > ');
    if (countMatches(candidate) === 1) return candidate;

    // Fallback: full structural path from body.
    var path2 = [];
    node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      path2.unshift(nthOfType(node));
      node = node.parentElement;
    }
    return 'body > ' + path2.join(' > ');
  }

  function textExcerpt(el) {
    var t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120);
  }

  function capture(el, cx, cy) {
    var rect = el.getBoundingClientRect();
    var x = rect.width > 0 ? (cx - rect.left) / rect.width : 0.5;
    var y = rect.height > 0 ? (cy - rect.top) / rect.height : 0.5;
    return {
      selector: uniqueSelector(el),
      text: textExcerpt(el),
      url: designUrl(window.location.href),
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y))
    };
  }

  /* ---------- Shadow DOM overlay ---------- */

  var host = document.createElement('div');
  host.id = '__uxer_overlay';
  host.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
  var shadow = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent =
    '.uxer-highlight{position:fixed;display:none;outline:3px solid #2563eb;' +
    'outline-offset:1px;background:rgba(37,99,235,0.12);box-sizing:border-box;}' +
    '.uxer-pin{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;' +
    'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
    'font:600 11px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;' +
    'background:#2563eb;box-shadow:0 1px 3px rgba(0,0,0,0.4);}' +
    '.uxer-pin.resolved{background:#16a34a;}';
  var highlightEl = document.createElement('div');
  highlightEl.className = 'uxer-highlight';
  var pinsLayer = document.createElement('div');
  pinsLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

  shadow.appendChild(style);
  shadow.appendChild(highlightEl);
  shadow.appendChild(pinsLayer);

  function mountOverlay() {
    if (!document.body) return false;
    if (!host.parentNode) document.body.appendChild(host);
    return true;
  }

  function positionHighlight(el) {
    var r = el.getBoundingClientRect();
    highlightEl.style.display = 'block';
    highlightEl.style.left = r.left + 'px';
    highlightEl.style.top = r.top + 'px';
    highlightEl.style.width = r.width + 'px';
    highlightEl.style.height = r.height + 'px';
  }

  function renderPins() {
    if (!mountOverlay()) return;
    pinsLayer.innerHTML = '';
    var cur = currentPage();
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      // Only render pins that belong to the current page. Pins with no url
      // (legacy) are shown everywhere.
      if (p.url && cur && pageKey(p.url) !== cur) continue;
      var el = null;
      try { el = document.querySelector(p.selector); } catch (e) {}
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var dot = document.createElement('div');
      dot.className = 'uxer-pin' + (p.status === 'resolved' ? ' resolved' : '');
      dot.textContent = String(p.index);
      dot.style.left = (r.left + r.width * p.x) + 'px';
      dot.style.top = (r.top + r.height * p.y) + 'px';
      pinsLayer.appendChild(dot);
    }
  }

  function refreshPositions() {
    renderPins();
    if (activeHighlight) {
      var el = null;
      try { el = document.querySelector(activeHighlight); } catch (e) {}
      if (el) positionHighlight(el);
    }
  }

  function throttle(fn, ms) {
    var t = null;
    return function () {
      if (t) return;
      t = setTimeout(function () { t = null; fn(); }, ms);
    };
  }

  /* ---------- interaction ---------- */

  document.addEventListener('mouseover', function (e) {
    if (mode !== 'comment') return;
    var el = e.target;
    if (el && el.nodeType === 1 && el !== host) positionHighlight(el);
  }, true);

  document.addEventListener('click', function (e) {
    if (mode !== 'comment') return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    post('anchor', { anchor: capture(el, e.clientX, e.clientY) });
  }, true);

  window.addEventListener('resize', throttle(refreshPositions, 100));
  document.addEventListener('scroll', throttle(refreshPositions, 120), true);

  /* ---------- message handling ---------- */

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.source !== 'uxer') return;
    if (d.type === 'mode') {
      mode = d.mode === 'comment' ? 'comment' : 'browse';
      if (mode === 'browse') clearHighlight();
    } else if (d.type === 'pins') {
      pins = d.pins || [];
      renderPins();
    } else if (d.type === 'focus') {
      focusSelector(d.selector);
    } else if (d.type === 'navigate') {
      navigateTo(d.url, d.selector);
    }
  });

  function clearHighlight() {
    highlightEl.style.display = 'none';
    activeHighlight = null;
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
  }

  function focusSelector(selector, retries) {
    if (typeof retries !== 'number') retries = 0;
    var el = null;
    try { el = document.querySelector(selector); } catch (e) {}
    if (!el) {
      if (retries > 0) {
        setTimeout(function () { focusSelector(selector, retries - 1); }, 150);
      }
      return;
    }
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    activeHighlight = selector;
    positionHighlight(el);
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(clearHighlight, 2500);
  }

  // Client-side navigate the SPA to a design URL (same origin), then focus
  // an element. SPA deep links aren't served by the origin (e.g. GitHub
  // Pages), so we drive the router in place instead of a full reload.
  function navigateTo(url, selector) {
    try {
      var a = new URL(url, base);
      if (a.origin !== origin) return false;
      var path = prefix + a.pathname + a.search + a.hash;
      var cur = window.location.pathname + window.location.search + window.location.hash;
      if (path !== cur) {
        // pushState goes through the patched version, which updates `base`
        // and notifies the parent. The popstate triggers the router.
        history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }
      if (selector) focusSelector(selector, 30);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- SPA proxying ---------- */

  function patchFetch() {
    var of = window.fetch;
    if (typeof of !== 'function') return;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (url && isSameOrigin(url)) {
        if (typeof input === 'string') {
          input = resUrl(url);
        } else {
          input = new Request(resUrl(url), input);
        }
      }
      return of.call(this, input, init);
    };
  }

  function patchXHR() {
    if (!window.XMLHttpRequest) return;
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (url && isSameOrigin(url)) url = resUrl(url);
      return oo.call(this, method, url);
    };
  }

  function patchHistory() {
    var op = history.pushState;
    var or = history.replaceState;
    history.pushState = function (state, title, url) {
      var target = url;
      if (url) {
        base = designUrl(url);
        post('location', { url: base });
        // Keep the URL as-is: the app's router already emits the
        // path-preserving proxied path (its basename was rewritten).
      }
      return op.call(this, state, title, target);
    };
    history.replaceState = function (state, title, url) {
      var target = url;
      if (url) {
        base = designUrl(url);
        post('location', { url: base });
      }
      return or.call(this, state, title, target);
    };
    window.addEventListener('popstate', function () {
      base = designUrl(window.location.pathname + window.location.search);
      post('location', { url: base });
    });
    window.addEventListener('hashchange', function () {
      base = designUrl(window.location.href);
      post('location', { url: base });
    });
  }

  // Reverse-map a proxied URL back to the real origin URL (for window.open).
  function unproxied(u) {
    return designUrl(u);
  }

  function patchOpen() {
    var ow = window.open;
    if (typeof ow !== 'function') return;
    window.open = function (url) {
      var abs = url ? unproxied(url) : url;
      return ow.call(window, abs || '', '_blank');
    };
  }

  patchFetch();
  patchXHR();
  patchHistory();
  patchOpen();

  /* ---------- DOM mutation refresh ---------- */

  var mo = new MutationObserver(throttle(refreshPositions, 150));
  function observe() {
    if (document.body) mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  }
  observe();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  }

  function ready() {
    if (mountOverlay()) {
      post('ready', { url: base, prefix: prefix });
      renderPins();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
