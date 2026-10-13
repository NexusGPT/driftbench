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
const model = value('--model') ?? '';
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
  if (!['haiku','gpt-6-luna','gemini-3.8-flash'].includes(model)) throw new Error('Unauthorized model');
  if (Buffer.byteLength(system+user)>500_000) throw new Error('Prompt exceeds frozen transport input bound');
  for (const [path,hash] of Object.entries(freeze.hashes)) {
    const actual=createHash('sha256').update(await readFile(resolve(root,path))).digest('hex');
    if (actual!==hash) throw new Error(`Runtime hash mismatch: ${path}`);
  }
  const schema=schemaFor(system);
  const fingerprint=(core:string)=>createHash('sha256').update(JSON.stringify({core,model,system,user,schema,reasoning:model==='haiku'?null:'medium'})).digest('hex');
  // Crash recovery consumes a completed receipt that had not reached the pilot cassette.
  if(process.env.VERIFY_PHASE==='pilot') {
    const prior=JSON.parse(await readFile(resolve(base,'evidence/pilot-runtime-freeze.json'),'utf8'));
    const lines=(await readFile(resolve(base,'receipts/calls.jsonl'),'utf8')).trim().split('\n');
    const hit=lines.map(line=>JSON.parse(line)).find(r=>r.fingerprint===fingerprint(prior.coreSha));
    if(hit) {
      await appendFile(resolve(base,'receipts/recovered.jsonl'),JSON.stringify({originalReceipt:hit.id,at:new Date().toISOString(),model})+'\n');
      process.stdout.write(JSON.stringify({result:hit.text,total_cost_usd:hit.costUsd,is_error:false}));
      process.exit(0);
    }
  }
  await mkdir(resolve(base,'receipts'),{recursive:true});
  budget('reserve',model.startsWith('gemini-')?1:0.5);
  reservation=true;
  let result:any;
  let metadata:any;
  if (model==='haiku') {
    const { createDialectTransport }=await import('../../packages/judges/src/clients/transport');
    // Frozen Haiku prompts already own their output instructions, including scratchpad where applicable.
    const env:Record<string,string|undefined>={...process.env,CLAUDE_JUDGE_MODEL:'claude-haiku-5-5',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'16384'};
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
    const isGoogle=model.startsWith('gemini-');
    const keyFile=isGoogle ? process.env.VERIFY_GEMINI_KEY_FILE : process.env.VERIFY_OPENAI_KEY_FILE;
    if (!keyFile) throw new Error('Provider key file path is required');
    const allowed=resolve(process.env.HOME!,'.nexus-secrets',isGoogle?'gemini-driftbench.key':'openai.key');
    if(resolve(keyFile)!==allowed) throw new Error('Only the owner-authorized key file may be used');
    const key=(await readFile(keyFile,'utf8')).trim();
    const { createDialectTransport }=await import('../../packages/judges/src/clients/transport');
    const transport=createDialectTransport({provider:isGoogle?'google':'openai',model,
      env:isGoogle?{GEMINI_API_KEY:key}:{OPENAI_API_KEY:key}, reasoning:'medium',
      timeoutMs:180000,maxTokens:32768,maxRetries:0});
    const response=await transport.complete({system,user,...(schema?{schema}:{})});
    const raw=JSON.parse(response.raw);
    const usage=isGoogle?raw.usageMetadata:raw.usage;
    if(!usage) throw new Error('Provider omitted token usage; reservation retained');
    // Frozen prices and source URLs are inherited from PR 168's verified shim price table.
    const input=isGoogle?usage.promptTokenCount:usage.prompt_tokens;
    const output=isGoogle?(usage.candidatesTokenCount??0)+(usage.thoughtsTokenCount??0):usage.completion_tokens;
    if(!Number.isFinite(input)||!Number.isFinite(output)) throw new Error('Incomplete token usage');
    const cached=isGoogle?0:Math.min(input,usage.prompt_tokens_details?.cached_tokens??0);
    const long=!isGoogle&&input>272000;
    const cost=isGoogle?(input*0.75+output*3.75)/1e6:
      ((input-cached)*0.10*(long?2:1)+cached*0.01*(long?2:1)+output*0.50*(long?1.5:1))/1e6;
    result={result:response.text,total_cost_usd:cost,is_error:false};
    metadata={...response,raw:undefined,text:undefined,usage};
  }
  const state=budget('settle',result.total_cost_usd);
  reservation=false;
  await appendFile(resolve(base,'receipts/calls.jsonl'),JSON.stringify({
    id,at:new Date().toISOString(),model,fingerprint:fingerprint(freeze.coreSha),phase:process.env.VERIFY_PHASE,
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
