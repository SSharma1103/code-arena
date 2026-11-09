import type { Message, ModelClient } from '../types.js';
import { Telemetry } from '../middleware/telemetry.js';
export type Budget = { window: number; output: number; input: number };
export class ContextManager {
  private cache = new Map<string, Budget>();
  constructor(private client: ModelClient, private telemetry: Telemetry, readonly estimate = (messages: Message[]) => messages.reduce((n, m) => n + Buffer.byteLength(JSON.stringify({...m,images:undefined}), 'utf8') + (m.images?.length ?? 0)*4096 + 16, 0)) {}
  async budget(model: string, signal: AbortSignal): Promise<Budget> {
    const cached = this.cache.get(model); if (cached) return cached;
    let metadata; try { metadata = (await this.client.models(signal)).find(m => m.id === model); } catch { signal.throwIfAborted(); }
    const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
    const window = valid(metadata?.contextLength) ? Math.floor(metadata.contextLength) : 273_000;
    if (!valid(metadata?.contextLength)) this.telemetry.emit('context.fallback', { model, window });
    const output = Math.max(1, Math.floor(Math.min(8192, window / 4, valid(metadata?.maxOutput) ? metadata.maxOutput : 8192)));
    const budget = { window, output, input: window - output }; this.cache.set(model, budget); return budget;
  }
}
