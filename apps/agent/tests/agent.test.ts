import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.js';
import { ContextManager } from '../src/context/context.js';
import { MemoryManager } from '../src/memory/memory.js';
import { FileSessionStore, SessionManager } from '../src/session/session.js';
import { Telemetry } from '../src/middleware/telemetry.js';
import type { ModelClient, Message } from '../src/types.js';
class Fake implements ModelClient {
  window = 4000; fail = false; calls: Message[][] = [];
  async models() { return [{id:'test/model',contextLength:this.window}]; }
  async generate(input: Parameters<ModelClient['generate']>[0]) { input.signal.throwIfAborted(); this.calls.push(input.messages); if(this.fail)throw new Error('secret provider body');return {text:input.messages[0]?.content.startsWith('Summarize')?'summary':'answer',finishReason:'stop',usage:{input:10,output:2,total:12}}; }
}
async function fixture(t: {after(fn:()=>Promise<void>):void}) {
  const dir=await mkdtemp(join(tmpdir(),'arena-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const client=new Fake();const events:Record<string,unknown>[]=[];const telemetry=new Telemetry(e=>events.push(e));const sessions=new SessionManager(new FileSessionStore(dir));const context=new ContextManager(client,telemetry);const memory=new MemoryManager(client,context,telemetry);const agent=new Agent(client,sessions,context,memory,telemetry);
  return {client,events,sessions,context,agent};
}
test('persists and resumes isolated sessions without leaking content to telemetry',async t=>{
  const f=await fixture(t);const a=await f.sessions.create('test/model');const b=await f.sessions.create('test/model');
  await f.agent.run({sessionId:a.id,prompt:'private prompt'});await f.agent.run({sessionId:a.id,prompt:'next'});
  assert.equal((await f.sessions.store.load(a.id)).turns.length,2);assert.equal((await f.sessions.store.load(b.id)).turns.length,0);
  assert.equal(f.client.calls[1].filter(m=>m.role==='assistant').length,1);assert.ok(!JSON.stringify(f.events).includes('private prompt'));
});
test('failure retains prompt, excludes failed history, and releases lock',async t=>{
  const f=await fixture(t);const s=await f.sessions.create('test/model');f.client.fail=true;
  await assert.rejects(f.agent.run({sessionId:s.id,prompt:'failed secret'}),/Run failed/);f.client.fail=false;
  await f.agent.run({sessionId:s.id,prompt:'retry'});const saved=await f.sessions.store.load(s.id);
  assert.equal(saved.turns[0].status,'failed');assert.ok(!JSON.stringify(f.client.calls.at(-1)).includes('failed secret'));assert.ok(!JSON.stringify(f.events).includes('secret provider'));
});
test('compacts older turns and preserves original transcript',async t=>{
  const f=await fixture(t);const s=await f.sessions.create('test/model');
  for(let i=0;i<8;i++)s.turns.push({id:String(i),prompt:'x'.repeat(350),status:'completed',response:{text:'original code'.repeat(10),finishReason:'stop'}});
  await f.sessions.store.save(s);await f.agent.run({sessionId:s.id,prompt:'continue'});
  const saved=await f.sessions.store.load(s.id);assert.ok(saved.covered>0);assert.equal(saved.summary,'summary');assert.equal(saved.turns[0].response?.text,s.turns[0].response?.text);assert.ok(f.events.some(e=>e.event==='context.compacted'));
});
test('summary failure leaves memory unchanged',async t=>{
  const f=await fixture(t);const s=await f.sessions.create('test/model');
  for(let i=0;i<8;i++)s.turns.push({id:String(i),prompt:'x'.repeat(500),status:'completed',response:{text:'code',finishReason:'stop'}});
  await f.sessions.store.save(s);f.client.fail=true;await assert.rejects(f.agent.run({sessionId:s.id,prompt:'continue'}));
  const saved=await f.sessions.store.load(s.id);assert.equal(saved.covered,0);assert.equal(saved.summary,'');assert.equal(saved.turns.length,9);
});
test('metadata fallback and output budget',async t=>{
  const f=await fixture(t);const b=await f.context.budget('missing',new AbortController().signal);assert.equal(b.window,273000);assert.equal(b.output,8192);assert.ok(f.events.some(e=>e.event==='context.fallback'));
});
test('rejects oversized input, cancellation, and concurrent locks',async t=>{
  const f=await fixture(t);const s=await f.sessions.create('test/model');
  await assert.rejects(f.agent.run({sessionId:s.id,prompt:'x'.repeat(5000)}));assert.equal(f.client.calls.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(f.agent.run({sessionId:s.id,prompt:'hello',signal:controller.signal}),/cancelled/);
  const release=await f.sessions.store.lock(s.id);await assert.rejects(f.agent.run({sessionId:s.id,prompt:'hello'}),/locked/);await release();
  const lease=await f.sessions.store.lock(s.id,'cli');await assert.rejects(f.sessions.store.lock(s.id,'cli'),/locked/);await lease();
  await assert.rejects(f.sessions.store.load('../bad'),/Invalid session/);
});
test('telemetry sink errors are isolated',async()=>{assert.equal(await new Telemetry(()=>{throw new Error();}).measure('test',{},async()=>42),42);});
