import { chromium, type Browser } from "playwright";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { runtimeAsset } from "../tools/runtime-assets.js";
import { exportDocument } from "./document.js";
import type { VideoExportTimeline } from "@code-arena/contracts";
import type { StoredExport } from "./store.js";

const policy = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://video-export.invalid; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function defaultEncoder() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const path: string = createRequire(import.meta.url)("ffmpeg-static"); if (path && existsSync(path)) return path; } catch { /* Production installs can use system FFmpeg. */ }
  return "ffmpeg";
}
export class VideoRenderer {
  constructor(private ffmpeg = defaultEncoder()) {}
  async render(job: StoredExport, directory: string, update: (status: "rendering" | "encoding", progress: number) => Promise<void>) {
    const frames = join(directory, "frames");
    await mkdir(frames, { recursive: true });
    let browser: Browser | undefined;
    const abort = new AbortController();
    const timer = setTimeout(() => { abort.abort(); void browser?.close().catch(() => {}); }, 10 * 60_000);
    // No backend credentials, cookies, persistent profile, or network services in Chromium.
    const env: Record<string, string> = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "LOCALAPPDATA"])
      if (process.env[key]) env[key] = process.env[key]!;
    try {
      await update("rendering", 0);
      browser = await chromium.launch({ headless: true, chromiumSandbox: true, env, channel: process.env.VIDEO_CHROMIUM_CHANNEL || undefined,
        args: ["--disable-background-networking", "--disable-extensions", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=256", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
      abort.signal.throwIfAborted();
      const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1,
        serviceWorkers: "block", acceptDownloads: false, reducedMotion: "no-preference" });
      await context.routeWebSocket("**/*", socket => socket.close());
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      let blocked = false;
      const html = exportDocument(job.source);
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.isNavigationRequest() && request.frame() === page.mainFrame() && url.href === "https://video-export.invalid/") {
          await route.fulfill({ contentType: "text/html", body: html, headers: { "Content-Security-Policy": policy } }); return;
        }
        const asset = url.origin === "https://video-export.invalid" && request.resourceType() === "script" && runtimeAsset(url.pathname);
        if (asset) { await route.fulfill({ contentType: "text/javascript", body: await asset, headers: { "Access-Control-Allow-Origin": "*" } }); return; }
        blocked = true; await route.abort("blockedbyclient");
      });
      await page.addInitScript(({ seed }) => {
        const w = window as unknown as Record<string, unknown>;
        w.__VIDEO_EXPORT__ = true;
        let state = seed;
        Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
      }, { seed: job.settings.seed });
      await page.goto("https://video-export.invalid/", { waitUntil: "load", timeout: 30_000 });
      await page.evaluate(async () => {
        const w = window as unknown as { videoExport?: VideoExportTimeline };
        if (!w.videoExport || typeof w.videoExport.renderAt !== "function")
          throw Error("UNSUPPORTED: This older HTML/Three.js output has no video export timeline. Regenerate it to enable export.");
        if (w.videoExport.ready !== true && (typeof w.videoExport.ready !== "object" || typeof w.videoExport.ready?.then !== "function"))
          throw Error("UNSUPPORTED: The output must supply videoExport.ready as true or an asset-readiness promise.");
        await Promise.race([Promise.resolve(w.videoExport.ready), new Promise((_, reject) => setTimeout(() => reject(Error("Scene readiness timed out")), 30_000))]);
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, image => image.decode()));
        if (Math.max(document.body?.scrollWidth ?? 0, document.documentElement.scrollWidth) > innerWidth * 1.02 || Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight) > innerHeight * 1.02)
          throw Error("UNSUPPORTED: This layout overflows the portrait frame. Regenerate a responsive portrait composition to avoid cropping or unreadable scaling.");
        if (document.querySelector('svg:not([viewBox])')) {
          const svg = document.querySelector('svg')!;
          const box = svg.getBBox();
          svg.setAttribute('viewBox', `0 0 ${svg.width.baseVal.value || box.width || 1080} ${svg.height.baseVal.value || box.height || 1920}`);
        }
      });
      if (blocked) throw Error("Assets are unavailable. Inline assets and use bundled Three.js before exporting.");
      let bytes = 0;
      const total = job.settings.duration * job.settings.fps;
      for (let frame = 0; frame < total; frame++) {
        abort.signal.throwIfAborted();
        await page.evaluate(async time => {
          const w = window as unknown as { videoExport: VideoExportTimeline };
          for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time * 1000; }
          for (const svg of document.querySelectorAll("svg")) { svg.pauseAnimations?.(); svg.setCurrentTime?.(time); }
          await Promise.race([w.videoExport.renderAt(time), new Promise((_, reject) => setTimeout(() => reject(Error("Frame render timed out")), 10_000))]);
        }, frame / job.settings.fps);
        const buffer = await page.screenshot({ path: join(frames, `${String(frame).padStart(4, "0")}.jpg`), type: "jpeg", quality: 94, timeout: 15_000 });
        bytes += buffer.length;
        if (bytes > 512 * 1024 * 1024) throw Error("Frame storage limit exceeded (512 MiB).");
        if (frame % 5 === 0 || frame === total - 1) await update("rendering", Math.round((frame + 1) / total * 85));
      }
      await browser.close(); browser = undefined;
      await update("encoding", 86);
      await this.encode(frames, join(directory, "video.mp4"), job, abort.signal, update);
      if ((await stat(join(directory, "video.mp4"))).size > 100 * 1024 * 1024) throw Error("Video size limit exceeded.");
    } finally {
      clearTimeout(timer);
      try { await browser?.close(); }
      finally { await rm(frames, { recursive: true, force: true }); }
    }
  }
  private encode(frames: string, output: string, job: StoredExport, signal: AbortSignal, update: (status: "encoding", progress: number) => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.ffmpeg, ["-nostdin", "-y", "-loglevel", "error", "-framerate", "30", "-i", join(frames, "%04d.jpg"),
        "-frames:v", String(job.settings.duration * 30), "-an", "-c:v", "libx264", "-threads", "2", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-vf", "setsar=1", "-movflags", "+faststart", "-progress", "pipe:1", output],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal });
      child.stderr.resume(); // Generated content and process diagnostics never reach client responses or logs.
      let pending = Promise.resolve();
      child.stdout.on("data", (data: Buffer) => {
        const frame = data.toString().match(/(?:^|\n)frame=(\d+)/)?.[1];
        if (frame) pending = pending.then(() => update("encoding", Math.min(99, 86 + Math.round(Number(frame) / (job.settings.duration * 30) * 13)))).catch(error => { child.kill(); reject(error); });
      });
      child.once("error", () => reject(Error("Encoder unavailable or interrupted. Install FFmpeg with libx264 and check FFMPEG_PATH.")));
      child.once("close", code => { void pending.then(() => code === 0 ? resolve() : reject(Error("FFmpeg encoding failed. Check worker dependencies and available disk space.")), reject); });
    });
  }
}
