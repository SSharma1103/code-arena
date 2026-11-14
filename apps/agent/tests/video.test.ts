import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExportStore } from "../src/video/store.js";
import { ExportWorker } from "../src/video/worker.js";
import { VideoRenderer } from "../src/video/renderer.js";
import { exportDocument } from "../src/video/document.js";
import { arenaServer } from "../src/service/http.js";
import { ArenaService, HttpError } from "../src/service/arena.js";

const owner = "a".repeat(64), other = "b".repeat(64), session = "12345678-1234-1234-1234-123456789abc";
const source = { format: "svg", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="20" cx="50" cy="50"/></svg>' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "arena-export-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new ExportStore(dir);
}
test("exports validate settings, snapshot versions, deduplicate simultaneous requests, and protect owners", async t => {
  const store = await fixture(t);
  await assert.rejects(store.enqueue(owner, session, "output", source, 6), /5, 10, or 15/);
  const jobs = await Promise.all(Array.from({ length: 5 }, () => store.enqueue(owner, session, "output", source, 5)));
  assert.equal(new Set(jobs.map(j => j.id)).size, 1);
  assert.ok(!("source" in jobs[0]!) && !("owner" in jobs[0]!));
  await assert.rejects(store.owned(other, jobs[0]!.id), /not found/);
  const next = await store.enqueue(owner, session, "output", { ...source, content: source.content + " " }, 5);
  assert.notEqual(next.sourceVersion, jobs[0]!.sourceVersion);
  assert.equal((await new ExportStore(store.directory).load(next.id)).source.content, source.content + " ");
  await assert.rejects(store.load("../secrets"), /not found/);
});
test("worker records ordered progress, publishes only finished results, preserves failures and retries explicitly", async t => {
  const store = await fixture(t);
  const job = await store.enqueue(owner, session, "output", source, 5);
  const renderer = { async render(_job: unknown, directory: string, update: (status: "rendering" | "encoding", progress: number) => Promise<void>) {
    await mkdir(directory); await update("rendering", 50);
    assert.equal((await store.load(job.id)).status, "rendering");
    await update("encoding", 90); await writeFile(join(directory, "video.mp4"), "fixture");
  } } as VideoRenderer;
  assert.equal(await new ExportWorker(store, renderer).tick(), true);
  assert.equal((await store.load(job.id)).status, "completed");
  const failure = await store.enqueue(owner, session, "broken", source, 5);
  const broken = { async render() { throw Error("UNSUPPORTED: Regenerate old output"); } } as unknown as VideoRenderer;
  await new ExportWorker(store, broken).tick();
  assert.equal((await store.load(failure.id)).failure?.code, "unsupported");
  const retry = await store.enqueue(owner, session, "broken", source, 5);
  assert.notEqual(retry.id, failure.id);
});
test("restart marks interrupted work failed, removes temporary data, and retains queued work", async t => {
  const store = await fixture(t);
  const first = await store.enqueue(owner, session, "output", source, 5);
  const job = await store.load(first.id); job.status = "encoding"; await store.save(job);
  await mkdir(store.path(job.id)); await writeFile(join(store.path(job.id), "partial"), "frames");
  const second = await store.enqueue(owner, session, "second", source, 5);
  await new ExportWorker(store).recover();
  assert.equal((await store.load(job.id)).failure?.code, "interrupted");
  await assert.rejects(access(store.path(job.id)));
  assert.equal((await store.load(second.id)).status, "queued");
});
test("worker lock prevents concurrent workers and graceful stop releases it after draining", async t => {
  const store = await fixture(t);
  await store.enqueue(owner, session, "output", source, 5);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const renderer = { async render() { entered(); await gate; } } as unknown as VideoRenderer;
  const worker = new ExportWorker(store, renderer), running = worker.run();
  await started;
  try { await assert.rejects(new ExportWorker(store, renderer).run(), /already running/); }
  finally { worker.stop(); release(); await running; }
  await assert.rejects(access(join(store.directory, "worker.lock")));
});
test("export API checks ownership on create, status, retry and ranged video downloads", async t => {
  const store = await fixture(t);
  const service = { view(o: string) { if (o !== owner) throw new HttpError(404, "Session not found"); return { status: "ready" }; }, artifact() { return source; } } as unknown as ArenaService;
  const server = arenaServer(service, "secret", undefined, store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, o = owner, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { "x-agent-secret": "secret", "x-arena-owner": o, ...init.headers } });
  const create = { method: "POST", body: JSON.stringify({ outputId: "output", duration: 5 }) };
  assert.equal((await call(`/sessions/${session}/exports`, other, create)).status, 404);
  const job = await (await call(`/sessions/${session}/exports`, owner, create)).json();
  for (const suffix of ["", "/video", "/retry"]) assert.equal((await call(`/exports/${job.id}${suffix}`, other, suffix === "/retry" ? { method: "POST" } : {})).status, 404);
  assert.equal((await call(`/exports/${job.id}/video`)).status, 409);
  const stored = await store.load(job.id); stored.status = "completed"; await store.save(stored);
  await mkdir(store.path(job.id)); await writeFile(join(store.path(job.id), "video.mp4"), "0123456789");
  const ranged = await call(`/exports/${job.id}/video`, owner, { headers: { Range: "bytes=2-4" } });
  assert.equal(ranged.status, 206); assert.equal(await ranged.text(), "234");
  assert.equal((await call(`/exports/${job.id}/video`, owner, { headers: { Range: "bytes=99-" } })).status, 416);
  stored.status = "failed"; await store.save(stored);
  const retried = await call(`/exports/${job.id}/retry`, owner, { method: "POST" });
  assert.equal(retried.status, 202);
  const newJob = await retried.json(); assert.notEqual(newJob.id, job.id);
  assert.equal((await store.load(newJob.id)).source.content, source.content);
});
test("declarative SVG/static HTML have adapters; scripted legacy HTML stays unsupported", () => {
  assert.match(exportDocument(source), /setCurrentTime/);
  assert.match(exportDocument({ format: "html", content: "<p>Still</p>" }), /videoExport/);
  assert.doesNotMatch(exportDocument({ format: "html", content: "<script>requestAnimationFrame(draw)</script>" }), /videoExport/);
  assert.throws(() => exportDocument({ format: "svg", content: "<svg><script>bad()</script></svg>" }), /UNSUPPORTED/);
});
