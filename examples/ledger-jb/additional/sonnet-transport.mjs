// Sonnet-only transport amendment. Other running model transports remain byte-identical.
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {claudeEnvironment,claudeArgs,readClaude,settingsFor} from './adapter.mjs';
import {buildDialectRequest} from '../../../packages/judges/src/clients/transport.ts';
import {runClaudeCommand} from '../../../packages/judges/src/clients/claude-cli.ts';
import {JudgeError} from '../../../packages/judges/src/http.ts';

export function readSonnet(ran){
  let value;try{value=JSON.parse(ran.stdout);}catch{return readClaude(ran);}
  // Observed CLI envelope: subtype=success but terminal_reason=api_error,
  // is_error=true, zero API duration, tokens and modelUsage; result is the error string.
  if(value.terminal_reason==='api_error'&&value.is_error===true&&value.usage?.output_tokens===0&&Object.keys(value.modelUsage??{}).length===0){
    const status=value.api_error_status??undefined;
    const error=new JudgeError(status?'http':'network',value.result||'Claude CLI API transport error',
      {status,retryable:!status||status===429||status>=500});
    error.raw=ran.stdout;error.costUsd=Number.isFinite(value.total_cost_usd)?value.total_cost_usd:undefined;error.usage={input:0,output:0,cached:0,cacheWrite:0};
    throw error;
  }
  return readClaude(ran);
}
export function createTransport(model,settings){
  if(model!=='claude-sonnet-5-5'||JSON.stringify(settings)!==JSON.stringify(settingsFor(model)))throw new Error('Frozen Sonnet settings differ');
  const env=claudeEnvironment(process.env),cwd=mkdtempSync(join(tmpdir(),'ledger-jb-sonnet-empty-'));
  return {maximumCostUsd:()=>settings.nativeReservationUsd,async call(prompt,{schema}){
    const started=Date.now(),built=buildDialectRequest('claude-cli',{...prompt,...(schema?{schema}:{})});
    return {...readSonnet(await runClaudeCommand('claude',claudeArgs(prompt),built.payload.user,{cwd,env,timeoutMs:settings.timeoutMs})),elapsedMs:Date.now()-started};
  }};
}
