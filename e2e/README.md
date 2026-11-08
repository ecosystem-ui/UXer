# E2E Tests

End-to-end tests for UXer, written with [Playwright](https://playwright.dev). They
drive the real UI in a real Chromium browser against the built frontend served
by the Go backend on a single port (`:8099`), using a throwaway SQLite database
(`server/data/e2e.db`) that is wiped on every run.

The Playwright config lives at [`playwright.config.ts`](../playwright.config.ts);
the tests live in this directory.

## Layout

```
e2e/
├── helpers.ts              # shared UI/API helpers and test users
├── auth.spec.ts            # signup, logout, login, shared-link return, wrong password
├── projects.spec.ts        # create project + persona, share from project/persona pages, invite before signup
├── collaboration.spec.ts   # three users collaborating across two projects
├── comment-routing.spec.ts # comments in the proxied iframe + fallback guidance
├── view-routing.spec.ts    # same-URL subview replay (VM detail / wizard open+close)
├── view-state.spec.ts      # grid/list layout state (capture, replay, legacy fallback)
└── README.md               # this file
```

## How the runner works

`playwright.config.ts` uses the `webServer` option to do everything for you in
one command, in order:

1. Build the client (`cd client && npm run build` → `client/dist`).
2. Wipe the isolated DB (`server/data/e2e.db`, `-wal`, `-shm`).
3. Build a standalone server binary (`server/bin/uxer-e2e`).
4. Run it on `http://localhost:8099` with `UXER_DB_PATH=data/e2e.db` and
   `UXER_STATIC_DIR=../client/dist`, serving both API and the built SPA.

When the tests finish (or fail), Playwright kills the server process. No leftover
`go run` child can hold a wiped DB, so ordering is deterministic.

The tests run **one at a time** (`workers: 1`, `fullyParallel: false`) because
several specs sign up the same user accounts against the shared DB.

## Prerequisites

- **Go** — the test runner builds and starts the Go server (`cmd/uxer`).
- **Node.js 20+** and **npm**.
- Client dependencies installed: `cd client && npm install`.
- Playwright package installed at the repo root: `npm install`.
- A Playwright Chromium install: `npm run test:e2e:install`.
- **Outbound network access** to `https://osac-project.github.io/osac-ux/` and
  `https://heyethankim.github.io/osac-bmaas/` (the sample design URLs). Only
  `comment-routing`, `view-routing`, and `view-state` actually load the proxied
  design; `auth`/`projects`/`collaboration` don't require it.

## Setup (one time)

> **Important:** the `test:e2e*` scripts live in the **root** `package.json`.
> Run them from the repo root (`UXer/`), **not** from `client/` — otherwise npm
> reports `Missing script: "test:e2e:install"`.

```bash
# from the repo root (UXer/)
npm install                          # installs @playwright/test (root package)
npm run test:e2e:install             # downloads the Chromium browser
cd client && npm install && cd ..    # client build dependencies
```

## Running the tests

From the repo root:

```bash
npm run test:e2e          # build + start server + run all specs (headless)
npm run test:e2e:headed   # same, but with a visible browser window
```

### Run a single spec or test

```bash
npx playwright test e2e/auth.spec.ts
npx playwright test -g "signup, logout, then login"
```

`-g`/`--grep` matches against the test title. Combine with the spec file to
narrow further:

```bash
npx playwright test e2e/projects.spec.ts -g "share a project"
```

## Seeing it in the browser (debugging)

Several ways to watch the tests run and inspect what's happening:

### 1. Headed mode

Run with a visible browser window (no step-by-step pausing, just live):

```bash
npm run test:e2e:headed
# or
npx playwright test --headed
```

### 2. Playwright Inspector (step through line by line)

Pauses before each action and opens the Playwright Inspector so you can step
through the test, inspect the page, and evaluate snippets:

```bash
npx playwright test --debug
# debug a single test:
npx playwright test e2e/auth.spec.ts -g "signup" --debug
```

`PWDEBUG=1 npx playwright test` is equivalent to `--debug`.

### 3. UI mode

Open the interactive Playwright UI runner — list tests, run them, step through,
and watch the timeline:

```bash
npx playwright test --ui
```

### 4. `slowMo` (slow down the actions)

Slow every action down so you can follow along in a headed window:

```bash
npx playwright test --headed --slow-mo=500
```

Or set `slowMo: 500` under `use` in `playwright.config.ts` temporarily.

### 5. Traces and screenshots

The config captures a **trace on first retry** and a **screenshot on failure**
into `test-results/`. To open a trace:

```bash
npx playwright show-trace test-results/<test-name>-chromium/trace.zip
```

Tip: to always record traces while debugging, run with
`npx playwright test --trace on`, then open the produced `trace.zip`.

## Test data

Tests sign up their own users (e.g. `alice@example.com`, `owner@example.com`)
and create their own projects/personas, so the isolated `e2e.db` is fully
self-provisioning. Common users and helpers are in [`helpers.ts`](./helpers.ts):

- `signupViaUI` / `loginViaUI` / `logoutViaUI` — drive auth through the UI.
- `createProject` / `createPersona` / `shareProject` / `openProject` /
  `openPersona` — project/persona flows.
- `seedComment` — creates a comment via the API (reuses the page's session
  cookies) so specs can set up threads without clicking through the iframe.
- `USERS` — Ana/Ben/Cat used by the collaboration spec.

## Troubleshooting

- **`webServer` fails / port already in use** — stop any process on `:8099`, or
  change `UXER_PORT` in `playwright.config.ts`.
- **Server build error** — make sure Go is installed and `cd client && npm run
  build` succeeds on its own.
- **Browser not found** — run `npm run test:e2e:install` to install Chromium.
- **Comment-routing spec times out loading the iframe** — check outbound access
  to `osac-project.github.io`; the other specs don't need it.
