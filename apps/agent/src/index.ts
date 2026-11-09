import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { OpenRouterClient } from "./client/openrouter.js";
import { SessionManager, FileSessionStore } from "./session/session.js";
import { ArenaService } from "./service/arena.js";
import { arenaServer } from "./service/http.js";
const env = resolve(import.meta.dirname, "../.env");
if (existsSync(env)) loadEnvFile(env);
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw Error("Set OPENROUTER_API_KEY in apps/agent/.env");
const service = new ArenaService(
  new OpenRouterClient(key),
  new SessionManager(new FileSessionStore()),
);
const server = arenaServer(
  service,
  process.env.AGENT_INTERNAL_SECRET ?? "code-arena-local-development",
);
server.listen(Number(process.env.AGENT_PORT ?? 3001), "127.0.0.1", () =>
  console.log("Agent API ready on loopback"),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void service.close().finally(() => {
      server.close();
      server.closeAllConnections();
    });
  });
