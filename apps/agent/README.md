# Agent

Node.js agent runtime with an OpenRouter adapter, conservative context budgeting,
rolling-summary memory, file sessions, and JSON telemetry on stderr.

## Testing CLI

Copy `.env.example` to `.env` in this directory for service settings. The web app requires each user to supply their own OpenRouter key. The CLI prompts for a key with hidden input.
From the repository root:

```sh
npm run cli --workspace=agent
npm run cli --workspace=agent -- --session <session-id>
```

Use the filter to narrow model IDs, arrow keys to select, and Enter to confirm.
Manual model-ID entry is available when metadata cannot be loaded. Enter submits
a prompt. `/exit` quits; Ctrl+C cancels an active run or exits when idle.
Responses are complete, not streamed. The HTTP service provides authenticated
session/run APIs and SSE for the Next.js workspace, alongside `GET /health`.

Sessions are private local JSON files under `.data/sessions`, ignored by Git.
Each fixes its model/system prompt and retains the original transcript alongside
its working summary. Run locks protect writes; CLI leases prevent two CLI
processes opening the same session. After an unclean process termination, verify
the recorded process ID is no longer running before removing its `.lock` files.

The context layer uses the smaller of OpenRouter's model and top-provider context
windows. Output is limited to the advertised completion maximum, one quarter of
the context window, and the application's 128,000-token ceiling. Five percent of
the window is reserved for framing and estimation differences. Unknown models
use a conservative 32,768-token context and 8,192-token output fallback.
Compaction starts at 80% of the remaining input budget. UTF-8 bytes plus message overhead provide an
intentionally conservative estimate, not a model-specific tokenizer. This can
compact earlier than necessary. Actual provider usage is emitted separately.
Metadata refreshes after five minutes; failed lookups are not cached.

Compaction uses the session model and is a billable model call. It retains the
latest four completed turns when they fit; larger histories are summarized in
bounded chunks with up to 8,192 summary tokens. JSON escaping is included in
chunk accounting. Failed compaction preserves the previous stored memory. There
are no automatic retries. Default run timeout is 15 minutes (configurable in
the Agent constructor); cancellation is supported through AbortSignal.

## Development

```sh
npm test --workspace=agent
npm run typecheck --workspace=agent
npm run build --workspace=agent
```

Tests use fake clients and temporary directories; no credentials or live calls
are required. The runtime uses constructor injection and application-owned
contracts in `src/types.ts`. Web API DTOs are shared through `packages/contracts`.

## Artifact tools

The Agent lives in `src/agent/agent.ts`. Inject registered tools through its
constructor; the CLI registers `src/tools/write_file.ts` automatically.
`write_file` accepts `{format: "svg" | "html" | "3js", content: string}`.
HTML and 3js are complete HTML pages; Three.js pages supply their browser imports.
Tool-capable models receive tool definitions and can correct rejected calls.
Runs stop after eight model calls or twelve tool calls, with no automatic retries.

Artifacts use generated filenames in a private OS temporary directory, limited
to 8 MiB per file and 64 MiB per session (web and CLI). The CLI prints localhost preview URLs
and per-response timing, usage, model calls, and tool calls. Open a URL manually.
Previews use a sandboxed iframe; generated code executes only in the browser.
External HTTPS imports/assets are allowed; previews have no application APIs.

On `/exit`, idle Ctrl+C, or SIGTERM, shutdown awaits active work, stops the
in-process preview server, removes temporary files, releases the CLI lease, and
prints a telemetry brief plus deletion/server confirmation. Ctrl+C during a run
cancels that run; exit once idle. Cleanup errors are reported with a failing exit
status. Forced termination or a power failure cannot guarantee cleanup.
Conversations persist, but previous artifact paths and URLs expire on exit;
resumed sessions must generate new files. Structured telemetry excludes file
contents and responses. The exit brief includes summary-call usage and identifies
calls with unavailable usage; token totals cover only usage reported by providers.


### Automated preview review

Install the Playwright browser once after installing npm dependencies:

```sh
npx playwright install chromium --no-shell
```

The CLI registers `ReviewPreviewTool` as `review_preview` alongside `write_file`.
Call it with the `entryFile` returned by `write_file` (relative to the temporary
artifact workspace) and an integer `captureAfterMs` between 0 and 5000:

```json
{"entryFile":"<artifact-id>.html","captureAfterMs":500}
```

