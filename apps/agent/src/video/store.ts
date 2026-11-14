import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { VideoExportJob } from "@code-arena/contracts";
import { HttpError } from "../service/errors.js";

export type ExportSource = { content: string; format: string };
export type StoredExport = VideoExportJob & { owner: string; source: ExportSource };
export class ExportStore {
  readonly directory: string;
  // Serialize enqueue in the API process so identical clicks cannot race.
  private pending: Promise<unknown> = Promise.resolve();
  constructor(directory = process.env.VIDEO_EXPORT_DIR ?? resolve(import.meta.dirname, "../../.data/exports")) {
    this.directory = resolve(directory);
  }
  path(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id)) throw new HttpError(404, "Export not found");
    return join(this.directory, id);
  }
  async save(job: StoredExport) {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(job.id) + ".json", temporary = target + "." + randomUUID() + ".tmp";
    job.updatedAt = new Date().toISOString();
    try { await writeFile(temporary, JSON.stringify(job), { mode: 0o600 }); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  }
  async all() {
    await mkdir(this.directory, { recursive: true });
    const jobs: StoredExport[] = [];
    for (const name of await readdir(this.directory)) {
      if (/^[a-f0-9-]+\.json$/.test(name)) jobs.push(await this.load(name.slice(0, -5)));
    }
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async load(id: string): Promise<StoredExport> {
    try { return JSON.parse(await readFile(this.path(id) + ".json", "utf8")); }
    catch { throw new HttpError(404, "Export not found"); }
  }
  async owned(owner: string, id: string) {
    const job = await this.load(id);
    if (job.owner !== owner) throw new HttpError(404, "Export not found");
    return job;
  }
  view({ owner: _owner, source: _source, ...job }: StoredExport): VideoExportJob { return job; }
  enqueue(owner: string, sessionId: string, outputId: string, source: ExportSource, duration: unknown) {
    const operation = this.pending.then(async () => {
      if (duration !== 5 && duration !== 10 && duration !== 15) throw new HttpError(400, "Choose 5, 10, or 15 seconds");
      const sourceVersion = createHash("sha256").update(source.format + "\0" + source.content).digest("hex");
      const jobs = await this.all();
      const duplicate = jobs.find(j => j.owner === owner && j.sessionId === sessionId && j.outputId === outputId && j.sourceVersion === sourceVersion && j.settings.duration === duration && j.status !== "failed");
      if (duplicate) return this.view(duplicate);
      if (jobs.length >= 100 || jobs.reduce((bytes, j) => bytes + Buffer.byteLength(j.source.content), 0) + Buffer.byteLength(source.content) > 128 * 1024 * 1024)
        throw new HttpError(429, "Export storage is full. Ask the operator to clear old exports.");
      const active = jobs.filter(j => !["completed", "failed"].includes(j.status));
      if (active.length >= 16 || active.filter(j => j.owner === owner).length >= 3)
        throw new HttpError(429, "Export queue is full. Wait for an export to finish.");
      if (jobs.filter(j => j.owner === owner).length >= 100)
        throw new HttpError(429, "Export storage limit reached. Ask the operator to clear old exports.");
      const job: StoredExport = {
        id: randomUUID(), owner, sessionId, outputId, sourceVersion, source,
        settings: { duration, width: 1080, height: 1920, fps: 30, seed: 42 },
        status: "queued", progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await this.save(job);
      return this.view(job);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
