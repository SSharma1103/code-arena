# Code Arena

A local model comparison playground for SVG artwork, Three.js objects, HTML
experiences, and a live Rubik's Cube agent. Built with TypeScript and npm workspaces.

- `apps/agent`: Node.js HTTP service at http://localhost:3001. Health check: `GET /health`.
- `apps/code-arena`: Next.js App Router application at http://localhost:3000.

## Getting started

Requires Node.js 22 or newer and npm.

```sh
npm ci
npx playwright install chromium
# Copy apps/agent/.env.example to apps/agent/.env and set OPENROUTER_API_KEY.
npm run dev
```

## Commands

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start both apps with file watching |
| `npm run dev:agent` | Start the Node.js app |
| `npm run dev:web` | Start the Next.js app |
| `npm run build` | Build both apps |
| `npm run typecheck` | Check TypeScript in both apps |
| `npm run lint` | Run configured workspace linters |
| `npm start --workspace=agent` | Start the built agent |
| `npm start --workspace=code-arena` | Start the built Next.js app |

The agent uses `AGENT_PORT` (default `3001`) and binds to `127.0.0.1`. Install dependencies from the root to maintain a single lockfile.

## Arena workspace

Open http://localhost:3000 and choose Generate SVG, 3D Objects, Ball in Hex (HTML),
or Rubik's Cube. Then select an OpenRouter model, edit the prompt, and choose a
maximum of 0–10 screenshot attempts per run (default 3). HTML accepts other tasks
as well as the prefilled hexagon challenge.

The workspace shows tool activity, responses, artifact versions, source,
downloads, screenshot reviews, and available token usage. Prepare cube opens an
embedded game; Start solving begins model-selected moves. Continue solving
resumes an unfinished attempt. Stop run retains previews. End session deletes
temporary artifacts and stops owned servers/browser processes, returning a
cleanup and telemetry brief.

The model picker fetches the live OpenRouter catalogue through the agent, ordered
by weekly token usage. Search by model name or ID, browse tool-capable models in
popularity order, or enter an ID manually. Provider failures show a retry action.

Sessions survive refresh while the agent remains alive. They expire after 30
minutes without visible-page heartbeats or activity; active runs defer expiry.
Agent restarts expire web sessions and previews. This release supports one model
per session on a local machine.

Next.js forwards `/api/arena/*` through server-side Route Handlers. The agent API
checks an internal secret and opaque browser owner. Set matching
`AGENT_INTERNAL_SECRET` values in `apps/agent/.env` and
`apps/code-arena/.env.local` to override the shared local-development default.
`AGENT_API_URL` overrides the web server's default agent URL. The default OpenRouter
key stays on the agent server; optional user keys are scoped to one session.
Previews are sandboxed and network-restricted;
Three.js 0.128.0 is served locally at `/runtime/three.module.js`.
The CLI remains available with `npm run cli --workspace=agent`.

## Verification

Run `npm run test --workspace=agent`, `npm run typecheck`, `npm run lint`, and
`npm run build` from the root. Tests do not call a live provider.

For browser smoke tests, start the fixture with
`node --import tsx apps/agent/tests/web-fixture.ts`. In a separate PowerShell terminal,
set `$env:AGENT_API_URL='http://127.0.0.1:3401'` and
`$env:CODE_ARENA_DIST_DIR='.next-preview'`, then start Next with
`npm run dev --workspace=code-arena -- --port 3400`.

Run `node apps/agent/tests/browser-smoke.mjs` from another terminal. It verifies all
four modes, refresh, source, reviews, cancellation and cleanup using a fake model
with real rendering tools and the cube MCP server. Screenshots go into the ignored
`apps/agent/.data` directory. The separate build directory supports running this
alongside the usual development server.

With the regular development servers running, `node apps/agent/tests/model-picker-smoke.mjs`
checks the live catalogue, search, keyboard selection, manual IDs, retry handling,
and mobile layout. It fetches model metadata and does not run generation calls.
## Session OpenRouter keys

The optional key field above the model picker overrides the server key only for
that session. Leave it blank to keep using `OPENROUTER_API_KEY`. Custom keys are
verified before session creation, held only in agent memory, and released when
the session ends, expires, or the agent stops. They cannot be changed mid-session;
start a new session to switch keys. Refreshing an active session needs no re-entry.
Keys are never saved to browser storage or session transcripts.

Run the browser regression against the dev servers with
`node apps/agent/tests/session-key-smoke.mjs` (uses mocked provider/session APIs).

## Publishing to GitHub

From this directory, create an empty GitHub repository, then run:

```sh
git add .
git commit -m "Initial Code Arena monorepo"
git remote add origin https://github.com/SSharma1103/code-arena.git
git push -u origin main
```

Real environment files, dependencies, build output, and local session data are
ignored. Both `.env.example` files are included. GitHub Actions runs typecheck,
lint, agent tests, and builds without provider credentials.

The current app is intended for local use. Its development secret and owner
cookies are not a public hosting authentication system. Configure a private
deployment and real access controls before exposing the server-funded API online.
No project license has been selected; choose one before offering reuse rights.
