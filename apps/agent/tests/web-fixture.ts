/** Manual browser/E2E fixture. Never imported by the production service. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArenaService } from "../src/service/arena.js";
import { arenaServer } from "../src/service/http.js";
import { SessionManager, FileSessionStore } from "../src/session/session.js";
import type { ModelClient } from "../src/types.js";
const directory = await mkdtemp(join(tmpdir(), "arena-browser-"));
const client: ModelClient = {
  models: async () => [
    { id: "test/designer", contextLength: 100000 },
    { id: "test/slow", contextLength: 100000 },
  ],
  generate: async (input) => {
    if (input.model === "test/slow")
      await new Promise((_r, reject) =>
        input.signal.addEventListener(
          "abort",
          () => reject(input.signal.reason),
          { once: true },
        ),
      );
    const current = input.messages.slice(
      input.messages.findLastIndex((m) => m.role === "user" && !m.images),
    );
    const tools = current.filter((m) => m.role === "tool");
    const cube = input.tools?.some((t) => t.name === "rubiks_start_cube");
    const call = (name: string, args: unknown) => ({
      text: "",
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call-" + tools.length, name, arguments: JSON.stringify(args) },
      ],
    });
    if (cube) {
      const game = input.messages
        .filter((m) => m.role === "tool")
        .map((m) => {
          try {
            return JSON.parse(m.content);
          } catch {
            return {};
          }
        })
        .find((m) => m.gameId)?.gameId;
      if (!game) return call("rubiks_start_cube", { scramble: false });
      if (!tools.length) return call("rubiks_join_game", { gameId: game });
      if (tools.length === 1)
        return call("rubiks_review_cube", { captureAfterMs: 100 });
      if (tools.length === 2) return call("rubiks_finish", { gameId: game });
    } else {
      const format = input.tools?.[0]?.parameters as any;
      const mode = format.properties.format.enum[0];
      if (!tools.length)
        return call("write_file", {
          format: mode,
          content:
            mode === "svg"
              ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><rect width="500" height="500" fill="#1b2020"/><circle cx="250" cy="250" r="160" fill="#e4a08e"/><text x="250" y="265" text-anchor="middle" font-size="40">Hello Arena</text></svg>'
              : mode === "3js"
                ? '<html><style>body{margin:0}</style><script type="module">import * as THREE from "/runtime/three.module.js";const r=new THREE.WebGLRenderer();r.setSize(innerWidth,innerHeight);document.body.append(r.domElement);const s=new THREE.Scene(),c=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,100);c.position.z=4;const m=new THREE.Mesh(new THREE.TorusKnotGeometry(),new THREE.MeshNormalMaterial());s.add(m);r.setAnimationLoop(()=>{m.rotation.y+=.01;r.render(s,c)});</script></html>'
                : "<html><style>body{display:grid;place-items:center;background:#17201a;color:#e2bf83;font:100px Georgia}div{border:2px solid;padding:50px;clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}</style><div>●</div></html>",
        });
      if (tools.length === 1)
        return call("review_preview", {
          entryFile: JSON.parse(tools[0]!.content).entryFile,
          captureAfterMs: 100,
        });
    }
    return {
      text: "Created and visually reviewed your experience. Your preview is ready.",
      finishReason: "stop",
      usage: { input: 120, output: 80, total: 200 },
    };
  },
};
const service = new ArenaService(
  client,
  new SessionManager(new FileSessionStore(directory)),
);
const server = arenaServer(service, "code-arena-local-development");
server.listen(3401, "127.0.0.1", () =>
  console.log("Browser fixture listening on 3401"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void service.close().then(() => {
      server.close();
      server.closeAllConnections();
      return rm(directory, { recursive: true, force: true });
    });
  });
