import { createServer } from 'node:http';
import type { ToolContext } from '../types.js';
import { runtimeAsset } from './runtime-assets.js';

export interface PreviewFileSource {
  readPreviewFile(entryFile: string, context: ToolContext): Promise<{content: string; contentType: string}>;
}
export interface RunPreview {
  url: string;
  close(): Promise<void>;
}
export interface PreviewServer {
  start(entryFile: string, context: ToolContext): Promise<RunPreview>;
}
export function validateEntryFile(value: unknown): asserts value is string {
  if(typeof value!=='string' || !value || value.length>512 || /[\\\x00-\x1f:%?#]/.test(value) || value.startsWith('/') || value.split('/').some(part=>!part || part==='.' || part==='..')) {
    throw new Error('entryFile must be a workspace-relative path without traversal');
  }
}

// The source owns workspace/run authorization; the server never exposes the host filesystem.
export class LocalRunPreviewServer implements PreviewServer {
  constructor(private source: PreviewFileSource) {}
  async start(entryFile: string, context: ToolContext): Promise<RunPreview> {
    validateEntryFile(entryFile);
    if(!context.runId) throw new Error('A current run is required');
    context.signal.throwIfAborted();
    await this.source.readPreviewFile(entryFile,context);
    const server=createServer((req,res)=>{
      void (async()=>{
        try {
          if(req.method!=='GET' || !req.url?.startsWith('/')) throw new Error('Unsupported request');
          const asset=runtimeAsset(req.url);
          if(asset){res.writeHead(200,{'Content-Type':'text/javascript','Access-Control-Allow-Origin':'*'});res.end(await asset);return;}
          const path=decodeURIComponent(req.url.slice(1).split('?')[0]!);validateEntryFile(path);
          const file=await this.source.readPreviewFile(path,context);
          res.writeHead(200,{
            'Content-Type':file.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
            'Referrer-Policy':'no-referrer',
            'Content-Security-Policy':"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'",
          });res.end(file.content);
        } catch {res.writeHead(404);res.end();}
      })();
    });
    server.maxConnections=32;server.requestTimeout=5_000;server.headersTimeout=5_000;
    const close=async()=>{await new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});};
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    if(context.signal.aborted){await close();context.signal.throwIfAborted();}
    const port=(server.address() as {port:number}).port;
    return {url:`http://127.0.0.1:${port}/${entryFile.split('/').map(encodeURIComponent).join('/')}`,close};
  }
}
