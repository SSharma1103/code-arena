import { createHash } from "node:crypto";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";

export const SESSION_COOKIE = "arena_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 5;

export type ArenaUser = { uid: string; name: string; email: string | null };

export class FirebaseSessionService {
  private readonly auth: Pick<Auth, "verifyIdToken" | "createSessionCookie" | "verifySessionCookie">;

  constructor(auth: Pick<Auth, "verifyIdToken" | "createSessionCookie" | "verifySessionCookie">) {
    this.auth = auth;
  }

  async create(idToken: string) {
    const claims = await this.auth.verifyIdToken(idToken, true);
    if (claims.firebase.sign_in_provider !== "google.com" ||
        Date.now() / 1000 - claims.auth_time > 300) {
      throw new Error("A recent Google sign-in is required");
    }
    return this.auth.createSessionCookie(idToken, { expiresIn: SESSION_SECONDS * 1000 });
  }

  async read(cookie: string | undefined): Promise<ArenaUser | null> {
    if (!cookie) return null;
    try {
      const claims: DecodedIdToken = await this.auth.verifySessionCookie(cookie, true);
      return {
        uid: claims.uid,
        name: typeof claims.name === "string" ? claims.name : claims.email ?? "Arena explorer",
        email: claims.email ?? null,
      };
    } catch {
      return null;
    }
  }

  owner(user: ArenaUser) {
    return createHash("sha256").update(`firebase:${user.uid}`).digest("hex");
  }
}
