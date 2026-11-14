"use client";
import { useEffect, useState } from "react";
import type { VideoExportJob } from "@code-arena/contracts";

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/arena/${path}`, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Could not export video");
  return data;
}
function savedJob(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function rememberJob(key: string, id?: string) {
  try { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key); } catch { /* Export still works when browser storage is disabled. */ }
}
export default function VideoExport({ sessionId, outputId, disabled }: { sessionId: string; outputId: string; disabled: boolean }) {
  const [duration, setDuration] = useState<5 | 10 | 15>(5);
  const [job, setJob] = useState<VideoExportJob>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const storageKey = `arena-video:${sessionId}:${outputId}`;
  const latestKey = `arena-video:${sessionId}:latest`;
  useEffect(() => {
    let live = true;
    const saved = savedJob(outputId ? storageKey : latestKey);
    if (saved) void request<VideoExportJob>(`exports/${saved}`).then(value => { if (live) setJob(value); }).catch(() => rememberJob(outputId ? storageKey : latestKey));
    return () => { live = false; };
  }, [storageKey, latestKey, outputId]);
  const active = job && !["completed", "failed"].includes(job.status);
  const jobId = job?.id;
  useEffect(() => {
    if (!active || !jobId) return;
    let live = true;
    const timer = setInterval(() => {
      void request<VideoExportJob>(`exports/${jobId}`).then(value => {
        if (live) { setJob(value); setError(""); }
      }).catch(e => { if (live) setError(e.message); });
    }, 1500);
    return () => { live = false; clearInterval(timer); };
  }, [active, jobId, pollAttempt]);
  async function start(retry = false) {
    setBusy(true); setError("");
    try {
      const value = await request<VideoExportJob>(retry && job ? `exports/${job.id}/retry` : `sessions/${sessionId}/exports`, retry ? {} : { outputId, duration });
      setJob(value); rememberJob(storageKey, value.id); rememberJob(latestKey, value.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not export video"); }
    finally { setBusy(false); }
  }
  const url = job?.status === "completed" ? `/api/arena/exports/${job.id}/video` : undefined;
  return <details className="video-export">
    <summary>Export video</summary>
    <div className="video-export-controls">
      <button className="video-export-close" aria-label="Close video export" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>Close ×</button>
      <p>Reels · 1080 × 1920 · 30 FPS · Silent MP4</p>
      <label>Duration <select value={duration} disabled={busy || Boolean(active)} onChange={e => setDuration(Number(e.target.value) as 5 | 10 | 15)}>
        {[5, 10, 15].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
      </select></label>
      <button disabled={disabled || busy || Boolean(active)} onClick={() => void start()}>{busy ? "Submitting…" : "Export video"}</button>
      {active && <div role="status"><p>{job.status === "queued" ? "Queued — waiting for video worker" : `${job.status} · ${job.progress}%`}</p><progress max={100} value={job.progress} aria-label="Video export progress" /></div>}
      {job?.failure && <div role="alert"><p>{job.failure.code === "unsupported" ? "Unsupported output: " : "Export failed: "}{job.failure.message}</p>
        {job.failure.code !== "unsupported" && <button disabled={busy} onClick={() => void start(true)}>Retry export</button>}</div>}
      {error && <p role="alert">{error} {active && <button onClick={() => setPollAttempt(value => value + 1)}>Reconnect</button>}</p>}
      {url && job && <><video src={url} controls playsInline preload="metadata" aria-label="Exported vertical video preview" /><a href={url + "?download=1"} download>Download {job.settings.duration}s MP4 ↓</a></>}
    </div>
  </details>;
}
