export class Telemetry {
  private runs=new Map<string,{input:number;output:number;total:number;known:number;missing:number;summaries:number}>();
  usage(runId:string) { return this.runs.get(runId); }
  forget(runId:string) { this.runs.delete(runId); }
  constructor(private sink: (event: Record<string, unknown>) => void = event => { process.stderr.write(JSON.stringify(event) + '\n'); }) {}
  emit(event: string, fields: Record<string, unknown> = {}) {
    if(typeof fields.runId==='string' && (event==='summary.usage'||event==='generation.usage')) {
      const record=this.runs.get(fields.runId) ?? {input:0,output:0,total:0,known:0,missing:0,summaries:0};
      const usage=fields.usage as {input:number;output:number;total:number}|undefined;
      if(usage){record.input+=usage.input;record.output+=usage.output;record.total+=usage.total;record.known++;}else record.missing++;
      if(event==='summary.usage')record.summaries++;
      this.runs.set(fields.runId,record);
    }
    try { this.sink({ event, time: new Date().toISOString(), ...fields }); } catch { /* Observability must not fail execution. */ }
  }
  async measure<T>(operation: string, fields: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
    const start = Date.now(); this.emit(operation + '.started', fields);
    try { const result = await action(); this.emit(operation + '.completed', { ...fields, durationMs: Date.now() - start }); return result; }
    catch (error) { this.emit(operation + '.failed', { ...fields, durationMs: Date.now() - start, code: 'operation_failed' }); throw error; }
  }
}
