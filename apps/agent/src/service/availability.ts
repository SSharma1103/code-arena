import { createHash } from 'node:crypto';
import type { ModelCheck, ModelCheckResult } from '@code-arena/contracts';

export interface ModelProbe { probe(model: string, signal: AbortSignal): Promise<void> }

export class ModelAvailabilityService {
  private cache = new Map<string, ModelCheckResult>();
  private pending = new Map<string, Promise<ModelCheckResult>>();
  private attempts = new Map<string, number[]>();
  constructor(private factory: (key: string) => ModelProbe, private now = () => Date.now()) {}
  async check(owner: string, input: ModelCheck): Promise<ModelCheckResult> {
    const key = input.openRouterApiKey;
    if (typeof key !== 'string' || !key.trim() || key.trim().length > 512 || /\s/.test(key.trim()))
      return { model: input.model, status: 'unavailable', checkedAt: new Date(this.now()).toISOString(), latencyMs: 0, reason: 'Enter your OpenRouter API key.' };
    const fingerprint = createHash('sha256').update(key.trim()).digest('hex');
    const id = `${owner}:${input.model}:${fingerprint}`;
    const now = this.now();
    for (const [key, result] of this.cache) if (now - Date.parse(result.checkedAt) >= 60_000) this.cache.delete(key);
    for (const [key, times] of this.attempts) if (!times.some(t => now - t < 60_000)) this.attempts.delete(key);
    const cached = this.cache.get(id);
    if (cached) return cached;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const times = (this.attempts.get(owner) ?? []).filter(t => now - t < 60_000);
    if (times.length >= 10 || [...this.pending.keys()].filter(k => k.startsWith(owner + ':')).length >= 2)
      return { model: input.model, status: 'unavailable', checkedAt: new Date(now).toISOString(), latencyMs: 0, reason: 'Too many checks. Wait a minute and retry.' };
    this.attempts.set(owner, [...times, now]);
    const task = (async (): Promise<ModelCheckResult> => {
      await Promise.resolve();
      try {
        const client = this.factory(key.trim());
        await client.probe(input.model, AbortSignal.timeout(20_000));
        const result: ModelCheckResult = { model: input.model, status: 'available', checkedAt: new Date(this.now()).toISOString(), latencyMs: this.now() - now };
        this.cache.set(id, result);
        return result;
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode;
        const reason = code === 401 || code === 403 ? 'OpenRouter key was not accepted.' : code === 402 ? 'Insufficient OpenRouter credits.' : code === 429 ? 'Model is rate limited. Retry shortly.' : code === 404 ? 'Model or endpoint is unavailable.' : (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError' ? 'Model check timed out.' : 'Model could not respond. Retry or choose another model.';
        return { model: input.model, status: 'unavailable', checkedAt: new Date(this.now()).toISOString(), latencyMs: this.now() - now, reason };
      } finally { this.pending.delete(id); }
    })();
    this.pending.set(id, task);
    return task;
  }
}
