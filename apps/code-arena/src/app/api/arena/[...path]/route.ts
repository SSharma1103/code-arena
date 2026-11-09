import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

async function proxy(
  request: NextRequest,
  { params }: RouteContext<"/api/arena/[...path]">,
) {
  const { path } = await params;
  const route = "/" + path.join("/");
  if (
    !/^\/(models|runtime\/three\.(min|module)\.js|sessions(?:\/[a-f0-9-]+(?:\/(?:runs|cancel|events|cube(?:\/start)?|artifacts\/[a-f0-9-]+))?)?)$/.test(
      route,
    )
  )
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== request.nextUrl.origin
  )
    return NextResponse.json(
      { error: "Request origin is not allowed" },
      { status: 403 },
    );
  let owner = request.cookies.get("arena_owner")?.value;
  const fresh = !owner || !/^[a-f0-9]{64}$/.test(owner);
  if (fresh) owner = randomBytes(32).toString("hex");
  const base = process.env.AGENT_API_URL ?? "http://127.0.0.1:3001";
  const url = new URL(route, base);
  url.search = request.nextUrl.search;
  const headers: Record<string, string> = {
    "x-agent-secret":
      process.env.AGENT_INTERNAL_SECRET ?? "code-arena-local-development",
    "x-arena-owner": owner!,
  };
  if (request.headers.get("last-event-id"))
    headers["last-event-id"] = request.headers.get("last-event-id")!;
  if (request.headers.get("content-type"))
    headers["content-type"] = request.headers.get("content-type")!;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 100_000)
      return NextResponse.json(
        { error: "Request is too large" },
        { status: 413 },
      );
    const body = ["GET", "HEAD", "DELETE"].includes(request.method)
      ? undefined
      : await request.text();
    if (body && Buffer.byteLength(body) > 100_000)
      return NextResponse.json(
        { error: "Request is too large" },
        { status: 413 },
      );
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: request.signal,
    });
    const forwarded = new Headers();
    for (const name of [
      "content-type",
      "content-security-policy",
      "content-disposition",
      "cache-control",
      "x-content-type-options",
      "referrer-policy",
      "access-control-allow-origin",
      "x-accel-buffering",
    ]) {
      const value = upstream.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    const response = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: forwarded,
    });
    if (
      fresh &&
      route === "/sessions" &&
      request.method === "POST" &&
      upstream.ok
    )
      response.cookies.set("arena_owner", owner!, {
        httpOnly: true,
        sameSite: "strict",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          "Agent unavailable. Start the agent service and check its configuration.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
