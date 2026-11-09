import type { AgentTool, ToolContext, ToolResult } from "../types.js";

export class ReviewBudget {
  used = 0;
  constructor(readonly maximum: number) {}
  reset() {
    this.used = 0;
  }
  wrap(tool: AgentTool, onCapture: (result: ToolResult) => void): AgentTool {
    return {
      definition: tool.definition,
      execute: async (args: unknown, context: ToolContext) => {
        if (this.used >= this.maximum)
          return {
            metadata: {
              error:
                "Screenshot budget exhausted. Continue using existing observations and return your result.",
              screenshotsRemaining: 0,
            },
            content: [],
          };
        this.used++;
        const result = (await tool.execute(args, context)) as ToolResult;
        result.metadata.screenshotsRemaining = this.maximum - this.used;
        onCapture(result);
        return result;
      },
    };
  }
}
