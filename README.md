# UXer — Design Review & Version Management

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

UXer lets UX designers manage **projects**, define **versions** (a label + a public
design URL), preview that URL in an iframe, drop comments anchored to DOM
elements, run discussion threads, and resolve comments against a version.

- **Frontend**: React + Vite + TypeScript + MUI (Material UI)
- **Backend**: Go (`net/http`), SQLite (`modernc.org/sqlite`), email + password auth (bcrypt)
- **Preview**: a reverse proxy that rewrites the design URL into an
  iframe-embeddable page and injects an annotation bridge

## Screenshots


**Project Personas**

![Project versions](docs/screenshots/project-versions.png)

![Design preview — empty comments state](docs/screenshots/preview-empty.png)

**Comment thread detail**

![Comment thread detail](docs/screenshots/comment-thread.png)

## Layout

```
UXer/
├── client/          # React + Vite + TS + MUI SPA
├── server/          # Go backend (cmd/uxer, internal/{api,db,auth,proxy})
│   ├── internal/db/migrations/   # embedded SQL migrations
│   └── internal/proxy/bridge.js  # in-iframe annotation overlay
├── competitors/     # existing competitor analysis (reference only)
├── .env.example
└── README.md
```

## Prerequisites

- Go 1.23+ (Go will auto-download the required newer toolchain on first build)
- Node.js 20+ and npm

## Setup

### 1. Configure the environment

```bash
cd UXer
cp .env.example .env
```

Set a random `SESSION_SECRET` (e.g. `openssl rand -hex 32`). No external OAuth
provider is needed — users sign up and sign in with **email + password**.

To email password-reset links, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, and `SMTP_FROM`, plus `UXER_APP_URL` (the public base URL for
reset links). If `SMTP_HOST` is left empty, reset links are logged to stdout
instead of being sent — useful for local development.

### 2. Install frontend dependencies

```bash
cd client
npm install
```

## Run (development)

Run the Go server (it serves the API and the proxy):

```bash
cd server
go run ./cmd/uxer
```

In another terminal, run the Vite dev server:

```bash
cd client
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api`, `/proxy`, and `/__uxer__`
to the Go server on `:8080`.

## Build (production)

```bash
cd client
npm run build          # outputs client/dist
cd ../server
go build -o uxer ./cmd/uxer
./uxer                 # serves the API, proxy, and client/dist
```

## Usage

1. Sign up with an email + password, then sign in. If you forget your
   password, use the **Forgot password?** link on the login page to receive a
   reset link by email.
2. Create a **project**.
3. Add a **version** — a label plus the public design URL (page, prototype,
   Storybook, Figma link, etc.).
4. Open the version to see the preview in an iframe. Owners can also **Share**
   the project from the persona page, not just from the project page. Sharing
   works for any email address: people who don't have an account yet are
   invited, and the viewer permission applies automatically when they sign up
   with that email.
5. Toggle **Comment mode**, click a DOM element, and add a comment.
6. Reply and resolve threads in the side panel. Resolving records the version
   the comment was resolved on; the version list shows open/resolved counts.

Project and persona URLs are shareable. Opening one without a session redirects
to `/login?next=<requested path>`; signing in (or signing up) returns you to
that page. `next` only accepts same-origin paths, so a crafted link cannot send
the browser off-site.

## Testing

