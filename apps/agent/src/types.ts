export type ToolCall = { id: string; name: string; arguments: string };
export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolContext = {sessionId: string; runId?: string; signal: AbortSignal};
export type ToolImage = {type: 'image'; mimeType: 'image/png'; data: string};
export type ToolResult = {metadata: Record<string, unknown>; content: ToolImage[]};
export interface AgentTool { definition: ToolDefinition; execute(args: unknown, context: ToolContext): Promise<unknown> }
export type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; images?: ToolImage[]; toolCalls?: ToolCall[]; toolCallId?: string };
export type Model = import('@code-arena/contracts').ModelOption;
export type Completion = { text: string; toolCalls?: ToolCall[]; finishReason: string; usage?: { input: number; output: number; total: number } };
export interface ModelClient {
  models(signal?: AbortSignal): Promise<Model[]>;
  generate(input: { model: string; messages: Message[]; maxTokens: number; signal: AbortSignal; tools?: ToolDefinition[] }): Promise<Completion>;
}
export type Turn = { id: string; prompt: string; status: 'running' | 'completed' | 'failed'; response?: Completion; messages?: Message[]; metrics?: {durationMs:number; modelCalls:number; toolCalls:number}; error?: string };
export type Session = { version: 1; id: string; model: string; system: string; summary: string; covered: number; turns: Turn[] };
