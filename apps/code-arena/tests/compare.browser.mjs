// Run against npm run dev:web, or set ARENA_TEST_URL. Uses installed Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("comparison starts both outputs, isolates failures, restores and fits mobile", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const sessions = new Map();
    const started = [];
    let count = 0;
    await page.route("**/api/arena/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname.replace("/api/arena/", "");
      if (path === "models")
        return route.fulfill({
          json: [
            { id: "test/a", name: "Model Alpha" },
            { id: "test/b", name: "Model Beta" },
          ],
        });
      if (path === "sessions" && req.method() === "POST") {
        const body = req.postDataJSON(),
          id = String(++count).padStart(8, "0") + "-aaaa";
        const value = {
          ...body,
          id,
          credentialSource: "server",
          status: "ready",
          runs: [],
          artifacts: [],
          reviews: [],
          initialCubeMoves: 0,
          cubeStarted: false,
          sequence: 0,
        };
        delete value.openRouterApiKey;
        sessions.set(id, value);
        return route.fulfill({ json: value });
      }
      const [, id, action] = path.split("/"),
        value = sessions.get(id);
      if (action === "events")
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: "event: connected\ndata: {}\n\n",
        });
      if (action === "runs") {
        started.push({ id, ...req.postDataJSON() });
        value.status = "running";
        value.runs.push({
          id: "run-" + started.length,
          prompt: req.postDataJSON().prompt,
          status: "running",
          modelCalls: 1,
          toolCalls: 0,
          screenshots: 0,
        });
        // Neither side completes until the other has also started.
        if (started.length === 2)
          for (const [i, s] of [...sessions.values()].entries()) {
            s.status = "ready";
            Object.assign(s.runs.at(-1), {
              status: i ? "failed" : "completed",
              response: i ? undefined : "Alpha completed",
              error: i ? "Beta failed" : undefined,
            });
          }
        return route.fulfill({ json: { operationId: "run" } });
      }
      if (value) return route.fulfill({ json: value });
      return route.fulfill({ status: 404, json: { error: "Not found" } });
    });
    await page.goto(process.env.ARENA_TEST_URL ?? "http://localhost:3000");
    await page.getByRole("button", { name: "Compare", exact: false }).click();
    await page.locator("a.quadrant.mode-svg").click();
    await page.locator(".comparison-lane").first().waitFor();
    assert.equal(await page.locator(".comparison-lane").count(), 2);
    await page.locator("#comparison-model-0").fill("test/a");
    await page.locator("#comparison-model-1").fill("test/b");
    await page.locator("#comparison-prompt").fill("Draw the same flower");
    await page.getByRole("button", { name: "Run comparison" }).click();
    await page.waitForFunction(() => location.search.includes("sessionB="));
    await page.waitForTimeout(1200);
    assert.equal(started.length, 2);
    assert.equal(started[0].prompt, started[1].prompt);
    await page.reload();
    await page.getByText("Alpha completed", { exact: true }).waitFor();
    await page.getByText("Beta failed", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Retry", exact: true }).count(),
      1,
    );
    const ids = await page
      .locator("[id]")
      .evaluateAll((nodes) => nodes.map((n) => n.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `overflow at ${width}`,
      );
      await page.screenshot({
        path: join(tmpdir(), `code-arena-compare-${width}.png`),
        fullPage: true,
      });
    }
  } finally {
    await browser.close();
  }
});
