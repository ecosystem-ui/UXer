/* UXer bridge — runs inside the proxied design page. Communicates with the
 * parent React app over postMessage. Provides:
 *   - browse / comment modes
 *   - hover highlight + click-to-capture (selector, text, relative x/y)
 *   - Shadow DOM pins overlay
 *   - location tracking (so the parent can map comments back to design pages)
 *
 * The page is served under a persona-specific origin, so the design's own URL
 * resolution (relative/root-relative links, location.assign, forms) works
 * untouched; no fetch/XHR/history URL rewriting is needed here.
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
  var mode = 'browse';
  var pins = [];
  var activeHighlight = null;
  var activeHighlightPage = null;
  var highlightTimer = null;
  // Comment id of the pin currently being focused (thread open). Its pin is
  // kept visible — at a fallback position when its element/step isn't reachable
  // yet — until the page reaches the comment's state.
  var pendingId = null;
  // Comment ids we already reported as `step-blocked`; cleared once the pin's
  // element becomes reachable so the parent can drop the now-stale alert.
  var blockedIds = {};
  // Wizard-replay progress tracking, used to detect when the wizard is gated
  // by validation/required fields and can't reach the target step.
  var replayStep = '';
  var replayStuck = 0;
  // Declarative state config sent by the parent (persona-level), if any.
  // It is overridden by a page-provided window.__UXER_STATE__.
  var parentStateConfig = null;

  // Built-in declarative controls for PatternFly v5/v6 apps. These are used
  // when the page carries PF chrome (nav / tabs / wizard) and no explicit
  // config is provided. The wizard step reuses currentStepKey().
  var PF_DEFAULT_CONTROLS = [
    { key: 'step', selector: '.pf-v6-c-wizard__nav-link, .pf-v5-c-wizard__nav-link', value: 'wizard-step' },
    { key: 'nav', selector: '.pf-v6-c-nav__link.pf-m-current, .pf-v5-c-nav__link.pf-m-current, .pf-v6-c-nav__link[aria-current="page"], .pf-v5-c-nav__link[aria-current="page"]', value: 'text' },
    { key: 'tab', selector: '.pf-v6-c-tabs__item.pf-m-current .pf-v6-c-tabs__item-text, .pf-v5-c-tabs__item.pf-m-current .pf-v5-c-tabs__item-text', value: 'text' }
  ];

  function post(type, data) {
    try {
      window.parent.postMessage(
        Object.assign({ source: 'uxer-bridge', type: type }, data || {}),
        '*'
      );
    } catch (e) {}
  }

  // Map a URL back to the design's real origin. URLs on the persona origin
  // (the page's own origin) are mapped to the design origin; everything else
  // passes through.
  function designUrl(u) {
    if (typeof u !== 'string') return u;
    try {
      var a = new URL(u, window.location.href);
      if (a.origin === window.location.origin) {
        return origin + a.pathname + a.search + a.hash;
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

  // Whether the page carries PatternFly navigation / tabs / wizard chrome.
  function detectPatternFly() {
    return !!document.querySelector(
      '.pf-v6-c-wizard, .pf-v5-c-wizard, .pf-v6-c-tabs, .pf-v5-c-tabs, .pf-v6-c-nav, .pf-v5-c-nav'
    );
  }

  // Extract the value a declarative control contributes to the state key.
  function controlValue(spec) {
    if (spec.value === 'wizard-step') return currentStepKey();
    var el = document.querySelector(spec.selector);
    if (!el) return '';
    if (spec.value === 'text') return (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (spec.value === 'value') return el.value != null ? String(el.value) : '';
    if (spec.value === 'checked') return el.checked ? '1' : '0';
    if (spec.value === 'id') return el.id || '';
    if (typeof spec.value === 'string' && spec.value.indexOf('attr:') === 0) {
      return el.getAttribute(spec.value.slice(5)) || '';
    }
    return '';
  }

  // Deterministic, order-independent key from a set of declarative controls.
  function declarativeKey(controls) {
    var parts = [];
    for (var i = 0; i < controls.length; i++) {
      var v = controlValue(controls[i]);
      if (v) parts.push(controls[i].key + '=' + v);
    }
    parts.sort();
    return parts.join('|');
  }

  // Coarse, stable signature for non-framework pages: visible structural
  // sections plus active markers, keyed by stable identity. Filter-only —
  // no attempt is made to restore this state.
  function autoSignature() {
    var ids = [];
    var els = document.querySelectorAll(
      'section[id], article[id], [role="tabpanel"][id], [data-state-section], ' +
      '[aria-selected="true"], [aria-current="page"], [aria-current="step"]'
    );
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var id = el.id || el.getAttribute('data-state-section') || el.getAttribute('data-state');
      if (!id) continue;
      if (el.id) {
        // Ignore sections that are currently hidden (zero size).
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
      }
      ids.push(id);
    }
    ids.sort();
    var uniq = [];
    for (var j = 0; j < ids.length; j++) {
      if (uniq.indexOf(ids[j]) === -1) uniq.push(ids[j]);
    }
    return uniq.join('|');
  }

  // The active declarative controls: page-provided > parent-provided >
  // PatternFly defaults (when PF chrome is detected) > null (auto mode).
  function activeControls() {
    if (window.__UXER_STATE__ && Array.isArray(window.__UXER_STATE__.controls)) {
      return window.__UXER_STATE__.controls;
    }
    if (parentStateConfig && Array.isArray(parentStateConfig.controls)) {
      return parentStateConfig.controls;
    }
    if (detectPatternFly()) return PF_DEFAULT_CONTROLS;
    return null;
  }

  // Compute the current view-state key and its mode ('declarative' | 'auto').
  // An empty key means "no distinguishable state" and disables filtering.
  function viewState() {
    var controls = activeControls();
    if (controls) {
      return { key: declarativeKey(controls), mode: 'declarative' };
    }
    return { key: autoSignature(), mode: 'auto' };
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

  // Whether a required PatternFly form field in the current wizard step is
  // empty. PatternFly marks required fields with a `*` via
  // `.pf-v6-c-form__label-required`; the field control lives in the same
  // `.pf-v6-c-form__group`. An empty required field gates "Next" — clicking it
  // would only surface validation errors — so it is reported as a block
  // instead of blindly clicking Next.
  function requiredFieldEmpty() {
    var scope = document.querySelector('.pf-v6-c-wizard, .pf-v5-c-wizard') || document;
    var groups = scope.querySelectorAll('.pf-v6-c-form__group, .pf-v5-c-form__group');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g.querySelector('.pf-v6-c-form__label-required, .pf-v5-c-form__label-required')) continue;
      var control = g.querySelector('input, textarea, select');
      if (control) {
        if (control.disabled || control.readOnly) continue;
        var v = control.value == null ? '' : String(control.value);
        if (!v.trim()) return true;
      } else {
        // PatternFly select / multiselect: an empty value shows no selected
        // text in its toggle.
        var text = g.querySelector('.pf-v6-c-menu-toggle__text, .pf-v5-c-menu-toggle__text');
        if (!text || !(text.textContent || '').trim()) return true;
      }
    }
    return false;
  }

  // Why the wizard currently can't advance ('' if it can). PatternFly shows
  // validation errors via `aria-invalid` / `.pf-m-error`, or disables "Next"
  // (but only counts a disabled Next as a block when there's no catalog card
  // left to select, i.e. we're past the card-selection gate).
  function wizardBlockReason() {
    if (requiredFieldEmpty()) return 'required-fields';
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
    var st = viewState();
    return {
      selector: uniqueSelector(el),
      text: textExcerpt(el),
      url: designUrl(window.location.href),
      step: currentStepKey(),
      state: st.key,
      stateMode: st.mode,
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
    '.uxer-pin.resolved{background:#16a34a;}' +
    '.uxer-pin.uxer-pin--pending{background:#fff;color:#2563eb;border:2px dashed #2563eb;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.4);animation:uxer-pulse 1.4s ease-in-out infinite;}' +
    '@keyframes uxer-pulse{0%,100%{opacity:1;}50%{opacity:0.55;}}';
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

  // Nearest collapsible toggle ancestor (PatternFly accordion or any
  // aria-expanded control) of an element, up to a few levels up.
  function collapsibleToggle(el) {
    var n = el;
    for (var i = 0; i < 8 && n && n !== document.body; i++) {
      if (n.hasAttribute && n.hasAttribute('aria-expanded')) return n;
      if (/\bpf-(v6|v5)-c-accordion__toggle\b/.test(n.className || '')) return n;
      n = n.parentElement;
    }
    return null;
  }

  function renderPins() {
    if (!mountOverlay()) return;
    pinsLayer.innerHTML = '';
    var cur = currentPage();
    var st = viewState();
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      var isPending = pendingId != null && p.id === pendingId;
      // While a thread is open, show only that comment's pin.
      if (pendingId != null && !isPending) continue;
      // Only render pins that belong to the current page. Pins with no url
      // (legacy) are shown everywhere.
      if (p.url && cur && pageKey(p.url) !== cur) continue;
      // Only render pins whose recorded view state matches the current one.
      // The pending (focused) pin is exempt so it stays visible while the
      // page hasn't reached its state yet.
      if (p.state && st.key && p.state !== st.key && !isPending) continue;
      var el = findElement(p.selector);
      if (!el) {
        // Element not rendered (e.g. collapsed accordion): keep a fallback
        // pin so the comment stays discoverable.
        appendPinDot(p, pendingDotPosition(), true);
        continue;
      }
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        appendPinDot(p, pendingDotPosition(), true);
        // The selected comment's target is inside a collapsed item: outline
        // the collapsible toggle so the reviewer knows where to expand.
        if (isPending) {
          var toggle = collapsibleToggle(el);
          if (toggle) {
            var toggleSel = uniqueSelector(toggle);
            if (toggleSel) {
              activeHighlight = toggleSel;
              activeHighlightPage = currentPage();
              positionHighlight(toggle);
              if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
            }
          }
        }
        continue;
      }
      // The pin's element is now reachable: tell the parent to drop any
      // stale "blocked" alert for this comment.
      if (blockedIds[p.id]) {
        delete blockedIds[p.id];
        post('step-reached', { id: p.id });
      }
      // Keep the selected element bordered while its thread is open. This
      // also covers the blocked→found transition, where focusSelector never
      // got a chance to place the border.
      if (isPending) {
        activeHighlight = p.selector;
        activeHighlightPage = currentPage();
        positionHighlight(el);
        if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
      }
      appendPinDot(p, { left: r.left + r.width * p.x, top: r.top + r.height * p.y }, false);
    }
  }

  // A fixed, clearly-visible fallback position for a pin whose target isn't
  // reachable yet (e.g. the wizard is gated behind required fields).
  function pendingDotPosition() {
    return { left: window.innerWidth / 2, top: 14 };
  }

  function appendPinDot(p, pos, pending) {
    var dot = document.createElement('div');
    var cls = 'uxer-pin' + (p.status === 'resolved' ? ' resolved' : '');
    if (pending) cls += ' uxer-pin--pending';
    dot.className = cls;
    dot.textContent = String(p.index);
    dot.style.left = pos.left + 'px';
    dot.style.top = pos.top + 'px';
    pinsLayer.appendChild(dot);
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
    } else if (d.type === 'config') {
      parentStateConfig = d.state || null;
      renderPins();
    } else if (d.type === 'pins') {
      pins = d.pins || [];
      renderPins();
    } else if (d.type === 'focus') {
      if (d.persist && d.id) pendingId = d.id;
      renderPins();
      focusWithStep(d.selector, d.step, 20, d.persist, d.id);
    } else if (d.type === 'navigate') {
      if (d.persist && d.id) pendingId = d.id;
      renderPins();
      navigateTo(d.url, d.selector, d.step, d.persist, d.id);
    } else if (d.type === 'clear') {
      pendingId = null;
      renderPins();
      clearHighlight();
    }
  });

  function clearHighlight() {
    highlightEl.style.display = 'none';
    activeHighlight = null;
    activeHighlightPage = null;
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
  }

  function isInsideOpenModal(el) {
    var boxes = document.querySelectorAll('.pf-v6-c-modal-box, .pf-v5-c-modal-box, [role="dialog"]');
    for (var i = 0; i < boxes.length; i++) {
      var r = boxes[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (boxes[i].contains(el)) return true;
    }
    return false;
  }

  // Close any open modal/overlay. Returns true if something was dismissed.
  function closeOpenModals() {
    var closed = false;
    var dialogs = document.querySelectorAll('dialog[open]');
    for (var i = 0; i < dialogs.length; i++) {
      try { dialogs[i].close(); closed = true; } catch (e) {}
    }
    var boxes = document.querySelectorAll('.pf-v6-c-modal-box, .pf-v5-c-modal-box, [role="dialog"]');
    for (var j = 0; j < boxes.length; j++) {
      var r = boxes[j].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var close = boxes[j].querySelector(
        '.pf-v6-c-modal-box__close button, .pf-v5-c-modal-box__close button, ' +
        'button[aria-label="Close"], button[aria-label="close"]'
      );
      if (close) { close.click(); return true; }
      closed = true;
    }
    // Escape fallback for overlays with no visible close button.
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
    } catch (e) {}
    return closed;
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
    // The target lives behind an open modal — dismiss it and retry so the
    // comment actually becomes visible.
    if (!isInsideOpenModal(el) && closeOpenModals()) {
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
        if (id) blockedIds[id] = true;
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

    // A validation/required-field gate is already detectable: clicking "Next"
    // would only re-surface the errors and corrupt the wizard. Keep polling so
    // the step-blocked detector above can report the gate, and so a human can
    // fill the required fields to unblock us.
    if (block) {
      schedule();
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

  // Client-side navigate the SPA to a design URL, then focus an element. The
  // design's router basename is already the persona origin's root, so the
  // target is the design pathname as-is.
  function navigateTo(url, selector, step, persist, id) {
    try {
      var a = new URL(url, window.location.href);
      var path = a.pathname + a.search + a.hash;
      var cur = window.location.pathname + window.location.search + window.location.hash;
      if (path !== cur) {
        history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }
      if (selector) focusWithStep(selector, step, 40, persist, id);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- location tracking ---------- */

  function patchHistory() {
    var op = history.pushState;
    var or = history.replaceState;
    history.pushState = function (state, title, url) {
      if (url) post('location', { url: designUrl(url) });
      return op.call(this, state, title, url);
    };
    history.replaceState = function (state, title, url) {
      if (url) post('location', { url: designUrl(url) });
      return or.call(this, state, title, url);
    };
    window.addEventListener('popstate', function () {
      post('location', { url: designUrl(window.location.href) });
    });
    window.addEventListener('hashchange', function () {
      post('location', { url: designUrl(window.location.href) });
    });
  }

  // Open external links on the design's real origin.
  function patchOpen() {
    var ow = window.open;
    if (typeof ow !== 'function') return;
    window.open = function (url) {
      var abs = url ? designUrl(url) : url;
      return ow.call(window, abs || '', '_blank');
    };
  }

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
      post('ready', { url: base });
      renderPins();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
