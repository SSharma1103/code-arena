import { RUN_TIMEOUT_MS } from '../limits.js';
import { OpenRouter } from '@openrouter/sdk';
import type { ModelClient, Model } from '../types.js';
export class OpenRouterClient implements ModelClient {
  private sdk: Pick<OpenRouter, 'models' | 'chat'>;
  // An explicit empty key prevents the SDK from reading OPENROUTER_API_KEY for catalogue requests.
  constructor(private apiKey?: string, sdk?: Pick<OpenRouter, 'models' | 'chat'>) { this.sdk = sdk ?? new OpenRouter({apiKey: apiKey ?? "",appTitle:'Code Arena',retryConfig:{strategy:'none'}}); }
  async probe(model: string, signal: AbortSignal): Promise<void> {
    if (!this.apiKey?.trim()) throw new Error('Enter your OpenRouter API key.');
    const result = await this.sdk.chat.send({chatRequest:{model,messages:[{role:'user',content:'Reply OK.'}],maxCompletionTokens:16,stream:false}}, {signal,timeoutMs:20_000,retries:{strategy:'none'}});
    if (!result.choices[0] || String(result.choices[0].finishReason) === 'error') throw new Error('Model unavailable');
  }
  async models(signal?: AbortSignal): Promise<Model[]> {
    const pages = await this.sdk.models.list({sort:'most-popular',outputModalities:'text'}, {signal,timeoutMs:30_000,retries:{strategy:'none'}});
    const models: Model[] = [];
    for await (const page of pages) for (const m of page.result.data) {
      const windows = [m.contextLength, m.topProvider.contextLength].filter(
        (n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 4,
      );
      if (m.architecture.outputModalities.includes('text')) models.push({
        id: m.id,
        name: m.name,
        contextLength: windows.length ? Math.min(...windows) : undefined,
        maxOutput: m.topProvider.maxCompletionTokens ?? undefined,
        supportsTools: m.supportedParameters.includes('tools'),
      });
    }
    return models;
  }
  async generate(input: Parameters<ModelClient['generate']>[0]) {
    if (!this.apiKey?.trim()) throw new Error('Enter your OpenRouter API key.');
    const result = await this.sdk.chat.send({chatRequest:{model:input.model,messages:input.messages.map(m => m.role === 'tool' ? {role:'tool' as const, content:m.content, toolCallId:m.toolCallId!} : m.role === 'assistant' ? {role:'assistant' as const,content:m.content,toolCalls:m.toolCalls?.map(t=>({id:t.id,type:'function' as const,function:{name:t.name,arguments:t.arguments}}))} : m.role==='user' ? {role:'user' as const,content:m.images?.length ? [{type:'text' as const,text:m.content},...m.images.map(image=>({type:'image_url' as const,imageUrl:{url:`data:${image.mimeType};base64,${image.data}`}}))] : m.content} : {role:m.role,content:m.content}),tools:input.tools?.map(t=>({type:'function' as const,function:t})),maxCompletionTokens:input.maxTokens,stream:false}}, {signal:input.signal,timeoutMs:RUN_TIMEOUT_MS,retries:{strategy:'none'}});
    const choice = result.choices[0];
    if (choice?.finishReason === 'length') throw new Error('Model reached its output limit before completing the response.');
    if (!choice || (!choice.message.content && !choice.message.toolCalls?.length)) throw new Error('Provider returned no text');
    return {text:typeof choice.message.content === 'string' ? choice.message.content : '',toolCalls:choice.message.toolCalls?.map(t=>({id:t.id,name:t.function.name,arguments:t.function.arguments})),finishReason:String(choice.finishReason),usage:result.usage ? {input:result.usage.promptTokens,output:result.usage.completionTokens,total:result.usage.totalTokens} : undefined};
  }
}
