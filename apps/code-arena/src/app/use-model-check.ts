"use client";
import { useRef, useState } from 'react';
import type { ModelCheckResult } from '@code-arena/contracts';

export function useModelCheck(model: string, key: string) {
  const [value, setValue] = useState<{ identity: string; result?: ModelCheckResult; checking: boolean }>();
  const latest = useRef(0);
  const identity = JSON.stringify([model.trim(), key.trim()]);
  async function check(selected = model) {
    if (!selected.trim()) return;
    const id = JSON.stringify([selected.trim(), key.trim()]);
    const request = ++latest.current;
    if (!key.trim()) {
      setValue({ identity: id, checking: false, result: { model: selected, status: 'unavailable', checkedAt: new Date().toISOString(), latencyMs: 0, reason: 'Enter your OpenRouter API key.' } });
      return;
    }
    setValue({ identity: id, checking: true });
    try {
      const response = await fetch('/api/arena/models/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selected.trim(), ...(key.trim() ? { openRouterApiKey: key.trim() } : {}) }) });
      if (response.status === 401) window.dispatchEvent(new Event('arena-sign-in-required'));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Check failed. Retry.');
      if (request === latest.current) setValue({ identity: id, checking: false, result: data });
    } catch (error) {
      if (request === latest.current) setValue({ identity: id, checking: false, result: { model: selected, status: 'unavailable', checkedAt: new Date().toISOString(), latencyMs: 0, reason: error instanceof Error ? error.message : 'Check failed.' } });
    }
  }
  const current = value?.identity === identity ? value : undefined;
  return { check, ready: current?.result?.status === 'available', checking: current?.checking, result: current?.result };
}
