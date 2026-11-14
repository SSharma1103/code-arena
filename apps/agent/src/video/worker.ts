import { open, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExportStore } from "./store.js";
import { VideoRenderer } from "./renderer.js";

/** One worker per local spool. A crash never silently retries costly rendering. */
export class ExportWorker {
  private stopping = false;
  constructor(private store: ExportStore, private renderer = new VideoRenderer()) {}
  stop() { this.stopping = true; }
  async recover() {
    for (const job of await this.store.all()) {
      if (job.status === "rendering" || job.status === "encoding") {
        job.status = "failed"; job.failure = { code: "interrupted", message: "Worker was interrupted. Retry this export." };
        await this.store.save(job);
      }
      if (job.status === "failed") await rm(this.store.path(job.id), { recursive: true, force: true });
    }
  }
  async tick() {
    const job = (await this.store.all()).find(j => j.status === "queued");
    if (!job) return false;
    const directory = this.store.path(job.id);
    try {
      await this.renderer.render(job, directory, async (status, progress) => {
        job.status = status; job.progress = progress; await this.store.save(job);
      });
      job.status = "completed"; job.progress = 100; job.result = `${job.id}/video.mp4`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      job.status = "failed";
      job.failure = message.includes("UNSUPPORTED:")
        ? { code: "unsupported", message: message.slice(message.indexOf("UNSUPPORTED:") + 12).split("\n")[0]!.slice(0, 250) }
        : { code: "render_failed", message: "Export could not finish. Check worker dependencies, inline assets, and the output timeline; then retry." };
      if (/Executable doesn't exist|browserType.launch|Encoder unavailable/.test(message))
        job.failure = { code: "dependencies", message: "Worker dependencies are unavailable. Install Playwright Chromium and FFmpeg with libx264; then retry." };
      else if (/timed out|Timeout|aborted/i.test(message))
        job.failure = { code: "timeout", message: "Rendering exceeded its time limit. Simplify the scene or fix its readiness/renderAt promise; then retry." };
      else if (/Assets are unavailable|decode/.test(message))
        job.failure = { code: "assets", message: "An asset could not load. Inline fonts/images and use only bundled Three.js; then retry." };
      await rm(directory, { recursive: true, force: true });
    }
    await this.store.save(job);
    return true;
  }
  async run() {
    await mkdir(this.store.directory, { recursive: true });
    const lockPath = join(this.store.directory, "worker.lock");
    const lock = await open(lockPath, "wx").catch(() => { throw Error("Export worker is already running. After a crash, verify it has stopped and remove worker.lock before restarting."); });
    await lock.writeFile(String(process.pid));
    try {
      await this.recover();
      while (!this.stopping) if (!await this.tick()) await new Promise(resolve => setTimeout(resolve, 1000));
    } finally { await lock.close(); await rm(lockPath, { force: true }); }
  }
}
