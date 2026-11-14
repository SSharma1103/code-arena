# Individual reels exports

Run from the repository root with Node 22+:

```sh
npm install
npx playwright install chromium
# Development installs include FFmpeg/FFprobe static binaries.
npm run dev
npm run worker:video --workspace=agent
```

For production, install system FFmpeg with libx264 and put it on PATH or set `FFMPEG_PATH` (development installs fall back to `ffmpeg-static`). Run `npm run build`, then run `npm start --workspace=agent`, the Next.js application, and `npm run worker:video:production --workspace=agent` as separate supervised processes. Both agent and worker read `apps/agent/.env`; see `.env.example`. Set the same absolute `VIDEO_EXPORT_DIR` for both. Keep this directory private and outside the web root. The default is `apps/agent/.data/exports` for both source and compiled execution. The worker needs no OpenRouter or Firebase credentials. `VIDEO_CHROMIUM_CHANNEL=chrome` or `msedge` optionally uses an installed browser instead of Playwright's download.

Open **Export video** on an individual model output (including each comparison lane), choose 5/10/15 seconds, then export. The panel polls durable job progress, restores its last job after reload, previews the completed video, and downloads through the authenticated Next.js proxy. The latest export remains accessible on the closed/expired session view in the same browser. Failed jobs have explicit retries; unsupported legacy scripted outputs explain that regeneration is required. Stop an active model run before creating its export; retries use the original saved snapshot even after the session expires. Cube export captures the current face state with a smooth deterministic orbit, not a replay of solver moves.

Exports are silent 1080×1920 H.264 MP4, 30 FPS, square pixels, `yuv420p`, CRF 18, fast-start metadata. Sequential screenshots use `frameIndex / 30`, from zero through `duration - 1/30`, so rendering delays do not slow playback. JPEG intermediates use quality 94. SVG retains its aspect ratio with portrait safe margins; cube framing keeps the entire orbit visible. New HTML/Three.js generation instructions request responsive portrait layouts, large central subjects, readable typography, and safe margins for reel controls. Arbitrary old landscape pages cannot be automatically redesigned into good portrait layouts: regenerate those outputs. MP4 remains the original chosen content without added text, audio, or montages.

## Generated output timeline

The serializable job DTOs and `VideoExportTimeline` interface live in `packages/contracts`. The window property itself exists only inside the isolated output page:

```js
const assetsReady = Promise.all([document.fonts.ready, /* texture/image loads */]);
window.videoExport = {
  ready: assetsReady.then(() => {}),
  async renderAt(seconds) {
    mesh.rotation.y = seconds * 0.7;
    renderer.render(scene, camera);
  },
};
if (!window.__VIDEO_EXPORT__) {
  const start = performance.now();
  function tick(now) {
    window.videoExport.renderAt((now - start) / 1000);
    requestAnimationFrame(tick);
  }
  assetsReady.then(() => requestAnimationFrame(tick));
}
```

`ready` must be `true` or a promise resolving after scene assets initialize. `renderAt` must reconstruct an absolute timestamp in any order, finish drawing before resolving, and not use wall-clock deltas. Fixed-step simulations must reset and seek from their initial state. Use seed 42 for procedural randomness. Automatic loops, physics, CSS animation, and timers must not compete with the export clock. The worker seeds `Math.random` before scripts load; deterministic crypto randomness is not supplied. Generated code is responsible for honoring the contract; the exporter cannot prove arbitrary simulations deterministic.

Declarative SVG uses `pauseAnimations`/`setCurrentTime` for SMIL and paused Web Animations for CSS. Script-free HTML/CSS has a still/seek adapter. Scripted legacy HTML, canvas and Three.js need regeneration with the timeline contract; the exporter does not guess at their animation speed. Fonts/images are awaited. Assets must be inline data/blob resources or bundled Three.js imports from `/runtime/three.module.js` or `/runtime/three.min.js`. Remote assets/fonts are intentionally unavailable.

## Durability and limits

The repository has a local JSON session store and no existing queue/database. The export spool follows that convention: atomic JSON rename, source snapshot + SHA-256 version, owner, settings, progress, result location, and failure stored per job. A single worker lock enforces concurrency **one** on one machine. Do not run multiple API processes against this spool: duplicate submission serialization is process-local. Identical submissions reuse queued/active/completed jobs; a failed retry gets a new ID. Interrupted rendering/encoding is marked failed at worker startup, never silently rerun. After a hard crash, verify the previous worker and its child browsers have stopped, remove `worker.lock`, then restart. Graceful signals drain the current job and release the lock.

Limits: 16 pending jobs globally, 3 pending per owner, 100 retained jobs globally, 128 MiB of source snapshots, 512 MiB frames per job, 100 MiB final MP4, 10-minute execution deadline, 30-second initialization, 10-second timeline call, 15-second screenshots, and two FFmpeg encoding threads. Chromium's JS heap is capped at 256 MiB. Frames and partial results are removed on success/failure/recovery; completed videos remain until operator cleanup. At the retention limit, stop API/worker and remove obsolete job JSON and its matching UUID directory together. No automatic retention policy or distributed queue is introduced.

The worker uses a fresh sandbox-enabled Chromium context and a minimal child environment, no application cookies, and an in-memory synthetic HTTPS origin; no preview server is exposed. CSP, blocked service workers/WebSockets, and deny-by-default request interception permit only the snapshot and bundled Three.js. Browser requests never receive the API secret. Creating jobs requires session ownership; progress, retry, and streamed/ranged video downloads check the persisted owner independently of live sessions.

Browser sandboxing is not a host memory/CPU quota. For production, run this worker under an unprivileged dedicated account/container with no secrets or host source mounts, no network egress, a memory/CPU limit (e.g. 2 GiB/2 CPUs), bounded disk, and a private shared spool. Keep the Chromium sandbox enabled; do not add `--no-sandbox`. Network interception protects the application boundary, while OS isolation contains browser vulnerabilities and total resource consumption. Install Chromium's system dependencies on Linux (`npx playwright install --with-deps chromium`).

## Verification

```sh
npm run test --workspace=agent
npm run typecheck
npm run lint
npm run test:video --workspace=agent
```

The optional real-video smoke uses FFmpeg/FFprobe (`FFMPEG_PATH`/`FFPROBE_PATH` or the development static binaries), Chromium, and an authenticated local service fixture. It exports representative HTML, SVG, Three.js and cube files, probes dimensions/duration/frame count/codec/pixel format, verifies fast-start atom ordering, decodes playback, checks slow-rendered animation timing, and exercises legacy failure. Outputs and a report are retained under `.data/video-smoke` for visual review. This test uses no provider calls. Tests do not validate publication to Instagram or other platform upload policies.
