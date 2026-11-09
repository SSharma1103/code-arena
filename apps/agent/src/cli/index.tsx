import { createRuntime } from '../service/runtime.js';
import React from 'react';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { render } from 'ink';
import { UI } from './ui.js';
import { OpenRouterClient } from '../client/openrouter.js';
import { SessionManager, FileSessionStore } from '../session/session.js';
import { Telemetry } from '../middleware/telemetry.js';
const env = resolve(import.meta.dirname,'../../.env'); if(existsSync(env))loadEnvFile(env);
if(!process.env.OPENROUTER_API_KEY?.trim()){process.stderr.write('OPENROUTER_API_KEY is required. Set it in apps/agent/.env.\n');process.exit(1);}
if(!process.stdin.isTTY){process.stderr.write('The testing CLI requires an interactive terminal.\n');process.exit(1);}
let statusListener = (_status:string) => {};
const started=Date.now();const counts={completed:0,failed:0,modelCalls:0,toolCalls:0,input:0,output:0,total:0,usageCalls:0,missingUsageCalls:0};
const telemetry = new Telemetry(event=>{if(event.event==='run.completed')counts.completed++;if(event.event==='run.failed')counts.failed++;if(event.event==='generation.started'||event.event==='summary.started')counts.modelCalls++;if(event.event==='tool.started')counts.toolCalls++;if(event.event==='generation.usage'||event.event==='summary.usage'){const u=event.usage as {input:number;output:number;total:number}|undefined;if(u){counts.input+=u.input;counts.output+=u.output;counts.total+=u.total;counts.usageCalls++;}else counts.missingUsageCalls++;}process.stderr.write(JSON.stringify(event)+'\n');if(event.event==='summary.started')statusListener('compacting');if(event.event==='generation.started')statusListener('running');});
const client = new OpenRouterClient(process.env.OPENROUTER_API_KEY);
const sessions = new SessionManager(new FileSessionStore());
const {agent,artifacts,cube}=createRuntime({client,sessions,telemetry,changed:()=>statusListener(`live cube: ${cube.url ?? ''}`)});
const args=process.argv.slice(2); const resume=args[0]==='--session'?args[1]:undefined;
if(args.length && (args[0]!=='--session'||!resume)){process.stderr.write('Usage: npm run cli --workspace=agent -- [--session <id>]\n');process.exit(1);}
try {
const app=render(<UI cube={cube} artifacts={artifacts} agent={agent} client={client} sessions={sessions} resume={resume} onStatus={listener=>{statusListener=listener;}}/>,{exitOnCtrlC:false});


await app.waitUntilExit();
} finally {
const cubeCleanup=await cube.close();
process.stdout.write(`Cube browser closed: ${cubeCleanup.browserClosed}. MCP server stopped: ${cubeCleanup.serverStopped}.\n`);
if(!cubeCleanup.browserClosed||!cubeCleanup.serverStopped)process.exitCode=1;
const cleanup=await artifacts.close();
process.stdout.write('\nTelemetry brief: '+JSON.stringify({...counts,durationMs:Date.now()-started})+'\n');
process.stdout.write(`Temporary files deleted: ${cleanup.filesDeleted}. Preview server stopped: ${cleanup.previewStopped ? 'yes' : 'NO'}.\n`);
for(const error of cleanup.errors)process.stderr.write(error+'\n');
if(cleanup.errors.length)process.exitCode=1;

}
