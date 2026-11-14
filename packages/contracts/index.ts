export type ArenaMode = "svg" | "3js" | "html" | "cube";
/** Generated pages own their scene; the exporter owns the clock. */
export interface VideoExportTimeline {
  ready: boolean | Promise<void>;
  renderAt(timeSeconds: number): Promise<void>;
}
export type VideoExportSettings = { duration: 5 | 10 | 15; width: 1080; height: 1920; fps: 30; seed: number };
export type VideoExportJob = {
  id: string; sessionId: string; outputId: string; sourceVersion: string;
  settings: VideoExportSettings;
  status: "queued" | "rendering" | "encoding" | "completed" | "failed";
  progress: number; createdAt: string; updatedAt: string;
  failure?: { code: string; message: string }; result?: string;
};
/** Ordered by OpenRouter popularity when returned by the model catalogue API. */
export type ModelOption = {
  id: string;
  name?: string;
  contextLength?: number;
  maxOutput?: number;
  supportsTools?: boolean;
};
export type SessionSettings = {
  mode: ArenaMode;
  model: string;
  maxScreenshots: number;
};
export type CreateSession = SessionSettings & { openRouterApiKey: string };
export type CubeState = {
  gameId: string;
  cube: {
    faces: Record<string, string[][]>;
    solved: boolean;
    moveHistory: string[];
  };
  nextAction: string | null;
};
export type Artifact = { id: string; format: string; entryFile: string };
export type ReviewImage = { id: string; tool: string; data: string };
export type RunView = {
  id: string;
  prompt: string;
  status: "running" | "completed" | "failed" | "cancelled";
  response?: string;
  error?: string;
  durationMs?: number;
  modelCalls: number;
  toolCalls: number;
  screenshots: number;
  usage?: { input: number; output: number; total: number };
};
export type CleanupBrief = {
  filesDeleted: number;
  previewStopped: boolean;
  browserClosed: boolean;
  serverStopped: boolean;
  errors: string[];
  durationMs: number;
  modelCalls: number;
  toolCalls: number;
  tokens: number | null;
};
export type SessionView = SessionSettings & {
  credentialSource: "server" | "user";
  id: string;
  status: "ready" | "running" | "ended" | "expired";
  runs: RunView[];
  artifacts: Artifact[];
  reviews: ReviewImage[];
  cube?: CubeState;
  initialCubeMoves: number;
  cubeStarted: boolean;
  sequence: number;
  cleanup?: CleanupBrief;
};
export type ArenaEvent = {
  sequence: number;
  type: string;
  time: string;
  data: Record<string, unknown>;
};

export type ModelCheck = { model: string; openRouterApiKey: string };
export type ModelCheckResult = { model: string; status: "available" | "unavailable"; checkedAt: string; latencyMs: number; reason?: string };
