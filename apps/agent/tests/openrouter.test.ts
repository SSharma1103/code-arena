import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenRouter } from "@openrouter/sdk";
import { HTTPClient } from "@openrouter/sdk/lib/http.js";
import { OpenRouterClient } from "../src/client/openrouter.js";

function model(id: string, name: string, tools = true, output = "text") {
  return {
    id,
    name,
    canonical_slug: id,
    created: 1,
    context_length: 128000,
    default_parameters: null,
    per_request_limits: null,
    supported_voices: null,
    endpoints: ["/api/v1/chat/completions"],
    links: { details: `/api/v1/models/${id}/endpoints` },
    architecture: { input_modalities: ["text"], output_modalities: [output], modality: `text->${output}` },
    pricing: { prompt: "0.000001", completion: "0.000002" },
    top_provider: { is_moderated: false, max_completion_tokens: 8192 },
    supported_parameters: tools ? ["tools"] : [],
  };
}

test("OpenRouter catalogue requests popularity order and maps names and tool support", async () => {
  const requests: Request[] = [];
  const data = [
    model("z/most-used", "Most Used"),
    model("a/runner-up", "Runner Up", false),
    model("image/generator", "Image Generator", false, "image"),
  ];
  const sdk = new OpenRouter({
    apiKey: "test-key",
    httpClient: new HTTPClient({ fetcher: async (request) => {
      requests.push(request as Request);
      return Response.json({ data, total_count: data.length, links: { next: null } });
    } }),
  });
  const models = await new OpenRouterClient("test-key", sdk).models();
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]!.url);
  assert.equal(url.origin, "https://openrouter.ai");
  assert.equal(url.pathname, "/api/v1/models");
  assert.equal(url.searchParams.get("sort"), "most-popular");
  assert.equal(url.searchParams.get("output_modalities"), "text");
  assert.deepEqual(models, [
    { id: "z/most-used", name: "Most Used", contextLength: 128000, maxOutput: 8192, supportsTools: true },
    { id: "a/runner-up", name: "Runner Up", contextLength: 128000, maxOutput: 8192, supportsTools: false },
  ]);
});

test("OpenRouter catalogue propagates provider failures without retrying or inventing models", async () => {
  let calls = 0;
  const sdk = new OpenRouter({
    apiKey: "test-key",
    httpClient: new HTTPClient({ fetcher: async () => {
      calls++;
      return Response.json({ error: { code: 503, message: "Unavailable" } }, { status: 503 });
    } }),
  });
  await assert.rejects(new OpenRouterClient("test-key", sdk).models());
  assert.equal(calls, 1);
});

test('availability probe is bounded and accepts token-limited empty text', async () => {
 let sent: Record<string, unknown> = {};
 const sdk = new OpenRouter({apiKey:'test-key',httpClient:new HTTPClient({fetcher:async(request)=>{
 sent=await (request as Request).json();
 return Response.json({system_fingerprint:null,id:'probe',object:'chat.completion',created:1,model:'test/model',choices:[{index:0,finish_reason:'length',message:{role:'assistant',content:''}}]});
 }})});
 await new OpenRouterClient('test-key',sdk).probe('test/model',new AbortController().signal);
 assert.equal(sent.max_completion_tokens,16);assert.equal(sent.model,'test/model');assert.equal(sent.stream,false);assert.equal(sent.tools,undefined);
});

 test('keyless clients cannot generate or probe even when an environment key exists',async()=>{
 const previous=process.env.OPENROUTER_API_KEY;
 process.env.OPENROUTER_API_KEY='must-not-be-used';
 try {
 const client=new OpenRouterClient();
 await assert.rejects(client.probe('test/model',new AbortController().signal),/Enter your/);
 await assert.rejects(client.generate({model:'test/model',messages:[],maxTokens:16,signal:new AbortController().signal}),/Enter your/);
 } finally { if(previous===undefined) delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous; }
 });

 test('public catalogue does not send the environment key',async()=>{
 const previous=process.env.OPENROUTER_API_KEY;const fetcher=globalThis.fetch;
 process.env.OPENROUTER_API_KEY='must-not-be-used';let calls=0;
 globalThis.fetch=async(input)=>{
 const request=input as Request;calls++;
 assert.ok(!request.headers.get('Authorization')?.includes('must-not-be-used'));
 return Response.json({data:[model('test/model','Test')],total_count:1,links:{next:null}});
 };
 try { assert.equal((await new OpenRouterClient().models()).length,1);assert.equal(calls,1); }
 finally {globalThis.fetch=fetcher;if(previous===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous;}
 });

 test('provider context ceiling overrides a larger model window',async()=>{
 const data=model('test/smaller','Smaller');
 const sdk=new OpenRouter({apiKey:'test-key',httpClient:new HTTPClient({fetcher:async()=>Response.json({data:[{...data,context_length:1050000,top_provider:{...data.top_provider,context_length:200000,max_completion_tokens:64000}}],total_count:1,links:{next:null}})})});
 const result=await new OpenRouterClient('test-key',sdk).models();
 assert.equal(result[0]!.contextLength,200000);assert.equal(result[0]!.maxOutput,64000);
 });
 test('generation sends the full completion budget and rejects truncated output',async()=>{
 let length=false;let calls=0;
 const sdk=new OpenRouter({apiKey:'test-key',httpClient:new HTTPClient({fetcher:async request=>{
 calls++;const sent=await(request as Request).json();assert.equal(sent.max_completion_tokens,128000);assert.equal(sent.max_tokens,undefined);
 return Response.json({system_fingerprint:null,id:'generation',object:'chat.completion',created:1,model:'test/model',choices:[{index:0,finish_reason:length?'length':'stop',message:{role:'assistant',content:'large code'.repeat(5000)}}]});
 }})});
 const provider=new OpenRouterClient('test-key',sdk);
 const request={model:'test/model',messages:[{role:'user' as const,content:'generate'}],maxTokens:128000,signal:new AbortController().signal};
 assert.equal((await provider.generate(request)).text.length,50000);
 length=true;await assert.rejects(provider.generate(request),/output limit/);assert.equal(calls,2);
 });
