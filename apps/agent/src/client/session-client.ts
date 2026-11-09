import type { ModelClient } from "../types.js";
import { OpenRouterClient } from "./openrouter.js";

/** Revocable reference: ended session runtimes cannot retain provider credentials. */
export class SessionClient implements ModelClient {
  constructor(private client: ModelClient | undefined) {}
  dispose() { this.client = undefined; }
  private current() {
    if (!this.client) throw new Error("Session has ended");
    return this.client;
  }
  models(signal?: AbortSignal) { return this.current().models(signal); }
  generate(input: Parameters<ModelClient["generate"]>[0]) { return this.current().generate(input); }
}

export async function createSessionClient(key: string, fetcher: typeof fetch = fetch): Promise<ModelClient> {
  let response: Response;
  try {
    response = await fetcher("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch { throw new Error("Could not verify your OpenRouter key. Please try again."); }
  await response.body?.cancel();
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Your OpenRouter key was not accepted. Check it and try again."
    : "Could not verify your OpenRouter key. Please try again.");
  return new OpenRouterClient(key);
}