End-to-end tests use [Playwright](https://playwright.dev) and run the built
frontend against the Go server on a single port with an isolated SQLite
database. The sample design URL is
<https://osac-project.github.io/osac-ux/>.

### Prerequisites

- Go 1.26+ (the server is started by the test runner)
- Node.js 20+ and npm, with the client dependencies installed (`cd client && npm install`)
- A Playwright Chromium install (`npm run test:e2e:install`)
- Outbound network access to `osac-project.github.io` and
  `heyethankim.github.io/osac-bmaas` (the server proxies the sample sites; the
  auth/projects/collaboration specs don't require it, but the
  comment-routing, view-routing, and view-state specs do)

### Running

```bash
npm install                 # installs @playwright/test
npm run test:e2e            # builds the client, starts the server, runs tests
npm run test:e2e:headed     # same, but headed for debugging
```

The Playwright config (`playwright.config.ts`) builds `client/dist`, starts the
Go server on `:8099` with a throwaway `server/data/e2e.db`, and tears it down
afterwards.

### Test cases

| Spec | Scenarios covered |
| --- | --- |
| `e2e/auth.spec.ts` | Sign up (creates account, lands on Projects), log out, log back in, reject a wrong password, and return to a shared project/persona link after login |
| `e2e/projects.spec.ts` | Create a project, add a persona (version) with a design URL, share a project with another user (from the project page and from a persona page), and invite an address before that person signs up |
| `e2e/collaboration.spec.ts` | Three users; the owner creates two projects (each with a persona) and shares both; all three reply to the same thread; each resolves a different thread |
| `e2e/comment-routing.spec.ts` | Create a comment in comment mode inside the proxied iframe and verify clicking it opens its thread; verify the manual-fallback error icon and guidance render when a recorded wizard step is gated by validation/required fields |
| `e2e/view-routing.spec.ts` | Same-URL subview replay: VM detail open/close and creation-wizard steps, including gated-step guidance |
| `e2e/view-state.spec.ts` | Grid/list layout state: comments recorded in list view route to their row after the persona opens in grid view (legacy state and recorded `view=` state), and new comments record the active layout |

## Podman deployment

The repo ships a multi-stage `Containerfile` (Node → Go → Alpine runtime) and
a `compose.yml` compatible with **Podman Compose** (and Docker Compose).

### Prerequisites

- [Podman](https://podman.io/) 4.x+
- [Podman Compose](https://github.com/containers/podman-compose) **or** the
  `podman compose` subcommand (bundled with Podman 4.4+)

### Quick start

```bash
# 1. Generate a session secret
export SESSION_SECRET=$(openssl rand -hex 32)

# 2. Build and start (data persists in a named volume)
podman compose up --build -d

# 3. Open the app
open http://localhost:8080
```

### Configuration

All env vars are passed through `compose.yml` and can be overridden by
exporting them or by creating a `.env` file in the project root:

```bash
cp .env.example .env
# Edit .env — set at minimum SESSION_SECRET
podman compose up --build -d
```

| Variable | Default in container | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | *(required)* | `openssl rand -hex 32` |
| `UXER_PORT` | `8080` | Also update `ports:` in `compose.yml` |
| `UXER_APP_URL` | `http://localhost:8080` | Set to your public URL in production |
| `UXER_SECURE_COOKIE` | `0` | Set to `1` when serving over HTTPS |
| `ALLOW_PRIVATE_HOSTS` | `localhost,127.0.0.1` | Hosts that bypass the SSRF guard |
| `SMTP_HOST` | *(empty — logs to stdout)* | Leave empty for local dev |

### SQLite persistence

The database lives in the `uxer-data` named volume mounted at `/app/data`
inside the container. To back it up:

```bash
podman volume export uxer-data > uxer-data-backup.tar
```

### Manual build (without Compose)

```bash
# Build
podman build -t uxer:latest .

# Run (replace SESSION_SECRET with your value)
podman run -d \
  --name uxer \
  -p 8080:8080 \
  -v uxer-data:/app/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e UXER_APP_URL="http://localhost:8080" \
  uxer:latest
```

### Useful commands

```bash
podman compose logs -f          # tail logs
podman compose down             # stop and remove containers (volume kept)
podman compose down -v          # also remove the data volume
podman compose ps               # check container status
```

## Preview proxy & limitations

The `/proxy?url=…` endpoint validates the design URL server-side, mints a
signed origin token, and redirects to a **persona-specific origin**
(`scheme://<token>.<host>/<path>`). Each persona is therefore served under its
own origin, so the design's own URL resolution — relative and root-relative
links, `window.location.origin`/`location.assign`, forms, React
`BrowserRouter`, and htmx requests — all work unchanged. Only same-origin
absolute URLs are rewritten onto the persona origin. The proxy strips
`X-Frame-Options`/`Content-Security-Policy`, injects the annotation bridge, and
guards against SSRF (only global-unicast addresses are reachable).

Known limitations (documented, not blockers):

- **WebSockets** and cross-origin subframes of the target site are not proxied.
- **Cookies are not forwarded** to the target (stateless proxy). Design URLs
  must be publicly accessible or listed in `ALLOW_PRIVATE_HOSTS`.
- Subdomain auth is the signed origin token itself (a capability URL); the
  minting endpoint still requires an authenticated session.
- Iframes that the target site blocks via JavaScript (e.g. `top !== self`
  checks) cannot be overridden.

### Declaring subviews for comment routing (generic)

Comments on pages that switch views **without changing the URL** (SPA tabs,
detail drawers, wizards) are routed via declarative state. A design page can
declare its own model by setting `window.__UXER_STATE__` before it loads:

```html
<script>
window.__UXER_STATE__ = {
  // controls: how to READ the current view state. Each non-empty value
  // contributes to the comment's stored `state` key.
  controls: [
    { key: 'view', selector: 'section.view.active', value: 'attr:id' }
  ],
  // reveal: how to REACH (or leave) a recorded value before focusing.
  reveal: [
    {
      key: 'view',
      selector: '[data-view]',       // opener clicked to reach `value`
      value: 'attr:data-view',
      action: 'click',
      close: { selector: '[data-back]' } // optional: leave this subview
    }
  ]
};
</script>
```

- `controls` value extractors: `text` | `value` | `checked` | `id` |
  `wizard-step` | `present` | `attr:<name>`. `present` records `1` when the
  element exists (useful for modal/overlay subviews like a creation wizard).
- `reveal` entries map a control `key` to an opener: either `call` (a global
  function name called with the recorded value) or `selector` + `value` (the
  first element whose value matches is clicked). The recorded value and the
  opener value must be in the same value space (e.g. a view id). Set
  `action: 'open'` for a single opener with no value to match (`call` is
  invoked with `args`, or the first `selector` element is clicked).
- When a control is **absent** from the recorded state but currently open, the
  bridge applies `close` (a `call` function, or a `selector` to click) so the
  comment's own view is shown again — e.g. leaving a VM detail back to its list.
- When a page omits `window.__UXER_STATE__`, PatternFly pages receive built-in
  controls/reveal rules (nav, tabs, wizard steps, the VM-detail opener with its
  back-to-list action, the creation-wizard opener, and the grid/list layout
  toggle on collection pages).
- The grid/list layout (`view`) matters because structural selectors are
  layout-specific: a comment captured on a table row only resolves in list
  view. New comments record the active layout and replay it before focusing.
  Comments captured before this key existed don't record a layout; for those
  the bridge retries in the recorded layout first, then tries the other
  layout(s) and keeps the one where the selector resolves (restoring the
  original layout when none do).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `UXER_PORT` | Go server port (default `8080`) |
| `UXER_DB_PATH` | SQLite file (default `data/uxer.db`) |
| `SESSION_SECRET` | Signing secret for session cookies |
| `UXER_SECURE_COOKIE` | `1` to mark session cookies `Secure` (HTTPS only) |
| `ALLOW_PRIVATE_HOSTS` | Comma-separated hosts that bypass the SSRF guard (e.g. `localhost`) |
| `UXER_STATIC_DIR` | Built frontend directory for production serving (`client/dist`) |
| `UXER_AUTH_RATE_LIMIT` | Auth requests allowed per IP per minute (default `20`) |
