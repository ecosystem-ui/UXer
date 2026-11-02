# Airside — Architecture, Technical Deep-Dive & Improvement Suggestions

> Repository: [`Airnauts/airside`](https://github.com/Airnauts/airside)
> Self-hosted, embeddable commenting overlay for any web page — threaded, DOM-anchored review comments backed by your own database and storage. No iframe, no third-party SaaS.

---

## 1. Overview

**Airside** is a library-first, open-source (MIT) commenting layer that teams drop into their
own web app to collect contextual, element-anchored feedback — a self-hosted alternative to
Vercel Comments. It was built by [Airnauts](https://www.airnauts.com), a digital product studio,
to solve a recurring problem in their own client work.

The essential idea: a reviewer clicks (or text-selects) anywhere on a live page, leaves a
comment **pinned to that DOM element**, and the comment survives redeploys by re-anchoring to
the same element across layout/DOM changes. Everything is hosted by the integrator — the server
route, the database, and the attachment storage — so no third-party SaaS and no iframe.

**Key characteristics:**

| Dimension | Choice |
|---|---|
| Distribution | npm packages under `@airnauts/*`, self-hosted (a managed cloud is a roadmap item) |
| Client | Self-contained vanilla `init()` engine with its own **bundled React 19**; light-DOM isolation |
| Server | Web-standard `Request → Response` handler with framework glue (Next.js App/Pages Router, generic Node bridge) |
| Persistence | MongoDB (Atlas/self-hosted) **or** PostgreSQL (hybrid columns + `jsonb`); in-memory for dev/tests |
| Storage | Vercel Blob, Amazon S3 / Cloudflare R2, or local filesystem |
| Language / runtime | TypeScript, ESM-first, Node ≥ 22 |
| Monorepo tooling | pnpm workspaces + Turborepo + tsup + Biome + Vitest + Changesets |

---

## 2. Repository at a glance

- **~747 commits**, MIT license, 5 stars, 0 forks at time of writing.
- **Monorepo** (`pnpm-workspace.yaml`) with `packages/*` (published) and `examples/*` (dev-only demos).
- **Docs** are unusually strong for a project of this size: `docs/adr.md` (49 ADRs),
  `docs/architecture.md`, `docs/prd.md`, `docs/integration.md`, `docs/milestones.md`,
  `docs/ideas.md`, and `docs/issues.md` (a tracked list of known rough edges).
- **Package manager pinned** to `pnpm@10.17.0`; `onlyBuiltDependencies` whitelists native builds.

Root scripts (`package.json`): `build`, `typecheck`, `test` (all via `turbo run`), `lint`
(`biome ci`), `size` (size-limit), `check:exports`, `changeset`, and a `release` pipeline
(`pnpm build && changeset publish`). Publishing is **automatic on every push to `main`** after CI passes.

---

## 3. High-level architecture

### 3.1 Runtime topology

```
┌─────────────────────────── Reviewer browser ───────────────────────────┐
│  Widget (@airnauts/airside-client)                                    │
│   • activation gate (URL key → localStorage)                          │
│   • light-DOM mount + bundled React                                   │
│   • anchoring runtime (capture / re-match / overlay)                  │
│   • api client (x-airside-key header, optimistic posts)               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ HTTP + x-airside-key header
                                   ▼
┌─────────────────────────── Integrator's app ───────────────────────────┐
│  @airnauts/airside-integration-next  (createAirsideAppRoute)          │
│        │                                                               │
│        ▼                                                               │
│  @airnauts/airside-server  (Request → Response core)                  │
│   security → router → zod validate → use-case → adapters               │
│        │                          │                                    │
│   RepositoryAdapter         StorageAdapter        Extensions           │
│   (mongo | postgres | mem)  (blob | s3 | fs)     (slack,email,jira,gh) │
└─────────────────────────────────────────────────────────────────────────┘
```

The **HTTP contract is the only coupling** between client and server. Because the client only
speaks to a configurable `endpoint`, a hosted backend can later sit behind the same endpoint
with zero client changes — this "library-first, hosted-ready" topology is ADR-0001.

### 3.2 Package layout

The monorepo is cleanly layered around a pure, isomorphic core:

| Package | Role |
|---|---|
| `@airnauts/airside-core` | **Isomorphic** (no DOM/Node): Zod schemas + HTTP contract, `pageKey` normalization, anchor fingerprint schema + scoring/threshold policy, OpenAPI generator |
| `@airnauts/airside-client` | Widget engine: `init()`, light-DOM mount, React UI (shadcn/Radix), anchoring runtime, API client |
| `@airnauts/airside-integration-react` | Thin `<AirsideLayer/>` wrapper that calls `init()` in an effect (`'use client'`) |
| `@airnauts/airside-server` | Web-standard `Request → Response` core + use-cases; subpath `./node` = generic Node↔Web bridge |
| `@airnauts/airside-integration-next` | One-call App Router (`createAirsideAppRoute`) and Pages Router (`createAirsidePagesRoute`) glue |
| `@airnauts/airside-adapter-mongo` | MongoDB repository (only package that pulls the mongo driver) |
| `@airnauts/airside-adapter-postgres` | PostgreSQL repository (driver-agnostic via host-supplied `query()`; `pg`-based lazy convenience) |
| `@airnauts/airside-adapter-memory` | In-memory repository for local dev / tests |
| `@airnauts/airside-storage-vercel-blob` / `-s3` / `-fs` | Storage concretes |
| `@airnauts/airside-extension-slack` / `-email` | Notification extensions |
| `@airnauts/airside-extension-jira` / `-github` | Thread-action extensions ("Create Jira/GitHub issue") |
| `@airnauts/airside-test-support` | Shared adapter conformance contract suites + fixtures |

**"Enable/disable via subpackage imports"**: integrators install only the adapters they use, so
the mongo driver never enters a build that doesn't import it. Client features (screenshots, text
anchors) are gated in `init({ features })` and dynamically imported. Bundle delivery is npm-only
in v1; a CDN/script-tag build is a fast-follow.

### 3.3 Layering principle

Pure, headless-testable logic (fingerprint schema, scoring weights, thresholds, HTTP contract
types) lives in `core`. Only DOM-touching code (building fingerprints from real nodes, running
the search, rendering the overlay) lives in `client`. This split is what makes the anchoring
engine unit-testable in jsdom.

---

## 4. Client architecture (`@airnauts/airside-client`)

### 4.1 Mount & isolation

A single call injects one root host element at `<body>`:

```ts
const handle = await airside.init({ key, endpoint, pageKey?, features?, provenance? })
```

The root is `position: fixed; inset: 0; pointer-events: none` and the widget renders into it in
the **light DOM** (not Shadow DOM — ADR-0006). Isolation is achieved via:

- `all: revert` on the root element.
- Tailwind with **preflight disabled** + a scoped class prefix.
- Radix portals/menus/toasts render into a single high-z-index portal container inside the host.
- Utilities emitted **un-layered** so a host's CSS reset can't override them (ADR-0025).

The widget never reads the host's React/runtime state — it only speaks HTTP.

### 4.2 Runtime modules

- **Activation gate** — mounts only when a valid key is present in the URL (`?airside-key=…`)
  *or* was persisted from a prior URL activation; otherwise a no-op. Activation persists the key
  to `localStorage` and strips the param (ADR-0018).
- **Identity** — first comment prompts for a self-asserted email, remembered in `localStorage`.
  No verification in v1.
- **Capture** — turns a click/selection into a fingerprint + offset / selection + capture context.
- **Re-match** — fast path → scored search → orphan; uses the pure policy from `core`.
- **Positioning** — recomputes pin/highlight coordinates on scroll, resize, `ResizeObserver` on the
  target, and a throttled `MutationObserver` (re-mount / SPA route change).
- **API client** — endpoint + `x-airside-key` header; optimistic posts with rollback.

### 4.3 UI stack

shadcn/ui pattern (Radix primitives + Tailwind), bundled inside the widget: dialogs, dropdown
menus, popovers, toasts. State is organized around a set of React contexts/providers
(`ThreadsProvider`, `PanelProvider`, `DraftsProvider`, `IdentityProvider`) plus a generic,
read-once, typed settings store (ADR-0046/0047).

Bundle size is budgeted at **300 kB** (esm, brotli) via `size-limit`.

---

## 5. Server architecture (`@airnauts/airside-server`)

A framework-agnostic core built on the Web `Request → Response` standard, with thin per-framework
glue and injected adapters.

**Pipeline:**

```
security (key-header · origin allowlist · CORS · rate-limit)
  → router (method + path)
    → zod validate (schemas from core)
      → use case
        → adapters
          → typed JSON/error Response
```

**Construction:**

```ts
createAirsideServer({
  repository, storage,
  secretKey, allowedOrigins,
  projectId, env?, pageKey?,
  extensions?,      // notifications + thread actions (forward-looking API)
  notifiers?,       // DEPRECATED alias for notification-only extensions
  rateLimit?,       // { writesPerMin: 60, readsPerMin: 600 } by default; false to disable
  uploads?,         // { maxBytes } — default 5 MB
  // test seams: now, ids, extractIp, rateLimiter
})
```

`Repository` and `StorageAdapter` are the only DB/IO seams. `extensions` is a third seam.

**Use cases** (each in `src/use-cases/*.ts`, mapped 1:1 to the operation table):
create thread, list threads, get thread, add comment (reply), set thread status
(resolve/reopen), delete thread, refresh anchor (self-heal), run thread action, upload attachment.

**Next.js glue is near-zero** — one call builds the server and its handlers:

```ts
// App Router — app/api/airside/[...path]/route.ts
export const { GET, POST, PATCH, OPTIONS } = createAirsideAppRoute(config)
// Pages Router — pages/api/airside/[...path].ts
export default createAirsidePagesRoute(config)  // + export const config = { api: { bodyParser: false } }
```

A route-level `disabled: true` keeps the route mounted but dormant (every handler 404s, no server
constructed) — used when a required env var is absent (ADR-0027). Other Node hosts wrap the same
core via `@airnauts/airside-server/node`.

The server runs on **Node-compatible runtimes only** (`node:crypto`, `Buffer`, Node DB drivers).

---

## 6. Security model (v1)

The secret key is a **bearer capability token, not user auth**: one shared secret per mount.

- Sent as the **`x-airside-key` header** (never the query string — leaks via referrer/logs), validated server-side.
- Paired with a configurable **origin allowlist** so a leaked link can't post from arbitrary sites.
  Origin policy (ADR-0017): allow an **absent** `Origin` (non-browser clients), reject only
  present-and-disallowed.
- **Basic per-key/IP rate limiting** (in-memory, default 60 writes / 600 reads per minute) → 429.
- One secret value flows through three transports: `init({ key })` → the **URL parameter** the gate
  checks (param name configurable) → the **`x-airside-key` header** the server validates. One value,
  three places.

**Limitations** (by design, documented): no accounts/roles/permissions, self-asserted (unverified)
email identity, and the in-memory rate limiter is per-instance (not distributed).

---

## 7. Data model

**Scope.** A thread is scoped by `projectId` (+ optional `env`), resolved from the secret key.
v1 = one project per mount. `pageKey` (page identity) defaults to `origin + pathname`
(trailing-slash normalized, hash dropped, query excluded), overridable via a shared
`pageKey: (url) => string` function.

### 7.1 MongoDB (`threads` collection) — document-first

```
{
  id,                       // nanoid, e.g. "3kXLTXxq-P9l"
  projectId, env?,          // scope
  scope: "page",            // seam: "page" | "global" (v1 always "page")
  pageKey, pageUrl, pageTitle?,
  anchor: { … },            // see §8
  status: "open" | "resolved",
  anchorState: "anchored" | "orphaned",
  selectionLost?,           // text quote gone, pin retained
  captureContext: { viewportW, viewportH, devicePixelRatio, userAgent },
  provenance?: { commitSha, branch, deploymentId },
  createdBy: { email, name },
  createdAt, updatedAt, lastActivityAt,
  schemaVersion,
  comments: [ …embedded, soft cap ~100 ]
}
```

Comments are **embedded** in the thread (one fetch, atomic) with a soft cap of ~100; the panel
paginates threads. A separate `authors` collection (keyed `(projectId, email)`) keeps a stable
identity for future notifications.

**Indexes:** `(projectId, pageKey)`, `(projectId, updatedAt desc)`, `(projectId, status)`.

### 7.2 PostgreSQL — hybrid columns + `jsonb`

The Postgres adapter is **driver-agnostic**: it takes a host-supplied `query()` executor, with a
`pg`-based lazy convenience. It maps stable queryable fields to **columns** (projectId, pageKey,
status, updatedAt for ordering/cursor pagination) and the variable-shaped parts (anchor, comments,
captureContext, provenance) into a **`jsonb`** column.

### 7.3 Embedded `comment`

```
{ id, author: { email, name }, text /* plain in v1 */,
  attachments: [{ url, name, contentType, size, w?, h? }],
  createdAt, editedAt? }
```

---

## 8. HTTP API contract

Defined once as Zod 4 in `core`; **OpenAPI generated** from it (served at `GET /openapi.json` +
a Scalar UI at `/docs`; static artifact emitted at build).

| Method | Path | Purpose |
|---|---|---|
| POST | `/threads` | create thread + first comment |
| GET | `/threads` | list — `?pageKey=` (on-page, anchors) or all-pages (panel); `?status=`, `?sort=updatedAt`, `?cursor=` |
| GET | `/threads/:id` | single thread + comments |
| POST | `/threads/:id/comments` | add reply `{text, attachmentIds?, author}` |
| PATCH | `/threads/:id` | resolve / reopen `{status}` |
| PATCH | `/threads/:id/anchor` | report re-match result (self-heal) |
| DELETE | `/threads/:id` | hard-delete (key-holder authz) |
| POST | `/threads/:id/actions/:actionId` | run a thread-action extension |
| POST | `/uploads` | multipart image → StorageAdapter → `{id, url, name, contentType, size}` |
| GET | `/openapi.json`, `/docs` | contract + Scalar UI |

**Conventions:** `x-airside-key` header on every request; origin allowlist + CORS; JSON; ISO-8601
timestamps; nanoid ids; cursor pagination; **two-step uploads** (`POST /uploads`, then reference
`attachmentIds`).

**Error shape:** `{ error: { code, message, details? } }` — 400 (zod details), 401 (missing/invalid
key), 403 (origin), 404, 409 (conflict), 413 (upload too large), 429 (rate limited), 502
(integration error).

---

## 9. Anchoring mechanism — the core innovation

This is the heart of the product and where the most engineering effort went. The policy is pure
and lives in `core`; the DOM capture/search/positioning lives in `client`.

### 9.1 Capture (on click / selection)

- target = `elementFromPoint` (or the selection's container);
- build **dual `selectors`** (structural `nth-of-type` + class path) and a **`signals` bag**
  (tag, role, capped text snippet, class tokens, sibling index, ancestor-landmark trail);
- `offset = ((clickX − rect.left)/w, (clickY − rect.top)/h)`;
- for a selection, capture start/end `{selectors, textNodeIndex, offset}` + `quote` +
  `prefix`/`suffix` (±~32 chars);
- record capture context (viewport, DPR, UA).

### 9.2 Re-match (on load + DOM mutations)

1. **Fast path** — `querySelector(stored)`; a single hit whose signals agree → anchored.
2. **Scored search** — scope candidates to the nearest surviving ancestor-landmark (else by tag).
3. **Decide** — `best ≥ accept (0.60)` **and** `lead over 2nd ≥ margin (0.10)` → anchored, then
   **self-heal** (`PATCH /threads/:id/anchor` rewrites the stored fingerprint); otherwise →
   **orphaned** → surfaced in the panel.
4. **Selection** — locate the quote within the matched element → re-highlight; miss → keep the
   element pin, set `selectionLost` (not orphaned).

### 9.3 Scoring weights (normalized 0..1, tunable)

| Signal | Weight | Implementation |
|---|---|---|
| Stable attrs (`id` / `data-testid` / `data-*`) | +0.40 | priority-weighted exact match (`id`=0.5, `data-testid`=0.3, other `data-*` shared) |
| Text-snippet similarity | +0.25 | Dice coefficient over bigrams |
| Class-token overlap | +0.15 | Jaccard |
| ARIA role | +0.10 | exact match |
| Sibling-index proximity | +0.05 | `1 / (1 + |Δindex|)` |
| Ancestor-trail overlap | +0.05 | Jaccard |

**Tag mismatch excludes a candidate** (`excluded: 'tagMismatch'`). The weights and the `accept ≈ 0.60`
threshold are deliberate: a stable attribute is the strongest single signal, but on its own
(+0.40) it still needs at least one corroborating signal to clear the threshold — **no single
signal auto-anchors**.

The thresholds are calibrated and regression-guarded by an **anchoring fixture corpus** — pairs of
(original DOM → mutated DOM) with expected outcomes (re-anchor / orphan / `selectionLost`), covering
wrapper-added, reorder, class rename, text change, attribute change, element removal, and duplicate
siblings, run in jsdom.

### 9.4 Known anchoring rough edges (tracked, not yet fixed)

- A pin on a plain structural element (no `id`/class/`data-*`) can silently migrate to the wrong
  surviving sibling after the original is removed (scores are close).
- Signal-less elements can't clear the threshold under mutation and always orphan (a v1 scoring
  limitation).

---

## 10. Extensions system

`extensions` covers two kinds of server add-ons (ADR-0034):

- **Notification extensions** (`slackExtension`, `emailExtension`) receive a `NotificationEvent`
  fanned out after each `createThread`/`addComment` write — **failures are isolated** so they can
  never break the write. Slack uses an Incoming Webhook (3s timeout); email uses a pluggable
  transport (SMTP via nodemailer, or Resend HTTP API).
- **Thread-action extensions** (`jiraExtension`, `githubExtension`) contribute reviewer-triggered
  actions, evaluated per thread and run via `POST /threads/:id/actions/:actionId`. An action may
  persist an `externalLink` back on the thread (deduped by provider). The Jira action builds ADF
  (Atlassian Document Format) content; the GitHub action uses token auth + `fetch` (not Octokit —
  ADR-0049).

The older `notifiers?` option is a deprecated alias for the notification half.

**Known v1 limitation:** Jira issue creation is per-thread but **not transactional** — a
near-simultaneous double-click can create two issues.

---

## 11. Tooling, testing & release

- **Build:** `tsup` (esbuild) + `tsc --build --force` for declarations; ESM-first with `exports`
  maps and subpath exports (`./node`, `./dev`, `/client`).
- **Lint/format:** Biome 2 (single quotes, no semicolons, 100-col, import organization).
- **TypeScript:** strict, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`,
  `moduleResolution: Bundler`.
- **Tests:** Vitest; `mongodb-memory-server` for integration; jsdom for anchoring corpus and React
  Testing Library; Playwright e2e in `examples/nextjs-host`; shared **adapter conformance contract**
  suites in `test-support` (any `Repository`/`StorageAdapter` must pass).
- **Backend built test-first (TDD)** — ADR-0010.
- **Releases:** Changesets; automatic publish on every green push to `main`; single `vX.Y.Z` tag cut
  in CI (ADR-0041).

---

## 12. Improvement suggestions

The project already maintains an honest, well-organized improvement backlog (`docs/ideas.md` +
`docs/issues.md` + the README roadmap). The items below consolidate and prioritize those, grouped
by theme, with my own assessment of impact.

### 12.1 Correctness & anchoring (highest priority)

1. **Fix silent sibling migration.** The "wrong surviving sibling" bug erodes the single most
   important promise of the product — that a comment reliably points at the element it was made on.
   The README explicitly defers this as a "TDD fix." This should be the top engineering priority.
2. **Improve signal-poor element anchoring.** Elements without stable attributes always orphan
   under mutation. Consider adding a fallback signal (e.g. a React-fiber/parent-path hint, a
   structural `:nth-of-type`-chain with ancestor landmarks, or a content-hash of nearby text) so
   "plain `<div>`" pins survive more than the current subset of changes.
3. **Add more anchor-corpus fixtures** — especially around React re-renders, list reordering, and
   CSS framework class churn — to continuously tighten the accept/margin thresholds with data.

### 12.2 Security & identity (high priority)

4. **Authenticated reviewer identity (SSO / magic-link).** Self-asserted email + a shared capability
   token is fine for small teams but is spoofable and unscoped. A magic-link flow (already collected
   email) preserves low friction while adding trust — the natural next step after dogfooding.
5. **Distributed rate limiting.** The in-memory limiter resets per serverless instance. A shared
   store (Redis/Upstash or DB-backed) is needed before multi-instance production.
6. **Transactional dedup of thread actions.** Make "Create Jira/GitHub issue" idempotent (e.g. a
   unique index on `externalLinks.provider + threadId`, or a conditional upsert) to eliminate the
   documented double-create race.
7. **Per-thread/attachment access hardening** — attachments are scoped by project but the storage
   URLs are otherwise unauthenticated (bearer-URL semantics). Document or tighten this surface.

### 12.3 Feature completeness (medium priority)

8. **Rich text / Markdown + `@mentions` + emoji reactions + per-comment edit/delete.** These close
   the gap to Vercel Comments and are the most-requested UX parity features. Reactions/edits need
   new endpoints + both adapter implementations.
9. **Page-level (unanchored) comments** — the `scope: "page"` seam is already designed; only UI +
   routes remain.
10. **Real-time updates (SSE/WebSocket)** — replace refetch-on-focus so multiple reviewers see each
    other's comments live. This is the biggest collaboration leap.
11. **Smooth pin positioning** — replace the per-scroll-frame layout pass with a CSS-anchored or
    IntersectionObserver-backed approach to remove jank.

### 12.4 Platform & reach (medium priority)

12. **CDN/script-tag delivery.** npm-only limits adoption to JS-bundler hosts. A prebuilt IIFE/ESM
    build on a CDN (with the same `init()` API) would unlock plain-HTML and CMS sites.
13. **More host glue** — Remix, SvelteKit, Astro, and a generic fetch-native handler for Hono/Express.
14. **More persistence adapters** — SQLite (via `better-sqlite3`/`libsql`) and MySQL would cover the
    "no separate DB service" and common-stack cases.
15. **More notifiers/actions** — Discord, Microsoft Teams, Linear, and a generic outbound webhook.

### 12.5 Developer & product quality (lower priority)

16. **Accessibility & keyboard-navigation pass** + widget i18n (localization).
17. **Jira/GitHub comment sync** — mirror later thread replies into the linked issue.
18. **In-widget changelog popup** so operators can surface product changes to reviewers.
19. **Managed cloud offering** — the stated long-term monetization path; the library-first topology
    (ADR-0001) was designed to make this a drop-in swap behind the same endpoint.

### 12.6 Housekeeping / polish

20. **Cosmetic `aws4` webpack warning** in the Mongo adapter — a lazy-import refactor; low effort,
    removes build noise for every Next.js integrator.
21. **Attachment cleanup seam.** `deleteThread` intentionally does not delete blobs (ADR-0044); a
    `StorageAdapter.delete` would prevent orphaned storage costs over time.

---

## 13. Summary

Airside is an unusually **well-engineered open-source product** for its maturity: a clean,
layered monorepo; a genuinely portable core (Web-standard `Request → Response` + injected
adapters); a novel, testable DOM-anchoring engine with a calibrated scoring policy and a fixture
corpus; strong security thinking for its capability-token model; and documentation (PRD → ADRs →
architecture → integration) that is far above the norm.

Its main risks are concentrated in exactly one place — the **anchoring engine** — which is both
its differentiator and its soft spot (the two tracked rough edges). The highest-leverage
investments are: fix the anchoring correctness bugs, add trusted identity, distributed rate
limiting, and real-time collaboration. Everything else is parity/polish that the roadmap already
anticipates.
