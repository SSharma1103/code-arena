import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { write_file } from '../src/tools/write_file.js';
import { Agent } from '../src/agent/agent.js';
import { SessionManager, FileSessionStore } from '../src/session/session.js';
import { ContextManager } from '../src/context/context.js';
import { MemoryManager } from '../src/memory/memory.js';
import { Telemetry } from '../src/middleware/telemetry.js';
import type { ModelClient } from '../src/types.js';

test('artifact formats, isolated previews, limits and confirmed deletion',async t=>{
  const tool=new write_file();t.after(()=>tool.close());const context={sessionId:'session',signal:new AbortController().signal};
  for(const format of ['svg','html','3js']){
    const artifact=await tool.execute({format,content:'<svg>example</svg>'},context);
    const view=await fetch(artifact.url);assert.equal(view.status,200);assert.match(await view.text(),/sandbox="allow-scripts"/);
    const file=await fetch(artifact.url.replace('/view/','/file/'));assert.match(file.headers.get('content-security-policy')!,/sandbox allow-scripts/);assert.equal(await file.text(),'<svg>example</svg>');
    assert.equal((await fetch(new URL('/unknown',artifact.url))).status,404);
  }
  await assert.rejects(tool.execute({format:'html',content:'x'}, {...context,sessionId:'other'}),/mismatch/);
  await assert.rejects(tool.execute({format:'js',content:'x'},context));
  await assert.rejects(tool.execute({format:'html',content:'x'.repeat(2*1024*1024+1)},context),/limit/);
  const files=tool.artifacts;const result=await tool.close();assert.deepEqual(result,{filesDeleted:3,previewStopped:true,errors:[]});
  for(const file of files)await assert.rejects(access(file.path));
  await assert.rejects(fetch(files[0]!.url));await assert.rejects(tool.execute({format:'html',content:'x'},context),/closed/);
});

test('tool loop recovers from invalid calls, persists exchanges, and limits runaway models',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'arena-tools-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const tool=new write_file();t.after(()=>tool.close());let calls=0;let runaway=false;
  const client:ModelClient={models:async()=>[{id:'test',contextLength:100000}],generate:async input=>{
    calls++;assert.equal(input.tools?.[0]?.name,'write_file');
    if(calls===1)return {text:'',finishReason:'tool_calls',toolCalls:[{id:'invalid',name:'unknown',arguments:'{}'}]};
    if(calls===2 || runaway)return {text:'',finishReason:'tool_calls',toolCalls:[{id:String(calls),name:'write_file',arguments:JSON.stringify({format:'svg',content:'<svg></svg>'})}]};
    assert.ok(input.messages.some(m=>m.role==='tool' && m.content.includes('http://127.0.0.1')));
    return {text:'Created',finishReason:'stop',usage:{input:2,output:3,total:5}};
  }};
  const telemetry=new Telemetry(()=>{});const sessions=new SessionManager(new FileSessionStore(dir));const context=new ContextManager(client,telemetry);const agent=new Agent(client,sessions,context,new MemoryManager(client,context,telemetry),telemetry,120000,[tool]);
  const session=await sessions.create('test');const result=await agent.run({sessionId:session.id,prompt:'draw'});assert.equal(result.text,'Created');
  const saved=await sessions.store.load(session.id);assert.equal(saved.turns[0]?.metrics?.toolCalls,2);assert.equal(saved.turns[0]?.messages?.filter(m=>m.role==='tool').length,2);
  runaway=true;await assert.rejects(agent.run({sessionId:session.id,prompt:'loop'}),/Run failed/);assert.equal(calls,11);
  assert.equal((await sessions.store.load(session.id)).turns[1]?.status,'failed');
});

test('cube-specific policy extends the loop and preserves tool ids',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'arena-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const client:ModelClient={models:async()=>[{id:'test',contextLength:100000}],generate:async input=>{calls++;if(calls<10)return {text:'',finishReason:'tool_calls',toolCalls:[{id:`cube-${calls}`,name:'rubiks_start_cube',arguments:'{}'}]};assert.ok(input.messages.some(m=>m.toolCallId==='cube-9'));return {text:'done',finishReason:'stop'};}};
 const telemetry=new Telemetry(()=>{}),sessions=new SessionManager(new FileSessionStore(dir)),context=new ContextManager(client,telemetry);
 const tool={definition:{name:'rubiks_start_cube',description:'test',parameters:{}},execute:async()=>({ok:true})};
 const agent=new Agent(client,sessions,context,new MemoryManager(client,context,telemetry),telemetry,120000,[tool],{rubiks_start_cube:{timeoutMs:300000,modelCalls:64,toolCalls:128}});
 const session=await sessions.create('test');assert.equal((await agent.run({sessionId:session.id,prompt:'solve'})).text,'done');assert.equal(calls,10);
});

test('launching the cube returns immediately and waits for the Start button',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'arena-start-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const client:ModelClient={models:async()=>[{id:'test',contextLength:100000}],generate:async()=>{calls++;return {text:'',finishReason:'tool_calls',toolCalls:[{id:'launch',name:'rubiks_start_cube',arguments:'{}'}]};}};
 const telemetry=new Telemetry(()=>{}),sessions=new SessionManager(new FileSessionStore(dir)),context=new ContextManager(client,telemetry);
 const tool={definition:{name:'rubiks_start_cube',description:'test',parameters:{}},execute:async()=>({metadata:{awaitingStart:true},content:[]})};
 const agent=new Agent(client,sessions,context,new MemoryManager(client,context,telemetry),telemetry,120000,[tool]);
 const session=await sessions.create('test');assert.match((await agent.run({sessionId:session.id,prompt:'open cube'})).text,/Press Start/);assert.equal(calls,1);
 assert.equal((await sessions.store.load(session.id)).turns[0]?.messages?.find(m=>m.role==='tool')?.toolCallId,'launch');
});
