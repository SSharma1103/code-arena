import type { BrowserType } from "playwright";
import type { CubeState } from "@code-arena/contracts";
import type { AgentTool, ToolContext } from "../types.js";
import { cubeDocument } from "./cube-renderer.js";
import { LocalRunPreviewServer } from "./preview-server.js";
import { ReviewPreviewTool } from "./review-preview.js";

export class CubeReviewTool implements AgentTool {
  readonly definition = {
    name: "rubiks_review_cube",
    description:
      "Inspect the current cube visually. Returns a screenshot and diagnostics; consumes one screenshot allowance.",
    parameters: {
      type: "object",
      properties: {
        captureAfterMs: { type: "integer", minimum: 0, maximum: 5000 },
      },
      required: ["captureAfterMs"],
      additionalProperties: false,
    },
  };
  constructor(
    private state: () => CubeState | undefined,
    private browser: Pick<BrowserType, "launch">,
  ) {}
  async execute(args: unknown, context: ToolContext) {
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).some((k) => k !== "captureAfterMs")
    )
      throw Error("Expected captureAfterMs");
    const state = this.state();
    if (!state) throw Error("Launch the cube first");
    const source = {
      readPreviewFile: async (entry: string) => {
        if (entry !== "cube.html") throw Error("Unknown file");
        return { content: cubeDocument(state), contentType: "text/html" };
      },
    };
    return new ReviewPreviewTool(
      this.browser,
      new LocalRunPreviewServer(source),
    ).execute(
      {
        entryFile: "cube.html",
        captureAfterMs: (args as Record<string, unknown>).captureAfterMs,
      },
      context,
    );
  }
}
