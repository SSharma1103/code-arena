import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ARENA_TEST_URL ?? 'http://localhost:3000';

test('auth boundary rejects anonymous sessions and cross-origin writes', async () => {
  for (const path of ['models', 'models/check', 'sessions', 'sessions/aaaaaaaa/runs', 'sessions/aaaaaaaa/events', 'sessions/aaaaaaaa/artifacts/bbbbbbbb']) {
    const response = await fetch(`${base}/api/arena/${path}`);
    assert.equal(response.status, 401, path);
  }
  const response = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin: 'https://untrusted.test', 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'forged' }) });
  assert.equal(response.status, 403);
  const missing = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin: new URL(base).origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missing.status, 400);
  const signedOut = await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin: new URL(base).origin } });
  assert.equal(signedOut.status, 200);
  assert.match(signedOut.headers.get('set-cookie'), /arena_session=;.*Max-Age=0/i);
});

test('sign-in dialog matches the launcher and fits desktop and mobile', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(base);
      await page.locator('a.quadrant').first().waitFor();
      assert.equal(await page.locator('a.quadrant').count(), 4);
      await page.getByRole('dialog', { name: 'Step into the arena.' }).waitFor();
      await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `../../.data/auth-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog:open').count(), 1);
      await page.close();
    }
  } finally { await browser.close(); }
});

 test('model failures block runs and retry unlocks the selected model', async () => {
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage();let calls=0;
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{uid:'test',name:'Tester',email:null}}}));
 await page.route('**/api/arena/models',route=>route.fulfill({json:[{id:'test/model',name:'Test Model'}]}));
 await page.route('**/api/arena/models/check',route=>{calls++;return route.fulfill({json:{model:'test/model',status:calls===1?'unavailable':'available',reason:calls===1?'Model is rate limited.':undefined,latencyMs:10,checkedAt:new Date().toISOString()}})});
 await page.goto(base+'/arena/svg');
 await page.locator('#openrouter-key').fill('test-user-key');
 const model=page.locator('#model');await model.fill('test/model');await model.press('Enter');
 await page.getByText('Model is rate limited.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Generate artwork'}).isDisabled(),true);
 await page.getByRole('button',{name:'Retry check'}).click();
 await page.getByText('Available (10 ms)',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Generate artwork'}).isEnabled(),true);
 }finally{await browser.close()}
 });
