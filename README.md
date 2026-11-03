# UXer — Design Review & Version Management

UXer lets UX designers manage **projects**, define **versions** (a label + a public
design URL), preview that URL in an iframe, drop comments anchored to DOM
elements, run discussion threads, and resolve comments against a version.

- **Frontend**: React + Vite + TypeScript + MUI (Material UI)
- **Backend**: Go (`net/http`), SQLite (`modernc.org/sqlite`), email + password auth (bcrypt)
- **Preview**: a reverse proxy that rewrites the design URL into an
  iframe-embeddable page and injects an annotation bridge

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

1. Sign up with an email + password, then sign in.
2. Create a **project**.
3. Add a **version** — a label plus the public design URL (page, prototype,
   Storybook, Figma link, etc.).
4. Open the version to see the preview in an iframe.
5. Toggle **Comment mode**, click a DOM element, and add a comment.
6. Reply and resolve threads in the side panel. Resolving records the version
   the comment was resolved on; the version list shows open/resolved counts.

## Testing

End-to-end tests use [Playwright](https://playwright.dev) and run the built
frontend against the Go server on a single port with an isolated SQLite
database. The sample design URL is
<https://osac-project.github.io/osac-ux/>.

### Prerequisites

- Go 1.26+ (the server is started by the test runner)
- Node.js 20+ and npm, with the client dependencies installed (`cd client && npm install`)
- A Playwright Chromium install (`npm run test:e2e:install`)
- Outbound network access to `osac-project.github.io` (the server proxies the
  sample site; the auth/projects/collaboration specs don't require it, but the
  comment-routing spec does)

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
| `e2e/auth.spec.ts` | Sign up (creates account, lands on Projects), log out, log back in, and reject a wrong password |
| `e2e/projects.spec.ts` | Create a project, add a persona (version) with a design URL, and share a project with another user |
| `e2e/collaboration.spec.ts` | Three users; the owner creates two projects (each with a persona) and shares both; all three reply to the same thread; each resolves a different thread |
| `e2e/comment-routing.spec.ts` | Create a comment in comment mode inside the proxied iframe and verify clicking it opens its thread; verify the manual-fallback error icon and guidance render when a recorded wizard step is gated by validation/required fields |

## Preview proxy & limitations

The `/proxy?url=…` endpoint fetches the design URL server-side, rewrites
same-origin links/scripts/styles through a **path-preserving** subresource
route (`/__uxer__/p/<origin>/<path>`), injects a `<base>` so relative JS
`import()`/CSS `url()`/HTML references resolve correctly, strips
`X-Frame-Options`/`Content-Security-Policy`, and injects the annotation bridge.
It guards against SSRF (only global-unicast addresses are reachable).

Known limitations (documented, not blockers):

- **WebSockets** and cross-origin subframes of the target site are not proxied.
- **SPA path routing**: `fetch`/`XMLHttpRequest`/`history.pushState` are patched
  so JS apps and their API calls work, but `history.pushState`-style pathname
  routing (e.g. React Router `BrowserRouter`) may render the proxied URL rather
  than the original pathname. Hash-based routing is unaffected.
- **Cookies are not forwarded** to the target (stateless proxy). Design URLs
  must be publicly accessible or listed in `ALLOW_PRIVATE_HOSTS`.
- Iframes that the target site blocks via JavaScript (e.g. `top !== self`
  checks) cannot be overridden.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `UXER_PORT` | Go server port (default `8080`) |
| `UXER_DB_PATH` | SQLite file (default `data/uxer.db`) |
| `SESSION_SECRET` | Signing secret for session cookies |
| `UXER_SECURE_COOKIE` | `1` to mark session cookies `Secure` (HTTPS only) |
| `ALLOW_PRIVATE_HOSTS` | Comma-separated hosts that bypass the SSRF guard (e.g. `localhost`) |
| `UXER_STATIC_DIR` | Built frontend directory for production serving (`client/dist`) |
