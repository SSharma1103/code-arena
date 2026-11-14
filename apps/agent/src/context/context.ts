import type { Message, ModelClient } from '../types.js';
import { Telemetry } from '../middleware/telemetry.js';
import { FALLBACK_CONTEXT_TOKENS, FALLBACK_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS } from '../limits.js';
export type Budget = { window: number; output: number; input: number };
export class ContextManager {
  private cache = new Map<string, { budget: Budget; expires: number }>();
  constructor(private client: ModelClient, private telemetry: Telemetry, readonly estimate = (messages: Message[]) => messages.reduce((n, m) => n + Buffer.byteLength(JSON.stringify({...m,images:undefined}), 'utf8') + (m.images?.length ?? 0)*4096 + 16, 0), private now = () => Date.now()) {}
  async budget(model: string, signal: AbortSignal): Promise<Budget> {
    signal.throwIfAborted();
    const cached = this.cache.get(model); if (cached && cached.expires > this.now()) return cached.budget;
    let metadata; try { metadata = (await this.client.models(signal)).find(m => m.id === model); } catch { signal.throwIfAborted(); }
    const valid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
    const knownWindow = valid(metadata?.contextLength) && metadata.contextLength >= 4 ? metadata.contextLength : undefined;
    const window = knownWindow ?? FALLBACK_CONTEXT_TOKENS;
    if (knownWindow === undefined) this.telemetry.emit('context.fallback', { model, window });
    const output = Math.max(1, Math.floor(Math.min(MAX_OUTPUT_TOKENS, window / 4, valid(metadata?.maxOutput) ? metadata.maxOutput : FALLBACK_OUTPUT_TOKENS)));
    // Leave 5% for tokenizer differences, provider framing, and image accounting.
    const budget = { window, output, input: Math.floor(window * .95) - output };
    // Do not pin a transient metadata failure for the session lifetime.
    if (knownWindow !== undefined) this.cache.set(model, { budget, expires: this.now() + 5 * 60_000 });
    this.telemetry.emit('context.budget', { model, ...budget });
    return budget;
  }
}
