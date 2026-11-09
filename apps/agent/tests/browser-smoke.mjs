import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Start web-fixture.ts on 3401 and Next on 3400 with AGENT_API_URL pointing at it.
const base = process.env.ARENA_BROWSER_URL ?? "http://localhost:3400";
await mkdir("apps/agent/.data", { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Generate SVG" }).waitFor();
  await page.screenshot({ path: "apps/agent/.data/arena-home-desktop.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  console.log(
    "Desktop home dimensions",
    await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      viewport: innerHeight,
    })),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "apps/agent/.data/arena-home-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const mode of ["svg", "3js", "html", "cube"]) {
    await page.goto(base + "/arena/" + mode);
    await page.getByLabel("Choose your model").fill("test/designer");
    const label =
      mode === "cube"
        ? "Prepare cube"
        : mode === "svg"
          ? "Generate artwork"
          : mode === "3js"
            ? "Generate object"
            : "Generate experience";
    await page.getByRole("button", { name: label, exact: false }).click();
    await page.waitForURL(/session=/);
    await page.waitForFunction(
      () =>
        document.querySelector(".telemetry-status")?.textContent ===
        "COMPLETED",
      null,
      { timeout: 60000 },
    );
    if (mode === "cube") {
      await page
        .frameLocator('iframe[title="Live Rubik’s cube"]')
        .locator("canvas")
        .waitFor();
      await page.getByRole("button", { name: "Start solving" }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".cube-stats")
            ?.textContent?.includes("SOLVED"),
        null,
        { timeout: 60000 },
      );
      await page.waitForFunction(
        () =>
          document.querySelector(".telemetry-status")?.textContent ===
          "COMPLETED",
        null,
        { timeout: 60000 },
      );
    } else {
      const frame = page.frameLocator(
        'iframe[title="Generated artifact preview"]',
      );
      if (mode === "3js") await frame.locator("canvas").waitFor();
      else if (mode === "svg") await frame.locator("img").waitFor();
      else await frame.locator("div").waitFor();
      await page.getByRole("button", { name: "source", exact: true }).click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".source-code")
            ?.textContent?.includes("Loading source"),
      );
      assert.match(
        await page.locator(".source-code").textContent(),
        mode === "svg" ? /<svg/ : /<html>/,
      );
      await page.getByRole("button", { name: "preview", exact: true }).click();
    }
    await page.locator("iframe").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `apps/agent/.data/arena-${mode}-desktop.png`,
    });
    await page.getByRole("button", { name: /reviews/ }).click();
    await page.locator(".review-gallery img").first().waitFor();
    await page.getByRole("button", { name: "preview", exact: true }).click();
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector(".telemetry-status")?.textContent ===
        "COMPLETED",
    );
    await page.locator("iframe").waitFor();
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `apps/agent/.data/arena-${mode}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "End session" }).click();
    await page.getByRole("heading", { name: "All wrapped up." }).waitFor();
    assert.match(
      await page.locator(".end-card").textContent(),
      /Preview server stopped/,
    );
    console.log(mode, "passed");
  }
  await page.goto(base + "/arena/svg");
  await page.getByLabel("Choose your model").fill("test/slow");
  await page.getByRole("button", { name: "Generate artwork" }).click();
  await page.getByRole("button", { name: "Stop run" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".telemetry-status")?.textContent === "CANCELLED",
  );
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("heading", { name: "All wrapped up." }).waitFor();
  assert.deepEqual(errors, []);
  console.log("All browser flows passed, including cancellation.");
} finally {
  await browser.close();
}
