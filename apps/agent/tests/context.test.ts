import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from '../src/context/context.js';
import { MemoryManager } from '../src/memory/memory.js';
import { Telemetry } from '../src/middleware/telemetry.js';
import type { ModelClient, Model, Session } from '../src/types.js';
const signal = () => new AbortController().signal;
const telemetry = () => new Telemetry(() => {});
function client(models: Model[]): ModelClient {
  return { models: async () => models, generate: async () => { throw Error('Unexpected generation'); } };
}
for (const [id, window] of [['openai/gpt-6-astra', 1_050_000], ['anthropic/claude-fable-5.2', 1_000_000]] as const) {
  test(id + ' uses its advertised window and supports 128k output', async () => {
    const context = new ContextManager(client([{id, contextLength:window, maxOutput:128_000}]),telemetry());
    const budget = await context.budget(id,signal());
    assert.equal(budget.window,window); assert.equal(budget.output,128_000);
    assert.equal(budget.input,Math.floor(window*.95)-128_000);
    assert.ok(budget.input + budget.output < window);
  });
}
test('budgets respect smaller models, unknown metadata and application ceiling', async () => {
  for (const [window,maxOutput,output] of [[8000,2000,2000],[100000,4096,4096],[1000000,300000,128000],[1000000,undefined,8192],[8000,1,1]] as const) {
    const context = new ContextManager(client([{id:'test',contextLength:window,maxOutput}]),telemetry());
    assert.equal((await context.budget('test',signal())).output,output);
  }
  for (const bad of [undefined, NaN, Infinity, -1, 0, 1.5]) {
    const context = new ContextManager(client([{id:'test',contextLength:bad,maxOutput:bad}]),telemetry());
    const budget=await context.budget('test',signal());assert.equal(budget.window,32768);assert.equal(budget.output,8192);
  }
});
test('metadata refreshes and transient failures do not become permanent limits', async () => {
  let now=0,calls=0,window=1_000_000,fail=true;
  const provider:ModelClient={...client([]),models:async()=>{calls++;if(fail)throw Error('offline');return [{id:'test',contextLength:window,maxOutput:128000}];}};
  const context=new ContextManager(provider,telemetry(),undefined,()=>now);
  assert.equal((await context.budget('test',signal())).window,32768);
  fail=false;assert.equal((await context.budget('test',signal())).window,1_000_000);
  window=100_000;await context.budget('test',signal());assert.equal(calls,2);
  now=300001;assert.equal((await context.budget('test',signal())).window,100_000);
  const abort=new AbortController();abort.abort();await assert.rejects(context.budget('test',abort.signal));
});
test('large escaped Unicode histories compact within every request budget and retain originals',async()=>{
  const provider=client([{id:'test',contextLength:4000,maxOutput:1000}]);
  let summaries=0;
  const context=new ContextManager(provider,telemetry());
  provider.generate=async input=>{
    summaries++;assert.ok(context.estimate(input.messages)+input.maxTokens<=Math.floor(4000*.95));
    return {text:'summary',finishReason:'stop'};
  };
  const original='\n"\\\u{1f600}'.repeat(3000);
  const session:Session={version:1,id:'test',model:'test',system:'system',summary:'',covered:0,turns:[{id:'old',prompt:'large code',status:'completed',response:{text:original,finishReason:'stop'}}]};
  const budget=await context.budget('test',signal());
  const messages=await new MemoryManager(provider,context,telemetry()).prepare(session,'continue',budget,signal(),'run');
  assert.ok(summaries>1);assert.ok(context.estimate(messages)<=budget.input);
  assert.equal(session.turns[0]!.response!.text,original);assert.equal(session.covered,1);
});
