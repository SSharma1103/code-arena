// Run against dev:web. Backend rendering/codec coverage lives in agent test:video.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("individual export controls show progress, retry, preview, restore, and fit mobile including cube", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const id = "12345678-1234-1234-1234-123456789abc";
    let mode = "svg", job, attempts = 0, closed = false;
    const requests = [];
    await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { uid: "test", name: "Tester" } } }));
    await page.route("**/api/arena/**", route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace("/api/arena/", "");
      if (path === "models") return route.fulfill({ json: [{ id: "test/model" }] });
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "event: connected\ndata: {}\n\n" });
      if (path === `sessions/${id}`) return route.fulfill({ json: { id, mode, model: "test/model", maxScreenshots: 3, credentialSource: "user", status: closed ? "ended" : "ready", runs: [], artifacts: closed || mode === "cube" ? [] : [{ id, format: "svg", entryFile: "art.svg" }], reviews: [], sequence: 0, initialCubeMoves: 0, cubeStarted: false, ...(mode === "cube" && !closed ? { cube: { gameId: "cube", cube: { faces: {}, solved: true, moveHistory: [] }, nextAction: null } } : {}) } });
      if (path.endsWith("/exports") || path.endsWith("/retry")) {
        requests.push(req.postDataJSON()); attempts++;
        job = { id: id.slice(0, -1) + attempts, sessionId: id, outputId: mode === "cube" ? "cube" : id, sourceVersion: "snapshot", settings: { duration: req.postDataJSON().duration ?? 10, width: 1080, height: 1920, fps: 30, seed: 42 }, status: attempts === 1 ? "queued" : "completed", progress: attempts === 1 ? 0 : 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        return route.fulfill({ json: job, status: 202 });
      }
      if (path.startsWith("exports/") && !path.endsWith("video")) return route.fulfill({ json: job });
      return route.fulfill({ contentType: "text/html", body: "<html><body>Artifact preview</body></html>" });
    });
    const base = process.env.ARENA_TEST_URL ?? "http://localhost:3000";
    await page.goto(`${base}/arena/svg?session=${id}`);
    const panel = page.locator(".video-export");
    await panel.locator("summary").click();
    await panel.getByLabel("Duration").selectOption("10");
    await panel.getByRole("button", { name: "Export video", exact: true }).click();
    await panel.getByText("Queued — waiting for video worker").waitFor();
    assert.deepEqual(requests[0], { outputId: id, duration: 10 });
    job.status = "rendering"; job.progress = 40;
    await panel.getByText("rendering · 40%").waitFor();
    job.status = "failed"; job.failure = { code: "timeout", message: "Rendering exceeded its time limit." };
    await panel.getByRole("button", { name: "Retry export" }).click();
    await panel.getByRole("link", { name: "Download 10s MP4 ↓" }).waitFor();
    assert.match(await panel.locator("video").getAttribute("src"), /\/exports\/.*\/video$/);
    await page.reload(); await panel.locator("summary").click();
    await panel.getByRole("link", { name: "Download 10s MP4 ↓" }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      const bounds = await panel.locator(".video-export-controls").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `popover bounds at ${width}: ${JSON.stringify(bounds)}`);
      await page.screenshot({ path: join(tmpdir(), `arena-video-${width}.png`), fullPage: true });
    }
    closed = true; await page.reload(); await panel.locator("summary").click();
    await panel.getByRole("link", { name: "Download 10s MP4 ↓" }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "Export video", exact: true }).isDisabled(), true);
    closed = false; mode = "cube";
    await page.goto(`${base}/arena/cube?session=${id}`);
    await panel.locator("summary").click(); await panel.getByLabel("Duration").selectOption("15");
    await panel.getByRole("button", { name: "Export video", exact: true }).click();
    await panel.getByRole("link", { name: "Download 15s MP4 ↓" }).waitFor();
    assert.deepEqual(requests.at(-1), { outputId: "cube", duration: 15 });
  } finally { await browser.close(); }
});
