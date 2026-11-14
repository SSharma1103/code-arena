import type { ModelAvailabilityService } from './availability.js';
import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { ArenaService, HttpError } from "./arena.js";
import { runtimeAsset } from "../tools/runtime-assets.js";
import { cubeDocument } from "../tools/cube-renderer.js";
const previewPolicy =
  "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src data:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  let text = "";
  for await (const part of req) {
    text += part.toString();
    if (Buffer.byteLength(text) > 100_000)
      throw new HttpError(413, "Request is too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Expected JSON");
  }
}
export function arenaServer(service: ArenaService, secret: string, availability?: ModelAvailabilityService) {
  return createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") {
          json(res, { status: "ok", service: "agent" });
          return;
        }
        const supplied = String(req.headers["x-agent-secret"] ?? "");
        if (
          Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
        )
          throw new HttpError(401, "Unauthorized");
        const owner = String(req.headers["x-arena-owner"] ?? "");
        if (!/^[a-f0-9]{64}$/.test(owner))
          throw new HttpError(401, "Missing session owner");
        const asset = runtimeAsset(url.pathname);
        if (req.method === "GET" && asset) {
          res.writeHead(200, {
            "Content-Type": "text/javascript",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
          });
          res.end(await asset);
          return;
        }
        if (url.pathname === "/models" && req.method === "GET") {
          const models = await service.client.models(AbortSignal.timeout(30_000));
          json(res, models.filter((model) => model.supportsTools !== false));
          return;
        }
        if ((url.pathname === '/models/check' || url.pathname === '/sessions') && req.method === 'POST' && availability) {
          const input = await body(req);
          if (!input || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || (typeof input.openRouterApiKey !== 'string' || !input.openRouterApiKey.trim() || input.openRouterApiKey.length > 512 || /\s/.test(input.openRouterApiKey.trim()))) throw new HttpError(400, 'Enter a valid model and key.');
          if (url.pathname === '/models/check' && Object.keys(input).some(k => !['model','openRouterApiKey'].includes(k))) throw new HttpError(400, 'Invalid model check.');
          const result = await availability.check(owner, input);
          if (url.pathname === '/models/check') { json(res, result); return; }
          if (result.status !== 'available') throw new HttpError(409, result.reason ?? 'Model unavailable');
          json(res, await service.create(owner, input), 201); return;
        }
        if (url.pathname === "/sessions" && req.method === "POST") {
          json(res, await service.create(owner, await body(req)), 201);
          return;
        }
        const match = url.pathname.match(
          /^\/sessions\/([a-f0-9-]+)(?:\/(.*))?$/,
        );
        if (!match) throw new HttpError(404, "Not found");
        const id = match[1]!,
          action = match[2];
        if (!action) {
          if (req.method === "GET") json(res, service.view(owner, id));
          else if (req.method === "PATCH") json(res, service.touch(owner, id));
          else if (req.method === "DELETE")
            json(res, await service.end(owner, id));
          else throw new HttpError(405, "Method not allowed");
          return;
        }
        if (action === "runs" && req.method === "POST") {
          const input = await body(req);
          json(res, service.start(owner, id, input?.prompt), 202);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          json(res, service.cancel(owner, id));
          return;
        }
        if (action === "cube/start" && req.method === "POST") {
          json(
            res,
            service.start(
              owner,
              id,
              "Continue solving this cube using the original instructions.",
              true,
            ),
            202,
          );
          return;
        }
        if (action === "events" && req.method === "GET") {
          service.view(owner, id);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          res.flushHeaders();
          const after = Number(
            req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0,
          );
          const unsubscribe = service.subscribe(
            owner,
            id,
            Number.isFinite(after) ? after : 0,
            (event) => {
              if (res.writableLength > 1024 * 1024) {
                res.destroy();
                return;
              }
              res.write(
                `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
              );
            },
          );
          res.write("event: connected\ndata: {}\n\n");
          const heartbeat = setInterval(
            () => res.write(": heartbeat\n\n"),
            15_000,
          );
          res.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
          });
          return;
        }
        if (action === "cube" && req.method === "GET") {
          const cube = service.view(owner, id).cube;
          if (!cube) throw new HttpError(404, "Cube is not ready");
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Security-Policy": previewPolicy,
            "Cache-Control": "no-store",
          });
          res.end(cubeDocument(cube, "/api/arena/runtime/three.min.js"));
          return;
        }
        const artifact = action.match(/^artifacts\/([a-f0-9-]+)$/);
        if (artifact && req.method === "GET") {
          const file = service.artifact(owner, id, artifact[1]!),
            source = url.searchParams.has("source"),
            download = url.searchParams.has("download");
          const svgPreview = file.format === "svg" && !source && !download;
          res.writeHead(200, {
            "Content-Type": source
              ? "text/plain; charset=utf-8"
              : download && file.format === "svg"
                ? "image/svg+xml"
                : "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": previewPolicy,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            ...(download
              ? {
                  "Content-Disposition": `attachment; filename="${file.entryFile}"`,
                }
              : {}),
          });
          res.end(
            source || download
              ? file.content
              : svgPreview
                ? `<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#161c1e}img{width:100%;height:100%;object-fit:contain;display:block}</style><img alt="Generated SVG artwork" src="data:image/svg+xml;base64,${Buffer.from(file.content).toString("base64")}">`
                : file.content.replaceAll("/runtime/", "/api/arena/runtime/"),
          );
          return;
        }
        throw new HttpError(404, "Not found");
      } catch (error) {
        if (!res.headersSent)
          json(
            res,
            {
              error:
                error instanceof HttpError
                  ? error.message
                  : "The agent could not complete this request. Check its configuration.",
            },
            error instanceof HttpError ? error.status : 500,
          );
        else res.end();
      }
    })();
  });
}
