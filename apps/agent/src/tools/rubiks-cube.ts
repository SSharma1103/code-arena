import { cubeView } from './cube-view.js';
import { createRequire } from 'node:module';
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AgentTool, ToolContext, ToolDefinition } from '../types.js';
import { Telemetry } from '../middleware/telemetry.js';

export interface CubeConnection {
  start(signal: AbortSignal): Promise<string>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
export class McpCubeConnection implements CubeConnection {
  private client = new Client({name:'code-arena',version:'1.0.0'});
  private transport?: StdioClientTransport;
  async start(signal: AbortSignal) {
    const entry=createRequire(import.meta.url).resolve('rubiks-cube-mcp-server');
    this.transport=new StdioClientTransport({command:process.execPath,args:[entry],env:{PORT:'0'},stderr:'pipe'});
    let buffer='';
    const ready=new Promise<string>((resolve,reject)=>{
      this.transport!.stderr!.on('data',(chunk:Buffer)=>{
        buffer=(buffer+chunk.toString()).slice(-8192);
        const match=buffer.match(/CODE_ARENA_CUBE_READY (http:\/\/127\.0\.0\.1:\d+)/);
        if(match)resolve(match[1]!);
      });
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
    const [origin]=await Promise.all([ready,this.client.connect(this.transport,{signal})]);
    const tools=await this.client.listTools({}, {signal});
    for(const name of ['startCube','joinGame','manipulateCube','finish'])if(!tools.tools.some(t=>t.name===name))throw new Error('Missing cube tool');
    return origin;
  }
  async call(name:string,args:Record<string,unknown>,signal:AbortSignal) {
    const result=await this.client.callTool({name,arguments:args},undefined,{signal,timeout:10_000});
    if(result.isError)throw new Error('Cube operation rejected');
    const blocks=result.content as {type:string;text?:string}[];
    for(const block of blocks){if(block.type==='text'&&block.text){try{const value=JSON.parse(block.text);if(value.gameId && value.cube)return value;}catch{/* Human-readable MCP text. */}}}
    throw new Error('Invalid cube response');
  }
  async close(){try{await this.client.close();}finally{await this.transport?.close();}}
}

import type { CubeState } from '@code-arena/contracts';
export interface CubePresenter { show(state:CubeState,signal:AbortSignal):Promise<void>; reportAttempt?(status:string):Promise<void>; close():Promise<void> }
export class RubiksCubeRuntime {
  private sessionId?:string;
  private origin?:string;
  private startup?:Promise<void>;
  private browser?:Browser;
  private context?:BrowserContext;
  private page?:Page;
  private games=new Set<string>();
  private startedGames=new Set<string>();
  private startHandler:(gameId:string)=>void=()=>{};
  async reportAttempt(status:'running'|'completed'|'failed'){
    await this.presenter?.reportAttempt?.(status);
    if(!this.page||this.page.isClosed())return;
    await this.page.evaluate(value=>{(window as unknown as {cubeAttemptStatus?:(value:string)=>void}).cubeAttemptStatus?.(value);},status).catch(()=>{});
  }
  setStartHandler(handler:(gameId:string)=>void){this.startHandler=handler;}
  authorizeStart(gameId:string){if(this.closing||!this.games.has(gameId))throw new Error('Unknown session game');this.startedGames.add(gameId);}
  private closing=false;
  private lifetime=new AbortController();
  private pending=new Set<Promise<unknown>>();
  private cleanup?:Promise<{browserClosed:boolean;serverStopped:boolean}>;
  url?:string;
  constructor(private connection:CubeConnection,private launcher:Pick<BrowserType,'launch'>,private telemetry:Telemetry,private changed:()=>void=()=>{},private presenter?:CubePresenter){}
  private async ensure(signal:AbortSignal){
    if(this.closing)throw new Error('Cube runtime closed');
    this.startup??=(async()=>{
      const startupSignal=AbortSignal.any([signal,AbortSignal.timeout(15_000)]);
      try{
        this.origin=await this.connection.start(startupSignal);
        if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(this.origin))throw new Error('Invalid cube origin');
        this.telemetry.emit('cube.started');
      }catch(error){await this.connection.close();throw error;}
    })();
    await this.startup;signal.throwIfAborted();
  }
  execute(name:string,args:unknown,context:ToolContext){
    const task=this.perform(name,args,{...context,signal:AbortSignal.any([context.signal,this.lifetime.signal])});
    this.pending.add(task);void task.finally(()=>this.pending.delete(task)).catch(()=>{});return task;
  }
  private async perform(name:string,args:unknown,context:ToolContext){
    context.signal.throwIfAborted();
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Invalid cube arguments');
    const a=args as Record<string,unknown>;
    if(name==='startCube'){
      if(this.presenter&&this.games.size)throw new Error('Use the existing cube. Start a new session for a new game.');
      if(Object.keys(a).some(k=>!['scramble','difficulty'].includes(k))||(a.scramble!==undefined&&typeof a.scramble!=='boolean')||(a.difficulty!==undefined&&(!Number.isInteger(a.difficulty)||Number(a.difficulty)<1||Number(a.difficulty)>100)))throw new Error('Invalid cube setup');
    }else{
      if(typeof a.gameId!=='string'||!this.games.has(a.gameId)||Object.keys(a).some(k=>!['gameId',...(name==='manipulateCube'?['move']:[])].includes(k)))throw new Error('Unknown session game');
      if(name==='manipulateCube'&&(typeof a.move!=='string'||! /^(U|D|L|R|F|B)('|2)?$/.test(a.move)))throw new Error('Invalid cube move');
    }
    if(this.sessionId&&this.sessionId!==context.sessionId)throw new Error('Cube session mismatch');
    this.sessionId=context.sessionId;
    await this.ensure(context.signal);
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(10_000)]);
    if((name==='manipulateCube'||name==='finish')&&!this.startedGames.has(String(a.gameId)))throw new Error('Press Start in the cube UI first');
    if(name==='finish'){
      const current=await this.connection.call('joinGame',{gameId:a.gameId},signal) as CubeState;
      if(!current.cube.solved)throw new Error('Cube is not solved');
    }
    const state=await this.connection.call(name,name==='startCube'?{scramble:true,difficulty:20,...a}:a,signal) as CubeState;
    if(!/^cube_[a-zA-Z0-9_]+$/.test(state.gameId)||!state.cube)throw new Error('Invalid cube state');
    this.games.add(state.gameId);
    this.url=`${this.origin}/game/${state.gameId}`;
    if(this.presenter)await this.presenter.show(state,signal);
    else if(name==='startCube'||name==='joinGame')await this.show(signal);
    this.telemetry.emit('cube.updated',{solved:state.cube.solved,moves:state.cube.moveHistory.length});this.changed();
    return {metadata:{...state,url:this.url,awaitingStart:!this.startedGames.has(state.gameId)},content:[]};
  }
  private async show(signal:AbortSignal){
    signal.throwIfAborted();
    if(!this.browser?.isConnected()){
      this.browser=await this.launcher.launch({channel:'chromium',headless:false,timeout:10_000});
      this.context=await this.browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false});
      await this.context.exposeBinding('startCubeSolve',({page,frame},gameId:unknown)=>{
        if(page!==this.page||frame!==page.mainFrame()||typeof gameId!=='string'||!this.games.has(gameId)||page.url()!==`${this.origin}/game/${gameId}`||this.closing)throw new Error('Invalid game');

        this.startedGames.add(gameId);this.startHandler(gameId);
      });
      await this.context.route('**/*',route=>{
        const match=new URL(route.request().url()).pathname.match(/^\/game\/(cube_[a-zA-Z0-9_]+)$/);
        if(route.request().isNavigationRequest()&&new URL(route.request().url()).origin===this.origin&&match&&this.games.has(match[1]!))return route.fulfill({contentType:'text/html',body:cubeView(match[1]!)});
        const u=new URL(route.request().url());
        return u.origin===this.origin||['https://cdnjs.cloudflare.com','https://cdn.socket.io'].includes(u.origin)?route.continue():route.abort();
      });
      await this.context.routeWebSocket('**/*',socket=>{const u=new URL(socket.url());if(u.origin===this.origin!.replace('http:','ws:'))socket.connectToServer();else socket.close();});
    }
    if(!this.page||this.page.isClosed())this.page=await this.context!.newPage();
    await this.page.goto(this.url!,{waitUntil:'domcontentloaded',timeout:10_000});
    signal.throwIfAborted();
  }
  close(){return this.cleanup??=(async()=>{
    this.closing=true;this.lifetime.abort();await Promise.allSettled([...this.pending]);await this.startup?.catch(()=>{});
    let browserClosed=true,serverStopped=true;
    try{await this.context?.close();}catch{browserClosed=false;}
    try{await this.browser?.close();}catch{browserClosed=false;}
    try{await this.presenter?.close();}catch{browserClosed=false;}
    try{await this.connection.close();}catch{serverStopped=false;}
    this.games.clear();this.telemetry.emit('cube.stopped',{browserClosed,serverStopped});
    return {browserClosed,serverStopped};
  })();}
}
const schemas:Record<string,Record<string,unknown>>={
  startCube:{scramble:{type:'boolean'},difficulty:{type:'integer',minimum:1,maximum:100}},
  joinGame:{gameId:{type:'string'}},manipulateCube:{gameId:{type:'string'},move:{type:'string',enum:['U','D','L','R','F','B'].flatMap(m=>[m,m+"'",m+'2'])}},finish:{gameId:{type:'string'}}
};
export function cubeTools(runtime:RubiksCubeRuntime):AgentTool[]{
  return Object.entries({startCube:'rubiks_start_cube',joinGame:'rubiks_join_game',manipulateCube:'rubiks_manipulate_cube',finish:'rubiks_finish'}).map(([remote,name])=>new McpCubeTool(runtime,remote,{name,description:remote==='startCube'?'Launch the Rubiks cube UI (default 20 scramble moves). Stop and wait for the user to press Start in the browser. Do not choose moves until a new prompt requests solving the started game. Games expire on CLI exit.':`Rubiks cube: ${remote}. Only current session games are available.`,parameters:{type:'object',properties:schemas[remote],required:remote==='startCube'?[]:remote==='manipulateCube'?['gameId','move']:['gameId'],additionalProperties:false}}));
}
class McpCubeTool implements AgentTool{
  constructor(private runtime:RubiksCubeRuntime,private remote:string,readonly definition:ToolDefinition){}
  execute(args:unknown,context:ToolContext){return this.runtime.execute(this.remote,args,context);}
}
