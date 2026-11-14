"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import CompareWorkspace from "./compare-workspace";
import RunToggle from "./run-toggle";
import { useModelCheck } from "./use-model-check";
import ModelPicker from "./model-picker";
import { AuthControl } from "./auth";
import type {
  ArenaEvent,
  ArenaMode,
  CleanupBrief,
  ModelOption,
  SessionView,
} from "@code-arena/contracts";

export const modes: Record<
  ArenaMode,
  {
    name: string;
    label: string;
    number: string;
    description: string;
    prompt: string;
    verb: string;
  }
> = {
  svg: {
    name: "Generate SVG",
    label: "VECTOR / SVG",
    number: "01",
    description: "From a few words to a thousand curves.",
    prompt:
      "Create an intricate geometric flower with layered petals, warm coral and cream colors, and a deep charcoal background.",
    verb: "Generate artwork",
  },
  "3js": {
    name: "3D Objects",
    label: "SPATIAL / THREE.JS",
    number: "02",
    description: "Give your imagination another dimension.",
    prompt:
      "Create an interactive sculptural chrome knot floating above a dark surface, with soft studio lighting and orbit controls.",
    verb: "Generate object",
  },
  html: {
    name: "Ball in Hex",
    label: "MOTION / HTML",
    number: "03",
    description: "A little physics. Endless possibilities.",
    prompt:
      "Create a ball bouncing inside a slowly rotating hexagon. Include gravity, realistic collisions and friction, with an elegant dark design and controls for speed and gravity.",
    verb: "Generate experience",
  },
  cube: {
    name: "Rubik’s Cube",
    label: "REASONING / LIVE AGENT",
    number: "04",
    description: "Six faces. One model. Every move, live.",
    prompt:
      "Prepare a scrambled Rubik’s cube. When I press Start solving, solve it step by step, reviewing your progress as needed.",
    verb: "Prepare cube",
  },
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/arena/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("arena-sign-in-required"));
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Artwork({ mode }: { mode: ArenaMode }) {
  if (mode === "svg")
    return (
      <svg className="art flower" viewBox="0 0 340 270" aria-hidden="true">
        <g transform="translate(170 135)">
          {Array.from({ length: 16 }, (_, i) => (
            <ellipse
              key={i}
              rx="40"
              ry="108"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              transform={`rotate(${i * 22.5})`}
            />
          ))}
          <circle r="38" fill="var(--panel)" stroke="currentColor" />
          <circle r="8" fill="currentColor" />
        </g>
        <path d="M40 40h18m-9-9v18M290 222h18m-9-9v18" stroke="currentColor" />
      </svg>
    );
  if (mode === "3js")
    return (
      <svg className="art sculpture" viewBox="0 0 340 270" aria-hidden="true">
        <defs>
          <linearGradient id="metal" x1="0" x2="1" y2="1">
            <stop stopColor="#d8e9eb" />
            <stop offset=".28" stopColor="#58666a" />
            <stop offset=".48" stopColor="#f0f8ed" />
            <stop offset=".65" stopColor="#455558" />
            <stop offset="1" stopColor="#b9d3cd" />
          </linearGradient>
        </defs>
        <g
          fill="none"
          stroke="url(#metal)"
          strokeWidth="28"
          transform="rotate(-25 170 135)"
        >
          <ellipse cx="140" cy="135" rx="68" ry="86" />
          <ellipse cx="205" cy="135" rx="46" ry="80" />
        </g>
        <ellipse cx="175" cy="242" rx="80" ry="4" fill="#000" opacity=".3" />
      </svg>
    );
  if (mode === "html")
    return (
      <svg className="art hex-art" viewBox="0 0 340 270" aria-hidden="true">
        <g className="hex-spin">
          <path
            d="M170 28 263 81 263 189 170 242 77 189 77 81Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M170 39 253 87 253 183 170 231 87 183 87 87Z"
            fill="none"
            stroke="currentColor"
            opacity=".15"
          />
        </g>
        <path
          d="M140 90Q80 180 175 202"
          fill="none"
          stroke="currentColor"
          strokeDasharray="3 7"
          opacity=".35"
        />
        <circle className="ball" cx="194" cy="183" r="18" fill="currentColor" />
        <circle cx="189" cy="177" r="5" fill="#fff" opacity=".45" />
      </svg>
    );
  const colors = ["#d4e4b8", "#de917a", "#f0cc78"];
  return (
    <svg className="art cube-art" viewBox="0 0 340 270" aria-hidden="true">
      <g transform="translate(170 135)">
        {[0, 1, 2].map((face) => (
          <g
            key={face}
            transform={
              face === 0
                ? "matrix(.86 .5 -.86 .5 0 -108)"
                : face === 1
                  ? "matrix(.86 .5 0 1 -93 -54)"
                  : "matrix(.86 -.5 0 1 0 0)"
            }
          >
            {Array.from({ length: 9 }, (_, i) => (
              <rect
                key={i}
                x={(i % 3) * 36 + 2}
                y={Math.floor(i / 3) * 36 + 2}
                width="32"
                height="32"
                rx="3"
                fill={colors[face]}
                opacity={0.6 + (i % 3) * 0.16}
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
function CubeFrame({ session }: { session: SessionView }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cube = session.cube;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "cube-state", cube: cube?.cube },
      "*",
    );
  }, [cube]);
  return (
    <iframe
      ref={frame}
      title="Live Rubik’s cube"
      className="cube-frame"
      sandbox="allow-scripts"
      src={`/api/arena/sessions/${session.id}/cube`}
      onLoad={() =>
        frame.current?.contentWindow?.postMessage(
          { type: "cube-state", cube: cube?.cube },
          "*",
        )
      }
    />
  );
}
export default function Arena({
  initialMode,
  sessionId,
  initialCompare = false,
  sessionB,
}: {
  initialMode?: ArenaMode;
  sessionId?: string;
  initialCompare?: boolean;
  sessionB?: string;
}) {
  const [compare, setCompare] = useState(initialCompare);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  if (compare && initialMode)
    return (
      <CompareWorkspace
        mode={initialMode}
        sessionIds={[sessionId, sessionB]}
        onSingle={() => {
          history.replaceState(null, "", `/arena/${initialMode}`);
          setCompare(false);
        }}
      />
    );
  return (
    <ArenaWorkspace
      compare={compare}
      onCompare={(value) => {
        history.replaceState(
          null,
          "",
          initialMode
            ? `/arena/${initialMode}${value ? "?compare=1" : ""}`
            : value
              ? "/?compare=1"
              : "/",
        );
        setCompare(value);
      }}
      key={workspaceVersion}
      initialMode={initialMode}
      sessionId={workspaceVersion === 0 ? sessionId : undefined}
      onNewSession={(mode) => {
        history.replaceState(null, "", `/arena/${mode}`);
        setWorkspaceVersion((version) => version + 1);
      }}
    />
  );
}
function ArenaWorkspace({
  initialMode,
  sessionId,
  onNewSession,
  compare,
  onCompare,
}: {
  initialMode?: ArenaMode;
  sessionId?: string;
  onNewSession(mode: ArenaMode): void;
  compare: boolean;
  onCompare(value: boolean): void;
}) {
  const [mode, setMode] = useState<ArenaMode | undefined>(initialMode),
    [prompt, setPrompt] = useState(
      initialMode && !sessionId ? modes[initialMode].prompt : "",
    ),
    [model, setModel] = useState(""),
    [openRouterApiKey, setOpenRouterApiKey] = useState(""),
    [showKey, setShowKey] = useState(false),
    [models, setModels] = useState<ModelOption[]>([]),
    [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    ),
    [modelError, setModelError] = useState(""),
    [modelAttempt, setModelAttempt] = useState(0),
    [maxScreenshots, setMaxScreenshots] = useState(3),
    [session, setSession] = useState<SessionView>(),
    [events, setEvents] = useState<ArenaEvent[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("preview"),
    [artifactId, setArtifactId] = useState(""),
    [source, setSource] = useState({ url: "", text: "" }),
    [connection, setConnection] = useState("Connecting"),
    [cleanup, setCleanup] = useState<CleanupBrief>(),
    [clock, setClock] = useState(0);
  const availability = useModelCheck(model, openRouterApiKey);
  const pending = useRef(false);
  const id = session?.id ?? sessionId;
  useEffect(() => {
    if (!mode) return;
    let live = true;
    void api<ModelOption[]>("models")
      .then((list) => {
        if (live) {
          setModels(list);
          setModelStatus("ready");
        }
      })
      .catch((e) => {
        if (live) {
          setModelError(e.message);
          setModelStatus("error");
        }
      });
    return () => {
      live = false;
    };
  }, [mode, modelAttempt]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      void api<SessionView>("sessions/" + id)
        .then((value) => {
          if (!live) return;
          setSession(value);
          setMode(value.mode);
          setModel(value.model);
          setMaxScreenshots(value.maxScreenshots);
          if (value.cleanup) setCleanup(value.cleanup);
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            stream.close();
            setConnection("Expired");
          }
        });
    };
    const stream = new EventSource(`/api/arena/sessions/${id}/events`);
    stream.addEventListener("connected", () => {
      setConnection("Live");
      refresh();
    });
    stream.onmessage = (event) => {
      const item = JSON.parse(event.data) as ArenaEvent;
      setEvents((items) =>
        items.some((i) => i.sequence === item.sequence)
          ? items
          : [...items, item].slice(-100),
      );
      if (!refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          refresh();
        }, 150);
    };
    stream.onerror = () => setConnection("Reconnecting");
    refresh();
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible")
        void api("sessions/" + id, "PATCH").catch(() => {});
    }, 60_000);
    return () => {
      live = false;
      stream.close();
      clearInterval(heartbeat);
      clearTimeout(refreshTimer);
    };
  }, [id]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const artifact =
    session?.artifacts.find((a) => a.id === artifactId) ??
    session?.artifacts.at(-1);
  const artifactUrl =
    artifact && `/api/arena/sessions/${id}/artifacts/${artifact.id}`;
  useEffect(() => {
    if (tab !== "source" || !artifactUrl) return;
    let live = true;
    void fetch(artifactUrl + "?source=1")
      .then((r) => r.text())
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
  }, [artifactUrl, tab]);
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function run() {
    void act(async () => {
      if (!session && !availability.ready) throw Error("Check model availability before starting.");
      if (!mode || !model.trim() || !prompt.trim())
        throw Error("Choose a model and enter your prompt.");
      let current = session;
      if (!current) {
        current = await api<SessionView>("sessions", "POST", {
          mode,
          model,
          maxScreenshots,
          ...(openRouterApiKey.trim()
            ? { openRouterApiKey: openRouterApiKey.trim() }
            : {}),
        });
        setOpenRouterApiKey("");
        setShowKey(false);
        setSession(current);
        history.replaceState(null, "", `/arena/${mode}?session=${current.id}`);
      }
      await api(`sessions/${current.id}/runs`, "POST", { prompt });
      setSession(await api<SessionView>("sessions/" + current.id));
      setPrompt("");
    });
  }
  const running = session?.status === "running",
    ended =
      Boolean(cleanup) ||
      session?.status === "ended" ||
      session?.status === "expired" ||
      connection === "Expired",
    last = session?.runs.at(-1),
    selected = mode && modes[mode];
  const activity = events.filter((e) =>
    [
      "assistant.message",
      "tool.started",
      "tool.result",
      "review.captured",
      "run.finished",
    ].includes(e.type),
  );
  const elapsed = running
    ? Math.max(
        0,
        Math.floor(
          (clock -
            new Date(
              events.findLast((e) => e.type === "run.started")?.time ??
                new Date(clock).toISOString(),
            ).getTime()) /
            1000,
        ),
      )
    : Math.round((last?.durationMs ?? 0) / 1000);
  if (!mode)
    return (
      <Launcher compare={compare} onCompare={onCompare} />
    );
  return (
    <main className={`workspace mode-${mode}`}>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-icon">✳</span> CODE ARENA
        </Link>
        <div className="breadcrumb">
          <span>/</span> {selected?.name}
        </div>
        <RunToggle
          compare={false}
          disabled={Boolean(id) || busy}
          onChange={onCompare}
        />
        <div className="header-actions">
          <AuthControl />
          <span className="connection">
            <span
              className={connection === "Live" ? "live-dot" : "live-dot muted"}
            />
            {ended ? "Session ended" : id ? connection : "New workspace"}
          </span>
          {ended ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => onNewSession(mode)}
            >
              Start new session <Arrow />
            </button>
          ) : (
            session && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setCleanup(
                      await api<CleanupBrief>("sessions/" + id, "DELETE"),
                    );
                    setSession(await api<SessionView>("sessions/" + id));
                  })
                }
              >
                End session ↗
              </button>
            )
          )}
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="composer">
          <Link className="back-link" href="/">
            ← All playgrounds
          </Link>
          <div className="eyebrow">
            {selected?.number} / {selected?.label}
          </div>
          <h1>
            {selected?.name}
            <span className="accent">.</span>
          </h1>
          <p className="composer-description">{selected?.description}</p>
          <div className="credential-field">
            <label className="field-label" htmlFor="openrouter-key">
              <span>OpenRouter API key</span> Required
            </label>
            {session ? (
              <div className="credential-status" role="status">
                Using your key
              </div>
            ) : (
              <div className="credential-input">
                <input
                  id="openrouter-key"
                  type={showKey ? "text" : "password"}
                  value={openRouterApiKey}
                  onChange={(event) => setOpenRouterApiKey(event.target.value)}
                  onBlur={() => void availability.check()}
                  placeholder="Enter your OpenRouter API key"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  maxLength={512}
                  disabled={busy || Boolean(id)}
                  aria-describedby="credential-help"
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || Boolean(id)}
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                  aria-pressed={showKey}
                  onClick={() => setShowKey((value) => !value)}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            )}
            <p className="field-help" id="credential-help">
              {session
                ? "Fixed for this session. Start a new session to change keys."
                : "Your key is required and used only for this session."}
            </p>
          </div>
          <label className="field-label" htmlFor="model">
            01 <span>Choose your model</span>
          </label>
          <ModelPicker
            availability={session ? undefined : availability}
            onCheck={session ? undefined : value => void availability.check(value)}
            value={model}
            models={models}
            status={modelStatus}
            error={modelError}
            onChange={setModel}
            onRetry={() => {
              setModelStatus("loading");
              setModelError("");
              setModelAttempt((attempt) => attempt + 1);
            }}
            disabled={Boolean(session)}
          />
          <div className="prompt-heading">
            <label className="field-label" htmlFor="prompt">
              02{" "}
              <span>
                {session?.cube
                  ? "Your solve instructions"
                  : session
                    ? "Refine your creation"
                    : "Describe your idea"}
              </span>
            </label>
            <button
              className="example-button"
              disabled={running || ended || Boolean(session?.cube)}
              onClick={() => setPrompt(selected!.prompt)}
            >
              Use example ↗
            </button>
          </div>
          <textarea
            id="prompt"
            maxLength={20000}
            value={session?.cube ? (session.runs[0]?.prompt ?? prompt) : prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running || ended || Boolean(session?.cube)}
            placeholder="What would you like to create?"
          />
          <div className="input-meta">
            <span>MAKE IT SPECIFIC. MAKE IT YOURS.</span>
            <span>{prompt.length.toLocaleString()} / 20K</span>
          </div>
          <div className="screenshot-field">
            <label htmlFor="screenshots">
              <span className="field-label">
                03 <span>Max screenshots</span>
              </span>
              <span className="field-help">
                Visual reviews the agent can take per run.
              </span>
            </label>
            <input
              id="screenshots"
              aria-label="Maximum screenshots"
              type="number"
              min="0"
              max="10"
              value={maxScreenshots}
              onChange={(e) => setMaxScreenshots(Number(e.target.value))}
              disabled={Boolean(session)}
            />
          </div>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {ended ? (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => onNewSession(mode)}
            >
              Start new session <Arrow />
            </button>
          ) : running ? (
            <button
              className="primary-button stop"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api("sessions/" + id + "/cancel", "POST");
                })
              }
            >
              Stop run <span>■</span>
            </button>
          ) : session?.cube ? (
            <button
              className="primary-button"
              disabled={
                busy || Boolean(session.cubeStarted && session.cube.cube.solved)
              }
              onClick={() =>
                void act(async () => {
                  await api("sessions/" + id + "/cube/start", "POST");
                  setSession(await api<SessionView>("sessions/" + id));
                })
              }
            >
              {session.cubeStarted
                ? session.cube.cube.solved
                  ? "Cube solved"
                  : "Continue solving"
                : "Start solving"}{" "}
              <Arrow />
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={run}
              disabled={
                busy ||
                (!session && !availability.ready) ||
                !model.trim() ||
                !prompt.trim() ||
                !Number.isInteger(maxScreenshots) ||
                maxScreenshots < 0 ||
                maxScreenshots > 10
              }
            >
              {busy
                ? "Connecting…"
                : session
                  ? "Run refinement"
                  : selected?.verb}{" "}
              <Arrow />
            </button>
          )}
          <p className="session-note">
            <span className="tiny-cross">+</span>{" "}
            {mode === "cube"
              ? "The cube waits for you to press Start solving."
              : "Your prompt. Your model. A fresh perspective."}
          </p>
          <div className="composer-foot">
            TEMPORARY WORKSPACE <span>LOCAL / PRIVATE</span>
          </div>
        </aside>
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
            cleanup,
            source,
            running,
            elapsed,
            last,
            maxScreenshots,
            model,
            activity,
            id,
          }}
        />
      </div>
    </main>
  );
}

