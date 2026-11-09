import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against the normal dev servers. Session creation/cleanup use the real API;
// model metadata and run submission are intercepted to avoid provider charges.
const base = process.env.ARENA_BROWSER_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/arena/models", (route) => route.fulfill({
    json: [{ id: "test/restart", name: "Restart Test", supportsTools: true }],
  }));
  await page.route("**/api/arena/sessions/*/runs", (route) => route.fulfill({
    status: 202,
    json: { operationId: "intercepted-run" },
  }));

  for (const [mode, action] of [
    ["svg", "Generate artwork"],
    ["3js", "Generate object"],
    ["html", "Generate experience"],
    ["cube", "Prepare cube"],
  ]) {
    await page.goto(`${base}/arena/${mode}`);
    let previousId;
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByLabel("Choose your model").fill("test/restart");
      await page.getByLabel("Maximum screenshots").fill("7");
      await page.locator("#prompt").fill("A prompt for the previous session");
      await page.getByRole("button", { name: action }).click();
      await page.waitForURL(/session=/);
      const id = new URL(page.url()).searchParams.get("session");
      assert.notEqual(id, previousId);
      previousId = id;
      await page.getByLabel("Choose your model").isDisabled().then((disabled) => assert.ok(disabled));
      // Cover both sessions created in this component and sessions resumed by URL.
      if (attempt === 1) {
        await page.reload();
        await page.getByRole("button", { name: "End session" }).waitFor();
      }
      await page.getByRole("button", { name: "reviews", exact: true }).click();
      await page.getByRole("button", { name: "End session" }).click();
      await page.getByRole("heading", { name: "All wrapped up." }).waitFor();
      const scope = page.locator(attempt === 0 ? ".header-actions" : ".composer");
      const restart = scope.getByRole("button", { name: "Start new session" });
      await restart.waitFor();
      await restart.click();
      await page.getByRole("button", { name: action }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/arena/${mode}`);
      assert.equal(new URL(page.url()).search, "");
      assert.equal(await page.getByLabel("Choose your model").isEnabled(), true);
      assert.equal(await page.getByLabel("Choose your model").inputValue(), "");
      assert.equal(await page.getByLabel("Maximum screenshots").inputValue(), "3");
      assert.ok((await page.locator("#prompt").inputValue()).length > 0);
      assert.notEqual(await page.locator("#prompt").inputValue(), "A prompt for the previous session");
      assert.equal(await page.locator(".tabs button.active").textContent(), "preview");
      assert.equal(await page.locator(".end-card").count(), 0);
      assert.equal(await page.locator(".telemetry-status").textContent(), "STANDING BY");
      assert.equal(await page.locator(".event-list details").count(), 0);
      assert.equal(await page.getByRole("button", { name: "End session" }).count(), 0);
    }
    // Refresh must keep the reset workspace, rather than reopening the ended ID.
    await page.reload();
    await page.getByRole("button", { name: action }).waitFor();
    assert.equal(await page.getByLabel("Choose your model").isEnabled(), true);
    console.log(`${mode}: end, restart, second session, resumed session, and refresh passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
