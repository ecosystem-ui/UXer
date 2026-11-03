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
  var activeHighlightPage = null;
  var highlightTimer = null;
  // Wizard-replay progress tracking, used to detect when the wizard is gated
  // by validation/required fields and can't reach the target step.
  var replayStep = '';
  var replayStuck = 0;

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

  // Auto-generated IDs are regenerated on every render, so a selector built
  // from one breaks as soon as the page reloads. These include PatternFly's
  // `pf-random-id-_r_16_` / `pf-nav-expandable-_r_f_` (a `_r_XX_` useId
  // suffix) and React 19's `:rN:` form. Treat them as unstable and fall back
  // to a structural path (or a stable attribute) instead.
  function isUnstableId(id) {
    return /^pf-random-id-/.test(id) ||
           /_r_[0-9a-z]+_$/i.test(id) ||
           /^:r\d+:/.test(id);
  }

  function isUnstableValue(v) {
    return /^pf-random-id-/.test(v) ||
           /_r_[0-9a-z]+_$/i.test(v) ||
           /:r\d+:/.test(v);
  }

  function escapeAttr(v) {
    return String(v).replace(/"/g, '\\"');
  }

  function escapeText(v) {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function normalizeText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Return a CSS class selector built from an element's stable classes,
  // dropping PatternFly modifiers/state (`pf-m-*`) and utility/state classes
  // that change between renders.
  function stableClassSelector(el) {
    var cls = typeof el.className === 'string' ? el.className : '';
    if (!cls) return '';
    var parts = cls.split(/\s+/).filter(function (c) {
      if (!c) return false;
      if (/^pf-m-/.test(c)) return false;
      if (/^(is-|has-)/.test(c)) return false;
      if (/^(active|selected|focused|disabled|current|open|closed|expanded|collapsed|hover|focus|hidden)$/i.test(c)) return false;
      return true;
    });
    if (!parts.length) return '';
    return parts.map(function (c) { return '.' + cssEscape(c); }).join('');
  }

  // Resolve a selector that may carry a text constraint of the form
  //   <css>:uxer-text("<exact text>")
  // Plain CSS selectors pass through to querySelector. Text constraints let us
  // anchor on stable classes + content (e.g. a card title) instead of a
  // brittle structural nth-of-type path.
  function queryAll(sel) {
    if (!sel) return [];
    var m = /^(.*?):uxer-text\("((?:[^"\\]|\\.)*)"\)$/.exec(sel);
    if (!m) {
      try { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
      catch (e) { return []; }
    }
    var base = m[1];
    var text = m[2].replace(/\\(["\\])/g, '$1');
    var els = [];
    try { els = Array.prototype.slice.call(document.querySelectorAll(base)); }
    catch (e) { return []; }
    return els.filter(function (el) { return normalizeText(el) === text; });
  }

  function findElement(sel) {
    var all = queryAll(sel);
    return all.length ? all[0] : null;
  }

  function uniqueSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    var tag = el.tagName.toLowerCase();

    if (el.id && !isUnstableId(el.id)) {
      var s = '#' + cssEscape(el.id);
      if (countMatches(s) === 1) return s;
    }

    // Stable data-* attributes (test ids and similar) produce resilient
    // selectors. Skip auto-generated PatternFly OUIA ids (useId suffix
    // `_r_XX_`) which change on every render.
    var dataAttrs = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-id',
                     'data-qa-id', 'data-ouia-component-id'];
    for (var di = 0; di < dataAttrs.length; di++) {
      var dv = el.getAttribute && el.getAttribute(dataAttrs[di]);
      if (!dv || isUnstableValue(dv)) continue;
      var ds = '[' + dataAttrs[di] + '="' + escapeAttr(dv) + '"]';
      if (countMatches(ds) === 1) return ds;
    }

    // Stable, semantic attributes produce resilient selectors. PatternFly
    // form controls (search inputs, filters) often have an aria-label or
    // placeholder but no stable id, so prefer these over a structural path
    // that would otherwise anchor on a volatile auto-generated ID.
    var stableAttrs = ['aria-label', 'placeholder', 'name', 'title'];
    for (var i = 0; i < stableAttrs.length; i++) {
      var av = el.getAttribute && el.getAttribute(stableAttrs[i]);
      if (!av) continue;
      var as = tag + '[' + stableAttrs[i] + '="' + escapeAttr(av) + '"]';
      if (countMatches(as) === 1) return as;
    }

    // Text-anchored selector: for leaf elements with short, stable text (card
    // titles, buttons, labels, cells), anchor on a stable class plus the exact
    // text content. This is far more resilient than a structural nth-of-type
    // path, which breaks when sibling DOM shifts.
    var ownText = normalizeText(el);
    if (ownText && ownText.length <= 80) {
      var clsSel = stableClassSelector(el);
      if (clsSel) {
        var ts = clsSel + ':uxer-text("' + escapeText(ownText) + '")';
        if (queryAll(ts).length === 1) return ts;
      }
    }

    // Path of nth-of-type segments up to the first stable ancestor.
    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      if (node.id && !isUnstableId(node.id)) {
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

  // The active wizard step, if the element lives inside a stepper. PatternFly
  // marks the current nav link with aria-current="step" and `.pf-m-current`,
  // and gives each step a stable id (e.g. "catalog", "networking"). We prefer
  // the id, then the label text, then the 0-based index.
  function currentStepKey() {
    var links = document.querySelectorAll('.pf-v6-c-wizard__nav-link');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var isCurrent = l.getAttribute('aria-current') === 'step' ||
        /\bpf-m-current\b/.test(l.className || '');
      if (!isCurrent) continue;
      if (l.id) return l.id;
      var txt = (l.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
      return String(i);
    }
    return '';
  }

  // The wizard's "Next" button, if one is present. It may be disabled (e.g.
  // validation still pending) — callers check `.disabled` before clicking.
  function wizardNextButton() {
    var footer = document.querySelector('.pf-v6-c-wizard__footer');
    if (!footer) return null;
    var btns = footer.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if ((b.textContent || '').replace(/\s+/g, ' ').trim() === 'Next') return b;
    }
    return null;
  }

  // The wizard nav link matching a recorded step key (id first, then label
  // text, then 0-based index).
  function wizardStepLink(step) {
    var links = document.querySelectorAll('.pf-v6-c-wizard__nav-link');
    for (var i = 0; i < links.length; i++) {
      if (links[i].id === step) return links[i];
    }
    for (var i = 0; i < links.length; i++) {
      var txt = (links[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (txt === step) return links[i];
    }
    if (/^\d+$/.test(step)) {
      var idx = parseInt(step, 10);
      if (idx >= 0 && idx < links.length) return links[idx];
    }
    return null;
  }

  // A human-readable label for a recorded step key (e.g. "Cluster version").
  function wizardStepLabel(step) {
    var link = wizardStepLink(step);
    if (!link) return step || '';
    var main = link.querySelector('.pf-v6-c-wizard__nav-link-main');
    if (main) {
      var t = (main.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return (link.textContent || '').replace(/\s+/g, ' ').trim() || step;
  }

  // Why the wizard currently can't advance ('' if it can). PatternFly shows
  // validation errors via `aria-invalid` / `.pf-m-error`, or disables "Next"
  // (but only counts a disabled Next as a block when there's no catalog card
  // left to select, i.e. we're past the card-selection gate).
  function wizardBlockReason() {
    var invalid = document.querySelector(
      '[aria-invalid="true"], .pf-m-error, .pf-v6-c-form__group.pf-m-error'
    );
    if (invalid) return 'validation';
    var next = wizardNextButton();
    var card = document.querySelector('.catalog-item-card--wizard');
    if (next && next.disabled && !card) return 'required-fields';
    return '';
  }

  function capture(el, cx, cy) {
    var rect = el.getBoundingClientRect();
    var x = rect.width > 0 ? (cx - rect.left) / rect.width : 0.5;
    var y = rect.height > 0 ? (cy - rect.top) / rect.height : 0.5;
    return {
      selector: uniqueSelector(el),
      text: textExcerpt(el),
      url: designUrl(window.location.href),
      step: currentStepKey(),
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
      var el = findElement(p.selector);
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
      // If the iframe navigated to a different page, the highlighted element
      // no longer exists — drop the stale border instead of leaving it behind.
      var cur = currentPage();
      if (activeHighlightPage && cur && activeHighlightPage !== cur) {
        clearHighlight();
        return;
      }
      var el = findElement(activeHighlight);
      if (el) positionHighlight(el);
      else clearHighlight();
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
      focusWithStep(d.selector, d.step, 20, d.persist, d.id);
    } else if (d.type === 'navigate') {
      navigateTo(d.url, d.selector, d.step, d.persist, d.id);
    } else if (d.type === 'clear') {
      clearHighlight();
    }
  });

  function clearHighlight() {
    highlightEl.style.display = 'none';
    activeHighlight = null;
    activeHighlightPage = null;
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
  }

  function focusSelector(selector, retries, persist) {
    if (typeof retries !== 'number') retries = 0;
    var el = findElement(selector);
    if (!el) {
      if (retries > 0) {
        setTimeout(function () { focusSelector(selector, retries - 1, persist); }, 150);
      }
      return;
    }
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    activeHighlight = selector;
    activeHighlightPage = currentPage();
    positionHighlight(el);
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
    if (!persist) highlightTimer = setTimeout(clearHighlight, 2500);
  }

  // Focus an element, optionally replaying a wizard to its recorded step first
  // (see currentStepKey / wizardNextButton). When the wizard can't advance
  // because required fields / validation block it, we post a `step-blocked`
  // message with guidance instead of polling until the budget runs out.
  function focusWithStep(selector, step, retries, persist, id) {
    replayStep = '';
    replayStuck = 0;
    stepLoop(selector, step, retries, persist, id);
  }

  function stepLoop(selector, step, retries, persist, id) {
    if (!step) {
      focusSelector(selector, retries, persist);
      return;
    }

    if (currentStepKey() === step) {
      focusSelector(selector, 30, persist);
      return;
    }

    function schedule() {
      if (retries > 0) {
        setTimeout(function () { stepLoop(selector, step, retries - 1, persist, id); }, 250);
      } else {
        focusSelector(selector, 10, persist);
      }
    }

    var cur = currentStepKey();
    var link = wizardStepLink(step);
    var targetDisabled = !!link && (/\bpf-m-disabled\b/.test(link.className || '') || link.disabled);
    var block = wizardBlockReason();

    // Detect a validation/required-field gate: the target step is disabled and
    // we've been stuck on the same step across several polls. Report it so the
    // parent can surface guidance instead of failing silently.
    if (link && targetDisabled) {
      if (cur === replayStep) replayStuck++;
      else { replayStep = cur; replayStuck = 1; }
      if (block && replayStuck >= 3) {
        post('step-blocked', {
          id: id,
          selector: selector,
          step: step,
          stepLabel: wizardStepLabel(step),
          reason: block
        });
        replayStuck = 0;
        return;
      }
    } else {
      replayStep = cur;
      replayStuck = 0;
    }

    // The target nav link is enabled: jump straight to it (back or forward).
    if (link && !targetDisabled) {
      link.click();
      schedule();
      return;
    }

    // Otherwise advance forward. Some wizards (e.g. the cluster creation
    // wizard) gate "Next" behind selecting a catalog item card; clicking the
    // card is idempotent, so if a card is present, select it and then advance.
    var card = document.querySelector('.catalog-item-card--wizard');
    if (card) {
      card.click();
      setTimeout(function () {
        var n = wizardNextButton();
        if (n && !n.disabled) n.click();
        schedule();
      }, 120);
      return;
    }

    var next = wizardNextButton();
    if (next && !next.disabled) {
      next.click();
      schedule();
      return;
    }

    // No actionable "Next" (still rendering, or a required field blocks it):
    // keep polling while the budget lasts, then give up gracefully.
    schedule();
  }

  // Client-side navigate the SPA to a design URL (same origin), then focus
  // an element. SPA deep links aren't served by the origin (e.g. GitHub
  // Pages), so we drive the router in place instead of a full reload.
  function navigateTo(url, selector, step, persist, id) {
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
      if (selector) focusWithStep(selector, step, 40, persist, id);
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
