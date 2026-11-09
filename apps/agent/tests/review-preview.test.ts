import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserType } from 'playwright';
import { ReviewPreviewTool } from '../src/tools/review-preview.js';
import { LocalRunPreviewServer } from '../src/tools/preview-server.js';
import { write_file } from '../src/tools/write_file.js';
import { Agent } from '../src/agent/agent.js';
import { SessionManager, FileSessionStore } from '../src/session/session.js';
import { ContextManager } from '../src/context/context.js';
import { MemoryManager } from '../src/memory/memory.js';
import { Telemetry } from '../src/middleware/telemetry.js';
import type { ModelClient, ToolContext } from '../src/types.js';

const context:ToolContext={sessionId:'session',runId:'run',signal:new AbortController().signal};

test('review validates arguments before opening a browser or server',async()=>{
  const tool=new ReviewPreviewTool({launch:async()=>{throw new Error('must not launch');}}, {start:async()=>{throw new Error('must not start');}});
  for(const entryFile of ['../x','/x','C:/x','a\\b','a/../b','%2e%2e/x','file:///x','a?x','a#x','a\0']) await assert.rejects(tool.execute({entryFile,captureAfterMs:0},context),/relative/);
  for(const captureAfterMs of [-1,5001,NaN,1.2,'100']) await assert.rejects(tool.execute({entryFile:'a.html',captureAfterMs},context),/integer/);
  await assert.rejects(tool.execute({entryFile:'a.html',captureAfterMs:0},{...context,runId:undefined}),/run/);
});

test('run preview rejects foreign artifacts and closes its listener',async t=>{
  const files=new write_file();t.after(()=>files.close());
  const artifact=await files.execute({format:'html',content:'<h1>private</h1>'},context);
  const previews=new LocalRunPreviewServer(files);
  await assert.rejects(previews.start(artifact.entryFile,{...context,runId:'other'}),/current run/);
  await assert.rejects(previews.start(artifact.entryFile,{...context,sessionId:'other'}),/current run/);
  const server=await previews.start(artifact.entryFile,context);
  try {
    assert.equal(await (await fetch(server.url)).text(),'<h1>private</h1>');
    assert.equal((await fetch(new URL('/AGENTS.md',server.url))).status,404);
    assert.equal((await fetch(new URL('/a%2fb',server.url))).status,404);
  } finally {await server.close();}
  await assert.rejects(fetch(server.url));
});

test('review closes context, browser and server on capture failure and cancellation',async()=>{
  for(const cancel of [false,true]){
    const events:string[]=[];const controller=new AbortController();
    const page={goto:async()=>{},waitForTimeout:async()=>{},screenshot:async()=>{if(cancel){controller.abort();await new Promise(r=>setTimeout(r,30));}throw new Error('capture failed');}};
    const browserContext={close:async()=>{events.push('context');},setDefaultTimeout:()=>{},setDefaultNavigationTimeout:()=>{},route:async()=>{},routeWebSocket:async()=>{},on:()=>{},newPage:async()=>page};
    const browser={newContext:async()=>browserContext,close:async()=>{events.push('browser');}};
    const launcher={launch:async()=>browser} as unknown as Pick<BrowserType,'launch'>;
    const tool=new ReviewPreviewTool(launcher,{start:async()=>({url:'http://127.0.0.1:1234/test.html',close:async()=>{events.push('server');}})});
    await assert.rejects(tool.execute({entryFile:'test.html',captureAfterMs:0},{...context,signal:controller.signal}));
    assert.deepEqual(events,['context','browser','server']);
  }
});

test('cancellation disposes a browser that finishes launching late',async()=>{
  const events:string[]=[];const controller=new AbortController();
  const tool=new ReviewPreviewTool({launch:async()=>{controller.abort();await new Promise(r=>setTimeout(r,20));return {close:async()=>{events.push('browser');}} as never;}},{start:async()=>({url:'http://127.0.0.1:1234/a.html',close:async()=>{events.push('server');}})});
  await assert.rejects(tool.execute({entryFile:'a.html',captureAfterMs:0},{...context,signal:controller.signal}));
  await new Promise(r=>setTimeout(r,40));assert.deepEqual(events,['server','browser']);
});

