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
