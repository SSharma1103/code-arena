/** Real media verification; intentionally separate from routine mocked tests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { ExportStore, type ExportSource } from "../src/video/store.js";
import { VideoRenderer } from "../src/video/renderer.js";
import { ExportWorker } from "../src/video/worker.js";
import { arenaServer } from "../src/service/http.js";
import { ArenaService, HttpError } from "../src/service/arena.js";
import { cubeDocument } from "../src/tools/cube-renderer.js";
import type { CubeState, VideoExportJob } from "@code-arena/contracts";

const require = createRequire(import.meta.url), run = promisify(execFile);
const ffmpeg: string = process.env.FFMPEG_PATH ?? require("ffmpeg-static");
const ffprobe: string = process.env.FFPROBE_PATH ?? require("ffprobe-static").path;
const directory = resolve(import.meta.dirname, "../../../.data/video-smoke", String(Date.now()));
const store = new ExportStore(directory);
const owner = "a".repeat(64), sessionId = "12345678-1234-1234-1234-123456789abc";
const cube: CubeState = { gameId: "smoke", cube: { solved: true, moveHistory: [], faces: Object.fromEntries(["front", "back", "top", "bottom", "left", "right"].map((f, i) => [f, Array.from({ length: 3 }, () => Array(3).fill("ROYGBW"[i]))])) }, nextAction: null };
const sources: Record<string, ExportSource> = {
  html: { format: "html", content: `<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:red;display:grid;place-items:center;color:white;font:72px sans-serif}div{width:240px;height:240px;border-radius:50%;background:#fff}</style><div></div><script>window.videoExport={ready:document.fonts.ready.then(()=>{}),async renderAt(t){await new Promise(r=>setTimeout(r,40));document.body.style.background=t<2.5?'red':'blue';document.querySelector('div').style.transform='translateY('+Math.sin(t*Math.PI)*250+'px)'}};</script>` },
  svg: { format: "svg", content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" rx="40" fill="#183f40"/><circle cx="300" cy="400" r="160" fill="#f1ac7b"><animate attributeName="r" values="100;200;100" dur="2s" repeatCount="indefinite"/></circle><text x="300" y="700" text-anchor="middle" fill="white" font-size="40">SVG in motion</text></svg>` },
  three: { format: "3js", content: `<!doctype html><style>html,body{margin:0;overflow:hidden;background:#15222c}</style><script type="module">import * as THREE from '/runtime/three.module.js';const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(innerWidth,innerHeight);document.body.appendChild(r.domElement);r.setClearColor(0x15222c);const s=new THREE.Scene(),c=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.1,100);c.position.z=6;const m=new THREE.Mesh(new THREE.TorusKnotGeometry(.65,.2,128,24),new THREE.MeshNormalMaterial());s.add(m);window.videoExport={ready:Promise.resolve(),async renderAt(t){m.rotation.set(t*.25,t*.75,0);r.render(s,c)}};</script>` },
  cube: { format: "cube", content: cubeDocument(cube) },
  still: { format: "html", content: '<style>html,body{margin:0;height:100%;background:#153b32;color:#fff}body{display:grid;place-items:center;font:80px sans-serif}</style><p>Still artwork</p>' },
  legacy: { format: "html", content: '<script>document.body.style.background="red"</script>' },
  broken: { format: "html", content: '<script>window.videoExport={ready:true,async renderAt(){throw Error("broken scene")}}</script>' },
  network: { format: "html", content: '<script>window.videoExport={ready:fetch("http://127.0.0.1:9/private"),async renderAt(){}}</script>' },
};
const service = { view(o: string) { if (o !== owner) throw new HttpError(404, "Session not found"); return { status: "ready", cube }; }, artifact(_o: string, _s: string, id: string) { assert.ok(sources[id]); return sources[id]; } } as unknown as ArenaService;
const server = arenaServer(service, "smoke-secret", undefined, store);
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let internalRequest = false;
server.on("request", request => { if (request.url === "/private-export-probe") internalRequest = true; });
sources.network = { format: "html", content: `<script>window.videoExport={ready:fetch(${JSON.stringify(base + "/private-export-probe")}),async renderAt(){}}</script>` };
const headers = { "x-agent-secret": "smoke-secret", "x-arena-owner": owner };
class DiagnosticRenderer extends VideoRenderer {
  override async render(...args: Parameters<VideoRenderer["render"]>) {
    try { await super.render(...args); }
    catch (error) {
      if (!["legacy", "broken", "network"].includes(args[0].outputId)) console.error("Smoke renderer diagnostic:", error);
      throw error;
    }
  }
}
const renderer = new DiagnosticRenderer(ffmpeg);
const worker = new ExportWorker(store, renderer);
const report: unknown[] = [];
let browser;
try {
  await mkdir(directory, { recursive: true });
  for (const [kind, duration] of [["html", 5], ["svg", 10], ["three", 5], ["cube", 15], ["still", 5]] as const) {
    const response = await fetch(`${base}/sessions/${sessionId}/exports`, { method: "POST", headers, body: JSON.stringify({ outputId: kind, duration }) });
    assert.equal(response.status, 202);
    const job = await response.json() as VideoExportJob;
    console.log(`Rendering ${kind}: ${duration}s (${job.id})`);
    await worker.tick();
    const finished = await (await fetch(`${base}/exports/${job.id}`, { headers })).json() as VideoExportJob;
    assert.equal(finished.status, "completed", JSON.stringify(finished.failure));
    const file = join(store.path(job.id), "video.mp4");
    const probe = JSON.parse((await run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file])).stdout);
    const video = probe.streams[0];
    assert.equal(video.codec_name, "h264"); assert.equal(video.pix_fmt, "yuv420p");
    assert.equal(video.width, 1080); assert.equal(video.height, 1920); assert.equal(video.r_frame_rate, "30/1");
    assert.equal(Number(video.nb_frames), duration * 30); assert.equal(Number(probe.format.duration), duration);
    assert.equal(probe.streams.length, 1);
    const data = await readFile(file); assert.ok(data.indexOf("moov") < data.indexOf("mdat"));
    await run(ffmpeg, ["-v", "error", "-i", file, "-f", "null", "-"]);
    await assert.rejects(access(join(store.path(job.id), "frames")));
    const download = await fetch(`${base}/exports/${job.id}/video?download=1`, { headers });
    assert.equal(download.status, 200); assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal((await download.arrayBuffer()).byteLength, data.length);
    if (kind === "html") {
      for (const [time, dominant] of [[0, 0], [3, 2]] as const) {
        const { stdout } = await run(ffmpeg, ["-v", "error", "-ss", String(time), "-i", file, "-frames:v", "1", "-vf", "crop=2:2:20:20,scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
        assert.ok(stdout[dominant]! > 200, `Expected timed color at ${time}s: ${stdout.toString('hex')}`);
      }
    }
    await run(ffmpeg, ["-v", "error", "-y", "-ss", "1", "-i", file, "-frames:v", "1", join(directory, `${kind}.png`)]);
    report.push({ kind, duration, video, file });
    console.log(`Verified ${kind}: H.264, portrait, timing, download, decode, cleanup`);
  }
  for (const kind of ["legacy", "broken", "network"]) {
    const job = await store.enqueue(owner, sessionId, kind, sources[kind]!, 5);
    await worker.tick();
    const failed = await store.load(job.id); assert.equal(failed.status, "failed");
    if (kind === "legacy") assert.equal(failed.failure?.code, "unsupported");
    await assert.rejects(access(store.path(job.id)));
    report.push({ kind, failure: failed.failure });
  }
  assert.equal(internalRequest, false, "Generated code must not reach internal HTTP services");
  browser = await chromium.launch({ headless: true, channel: process.env.VIDEO_CHROMIUM_CHANNEL || undefined });
  const page = await browser.newPage({ extraHTTPHeaders: headers });
  const first = (await store.all()).find(j => j.status === "completed")!;
  await page.goto(`${base}/exports/${first.id}/video`);
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2; });
  await page.evaluate(async () => { const v = document.querySelector('video')!; v.muted = true; await v.play(); });
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > .1);
  report.push({ browserPlayback: true });
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`All real-video checks passed. Review samples: ${directory}`);
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
}