test('agent returns tool metadata with original IDs and screenshot image messages after all results',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'arena-review-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
  const client:ModelClient={models:async()=>[{id:'test',contextLength:100000}],generate:async input=>{
    if(++calls===1)return {text:'',finishReason:'tool_calls',toolCalls:[{id:'review-id',name:'review_preview',arguments:'{}'},{id:'second-id',name:'review_preview',arguments:'{}'}]};
    const results=input.messages.filter(m=>m.role==='tool');assert.deepEqual(results.map(m=>m.toolCallId),['review-id','second-id']);
    assert.equal(results[0]!.content,'{"ok":true}');
    const images=input.messages.filter(m=>m.images?.length);assert.equal(images.length,2);assert.match(images[0]!.content,/review-id/);assert.equal(images[0]!.images![0]!.data,'cG5n');
    assert.ok(input.messages.indexOf(images[0]!)>input.messages.indexOf(results[1]!));
    return {text:'Reviewed',finishReason:'stop'};
  }};
  const telemetry=new Telemetry(()=>{});const sessions=new SessionManager(new FileSessionStore(dir));const budget=new ContextManager(client,telemetry);
  const tool={definition:{name:'review_preview',description:'test',parameters:{}},execute:async(_:unknown,ctx:ToolContext)=>{assert.ok(ctx.runId);return {metadata:{ok:true},content:[{type:'image' as const,mimeType:'image/png' as const,data:'cG5n'}]};}};
  const agent=new Agent(client,sessions,budget,new MemoryManager(client,budget,telemetry),telemetry,120000,[tool]);
  const session=await sessions.create('test');assert.equal((await agent.run({sessionId:session.id,prompt:'review'})).text,'Reviewed');
});

test('Chromium captures screenshot and diagnostics, denies external navigation, and cleans up', {skip:!existsSync(chromium.executablePath())?'Run npx playwright install chromium':false},async t=>{
  let externalHits=0;
  const external=createServer((_req,res)=>{externalHits++;res.end('external');});
  await new Promise<void>(resolve=>external.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>{external.close(()=>resolve());external.closeAllConnections();}));
  const externalURL=`http://127.0.0.1:${(external.address() as {port:number}).port}/blocked`;
  const files=new write_file();t.after(()=>files.close());
  const artifact=await files.execute({format:'html',content:`<!doctype html><h1>Review fixture</h1><img src='/missing.html'><script>
    console.error('fixture console error');
    setTimeout(()=>{throw new Error('fixture uncaught error');},10);
    fetch('/missing.html').catch(()=>{});
    setTimeout(()=>{location.href='${externalURL}';},100);
  </script>`},context);
  let url='';let closed=false;
  const source=new LocalRunPreviewServer(files);
  const tool=new ReviewPreviewTool(chromium,{start:async(...args)=>{const preview=await source.start(...args);url=preview.url;return {...preview,close:async()=>{await preview.close();closed=true;}};}});
  const result=await tool.execute({entryFile:artifact.entryFile,captureAfterMs:300},context);
  assert.equal(result.content[0]?.mimeType,'image/png');assert.equal(Buffer.from(result.content[0]!.data,'base64').subarray(1,4).toString(),'PNG');
  assert.match(JSON.stringify(result.metadata.consoleErrors),/fixture console error/);
  assert.match(JSON.stringify(result.metadata.javascriptErrors),/fixture uncaught error/);
  assert.match(JSON.stringify(result.metadata.httpErrors),/404/);
  assert.ok((result.metadata.blockedRequests as string[]).includes(externalURL));assert.equal(externalHits,0);
  assert.match(JSON.stringify(result.metadata.failedRequests),/blocked/);
  assert.equal(closed,true);await assert.rejects(fetch(url));
});

test('OpenRouter serializes screenshot image content and retains tool-call IDs on the wire',async t=>{
  const { OpenRouterClient }=await import('../src/client/openrouter.js');
  let payload:Record<string,any>|undefined;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
    assert.ok(input instanceof Request);
    payload=await input.json();
    throw new Error('Test stops before network access');
  });
  const client=new OpenRouterClient('test-key');
  await assert.rejects(client.generate({model:'test',maxTokens:100,signal:context.signal,messages:[
    {role:'assistant',content:'',toolCalls:[{id:'capture-id',name:'review_preview',arguments:'{}'}]},
    {role:'tool',toolCallId:'capture-id',content:'{"ok":true}'},
    {role:'user',content:'Screenshot from tool call capture-id',images:[{type:'image',mimeType:'image/png',data:'cG5n'}]},
  ]}));
  assert.ok(payload);
  assert.equal(payload.messages[0].tool_calls[0].id,'capture-id');
  assert.equal(payload.messages[1].tool_call_id,'capture-id');
  assert.deepEqual(payload.messages[2].content[1],{type:'image_url',image_url:{url:'data:image/png;base64,cG5n'}});
});
