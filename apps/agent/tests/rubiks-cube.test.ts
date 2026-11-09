import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {McpCubeConnection,RubiksCubeRuntime,cubeTools,type CubeConnection} from '../src/tools/rubiks-cube.js';
import {Telemetry} from '../src/middleware/telemetry.js';
const ctx={sessionId:'test',runId:'run',signal:AbortSignal.timeout(30_000)};
test('cube validates before starting and cleanup is idempotent',async()=>{
 let starts=0,closed=0;
 const connection:CubeConnection={start:async()=>{starts++;return 'http://127.0.0.1:1234';},call:async()=>{throw Error('unexpected');},close:async()=>{closed++;}};
 const runtime=new RubiksCubeRuntime(connection,chromium,new Telemetry(()=>{}));
 assert.equal(cubeTools(runtime).length,4);
 await assert.rejects(runtime.execute('startCube',{difficulty:101},ctx));
 await assert.rejects(runtime.execute('manipulateCube',{gameId:'foreign',move:'U'},ctx));
 assert.equal(starts,0);await runtime.close();await runtime.close();assert.equal(closed,1);
});
test('real MCP and Chromium update the live view and shut down',async()=>{
 const connection=new McpCubeConnection();let browser:any;
 const launcher={launch:async(options:any)=>{browser=await chromium.launch({...options,headless:true});return browser;}};
 const runtime=new RubiksCubeRuntime(connection,launcher,new Telemetry(()=>{}));
 let url='';
 try{
  const start=await runtime.execute('startCube',{scramble:false},ctx);url=start.metadata.url;
  const gameId=start.metadata.gameId;
  assert.equal(start.metadata.cube.solved,true);
  const page=browser.contexts()[0].pages()[0];
  await page.waitForFunction(()=>document.getElementById('connectionStatus')?.classList.contains('connected'),{},{timeout:20_000});
  await assert.rejects(runtime.execute('joinGame',{gameId},{...ctx,sessionId:'other'}));
  await assert.rejects(runtime.execute('manipulateCube',{gameId,move:'U'},ctx),/Press Start/);
  let starts=0;runtime.setStartHandler(()=>{starts++;});
  await mkdir('.data',{recursive:true});
  await page.screenshot({path:'.data/cube-studio-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.data/cube-studio-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Start solving'}).click();
  await page.waitForFunction(()=>document.getElementById('start')?.textContent==='Agent started');assert.equal(starts,1);
  await runtime.execute('manipulateCube',{gameId,move:'U'},ctx);
  await page.waitForFunction(()=>document.getElementById('moveCount')?.textContent==='1');
  await assert.rejects(runtime.execute('finish',{gameId},ctx),/not solved/);
  await runtime.reportAttempt('completed');
  assert.equal(await page.locator('#gameStatus').textContent(),'Attempt ended');
  await page.getByRole('button',{name:'Continue solving'}).click();
  await page.waitForFunction(()=>document.getElementById('start')?.textContent==='Agent started');assert.equal(starts,2);
  const restored=await runtime.execute('manipulateCube',{gameId,move:"U'"},ctx);
  assert.equal(restored.metadata.cube.solved,true);
  await page.waitForFunction(()=>document.getElementById('moveCount')?.textContent==='2');
  await runtime.reportAttempt('completed');
  assert.equal(await page.locator('#gameStatus').textContent(),'Cube solved');
  await runtime.execute('finish',{gameId},ctx);
  assert.equal((await fetch(url)).status,200);
 }finally{assert.deepEqual(await runtime.close(),{browserClosed:true,serverStopped:true});}
 assert.equal(browser.isConnected(),false);await assert.rejects(fetch(url));
});

test('cancelled initialization closes its connection',async()=>{
 let closed=0;
 const connection:CubeConnection={start:async signal=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}),call:async()=>({}),close:async()=>{closed++;}};
 const runtime=new RubiksCubeRuntime(connection,chromium,new Telemetry(()=>{}));
 const abort=new AbortController();const pending=runtime.execute('startCube',{}, {...ctx,signal:abort.signal});abort.abort();
 await assert.rejects(pending);await runtime.close();assert.ok(closed>=1);
});

test('every cube move is reversible on distinct stickers and the reported scramble solves',()=>{
 const {RubiksCube}=createRequire(import.meta.url)('rubiks-cube-mcp-server/dist/cubeLogic.js');
 const scramble=['R',"D'",'U',"D'","D'","R'","F'","U'",'F','R','B','U','D','D','D',"F'","U'","D'",'B',"L'"];
 for(const face of ['U','D','L','R','F','B'])for(const suffix of ['',"'",'2']){
  const cube=new RubiksCube();const state=cube.getState();let sticker=0;
  for(const key of Object.keys(state.faces))state.faces[key]=state.faces[key].map((row:string[])=>row.map(()=>String(sticker++)));
  cube.setState(state);const before=JSON.stringify(cube.getState().faces);
  const move=face+suffix;cube.executeMove(move);cube.executeMove(suffix==='2'?move:suffix==="'"?face:face+"'");
  assert.equal(JSON.stringify(cube.getState().faces),before,move+' followed by inverse');
  for(let i=0;i<4;i++)cube.executeMove(face);
  assert.equal(JSON.stringify(cube.getState().faces),before,face+' four turns');
 }
 const cube=new RubiksCube();scramble.forEach(move=>cube.executeMove(move));
 scramble.toReversed().forEach(move=>cube.executeMove(move.endsWith("'")?move[0]:move+"'"));
 assert.equal(cube.isSolved(),true);
});