Only artifacts created in the current run are reviewable. The tool composes an
injected Chromium launcher and a `PreviewServer`; `LocalRunPreviewServer` composes
an authorized `PreviewFileSource`. Each review starts its own loopback server and
fresh browser context, then closes the context, browser, and listener in `finally`,
including on failure or cancellation. Browser launch is limited to 10 seconds,
navigation to 8 seconds, screenshot operations to 5 seconds, and the overall review
to 20 seconds.

Results include a 1280?720 PNG image plus structured console errors, uncaught
JavaScript errors, failed requests, HTTP errors, blocked requests, and any navigation
error. Each diagnostic list is capped at 100 entries and strings at 2000 characters.
The agent keeps metadata on the original tool-call ID and sends screenshots as
image content after the tool results, so use an image-capable model. Screenshots
are preserved in session transcripts; telemetry does not contain their contents.

Review browser requests can reach only the exact run preview server origin.
Service workers, WebSockets, downloads, popups, external resources and nested frames
are restricted. CDN imports are unavailable during review; bundle Three.js and
other dependencies as authorized local artifacts. Interactive `write_file` previews
retain their existing policy. Review does not execute generated code in Node.js.
The browser is an isolation boundary, not an OS/container sandbox for hostile tenants.

`npm run test --workspace=agent` includes a Chromium integration test when the
browser is installed; otherwise that test reports a skip. Unit tests use injected
dependencies and do not require browser downloads or OpenRouter access.

### Live Rubik's Cube MCP tool

Run `npm run cli --workspace=agent`, select a tool-capable model, and prompt:
`Start a Rubik's cube and solve it. Show me the live feed.`
The agent chooses moves using `rubiks_start_cube`, `rubiks_join_game`,
`rubiks_manipulate_cube`, and `rubiks_finish`. Default scramble difficulty is 20
moves (override in your prompt). No algorithmic solver is injected; upstream
state includes move history, including scramble moves.

The first cube tool call starts a session-owned MCP child on an ephemeral
loopback port. A visible, isolated Chromium window opens on start/join. Install
Chromium with `npx playwright install chromium --no-shell` if needed. The viewer
requires its upstream Three.js and Socket.IO CDN assets. Its browser policy is
separate from the stricter `review_preview` policy.

Cube tool use promotes only that run to 5 minutes from run start, 64 model calls,
and 128 tool calls. Cancellation preserves the cube for another prompt. Games
and live URLs are not restored from saved chats. If the server crashes, create a
new CLI session. Closing the browser manually allows reopening via join/start.

`/exit`, idle Ctrl+C, or SIGTERM closes the browser and MCP child and prints
cleanup confirmation alongside the existing artifact cleanup and telemetry.
The published server is pinned to 1.1.1; the root postinstall patch fixes
loopback binding, port readiness, game URLs, and an upstream back-face rotation
that reversed the bottom edge incorrectly. Its upstream MIT license remains
in the installed package. The real MCP/browser integration test requires
Chromium and access to the viewer CDNs; routine model calls are mocked.

Cube Studio now opens in the owned browser with a large responsive 3D stage,
orbit/zoom controls, and an agent move timeline (scramble moves are excluded).
Launching a cube pauses the agent. Press **Start solving** in the browser to
submit a fresh solving turn in the CLI; the five-minute solve budget begins with
that turn. Move/finish calls are rejected before Start. Exit still closes both
the viewer and MCP process. The application-owned viewer is served through the
owned browser; opening the raw upstream URL in another browser uses its original UI.

When a solving turn ends without solving, Cube Studio shows **Attempt ended**
(or **Attempt interrupted** on failure) and offers **Continue solving**. It does
not leave a stopped agent labeled as running. Existing games created with the
old back-face rotation may contain invalid states; restart the CLI and create a
new cube after updating this patch.

## Model limit references

Checked November 14, 2026 against OpenRouter's live model catalogue:

| Model | Context tokens | Maximum completion tokens |
| --- | ---: | ---: |
| [GPT-6 Astra](https://openrouter.ai/openai/gpt-6-astra) | 1,050,000 | 128,000 |
| [Claude Fable 5.2](https://openrouter.ai/anthropic/claude-fable-5.2-20261109) | 1,000,000 | 128,000 |

These are reference snapshots; runtime budgets come from the selected model's live
metadata, with the application ceilings above. Reasoning shares the completion
budget, so visible code may be shorter. A length-limited completion fails instead
of executing incomplete tool arguments or reporting a truncated artifact as complete.
See the [model catalogue API](https://openrouter.ai/docs/api/api-reference/models/get-models),
[completion parameters](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request),
and [reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
Artifact byte limits and the 15-minute deadline are application resource policies,
not provider guarantees. Tests mock inference and write real large temporary files;
they do not spend OpenRouter credits or establish real-model quality or latency.
