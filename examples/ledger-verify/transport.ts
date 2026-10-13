/** Provider wrapper. Keys are loaded here, never in the parent runner or its logs. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { schemaFor } from './schemas';

const root = fileURLToPath(new URL('../..', import.meta.url));
const base = resolve(root,'examples/ledger-verify');
const argv = process.argv.slice(2);
const value = (flag:string) => argv[argv.indexOf(flag)+1];
const model = value('--model');
const system = value('--system-prompt') ?? '';
const chunks=[];
for await (const chunk of process.stdin) chunks.push(chunk);
const user=Buffer.concat(chunks).toString('utf8');
const id=randomUUID();
let reservation=false;
const budget = (action:string,amount=0.5) => JSON.parse(execFileSync('python3',[
  resolve(base,'budget.py'),resolve(base,'receipts/budget.json'),action,id,String(amount),model,
],{encoding:'utf8'}));
try {
  const freeze=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
  if (Date.now() >= freeze.deadlineAt) throw new Error('Last-call cutoff reached');
  if (!['haiku','gpt-6-luna'].includes(model)) throw new Error('Unauthorized model');
  if (Buffer.byteLength(system+user)>500_000) throw new Error('Prompt exceeds frozen transport input bound');
  for (const [path,hash] of Object.entries(freeze.hashes)) {
    const actual=createHash('sha256').update(await readFile(resolve(root,path))).digest('hex');
    if (actual!==hash) throw new Error(`Runtime hash mismatch: ${path}`);
  }
  const schema=schemaFor(system);
  await mkdir(resolve(base,'receipts'),{recursive:true});
  budget('reserve');
  reservation=true;
  let result:any;
  let metadata:any;
  if (model==='haiku') {
    const { createDialectTransport }=await import('../../packages/judges/src/clients/transport');
    // Frozen Haiku prompts already own their output instructions, including scratchpad where applicable.
    const env={...process.env,CLAUDE_JUDGE_MODEL:'claude-haiku-5-5',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'16384'};
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GEMINI_API_KEY;
    const transport=createDialectTransport({provider:'claude-cli',model:'claude-haiku-5-5',env,
      timeoutMs:240000,maxBudgetUsd:0.5});
    const response=await transport.complete({system,user});
    if (response.costUsd===undefined) throw new Error('Provider omitted fee; reservation retained');
    result={result:response.text,total_cost_usd:response.costUsd,is_error:false};
    metadata={...response,raw:undefined,text:undefined};
  } else {
    const keyFile=process.env.VERIFY_OPENAI_KEY_FILE;
    if (!keyFile) throw new Error('VERIFY_OPENAI_KEY_FILE is required');
    const key=(await readFile(keyFile,'utf8')).trim();
    const { runShim }=await import('../judge-benchmarks/src/llm-shim.mjs');
    result=await runShim({argv:[...argv,'--reasoning-effort','medium',
      ...(schema ? ['--json-schema',JSON.stringify(schema)] : [])],input:user,
      env:{OPENAI_API_KEY:key},
      fetch:async (url:any,options:any) => {
        const body=JSON.parse(options.body);
        body.max_completion_tokens=32768;
        const response=await fetch(url,{...options,body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
        const clone=response.clone();
        try { const raw=await clone.json();metadata={usage:raw.usage,finishReason:raw.choices?.[0]?.finish_reason}; }
        catch { metadata={httpStatus:response.status}; }
        return response;
      }});
    if (result.is_error) throw new Error('Provider error; reservation retained, inspect receipt');
  }
  const state=budget('settle',result.total_cost_usd);
  reservation=false;
  await appendFile(resolve(base,'receipts/calls.jsonl'),JSON.stringify({
    id,at:new Date().toISOString(),model,fingerprint:createHash('sha256').update(JSON.stringify({
      core:freeze.coreSha,model,system,user,schema,reasoning:model==='haiku'?null:'medium'})).digest('hex'),
    costUsd:result.total_cost_usd,metadata,state,text:result.result,
  })+'\n');
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  const message=error instanceof Error ? error.message : String(error);
  await mkdir(resolve(base,'receipts'),{recursive:true});
  await appendFile(resolve(base,'receipts/errors.jsonl'),JSON.stringify({id,model,at:new Date().toISOString(),
    message,reservationRetained:reservation})+'\n');
  // "limit" makes the frozen caller stop without retrying an unknown-cost or content failure.
  process.stdout.write(JSON.stringify({is_error:true,total_cost_usd:0,result:`Transport limit: ${message}`}));
}
