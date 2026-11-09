import type { Browser, BrowserType, BrowserContext } from 'playwright';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { validateEntryFile, type PreviewServer, type RunPreview } from './preview-server.js';

export class ReviewPreviewTool implements AgentTool {
  readonly definition = {
    name:'review_preview',
    description:'Inspect a file generated in this run using Chromium. Returns a screenshot and browser diagnostics. Network access is restricted to this run preview server; bundle dependencies locally. Use entryFile returned by write_file.',
    parameters:{type:'object',properties:{entryFile:{type:'string'},captureAfterMs:{type:'integer',minimum:0,maximum:5000}},required:['entryFile','captureAfterMs'],additionalProperties:false},
  };
  constructor(private browser: Pick<BrowserType,'launch'>, private previews: PreviewServer) {}

  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    if(!args || typeof args!=='object' || Array.isArray(args)) throw new Error('Expected entryFile and captureAfterMs');
    const {entryFile,captureAfterMs}=args as Record<string,unknown>;
    validateEntryFile(entryFile);
    if(typeof captureAfterMs!=='number' || !Number.isInteger(captureAfterMs) || captureAfterMs<0 || captureAfterMs>5000 || Object.keys(args).some(k=>!['entryFile','captureAfterMs'].includes(k))) throw new Error('captureAfterMs must be an integer from 0 to 5000');
    if(!context.runId) throw new Error('A current run is required');
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    let preview:RunPreview|undefined;let browser:Browser|undefined;let browserContext:BrowserContext|undefined;
    const consoleErrors:string[]=[];const javascriptErrors:string[]=[];
    const failedRequests:{url:string;error:string}[]=[];const httpErrors:{url:string;status:number}[]=[];const blockedRequests:string[]=[];
    const push=<T>(list:T[],value:T)=>{if(list.length<100)list.push(value);};
    const clip=(s:string)=>s.slice(0,2000);
    const bounded=async <T>(operation:Promise<T>):Promise<T>=>{
      // Always observe a started operation, including synchronous cancellation during acquisition.
      void operation.catch(()=>{});
      signal.throwIfAborted();
      let cancel=()=>{};
      const cancelled=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});});
      try{return await Promise.race([operation,cancelled]);}finally{signal.removeEventListener('abort',cancel);}
    };
    const acquire=async <T>(operation:()=>Promise<T>,dispose:(resource:T)=>Promise<unknown>):Promise<T>=>{
      signal.throwIfAborted();
      let abandoned=false;let received=false;let resource:T;let disposal:Promise<unknown>|undefined;
      const cleanup=()=>disposal ??= dispose(resource);
      const pending=operation().then(async value=>{
        resource=value;received=true;
        if(abandoned || signal.aborted){await cleanup();throw signal.reason;}
        return value;
      });
      try{return await bounded(pending);}catch(error){
        abandoned=true;
        if(received)await cleanup();
        throw error;
      }
    };
    try {
      preview=await acquire(()=>this.previews.start(entryFile,{...context,signal}),p=>p.close());signal.throwIfAborted();
      const origin=new URL(preview.url);
      if(origin.protocol!=='http:' || origin.hostname!=='127.0.0.1' || origin.username || origin.password) throw new Error('Preview must be a loopback HTTP server');
      browser=await acquire(()=>this.browser.launch({channel:'chromium',headless:true,timeout:10_000,args:['--disable-background-networking','--dns-prefetch-disable','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']}),b=>b.close());signal.throwIfAborted();
      browserContext=await acquire(()=>browser!.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false,permissions:[]}),c=>c.close());
      const activeContext=browserContext;
      signal.throwIfAborted();
      return await bounded((async()=>{
        activeContext.setDefaultTimeout(5_000);activeContext.setDefaultNavigationTimeout(8_000);
        await activeContext.route('**/*',async route=>{
          const url=route.request().url();
          if(new URL(url).origin===origin.origin && new URL(url).protocol==='http:') await route.continue();
          else {push(blockedRequests,clip(url));await route.abort('blockedbyclient');}
        });
        await activeContext.routeWebSocket('**/*',socket=>{push(blockedRequests,clip(socket.url()));socket.close();});
        activeContext.on('console',message=>{if(message.type()==='error')push(consoleErrors,clip(message.text()));});
        activeContext.on('weberror',error=>push(javascriptErrors,clip(error.error().message)));
        activeContext.on('requestfailed',request=>push(failedRequests,{url:clip(request.url()),error:clip(request.failure()?.errorText ?? 'Request failed')}));
        activeContext.on('response',response=>{if(response.status()>=400)push(httpErrors,{url:clip(response.url()),status:response.status()});});
        const page=await activeContext.newPage();
        // Popups inherit routing but are closed to keep a review limited to one page.
        activeContext.on('page',popup=>{if(popup!==page)void popup.close().catch(()=>{});});
        let navigationError:string|undefined;
        try {await page.goto(preview!.url,{waitUntil:'domcontentloaded'});}catch(error){signal.throwIfAborted();navigationError=clip(error instanceof Error?error.message:String(error));}
        await page.waitForTimeout(captureAfterMs);
        const screenshot=await page.screenshot({type:'png',timeout:5_000,fullPage:false});
        if(screenshot.length>5*1024*1024) throw new Error('Screenshot exceeds size limit');
        signal.throwIfAborted();
        return {metadata:{entryFile,captureAfterMs,url:preview!.url,viewport:{width:1280,height:720},consoleErrors,javascriptErrors,failedRequests,httpErrors,blockedRequests,navigationError,diagnosticLimit:100},content:[{type:'image' as const,mimeType:'image/png' as const,data:screenshot.toString('base64')}]};
      })());
    } finally {
      try {await browserContext?.close();} finally {try {await browser?.close();} finally {await preview?.close();}}
    }
  }
}
