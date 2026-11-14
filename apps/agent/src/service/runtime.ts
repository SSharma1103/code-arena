import { RUN_TIMEOUT_MS } from "../limits.js";
import { exportInstructions } from "../video/document.js";
import { chromium, type BrowserType } from "playwright";
import type { ArenaMode, CubeState } from "@code-arena/contracts";
import type { AgentTool, Message, ModelClient, ToolResult } from "../types.js";
import { Agent } from "../agent/agent.js";
import { SessionManager } from "../session/session.js";
import { ContextManager } from "../context/context.js";
import { MemoryManager } from "../memory/memory.js";
import { Telemetry } from "../middleware/telemetry.js";
import { write_file } from "../tools/write_file.js";
import { ReviewPreviewTool } from "../tools/review-preview.js";
import { LocalRunPreviewServer } from "../tools/preview-server.js";
import {
  McpCubeConnection,
  RubiksCubeRuntime,
  cubeTools,
  type CubeConnection,
  type CubePresenter,
} from "../tools/rubiks-cube.js";
import { CubeReviewTool } from "../tools/cube-review.js";
import { ReviewBudget } from "./review-budget.js";

export const modeInstructions: Record<ArenaMode, string> = {
  svg: "Generate SVG artwork. You MUST use write_file with format svg. Use review_preview to inspect and improve it within the screenshot allowance.",
  "3js":
    "Generate a complete HTML page containing a Three.js object or scene. You MUST use write_file with format 3js. Import Three.js from /runtime/three.module.js; it is bundled locally. Avoid other external dependencies. Review with review_preview.",
  html: "Generate a complete HTML experience using write_file with format html. The default challenge is a ball bouncing inside a rotating hexagon, but follow the user if they request another HTML experience. Use inline scripts/styles. If needed, import Three.js from /runtime/three.module.js. Review with review_preview.",
  cube: "Use the Rubiks cube tools. Initially launch exactly one cube and wait for the user to press Start solving. Save the user instructions for solving. On subsequent solve requests inspect the existing game and choose each move yourself. Never create a replacement game during solving. Use rubiks_review_cube for optional visual inspection. Call finish only when solved.",
};
for (const mode of ["svg", "html", "3js"] as const) modeInstructions[mode] += exportInstructions;
export type RuntimeOptions = {
  client: ModelClient;
  sessions: SessionManager;
  telemetry: Telemetry;
  mode?: ArenaMode;
  maxScreenshots?: number;
  presenter?: CubePresenter;
  connection?: CubeConnection;
  browser?: Pick<BrowserType, "launch">;
  changed?: () => void;
  observe?: (message: Message) => void;
  capture?: (result: ToolResult, tool: string) => void;
  cubeState?: () => CubeState | undefined;
};
/** Both transports compose the same agent and resource owners. */
export function createRuntime(options: RuntimeOptions) {
  const { client, sessions, telemetry } = options,
    browser = options.browser ?? chromium;
  const context = new ContextManager(client, telemetry),
    memory = new MemoryManager(client, context, telemetry),
    artifacts = new write_file();
  const cube = new RubiksCubeRuntime(
    options.connection ?? new McpCubeConnection(),
    browser,
    telemetry,
    options.changed,
    options.presenter,
  );
  const budget = new ReviewBudget(options.maxScreenshots ?? 10);
  const review = new ReviewPreviewTool(
    browser,
    new LocalRunPreviewServer(artifacts),
  );
  let tools: AgentTool[];
  if (options.mode === "cube")
    tools = [
      ...cubeTools(cube),
      budget.wrap(
        new CubeReviewTool(options.cubeState ?? (() => undefined), browser),
        (r) => options.capture?.(r, "rubiks_review_cube"),
      ),
    ];
  else {
    const writer: AgentTool = {
      definition: {
        ...artifacts.definition,
        parameters: {
          ...artifacts.definition.parameters,
          properties: {
            ...artifacts.definition.parameters.properties,
            format: {
              type: "string",
              enum: options.mode ? [options.mode] : ["svg", "html", "3js"],
            },
          },
        },
      },
      execute: async (args, ctx) => {
        if (
          options.mode &&
          (!args ||
            typeof args !== "object" ||
            (args as Record<string, unknown>).format !== options.mode)
        )
          throw Error("Wrong format for this arena mode");
        const result = await artifacts.execute(args, ctx);
        options.changed?.();
        return result;
      },
    };
    tools = [
      writer,
      options.mode
        ? budget.wrap(review, (r) => options.capture?.(r, "review_preview"))
        : review,
    ];
    if (!options.mode) tools.push(...cubeTools(cube));
  }
  const policies = Object.fromEntries(
    cubeTools(cube).map((t) => [
      t.definition.name,
      { timeoutMs: 300_000, modelCalls: 64, toolCalls: 128 },
    ]),
  );
  const agent = new Agent(
    client,
    sessions,
    context,
    memory,
    telemetry,
    RUN_TIMEOUT_MS,
    tools,
    policies,
    options.observe,
  );
  return { agent, artifacts, cube, budget };
}
