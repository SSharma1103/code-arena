"use client";

import { AuthControl } from "./auth";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ArenaEvent,
  ArenaMode,
  ModelOption,
  SessionView,
} from "@code-arena/contracts";
import { api, modes, OutputPanel } from "./arena";
import { useModelCheck } from "./use-model-check";
import ModelPicker from "./model-picker";
import RunToggle from "./run-toggle";

function useLane(initialId?: string) {
  const [session, setSession] = useState<SessionView>();
  const [id, setId] = useState(initialId);
  const [events, setEvents] = useState<ArenaEvent[]>([]);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () =>
      void api<SessionView>(`sessions/${id}`)
        .then((value) => {
          if (live) setSession(value);
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setConnection("Expired");
            stream.close();
          }
        });
    const stream = new EventSource(`/api/arena/sessions/${id}/events`);
    stream.addEventListener("connected", () => {
      setConnection("Live");
      refresh();
    });
    stream.onmessage = (event) => {
      const item = JSON.parse(event.data) as ArenaEvent;
      setEvents((items) =>
        items.some((e) => e.sequence === item.sequence)
          ? items
          : [...items, item].slice(-100),
      );
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          refresh();
        }, 150);
    };
    stream.onerror = () => setConnection("Reconnecting");
    refresh();
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible")
        void api(`sessions/${id}`, "PATCH").catch(() => {});
    }, 60_000);
    return () => {
      live = false;
      stream.close();
      clearTimeout(timer);
      clearInterval(heartbeat);
    };
  }, [id]);
  return {
    session,
    setSession,
    id,
    setId,
    events,
    error,
    setError,
    connection,
  };
}
type Lane = ReturnType<typeof useLane>;
function LaneOutput({
  lane,
  mode,
  model,
  label,
  maxScreenshots,
  busy,
  action,
}: {
  lane: Lane;
  mode: ArenaMode;
  model: string;
  label: string;
  maxScreenshots: number;
  busy: boolean;
  action(kind: "retry" | "cancel"): void;
}) {
  const [tab, setTab] = useState("preview");
  const [artifactId, setArtifactId] = useState("");
  const [source, setSource] = useState({ url: "", text: "" });
  const [clock, setClock] = useState(0);
  const { session, id, events } = lane;
  const running = session?.status === "running";
  const ended =
    session?.status === "ended" ||
    session?.status === "expired" ||
    lane.connection === "Expired";
  const artifact =
    session?.artifacts.find((a) => a.id === artifactId) ??
    session?.artifacts.at(-1);
  const artifactUrl =
    artifact && `/api/arena/sessions/${id}/artifacts/${artifact.id}`;
  const last = session?.runs.at(-1);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (tab !== "source" || !artifactUrl) return;
    let live = true;
    void fetch(artifactUrl + "?source=1")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.text();
      })
      .then((text) => {
        if (live) setSource({ url: artifactUrl, text });
      })
      .catch(() => {
        if (live)
          setSource({ url: artifactUrl, text: "Could not load source." });
      });
    return () => {
      live = false;
    };
  }, [tab, artifactUrl]);
  const started = events.findLast((e) => e.type === "run.started")?.time;
  const elapsed = running
    ? Math.max(
        0,
        Math.floor((clock - (started ? Date.parse(started) : clock)) / 1000),
      )
    : Math.round((last?.durationMs ?? 0) / 1000);
  return (
    <div className="comparison-lane">
      <div className="lane-heading">
        <span className="lane-letter">{label}</span>
        <div>
          <span className="eyebrow">MODEL {label}</span>
          <strong title={session?.model ?? model}>
            {session?.model ?? (model || "Choose a model")}
          </strong>
        </div>
        <span className="lane-connection">
          {id ? lane.connection : "Standing by"}
        </span>
        {running ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action("cancel")}
          >
            Stop
          </button>
        ) : !ended &&
          (lane.error ||
            last?.status === "failed" ||
            last?.status === "cancelled") ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action("retry")}
          >
            Retry
          </button>
        ) : null}
      </div>
      {lane.error && (
        <p className="error-message lane-error" role="alert">
          {lane.error}
        </p>
      )}
      <OutputPanel
        {...{
          session,
          tab,
          setTab,
          mode,
          artifact,
          setArtifactId,
          artifactUrl,
          ended,
          source,
          running,
          elapsed,
          last,
          maxScreenshots,
          model,
          id,
        }}
        cleanup={session?.cleanup}
        activity={events.filter((e) =>
          [
            "assistant.message",
            "tool.started",
            "tool.result",
            "review.captured",
            "run.finished",
          ].includes(e.type),
        )}
      />
    </div>
  );
}
export default function CompareWorkspace({
  mode,
  sessionIds,
  onSingle,
}: {
  mode: ArenaMode;
  sessionIds: [string | undefined, string | undefined];
  onSingle(): void;
}) {
  const [version, setVersion] = useState(0);
  return (
    <ComparisonSession
      key={version}
      {...{
        mode,
        sessionIds: version ? [undefined, undefined] : sessionIds,
        onSingle,
      }}
      onNew={() => {
        history.replaceState(null, "", `/arena/${mode}?compare=1`);
        setVersion((v) => v + 1);
      }}
    />
  );
}
function ComparisonSession({
  mode,
  sessionIds,
  onSingle,
  onNew,
}: {
  mode: ArenaMode;
  sessionIds: [string | undefined, string | undefined];
  onSingle(): void;
  onNew(): void;
}) {
  const a = useLane(sessionIds[0]),
    b = useLane(sessionIds[1]);
  const lanes = [a, b];
  const [models, setModels] = useState<ModelOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [modelError, setModelError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(["", ""]);
  const [prompt, setPrompt] = useState(
    sessionIds.some(Boolean) ? "" : modes[mode].prompt,
  );
  const [key, setKey] = useState("");
  const checkA = useModelCheck(selected[0], key);
  const checkB = useModelCheck(selected[1], key);
  const checks = [checkA, checkB];
  const [showKey, setShowKey] = useState(false);
  const [maxScreenshots, setMaxScreenshots] = useState(3);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastPrompt = useRef("");
  const locked = lanes.some((l) => l.id);
  const running = lanes.some((l) => l.session?.status === "running");
  const ended = lanes.some(
    (l) =>
      l.session?.status === "ended" ||
      l.session?.status === "expired" ||
      l.connection === "Expired",
  );
  const settings = a.session ?? b.session;
  const limit = settings?.maxScreenshots ?? maxScreenshots;
  useEffect(() => {
    let live = true;
    void api<ModelOption[]>("models")
      .then((value) => {
        if (live) {
          setModels(value);
          setStatus("ready");
        }
      })
      .catch((e) => {
        if (live) {
          setModelError(e.message);
          setStatus("error");
        }
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  function saveUrl(ids: (string | undefined)[]) {
    const query = new URLSearchParams({ compare: "1" });
    if (ids[0]) query.set("session", ids[0]);
    if (ids[1]) query.set("sessionB", ids[1]);
    history.replaceState(null, "", `/arena/${mode}?${query}`);
  }
  async function perform(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await operation();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function submit(indices = [0, 1], retry = false) {
    await perform(async () => {
      if (indices.some(i => !lanes[i].id && !checks[i].ready)) return;
      const text = retry
        ? lastPrompt.current ||
          lanes[indices[0]].session?.runs.at(-1)?.prompt ||
          prompt
        : prompt;
      if (!text.trim() && mode !== "cube") return;
      const ids = lanes.map((l) => l.id);
      // Establish the owner cookie before creating the second independent session.
      try {
        for (const i of indices) {
          const lane = lanes[i];
          lane.setError("");
          if (!ids[i]) {
            try {
              if (settings?.credentialSource === "user" && !key.trim())
                throw Error(
                  "Re-enter your API key to create the missing session.",
                );
              const value = await api<SessionView>("sessions", "POST", {
                mode,
                model: selected[i],
                maxScreenshots: limit,
                ...(key.trim() ? { openRouterApiKey: key.trim() } : {}),
              });
              ids[i] = value.id;
              lane.setId(value.id);
              lane.setSession(value);
              saveUrl(ids);
            } catch (e) {
              lane.setError(
                e instanceof Error ? e.message : "Could not create session",
              );
            }
          }
        }
      } finally {
        setKey("");
        setShowKey(false);
      }
      lastPrompt.current = text;
      await Promise.allSettled(
        indices.map(async (i) => {
          if (!ids[i]) return;
          const lane = lanes[i];
          try {
            const cube = lane.session?.cube;
            if (cube && cube.cube.solved && lane.session?.cubeStarted) return;
            await api(
              `sessions/${ids[i]}/${cube ? "cube/start" : "runs"}`,
              "POST",
              cube ? {} : { prompt: text },
            );
            lane.setSession(await api<SessionView>(`sessions/${ids[i]}`));
          } catch (e) {
            lane.setError(e instanceof Error ? e.message : "Run failed");
          }
        }),
      );
      if (ids.every(Boolean)) setPrompt("");
    });
  }
  async function control(kind: "cancel" | "end", indices = [0, 1]) {
    await perform(async () => {
      await Promise.allSettled(
        indices.map(async (i) => {
          const lane = lanes[i];
          if (!lane.id) return;
          try {
            await api(
              `sessions/${lane.id}${kind === "cancel" ? "/cancel" : ""}`,
              kind === "cancel" ? "POST" : "DELETE",
            );
            lane.setSession(await api<SessionView>(`sessions/${lane.id}`));
          } catch (e) {
            lane.setError(e instanceof Error ? e.message : "Request failed");
          }
        }),
      );
    });
  }
  const cubeReady = lanes.some((l) => l.session?.cube);
  const solved = lanes.every(
    (l) => l.session?.cubeStarted && l.session?.cube?.cube.solved,
  );
  return (
    <main className={`workspace compare-workspace mode-${mode}`}>
      <header className="site-header">
        <Link href="/?compare=1" className="brand">
          <span className="brand-icon">✳</span> CODE ARENA
        </Link>
        <div className="breadcrumb">/ {modes[mode].name}</div>
        <RunToggle
          compare
          disabled={locked || busy}
          onChange={(value) => {
            if (!value) onSingle();
          }}
        />
        <div className="header-actions">
          <AuthControl />
          {locked && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void control("end")}
            >
              End comparison ↗
            </button>
          )}
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="composer">
          <Link className="back-link" href="/?compare=1">
            ← All playgrounds
          </Link>
          <div className="eyebrow">ONE PROMPT / TWO PERSPECTIVES</div>
          <h1>
            {modes[mode].name}
            <span className="accent">.</span>
          </h1>
          <p className="composer-description">
            The same idea. Two models. Watch them create side by side.
          </p>
          <div className="credential-field">
            <label className="field-label" htmlFor="comparison-key">
              <span>OpenRouter API key</span> Required
            </label>
            {lanes.every((l) => l.id) ? (
              <div className="credential-status">
                Using your key
              </div>
            ) : (
              <div className="credential-input">
                <input
                  id="comparison-key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  maxLength={512}
                  value={key}
                  disabled={busy}
                  onChange={(e) => setKey(e.target.value)}
                  onBlur={() => { void checkA.check(); void checkB.check(); }}
                  placeholder="Enter your OpenRouter API key"
                />
                <button
                  className="text-button"
                  aria-pressed={showKey}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            )}
            <p className="field-help">
              One key for both models. Used only for this comparison.
            </p>
          </div>
          <div className="comparison-models">
            {lanes.map((lane, i) => (
              <div key={i}>
                <label
                  className="field-label"
                  htmlFor={`comparison-model-${i}`}
                >
                  <b className="model-letter">{i === 0 ? "A" : "B"}</b>
                  <span>Model {i === 0 ? "A" : "B"}</span>
                </label>
                <ModelPicker
                  availability={lane.id ? undefined : checks[i]}
                  onCheck={lane.id ? undefined : value => void checks[i].check(value)}
                  id={`comparison-model-${i}`}
                  value={lane.session?.model ?? selected[i]}
                  models={models}
                  status={status}
                  error={modelError}
                  disabled={Boolean(lane.id) || busy}
                  onChange={(value) =>
                    setSelected((values) =>
                      values.map((v, j) => (i === j ? value : v)),
                    )
                  }
                  onRetry={() => {
                    setStatus("loading");
                    setAttempt((v) => v + 1);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="prompt-heading">
            <label className="field-label" htmlFor="comparison-prompt">
              <span>
                {locked ? "Refine both outputs" : "Describe your idea"}
              </span>
            </label>
            <button
              className="example-button"
              disabled={running || busy || cubeReady || ended}
              onClick={() => setPrompt(modes[mode].prompt)}
            >
              Use example ↗
            </button>
          </div>
          <textarea
            id="comparison-prompt"
            maxLength={20000}
            value={prompt}
            disabled={running || busy || cubeReady || ended}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="One prompt, sent to both models…"
          />
          <div className="input-meta">
            <span>SHARED WITH BOTH MODELS</span>
            <span>{prompt.length.toLocaleString()} / 20K</span>
          </div>
          <div className="screenshot-field">
            <label htmlFor="comparison-reviews">
              <span className="field-label">
                <span>Max screenshots</span>
              </span>
              <span className="field-help">
                The same visual review limit per model.
              </span>
            </label>
            <input
              id="comparison-reviews"
              type="number"
              min={0}
              max={10}
              value={limit}
              disabled={locked || busy}
              onChange={(e) => setMaxScreenshots(Number(e.target.value))}
            />
          </div>
          {ended ? (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await Promise.allSettled(
                    lanes
                      .filter((l) => l.id)
                      .map((l) => api(`sessions/${l.id}`, "DELETE")),
                  );
                  onNew();
                })
              }
            >
              New comparison <span aria-hidden="true">&nearr;</span>
            </button>
          ) : running ? (
            <button
              className="primary-button stop"
              disabled={busy}
              onClick={() => void control("cancel")}
            >
              Stop both <span>■</span>
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={
                busy ||
                solved ||
                lanes.some((lane, i) => !lane.id && !checks[i].ready) ||
                (!cubeReady &&
                  (!prompt.trim() ||
                    lanes.some((l, i) => !l.id && !selected[i].trim()))) ||
                !Number.isInteger(limit) ||
                limit < 0 ||
                limit > 10
              }
              onClick={() => void submit()}
            >
              {busy
                ? "Connecting…"
                : cubeReady
                  ? solved
                    ? "Cubes solved"
                    : "Start / continue solving"
                  : locked
                    ? "Refine both outputs"
                    : "Run comparison"}
              <span>↗</span>
            </button>
          )}
          <p className="session-note">
            <span className="tiny-cross">+</span>
            {mode === "cube"
              ? "Two independent cubes. Both wait for Start solving."
              : "Same prompt. Same limits. Independent results."}
          </p>
          <div className="composer-foot">
            TEMPORARY WORKSPACE <span>LOCAL / PRIVATE</span>
          </div>
        </aside>
        <div className="comparison-outputs">
          {lanes.map((lane, i) => (
            <LaneOutput
              key={i}
              lane={lane}
              mode={mode}
              model={selected[i]}
              label={i === 0 ? "A" : "B"}
              maxScreenshots={limit}
              busy={busy}
              action={(kind) => {
                if (kind === "retry") void submit([i], true);
                else void control("cancel", [i]);
              }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
