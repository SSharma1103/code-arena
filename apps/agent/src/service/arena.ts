import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  ArenaEvent,
  CreateSession,
  RunView,
  SessionView,
  CleanupBrief,
} from "@code-arena/contracts";
import type { ModelClient, Message } from "../types.js";
import { SessionClient, createSessionClient } from "../client/session-client.js";
import { SessionManager } from "../session/session.js";
import { Telemetry } from "../middleware/telemetry.js";
import {
  createRuntime,
  modeInstructions,
  type RuntimeOptions,
} from "./runtime.js";

import { HttpError } from "./errors.js";
export { HttpError } from "./errors.js";
type Entry = {
  client: SessionClient;
  owner: string;
  view: SessionView;
  runtime: ReturnType<typeof createRuntime>;
  events: ArenaEvent[];
  listeners: Set<(event: ArenaEvent) => void>;
  active?: { abort: AbortController; promise: Promise<void> };
  closing?: Promise<CleanupBrief>;
  touched: number;
  created: number;
  initialPrompt: string;
  usageKnown: boolean;
  usageMissing: boolean;
  modelCalls: number;
  toolCalls: number;
  tokens: number;
};
export class ArenaService {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    readonly client: ModelClient,
    private sessions: SessionManager,
    private dependencies: Pick<RuntimeOptions, "connection" | "browser"> = {},
    private now = () => Date.now(),
    private ttl = 30 * 60_000,
    private clientFactory: (key: string) => Promise<ModelClient> = createSessionClient,
  ) {
    this.timer = setInterval(() => {
      void this.sweep();
    }, 60_000);
    this.timer.unref();
  }
  async create(owner: string, input: unknown) {
    const a = input as CreateSession;
    if (
      !a ||
      !["svg", "3js", "html", "cube"].includes(a.mode) ||
      typeof a.model !== "string" ||
      !a.model.trim() ||
      a.model.length > 200 ||
      !Number.isInteger(a.maxScreenshots) ||
      a.maxScreenshots < 0 ||
      a.maxScreenshots > 10 ||
      Object.keys(a).some(
        (k) => !["mode", "model", "maxScreenshots", "openRouterApiKey"].includes(k),
      )
    )
      throw new HttpError(
        400,
        "Choose a mode, model, and screenshot limit from 0 to 10.",
      );
    const rawKey = a.openRouterApiKey;
    if (typeof rawKey !== "string" || !rawKey.trim() || rawKey.trim().length > 512 || /\s/.test(rawKey.trim()))
      throw new HttpError(400, "Enter your OpenRouter API key (up to 512 characters).");
    if ([...this.entries.values()].filter((e) => !e.closing).length >= 8)
      throw new HttpError(
        429,
        "End an existing session before opening another.",
      );
    const key = rawKey.trim();
    let provider: ModelClient;
    try { provider = await this.clientFactory(key); }
    catch { throw new HttpError(400, "Could not verify your OpenRouter key. Check it and try again."); }
    const client = new SessionClient(provider);
    try {
    if ([...this.entries.values()].filter((e) => !e.closing).length >= 8)
      throw new HttpError(429, "End an existing session before opening another.");
    const session = await this.sessions.create(
      a.model,
      modeInstructions[a.mode] +
        `\nMaximum screenshot attempts per run: ${a.maxScreenshots}. This is a ceiling, not a target. Files persist only until this session ends.`,
    );
    const view: SessionView = {
      mode: a.mode,
      model: a.model,
      maxScreenshots: a.maxScreenshots,
      credentialSource: "user",
      id: session.id,
      status: "ready",
      runs: [],
      artifacts: [],
      reviews: [],
      sequence: 0,
      initialCubeMoves: 0,
      cubeStarted: false,
    };
    let entry: Entry;
    const publish = (type: string, data: Record<string, unknown> = {}) =>
      this.publish(entry, type, data);
    const telemetry = new Telemetry((event) => {
      if (!entry) return;
      const run = view.runs.at(-1);
      if (
        event.event === "generation.started" ||
        event.event === "summary.started"
      ) {
        entry.modelCalls++;
        if (run) run.modelCalls++;
      }
      if (event.event === "tool.started") {
        entry.toolCalls++;
        if (run) run.toolCalls++;
      }
      if (
        event.event === "generation.usage" ||
        event.event === "summary.usage"
      ) {
        const u = event.usage as { total: number } | undefined;
        if (u) {
          entry.usageKnown = true;
          entry.tokens += u.total;
        } else entry.usageMissing = true;
      }
      publish(String(event.event), { tool: event.tool });
    });
    const runtime = createRuntime({
      client,
      sessions: this.sessions,
      telemetry,
      mode: a.mode,
      maxScreenshots: a.maxScreenshots,
      ...this.dependencies,
      presenter: {
        show: async (state) => {
          if (!view.cube) view.initialCubeMoves = state.cube.moveHistory.length;
          view.cube = state;
          publish("cube.state");
        },
        close: async () => {},
      },
      cubeState: () => view.cube,
      changed: () => {
        view.artifacts = runtime.artifacts.artifacts.map((f) => ({
          id: basename(f.path).split(".")[0]!,
          format: f.format,
          entryFile: basename(f.path),
        }));
        publish("artifacts.changed");
      },
      observe: (message: Message) => {
        if (message.role === "assistant")
          publish("assistant.message", {
            text: message.content,
            tools: message.toolCalls?.map((c) => ({ id: c.id, name: c.name })),
          });
        else
          publish("tool.result", {
            toolCallId: message.toolCallId,
            metadata: JSON.parse(message.content),
          });
      },
      capture: (result, tool) => {
        const run = view.runs.at(-1);
        if (run) run.screenshots = runtime.budget.used;
        for (const image of result.content) {
          view.reviews.push({ id: randomUUID(), tool, data: image.data });
          if (view.reviews.length > 10) view.reviews.shift();
        }
        publish("review.captured", { diagnostics: result.metadata });
      },
    });
    entry = {
      client,
      owner,
      view,
      runtime,
      events: [],
      listeners: new Set(),
      touched: this.now(),
      created: this.now(),
      initialPrompt: "",
      usageKnown: false,
      usageMissing: false,
      modelCalls: 0,
      toolCalls: 0,
      tokens: 0,
    };
    this.entries.set(view.id, entry);
    return structuredClone(view);
    } catch (error) { client.dispose(); throw error; }
  }
  private publish(e: Entry, type: string, data: Record<string, unknown> = {}) {
    const event: ArenaEvent = {
      sequence: ++e.view.sequence,
      type,
      time: new Date(this.now()).toISOString(),
      data,
    };
    e.events.push(event);
    if (e.events.length > 200) e.events.shift();
    for (const listener of e.listeners) listener(event);
  }
  private entry(owner: string, id: string) {
    const e = this.entries.get(id);
    if (!e)
      throw new HttpError(
        410,
        "This session has expired or the agent restarted. Start a new session.",
      );
    if (e.owner !== owner) throw new HttpError(404, "Session not found");
    return e;
  }
  view(owner: string, id: string) {
    return structuredClone(this.entry(owner, id).view);
  }
  touch(owner: string, id: string) {
    const e = this.entry(owner, id);
    e.touched = this.now();
    return { ok: true };
  }
  artifact(owner: string, id: string, artifactId: string) {
    const e = this.entry(owner, id);
    if (e.closing) throw new HttpError(410, "Artifacts have expired");
    try {
      return e.runtime.artifacts.readArtifact(artifactId);
    } catch {
      throw new HttpError(404, "Artifact not found");
    }
  }
  subscribe(
    owner: string,
    id: string,
    after: number,
    listener: (event: ArenaEvent) => void,
  ) {
    const e = this.entry(owner, id);
    for (const event of e.events) if (event.sequence > after) listener(event);
    e.listeners.add(listener);
    return () => e.listeners.delete(listener);
  }
  start(owner: string, id: string, prompt: unknown, solve = false) {
    const e = this.entry(owner, id);
    if (e.closing) throw new HttpError(410, "Session has ended");
    if (e.active) throw new HttpError(409, "A run is already active");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20_000)
      throw new HttpError(400, "Enter a prompt of up to 20,000 characters");
    if (e.view.runs.length >= 50)
      throw new HttpError(
        429,
        "Session turn limit reached. Start a new session.",
      );
    if (solve) {
      if (!e.view.cube || e.view.mode !== "cube")
        throw new HttpError(409, "Prepare the cube first");
      if (e.view.cubeStarted && e.view.cube.cube.solved)
        throw new HttpError(409, "This cube is already solved");
      e.runtime.cube.authorizeStart(e.view.cube.gameId);
      e.view.cubeStarted = true;
    } else if (e.view.mode === "cube" && e.view.cube)
      throw new HttpError(
        409,
        "Use Start solving or Continue solving for this cube",
      );
    e.initialPrompt ||= prompt;
    const actual = solve
      ? `Solve the existing cube ${e.view.cube!.gameId}. Do not create another game. User instructions: ${e.initialPrompt}\n${prompt}`
      : prompt;
    const run: RunView = {
      id: randomUUID(),
      prompt,
      status: "running",
      modelCalls: 0,
      toolCalls: 0,
      screenshots: 0,
    };
    e.view.runs.push(run);
    e.view.status = "running";
    e.touched = this.now();
    e.runtime.budget.reset();
    const abort = new AbortController(),
      started = this.now();
    const promise = Promise.resolve().then(async () => {
      this.publish(e, "run.started", { operationId: run.id });
      try {
        const result = await e.runtime.agent.run({
          sessionId: id,
          prompt: actual,
          signal: abort.signal,
        });
        run.response = result.text;
        run.usage = result.usage;
        run.status = "completed";
      } catch (error) {
        run.status = abort.signal.aborted ? "cancelled" : "failed";
        run.error = error instanceof Error ? error.message : "Run failed";
      } finally {
        run.durationMs = this.now() - started;
        run.screenshots = e.runtime.budget.used;
        e.active = undefined;
        e.touched = this.now();
        if (!e.closing) e.view.status = "ready";
        this.publish(e, "run.finished", {
          operationId: run.id,
          status: run.status,
        });
      }
    });
    e.active = { abort, promise };
    return { operationId: run.id };
  }
  cancel(owner: string, id: string) {
    const e = this.entry(owner, id);
    e.active?.abort.abort();
    return { ok: true };
  }
  end(owner: string, id: string, expired = false) {
    const e = this.entry(owner, id);
    if (e.closing) return e.closing;
    e.view.status = expired ? "expired" : "ended";
    return (e.closing = (async () => {
      e.active?.abort.abort();
      try { await e.active?.promise; }
      finally { e.client.dispose(); }
      const cube = await e.runtime.cube.close(),
        files = await e.runtime.artifacts.close();
      const cleanup: CleanupBrief = {
        ...cube,
        ...files,
        durationMs: this.now() - e.created,
        modelCalls: e.modelCalls,
        toolCalls: e.toolCalls,
        tokens: e.usageKnown && !e.usageMissing ? e.tokens : null,
      };
      e.view.cleanup = cleanup;
      e.view.artifacts = [];
      e.view.reviews = [];
      e.view.cube = undefined;
      this.publish(e, "session.closed", { cleanup });
      return cleanup;
    })());
  }
  async sweep() {
    for (const [id, e] of this.entries) {
      if (!e.active && !e.closing && this.now() - e.touched >= this.ttl)
        await this.end(e.owner, id, true);
      if (
        e.closing &&
        this.now() - e.touched > this.ttl * 2 &&
        !e.listeners.size
      )
        this.entries.delete(id);
    }
  }
  async close() {
    clearInterval(this.timer);
    await Promise.all(
      [...this.entries].map(([id, e]) => this.end(e.owner, id)),
    );
  }
}
