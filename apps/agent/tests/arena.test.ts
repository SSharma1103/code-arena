import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { ModelAvailabilityService } from "../src/service/availability.js";
import { ArenaService } from "../src/service/arena.js";
import { arenaServer } from "../src/service/http.js";
import { SessionManager, FileSessionStore } from "../src/session/session.js";
import { ReviewBudget } from "../src/service/review-budget.js";
import { createRuntime, modeInstructions } from "../src/service/runtime.js";
import { Telemetry } from "../src/middleware/telemetry.js";
import { cubeDocument } from "../src/tools/cube-renderer.js";
import { CubeReviewTool } from "../src/tools/cube-review.js";
import type { ModelClient } from "../src/types.js";
import type { CubeState } from "@code-arena/contracts";
const owner = "a".repeat(64),
  other = "b".repeat(64);
const signal = new AbortController().signal;
const fake: ModelClient = {
  models: async () => [{ id: "test/model", contextLength: 100000 }],
  generate: async (input) => {
    const hasFile = input.messages.some(
      (m) => m.role === "tool" && m.content.includes("entryFile"),
    );
    if (hasFile)
      return {
        text: "Your artwork is ready.",
        finishReason: "stop",
        usage: { input: 10, output: 5, total: 15 },
      };
    return {
      text: "Creating the artwork.",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "original-call",
          name: "write_file",
          arguments: JSON.stringify({
            format: "svg",
            content:
              '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="30"/></svg>',
          }),
        },
      ],
    };
  },
};
async function fixture(
  t: { after(fn: () => Promise<void>): void },
  client = fake,
  now?: () => number,
) {
  const dir = await mkdtemp(join(tmpdir(), "arena-web-"));
  const sessions = new SessionManager(new FileSessionStore(dir));
  const service = new ArenaService(client, sessions, {}, now, 1000, async () => client);
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { service, sessions };
}
async function finished(service: ArenaService, id: string) {
  for (let i = 0; i < 100; i++) {
    if (service.view(owner, id).status !== "running")
      return service.view(owner, id);
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Run did not finish");
}
test("web sessions enforce inputs, ownership, artifact access, follow-ups and cleanup", async (t) => {
  const { service, sessions } = await fixture(t);
  for (const maxScreenshots of [-1, 11, 1.5])
    await assert.rejects(
      service.create(owner, {
    openRouterApiKey: "test-key",
        mode: "svg",
        model: "test/model",
        maxScreenshots,
      }),
    );
  const view = await service.create(owner, {
    openRouterApiKey: "test-key",
    mode: "svg",
    model: "test/model",
    maxScreenshots: 0,
  });
  assert.throws(() => service.view(other, view.id), /not found/);
  assert.throws(() => service.start(owner, view.id, ""), /prompt/);
  service.start(owner, view.id, "Draw a circle");
  assert.throws(
    () => service.start(owner, view.id, "duplicate"),
    /already active/,
  );
  const done = await finished(service, view.id);
  assert.equal(done.runs[0]?.response, "Your artwork is ready.");
  assert.equal(done.artifacts.length, 1);
  const file = service.artifact(owner, view.id, done.artifacts[0]!.id);
  assert.match(file.content, /<svg/);
  assert.throws(() => service.artifact(other, view.id, done.artifacts[0]!.id));
  const saved = await sessions.store.load(view.id);
  assert.ok(
    saved.turns[0]?.messages?.some((m) => m.toolCallId === "original-call"),
  );
  const replay: any[] = [];
  const off = service.subscribe(owner, view.id, done.sequence - 1, (e) =>
    replay.push(e),
  );
  assert.equal(replay.length, 1);
  off();
  service.start(owner, view.id, "Refine it");
  await finished(service, view.id);
  const brief = await service.end(owner, view.id);
  assert.equal(brief.filesDeleted, 1);
  assert.equal(brief.previewStopped, true);
  assert.deepEqual(await service.end(owner, view.id), brief);
  assert.throws(
    () => service.artifact(owner, view.id, done.artifacts[0]!.id),
    /expired/,
  );
});
test("screenshot budget counts attempts, denies extra captures, and resets per run", async () => {
  for (const maximum of [0, 2]) {
    let calls = 0;
    const budget = new ReviewBudget(maximum);
    const tool = budget.wrap(
      {
        definition: { name: "review", description: "", parameters: {} },
        execute: async () => {
          calls++;
          return { metadata: {}, content: [] };
        },
      },
      () => {},
    );
    for (let i = 0; i < 4; i++)
      await tool.execute({}, { sessionId: "s", runId: "r", signal });
    assert.equal(calls, maximum);
    budget.reset();
    assert.equal(budget.used, 0);
  }
  const budget = new ReviewBudget(1);
  const tool = budget.wrap(
    {
      definition: { name: "review", description: "", parameters: {} },
      execute: async () => {
        throw Error("capture failed");
      },
    },
    () => {},
  );
  await assert.rejects(tool.execute({}, { sessionId: "s", signal }));
  assert.equal(budget.used, 1);
});
test("each mode exposes only its allowed tools and format", async (t) => {
  const { sessions } = await fixture(t);
  for (const mode of ["svg", "html", "3js", "cube"] as const) {
    let definitions: string[] = [];
    const client: ModelClient = {
      ...fake,
      generate: async (input) => {
        definitions = input.tools!.map((t) => t.name);
        assert.match(
          input.messages[0]!.content,
          new RegExp(mode === "cube" ? "Rubiks" : "Generate"),
        );
        return { text: "done", finishReason: "stop" };
      },
    };
    const runtime = createRuntime({
      client,
      sessions,
      telemetry: new Telemetry(() => {}),
      mode,
      maxScreenshots: 0,
    });
    const session = await sessions.create("test/model", modeInstructions[mode]);
    await runtime.agent.run({ sessionId: session.id, prompt: "test" });
    if (mode === "cube") {
      assert.ok(definitions.includes("rubiks_review_cube"));
      assert.ok(!definitions.includes("write_file"));
    } else {
      assert.deepEqual(definitions, ["write_file", "review_preview"]);
    }
    await runtime.cube.close();
    await runtime.artifacts.close();
  }
});
test("cancellation retains outcomes and inactivity expires resources", async (t) => {
  let now = 1000;
  const client: ModelClient = {
    ...fake,
    generate: async (input) =>
      new Promise((_r, reject) => {
        if (input.signal.aborted) reject(input.signal.reason);
        else
          input.signal.addEventListener(
            "abort",
            () => reject(input.signal.reason),
            { once: true },
          );
      }),
  };
  const { service } = await fixture(t, client, () => now);
  const s = await service.create(owner, {
    openRouterApiKey: "test-key",
    mode: "svg",
    model: "test/model",
    maxScreenshots: 3,
  });
  service.start(owner, s.id, "wait");
  now = 5000;
  await service.sweep();
  assert.equal(service.view(owner, s.id).status, "running");
  service.cancel(owner, s.id);
  await finished(service, s.id);
  assert.equal(service.view(owner, s.id).runs[0]?.status, "cancelled");
  now = 7000;
  await service.sweep();
  assert.equal(service.view(owner, s.id).status, "expired");
  assert.ok(service.view(owner, s.id).cleanup?.serverStopped);
});
test("HTTP boundary authenticates requests and serves sandboxed original/source previews", async (t) => {
  const { service } = await fixture(t);
  const server = arenaServer(service, "secret", new ModelAvailabilityService(() => { throw Error("Unexpected probe"); }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const headers = { "x-agent-secret": "secret", "x-arena-owner": owner };
  assert.equal((await fetch(base + "/models")).status, 401);
  for (const path of ['/models/check', '/sessions']) {
    for (const key of [undefined, '', ' ']) {
      const response = await fetch(base + path, {method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({mode:'svg',model:'test/model',maxScreenshots:0,openRouterApiKey:key})});
      assert.equal(response.status,400);
    }
  }
  const s = await service.create(owner, {
    openRouterApiKey: "test-key",
    mode: "svg",
    model: "test/model",
    maxScreenshots: 0,
  });
  service.start(owner, s.id, "draw");
  const view = await finished(service, s.id);
  const url = base + `/sessions/${s.id}/artifacts/${view.artifacts[0]!.id}`;
  const response = await fetch(url, { headers });
  assert.match(
    response.headers.get("content-security-policy")!,
    /sandbox allow-scripts/,
  );
  assert.match(await response.text(), /data:image\/svg\+xml;base64/);
  const download = await fetch(url + "?download=1", { headers });
  assert.match(download.headers.get("content-disposition")!, /attachment/);
  const module = await fetch(base + "/runtime/three.module.js", { headers });
  assert.equal(module.status, 200);
  assert.match(await module.text(), /WebGLRenderer/);
  assert.equal(
    (await fetch(base + "/runtime/../package.json", { headers })).status,
    404,
  );
  const stream = await fetch(
    base + `/sessions/${s.id}/events?after=${view.sequence - 1}`,
    { headers },
  );
  const reader = stream.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /id:/);
  await reader.cancel();
});
test("model API keeps provider popularity order and only suggests tool-capable models", async (t) => {
  const { service } = await fixture(t, {
    ...fake,
    models: async () => [
      { id: "z/popular", name: "Popular", supportsTools: true },
      { id: "a/text-only", name: "Text Only", supportsTools: false },
      { id: "b/next", name: "Next", supportsTools: true },
    ],
  });
  const server = arenaServer(service, "secret");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(base + "/models", {
    headers: { "x-agent-secret": "secret", "x-arena-owner": owner },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { id: "z/popular", name: "Popular", supportsTools: true },
    { id: "b/next", name: "Next", supportsTools: true },
  ]);
});
test("cube screenshot uses the shared renderer and closes its controlled preview", async () => {
  const faces = Object.fromEntries(
    ["right", "left", "top", "bottom", "front", "back"].map((f, i) => [
      f,
      Array.from({ length: 3 }, () =>
        Array(3).fill(["R", "O", "W", "Y", "G", "B"][i]),
      ),
    ]),
  );
  const state: CubeState = {
    gameId: "cube_test",
    cube: { faces, solved: true, moveHistory: [] },
    nextAction: "finish",
  };
  assert.match(cubeDocument(state), /cube-state/);
  const review = await new CubeReviewTool(() => state, chromium).execute(
    { captureAfterMs: 100 },
    { sessionId: "cube", runId: "review", signal },
  );
  assert.equal(review.content[0]?.mimeType, "image/png");
  assert.ok(review.content[0]!.data.length > 1000);
  assert.deepEqual(review.metadata.javascriptErrors, []);
  assert.deepEqual(review.metadata.failedRequests, []);
  await assert.rejects(
    new CubeReviewTool(() => undefined, chromium).execute(
      { captureAfterMs: 0 },
      { sessionId: "cube", runId: "r", signal },
    ),
    /Launch/,
  );
});
