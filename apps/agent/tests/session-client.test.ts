import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionClient, createSessionClient } from "../src/client/session-client.js";
import { ArenaService } from "../src/service/arena.js";
import { SessionManager, FileSessionStore } from "../src/session/session.js";
import type { ModelClient } from "../src/types.js";

test("session clients release provider references", async () => {
  const client = new SessionClient({ models: async () => [], generate: async () => ({ text: "ok", finishReason: "stop" }) });
  assert.deepEqual(await client.models(), []);
  client.dispose();
  client.dispose();
  assert.throws(() => client.models(), /ended/);
});

test("key verification uses only the provider endpoint and sanitizes failures", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/key");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json({ error: "secret" }, { status: 401 });
  };
  await assert.rejects(createSessionClient("secret", fetcher), /not accepted/);
  assert.equal(calls, 1);
  await assert.rejects(createSessionClient("secret", async () => { throw Error("secret"); }), /Could not verify/);
  await createSessionClient("secret", async () => Response.json({ data: {} }));
});

test("session keys isolate provider calls and never enter session responses or storage", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "arena-credentials-"));
  const calls: string[] = [];
  const fake = (key: string): ModelClient => ({
    models: async () => { calls.push(`${key}:models`); return [{ id: "test/model", contextLength: 100000 }]; },
    generate: async () => { calls.push(`${key}:generate`); return { text: "done", finishReason: "stop" }; },
  });
  const service = new ArenaService(fake("default"), new SessionManager(new FileSessionStore(dir)), {}, undefined, 1000,
    async (key) => { if (key === "bad") throw Error("bad secret"); return fake(key); });
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  const owner = "a".repeat(64);
  const settings = { mode: "svg", model: "test/model", maxScreenshots: 0 };
  for (const key of [1, "with space", "x".repeat(513)])
    await assert.rejects(service.create(owner, { ...settings, openRouterApiKey: key }));
  await assert.rejects(service.create(owner, { ...settings, openRouterApiKey: "bad" }), /Could not verify/);
  const custom = await service.create(owner, { ...settings, openRouterApiKey: " private-key " });
  const normal = await service.create(owner, settings);
  assert.equal(custom.credentialSource, "user");
  assert.equal(normal.credentialSource, "server");
  const events: unknown[] = [];
  service.subscribe(owner, custom.id, 0, (event) => events.push(event));
  async function run(id: string) {
    service.start(owner, id, "hello");
    for (let i = 0; i < 100 && service.view(owner, id).status === "running"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(service.view(owner, id).runs.at(-1)?.status, "completed");
  }
  await Promise.all([run(custom.id), run(normal.id)]);
  await run(custom.id);
  assert.equal(calls.filter((value) => value === "private-key:generate").length, 2);
  assert.equal(calls.filter((value) => value === "default:generate").length, 1);
  assert.ok(calls.includes("private-key:models"));
  assert.ok(!JSON.stringify([service.view(owner, custom.id), events]).includes("private-key"));
  assert.ok(!(await readFile(join(dir, custom.id + ".json"), "utf8")).includes("private-key"));
  assert.throws(() => service.view("b".repeat(64), custom.id), /not found/);
  await service.end(owner, custom.id);
  assert.throws(() => service.start(owner, custom.id, "hello"), /ended/);
  await run(normal.id);
});
