import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Session } from '../types.js';

export interface SessionStore { load(id: string): Promise<Session>; save(session: Session): Promise<void>; lock(id: string, kind?: 'run' | 'cli'): Promise<() => Promise<void>> }
export class FileSessionStore implements SessionStore {
  constructor(private directory = resolve(import.meta.dirname, '../../.data/sessions')) {}
  private path(id: string) { if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error('Invalid session ID'); return join(this.directory, id); }
  async load(id: string): Promise<Session> {
    const value = JSON.parse(await readFile(this.path(id) + '.json', 'utf8')) as Session;
    if (value.version !== 1 || value.id !== id || typeof value.model !== 'string' || typeof value.system !== 'string' || typeof value.summary !== 'string' || !Number.isInteger(value.covered) || !Array.isArray(value.turns) || value.covered < 0 || value.covered > value.turns.length || value.turns.some(t => !t || typeof t.prompt !== 'string' || !['running','completed','failed'].includes(t.status) || (t.status === 'completed' && typeof t.response?.text !== 'string'))) throw new Error('Invalid session file');
    return value;
  }
  async save(session: Session) {
    await mkdir(this.directory, { recursive: true }); const path = this.path(session.id) + '.json'; const temp = path + '.' + randomUUID() + '.tmp';
    try { await writeFile(temp, JSON.stringify(session, null, 2), { mode: 0o600 }); await rename(temp, path); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async lock(id: string, kind: 'run' | 'cli' = 'run') {
    await mkdir(this.directory, { recursive: true }); const path = this.path(id) + '.' + kind + '.lock';
    let file; try { file = await open(path, 'wx'); } catch { throw new Error('Session locked. Close the other process; after a crash remove its .lock file.'); }
    await file.writeFile(String(process.pid));
    return async () => { await file.close(); await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); };
  }
}
export class SessionManager {
  constructor(readonly store: SessionStore) {}
  async create(model: string, system = 'You are a helpful assistant.'): Promise<Session> {
    if (!model.trim()) throw new Error('Model is required');
    const session: Session = { version: 1, id: randomUUID(), model, system, summary: '', covered: 0, turns: [] };
    await this.store.save(session); return session;
  }
}