export function OutputPanel({
  session,
  tab,
  setTab,
  mode,
  artifact,
  setArtifactId,
  artifactUrl,
  ended,
  cleanup,
  source,
  running,
  elapsed,
  last,
  maxScreenshots,
  model,
  activity,
}: {
  session?: SessionView;
  tab: string;
  setTab(value: string): void;
  mode: ArenaMode;
  artifact?: SessionView["artifacts"][number];
  setArtifactId(value: string): void;
  artifactUrl?: string;
  ended: boolean;
  cleanup?: CleanupBrief;
  source: { url: string; text: string };
  running: boolean;
  elapsed: number;
  last?: SessionView["runs"][number];
  maxScreenshots: number;
  model: string;
  activity: ArenaEvent[];
  id?: string;
}) {
  return (
    <section className="output">
      <div className="output-toolbar">
        <div className="tabs">
          {["preview", "source", "reviews"].map((name) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(name)}
              disabled={name === "source" && mode === "cube"}
            >
              {name}
              {name === "reviews" &&
                Boolean(session?.reviews.length) &&
                ` (${session?.reviews.length})`}
            </button>
          ))}
        </div>
        <div className="artifact-actions">
          {session && session.artifacts.length > 1 && (
            <select
              aria-label="Select artifact"
              value={artifact?.id}
              onChange={(e) => setArtifactId(e.target.value)}
            >
              {session.artifacts.map((a, i) => (
                <option value={a.id} key={a.id}>
                  Version {i + 1}
                </option>
              ))}
            </select>
          )}
          {artifactUrl && (
            <a href={artifactUrl + "?download=1"} download>
              Download ↓
            </a>
          )}
        </div>
      </div>
      <div
        className={`preview-stage ${artifact || session?.cube ? "has-output" : ""}`}
      >
        {ended ? (
          <div className="end-card">
            <span className="eyebrow">WORKSPACE CLOSED</span>
            <h2>All wrapped up.</h2>
            {cleanup ? (
              <>
                <p>{cleanup.filesDeleted} temporary files deleted.</p>
                <p>
                  Preview server{" "}
                  {cleanup.previewStopped ? "stopped" : "could not stop"} · Cube
                  server {cleanup.serverStopped ? "stopped" : "could not stop"}{" "}
                  · Browser{" "}
                  {cleanup.browserClosed ? "closed" : "could not close"}
                </p>
                <p>
                  {cleanup.modelCalls} model calls · {cleanup.toolCalls} tool
                  calls · {cleanup.tokens?.toLocaleString() ?? "Unavailable"}{" "}
                  tokens
                </p>
                {cleanup.errors.map((e) => (
                  <p className="error-message" key={e}>
                    {e}
                  </p>
                ))}
              </>
            ) : (
              <p>This session has expired. Create a new one to continue.</p>
            )}
          </div>
        ) : tab === "source" ? (
          <pre className="source-code">
            {artifact
              ? source.url === artifactUrl
                ? source.text
                : "Loading source…"
              : "Your generated source will appear here."}
          </pre>
        ) : tab === "reviews" ? (
          <div className="review-gallery">
            {session?.reviews.length ? (
              session.reviews.map((image, i) => (
                <figure key={image.id}>
                  <Image
                    unoptimized
                    width={1280}
                    height={720}
                    src={`data:image/png;base64,${image.data}`}
                    alt={`Agent visual review ${i + 1}`}
                  />
                  <figcaption>
                    REVIEW {String(i + 1).padStart(2, "0")} / {image.tool}
                  </figcaption>
                </figure>
              ))
            ) : (
              <div className="empty-reviews">
                <h2>A second look.</h2>
                <p>Agent screenshots and visual reviews will appear here.</p>
              </div>
            )}
          </div>
        ) : session?.cube ? (
          <>
            <CubeFrame session={session} />
            <div className="cube-stats">
              <span>
                {session.cubeStarted
                  ? session.cube.cube.solved
                    ? "SOLVED"
                    : running
                      ? "AGENT IS SOLVING"
                      : "ATTEMPT ENDED"
                  : "READY WHEN YOU ARE"}
              </span>
              <span>
                {Math.max(
                  0,
                  session.cube.cube.moveHistory.length -
                    session.initialCubeMoves,
                )}{" "}
                AGENT MOVES
              </span>
            </div>
            <div className="cube-timeline" aria-label="Move timeline">
              {session.cube.cube.moveHistory
                .slice(session.initialCubeMoves)
                .map((move, index) => (
                  <span key={index}>{move}</span>
                ))}
            </div>
          </>
        ) : artifactUrl ? (
          <iframe
            key={artifactUrl}
            title="Generated artifact preview"
            sandbox="allow-scripts"
            src={artifactUrl}
          />
        ) : (
          <div className="empty-stage">
            <Artwork mode={mode} />
            <span className="eyebrow">
              {running ? "YOUR MODEL IS AT WORK" : "A SPACE FOR YOUR NEXT IDEA"}
            </span>
            <h2>
              {running
                ? "Making something yours."
                : "Start with a little curiosity."}
            </h2>
            <p>
              {running
                ? "Follow the agent’s progress below. Your preview will appear here."
                : "Choose a model, describe an idea, and see what happens."}
            </p>
            <span className={`stage-cross ${running ? "pulse" : ""}`}>+</span>
          </div>
        )}
      </div>
      <div className="telemetry">
        <span className="telemetry-status">
          <span className={running ? "live-dot pulse" : "live-dot muted"} />
          {running ? "RUNNING" : (last?.status.toUpperCase() ?? "STANDING BY")}
        </span>
        <span>{elapsed}s</span>
        <span>{last?.modelCalls ?? 0} calls</span>
        <span>{last?.toolCalls ?? 0} tools</span>
        <span>
          {last?.screenshots ?? 0}/{maxScreenshots} reviews
        </span>
        <span>{last?.usage?.total.toLocaleString() ?? "—"} tokens</span>
      </div>
      <section className="activity">
        <div className="activity-heading">
          <span>AGENT ACTIVITY</span>
          <span>{session ? model : "WAITING FOR YOUR FIRST PROMPT"}</span>
        </div>
        {last?.error && (
          <p role="alert" className="error-message">
            {last.error}
          </p>
        )}
        {session?.runs
          .filter((r) => r.response)
          .map((r) => (
            <div className="agent-response" key={r.id}>
              <span className="response-icon">✳</span>
              <p>{r.response}</p>
            </div>
          ))}
        <div className="event-list">
          {activity.slice(-15).map((event) => (
            <details key={event.sequence}>
              <summary>
                <span className="event-time">
                  {new Date(event.time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                {event.type === "assistant.message"
                  ? String(event.data.text || "Choosing the next action")
                  : event.type === "tool.started"
                    ? `Using ${event.data.tool}`
                    : event.type === "review.captured"
                      ? "Visual review captured"
                      : event.type === "run.finished"
                        ? `Run ${event.data.status}`
                        : "Tool result received"}
                <span>+</span>
              </summary>
              <pre>{JSON.stringify(event.data, null, 2)}</pre>
            </details>
          ))}
          {!activity.length && (
            <p className="activity-empty">
              The process is part of the picture. You’ll see it here.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

export function Launcher({compare = false, onCompare = () => {}}: {compare?: boolean; onCompare?: (value: boolean) => void}) { return (
      <main className="landing">
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-icon">✳</span> CODE ARENA
          </Link>
          <span className="header-note">
            AN OPEN PLAYGROUND FOR INTELLIGENCE
          </span>
          <span className="edition">
            VOL. 001 <span className="live-dot" />
            <AuthControl />
          </span>
        </header>
        <div className="intro-line">
          <span>ONE PROMPT. FOUR POSSIBILITIES.</span>
          <RunToggle compare={compare} onChange={onCompare} />
        </div>
        <div className="quadrants">
          {(Object.entries(modes) as [ArenaMode, typeof modes.svg][]).map(
            ([key, item]) => (
              <Link
                className={`quadrant mode-${key}`}
                key={key}
                href={`/arena/${key}${compare ? "?compare=1" : ""}`}
              >
                <div className="quadrant-top">
                  <span>
                    {item.number} / {item.label}
                  </span>
                  <span className="circle-arrow">
                    <Arrow />
                  </span>
                </div>
                <Artwork mode={key} />
                <div className="quadrant-copy">
                  <h1>
                    {item.name}
                    {key === "html" && <small>with HTML</small>}
                  </h1>
                  <p>{item.description}</p>
                </div>
                <span className="enter-label">
                  ENTER WORKSPACE <Arrow />
                </span>
              </Link>
            ),
          )}
        </div>
        <footer className="landing-footer">
          <span>IDEAS IN. POSSIBILITIES OUT.</span>
          <span>POWERED BY YOUR MODEL OF CHOICE</span>
        </footer>
      </main>
); }
