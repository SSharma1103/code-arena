import assert from "node:assert/strict";
import { chromium } from "playwright";

// Uses a running Next/agent pair; model listing only, no paid generation calls.
const base = process.env.ARENA_BROWSER_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const modelResponse = page.waitForResponse((response) => response.url().endsWith("/api/arena/models"));
  await page.goto(base + "/arena/svg");
  const response = await modelResponse;
  assert.equal(response.status(), 200);
  const liveModels = await response.json();
  assert.ok(liveModels.length > 0);
  assert.ok(liveModels.every((model) => model.name && model.supportsTools));
  await page.locator("#model-help").filter({ hasText: "Popular first" }).waitFor();
  const input = page.getByRole("combobox", { name: "Choose your model" });
  await input.click();
  const options = page.getByRole("option");
  assert.equal(await options.count(), Math.min(40, liveModels.length));
  assert.ok((await options.first().innerText()).includes(liveModels[0].name));
  await page.screenshot({ path: "apps/agent/.data/model-picker-desktop.png" });
  await options.first().click();
  assert.equal(await input.inputValue(), liveModels[0].id);
  assert.equal(await input.getAttribute("aria-expanded"), "false");

  await input.fill(liveModels[0].id);
  await input.press("ArrowDown");
  await input.press("Enter");
  assert.equal(await input.inputValue(), liveModels[0].id);
  await input.fill("custom/manually-entered-model");
  await page.getByText("No matches. You can still use this model ID.").waitFor();
  await input.press("Escape");
  assert.equal(await input.inputValue(), "custom/manually-entered-model");

  const fixtures = [
    { id: "z/popular-model", name: "Most Popular", supportsTools: true },
    { id: "a/second-model", name: "Another Model", supportsTools: true },
  ];
  let available = false;
  await page.route("**/api/arena/models", async (route) => {
    if (!available) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 503, json: { error: "Provider unavailable" } });
    } else await route.fulfill({ json: fixtures });
  });
  await page.reload();
  await page.locator("#model-help").filter({ hasText: "Loading popular models" }).waitFor();
  await page.getByRole("button", { name: "retry", exact: true }).waitFor();
  available = true;
  await page.getByRole("button", { name: "retry", exact: true }).click();
  await page.locator("#model-help").filter({ hasText: "Popular first" }).waitFor();
  await input.click();
  assert.ok((await options.first().innerText()).includes("Most Popular"));
  await input.fill("ANOTHER");
  assert.equal(await options.count(), 1);
  await options.first().click();
  assert.equal(await input.inputValue(), "a/second-model");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Browse popular models", exact: true }).click();
  await options.first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "apps/agent/.data/model-picker-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`Model picker passed: ${liveModels.length} live models, ranking, search, keyboard selection, manual IDs, retry, and mobile layout.`);
} finally {
  await browser.close();
}
