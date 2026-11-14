import { MAX_ARTIFACT_BYTES, MAX_SESSION_ARTIFACT_BYTES } from '../limits.js';
import { mkdtemp, writeFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AgentTool, ToolContext } from '../types.js';
import { runtimeAsset } from './runtime-assets.js';

export class write_file implements AgentTool {
  readonly definition = {name:'write_file', description:'Write an SVG or complete HTML/Three.js page (up to 8 MiB per file, 64 MiB total per session). Returns a temporary localhost preview URL. For 3js include browser imports in a complete HTML page.', parameters:{type:'object', properties:{format:{type:'string',enum:['svg','html','3js']},content:{type:'string'}},required:['format','content'],additionalProperties:false}};
  private directory?: string;
  private sessionId?: string;
  private server?: Server;
  private files = new Map<string,{content:string;format:string;path:string;url:string;runId?:string}>();
  private bytes = 0;
  private closed = false;
  get artifacts() { return [...this.files.values()].map(({content,...file})=>file); }
  readArtifact(id:string) {
    if(this.closed)throw new Error('Artifact session closed');
    const file=this.files.get(id);if(!file)throw new Error('Unknown artifact');
    return {content:file.content,format:file.format,entryFile:basename(file.path)};
  }
  async execute(args: unknown, context: ToolContext) {
    context.signal.throwIfAborted();
    if(this.closed) throw new Error('Artifact session closed');
    if(!args || typeof args !== 'object') throw new Error('Expected format and content');
    const {format,content}=args as Record<string,unknown>;
    if(!['svg','html','3js'].includes(String(format)) || typeof content!=='string' || !content.trim() || Object.keys(args).some(k=>!['format','content'].includes(k))) throw new Error('Expected format svg/html/3js and nonempty content');
    const size=Buffer.byteLength(content);
    if(size>MAX_ARTIFACT_BYTES || this.bytes+size>MAX_SESSION_ARTIFACT_BYTES) throw new Error('Artifact size limit exceeded (8 MiB per file, 64 MiB per session)');
    if(this.sessionId && this.sessionId!==context.sessionId) throw new Error('Artifact session mismatch');
    this.sessionId=context.sessionId;
    this.directory ??= await realpath(await mkdtemp(join(tmpdir(),'code-arena-')));
    if(!this.server){
      const server=createServer((req,res)=>{
        const asset=req.method==='GET' && runtimeAsset(req.url ?? '');
        if(asset){void asset.then(content=>{res.writeHead(200,{'Content-Type':'text/javascript','Access-Control-Allow-Origin':'*'});res.end(content);},()=>{res.writeHead(404);res.end();});return;}
        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
        const id=req.url?.match(/^\/(view|file)\/([a-f0-9-]+)$/);const file=id && this.files.get(id[2]!);
        if(req.method!=='GET'||!id||!file){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Security-Policy',id[1]==='view'?"default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'":"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; connect-src https:; font-src https: data:; base-uri 'none'; form-action 'none'");
        res.setHeader('Content-Type',id[1]==='view'||file.format!=='svg'?'text/html; charset=utf-8':'image/svg+xml');
        res.end(id[1]==='view'?`<!doctype html><title>Code Arena Preview</title><iframe sandbox="allow-scripts" style="position:fixed;inset:0;width:100%;height:100%;border:0" src="/file/${id[2]}"></iframe>`:file.content);
      });
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});this.server=server;
    }
    context.signal.throwIfAborted();
    const id=randomUUID();const path=join(this.directory,id+(format==='svg'?'.svg':'.html'));
    await writeFile(path,content,{mode:0o600});this.bytes+=size;
    const port=(this.server.address() as {port:number}).port;
    const url=`http://127.0.0.1:${port}/view/${id}`;
    this.files.set(id,{content,format:String(format),path,url,runId:context.runId});
    return {id,format,path,url,entryFile:basename(path)};
  }
  // Only registered artifacts from this run are visible to automated review.
  async readPreviewFile(entryFile: string, context: ToolContext) {
    context.signal.throwIfAborted();
    const file=[...this.files.values()].find(f=>basename(f.path)===entryFile && f.runId===context.runId);
    if(this.closed || context.sessionId!==this.sessionId || !context.runId || !file || !this.directory) throw new Error('File is not in the current run workspace');
    if(await realpath(file.path)!==file.path) throw new Error('Artifact symlinks are not allowed');
    return {content:file.content,contentType:file.format==='svg'?'image/svg+xml':'text/html; charset=utf-8'};
  }
  async close() {
    this.closed=true;const errors:string[]=[];let stopped=true;let deleted=0;
    if(this.server){try{await new Promise<void>((resolve,reject)=>{this.server!.close(e=>e?reject(e):resolve());this.server!.closeAllConnections();});}catch{stopped=false;errors.push('Preview server failed to stop');}}
    if(this.directory){try{await rm(this.directory,{recursive:true,force:true});await access(this.directory).then(()=>{throw new Error('Still exists');},e=>{if(e.code!=='ENOENT')throw e;});deleted=this.files.size;}catch{errors.push('Temporary artifact deletion failed');}}
    this.files.clear();this.bytes=0;
    return {filesDeleted:deleted,previewStopped:stopped,errors};
  }
}
