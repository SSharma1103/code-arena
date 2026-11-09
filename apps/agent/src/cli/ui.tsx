import type { RubiksCubeRuntime } from '../tools/rubiks-cube.js';
import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { stripVTControlCharacters } from 'node:util';
import type { write_file } from '../tools/write_file.js';
import type { Agent } from '../agent/agent.js';
import type { ModelClient, Session } from '../types.js';
import type { SessionManager } from '../session/session.js';
export const safeText = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');
export function UI({agent,client,sessions,resume,onStatus,artifacts,cube}: {cube?:RubiksCubeRuntime;agent:Agent;client:ModelClient;sessions:SessionManager;resume?:string;artifacts?:write_file;onStatus?:(listener:(status:string)=>void)=>void}) {
  const {exit} = useApp(); const [session,setSession] = useState<Session>(); const [models,setModels] = useState<string[]>([]); const [input,setInput] = useState(''); const [filter,setFilter] = useState(''); const [error,setError] = useState(''); const [status,setStatus] = useState('loading'); const [manual,setManual] = useState(false); const active = useRef<AbortController | null>(null);
  const initialization=useRef<Promise<void> | null>(null);
  const pending=useRef<Promise<void> | null>(null);const closing=useRef(false);
  const shutdown=async()=>{if(closing.current)return;closing.current=true;active.current?.abort();await initialization.current;await pending.current;try{const release=lease.current;lease.current=null;await release?.();}finally{exit();}};
  const lease = useRef<(() => Promise<void>) | null>(null);
  const load = async () => {setStatus('loading');setError('');try {if(resume) {const saved=await sessions.store.load(resume);lease.current=await sessions.store.lock(resume,'cli');setSession(saved);} else setModels((await client.models(AbortSignal.timeout(30_000))).map(m=>m.id));setStatus('ready');}catch{setError('Could not load models/session. It may be locked. Retry or enter a model ID.');setStatus('ready');}};
  useEffect(()=>{const terminate=()=>{void shutdown();};process.on('SIGTERM',terminate);initialization.current=load();onStatus?.(setStatus);return()=>{process.off('SIGTERM',terminate);active.current?.abort();void lease.current?.().catch(()=>{});};},[]);
  useInput((value,key)=>{if(key.ctrl && value==='c'){if(active.current) active.current.abort();else void shutdown();}});
  const select = async (model:string) => {try {const created=await sessions.create(model);lease.current=await sessions.store.lock(created.id,'cli');setSession(created);setInput('');setError('');}catch{setError('Could not create session');}};
  const submit = async (prompt:string) => {
    if(prompt==='/exit'){void shutdown();return;} if(!prompt.trim() || active.current || !session)return;
    active.current=new AbortController();setStatus('running');setError('');setInput('');
    try {await cube?.reportAttempt('running');await agent.run({sessionId:session.id,prompt,signal:active.current.signal});await cube?.reportAttempt('completed');}catch(e){await cube?.reportAttempt('failed');setError(e instanceof Error?e.message:'Run failed');}
    finally {try{setSession(await sessions.store.load(session.id));}catch{setError('Could not reload session');}active.current=null;setStatus('ready');}
  };
  useEffect(()=>{
    cube?.setStartHandler(gameId=>{void (async()=>{await pending.current;if(closing.current)return;const task=submit(`Solve the already started cube ${gameId}. Use rubiks_join_game to inspect it, choose moves, and finish when solved. Do not create a new cube.`);pending.current=task;await task;})();});
    return ()=>cube?.setStartHandler(()=>{});
  },[cube,session]);
  return <Box flexDirection="column">
    <Text bold color="cyan">{`╔════════════════════════════╗\n║   C O D E   A R E N A      ║\n╚════════════════════════════╝`}</Text>
    {error && <Text color="red">{safeText(error)}</Text>}
    {!session && status!=='loading' && <>
      <Text>{manual?'Model ID:':'Filter models:'}</Text>
      <TextInput value={manual?input:filter} onChange={manual?setInput:setFilter} onSubmit={value=>{if(manual)void select(value);}}/>
      {!manual && <Box borderStyle="round"><SelectInput items={[{label:'Enter model ID manually',value:'manual'},{label:'Retry loading',value:'retry'},...models.filter(m=>m.toLowerCase().includes(filter.toLowerCase())).slice(0,20).map(m=>({label:safeText(m),value:m}))]} onSelect={item=>{if(item.value==='manual')setManual(true);else if(item.value==='retry')void load();else void select(item.value);}}/></Box>}
    </>}
    {session && <><Text dimColor>{safeText(session.model)} | Session {session.id}</Text>
      {resume && <Text dimColor>Earlier temporary artifacts have expired. Generate them again for new previews.</Text>}
      {session.turns.map(turn=><Box key={turn.id} flexDirection="column"><Text color="green">You: {safeText(turn.prompt)}</Text><Text>{turn.response?safeText(turn.response.text):`[${turn.status}]`}</Text>{turn.metrics && <Text dimColor>{turn.metrics.durationMs} ms | {turn.metrics.modelCalls} model calls | {turn.metrics.toolCalls} tool calls | tokens: {turn.response?.usage?.total ?? 'unavailable'}</Text>}</Box>)}
      {cube?.url && <Text color="cyan">Cube live: {safeText(cube.url)}</Text>}
      {artifacts?.artifacts.map(file=><Text key={file.path} color="cyan">{file.format}: {safeText(file.url)}</Text>)}
      <Text color="yellow">{status} · /exit to quit · Ctrl+C to cancel/exit</Text>
      {status==='ready' && <Box borderStyle="round"><TextInput value={input} onChange={setInput} onSubmit={value=>{pending.current=submit(value);}} placeholder="Enter a prompt"/></Box>}
    </>}
    {status==='loading' && <Text>Loading…</Text>}
  </Box>;
}
