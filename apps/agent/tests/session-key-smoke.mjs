import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.ARENA_BROWSER_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/arena/models", (route) => route.fulfill({ json: [{ id: "test/model" }] }));
  for (const [mode, action] of [["svg", "Generate artwork"], ["3js", "Generate object"], ["html", "Generate experience"], ["cube", "Prepare cube"]]) {
    let view, fail = true;
    await page.route("**/api/arena/sessions**", async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.endsWith("/sessions") && req.method() === "POST") {
        assert.equal(req.postDataJSON().openRouterApiKey, "test-private-key");
        if (fail) { fail = false; return route.fulfill({ status: 400, json: { error: "Check your key" } }); }
        view = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", mode, model: "test/model", maxScreenshots: 3,
          credentialSource: "user", status: "ready", runs: [], artifacts: [], reviews: [], sequence: 0,
          initialCubeMoves: 0, cubeStarted: false };
        return route.fulfill({ status: 201, json: view });
      }
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": heartbeat\n\n" });
      if (path.endsWith("/runs")) return route.fulfill({ status: 202, json: { operationId: "test" } });
      if (req.method() === "DELETE") {
        view.status = "ended";
        view.cleanup = { filesDeleted: 0, previewStopped: true, browserClosed: true, serverStopped: true, errors: [], durationMs: 0, modelCalls: 0, toolCalls: 0, tokens: null };
        return route.fulfill({ json: view.cleanup });
      }
      return route.fulfill({ json: view });
    });
    await page.goto(`${base}/arena/${mode}`);
    const input = page.getByLabel("OpenRouter API key");
    await input.fill("test-private-key");
    assert.equal(await input.getAttribute("type"), "password");
    await page.getByRole("button", { name: "Show API key" }).click();
    assert.equal(await input.getAttribute("type"), "text");
    await page.getByLabel("Choose your model").fill("test/model");
    await page.getByRole("button", { name: action }).click();
    await page.getByText("Check your key", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "test-private-key");
    await page.getByRole("button", { name: action }).click();
    await page.getByText("Using your key", { exact: true }).waitFor();
    assert.equal(await input.count(), 0);
    await page.reload();
    await page.getByText("Using your key", { exact: true }).waitFor();
    await page.getByRole("button", { name: "End session" }).click();
    await page.getByRole("heading", { name: "All wrapped up." }).waitFor();
    await page.locator(".header-actions").getByRole("button", { name: "Start new session" }).click();
    assert.equal(await input.inputValue(), "");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.unroute("**/api/arena/sessions**");
    console.log(`${mode}: key input, error recovery, session lock, refresh and restart passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
