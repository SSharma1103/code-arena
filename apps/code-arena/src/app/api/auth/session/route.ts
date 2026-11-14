import { NextRequest, NextResponse } from "next/server";
import { sessionService } from "@/lib/auth/server";
import { SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth/session";

function response(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) return response({ user: null });
  try {
    return response({ user: await sessionService().read(request.cookies.get(SESSION_COOKIE)?.value) });
  } catch {
    return response({ error: "Authentication is unavailable. Check Firebase server configuration." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return response({ error: "Request origin is not allowed" }, 403);
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_000) {
    return response({ error: "Request is too large" }, 413);
  }
  let idToken: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > 16_000) return response({ error: "Request is too large" }, 413);
    idToken = JSON.parse(body)?.idToken;
  } catch {
    return response({ error: "Invalid sign-in request" }, 400);
  }
  if (typeof idToken !== "string" || !idToken || idToken.length > 15_000) {
    return response({ error: "A Firebase ID token is required" }, 400);
  }
  let service;
  try { service = sessionService(); } catch {
    return response({ error: "Authentication is unavailable. Check Firebase server configuration." }, 503);
  }
  try {
    const cookie = await service.create(idToken);
    const user = await service.read(cookie);
    if (!user) return response({ error: "Could not verify the sign-in session" }, 401);
    const result = response({ user });
    result.cookies.set(SESSION_COOKIE, cookie, {
      httpOnly: true, secure: request.nextUrl.protocol === "https:",
      sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
    });
    result.cookies.delete("arena_owner");
    return result;
  } catch {
    return response({ error: "Could not complete Google sign-in. Try again and check Firebase server configuration if the problem continues." }, 401);
  }
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return response({ error: "Request origin is not allowed" }, 403);
  }
  const result = response({ user: null });
  result.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0,
  });
  result.cookies.delete("arena_owner");
  return result;
}
