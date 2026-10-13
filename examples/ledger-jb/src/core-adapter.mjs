import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt, pairLedgerRequest, pairLedgerSchema, parsePairLedgerText, judgePairLedger,
  scoreLedger, createDialectTransport, FROZEN_BENCHMARK_REASONING } from '../../../packages/judges/src/index.ts';
import { CRITERION } from './harness.mjs';

export const PROVIDERS = {
  'claude-haiku-5-5': { provider:'claude-cli', family:'anthropic', dialect:'scratchpad-json' },
  'gpt-6-luna': { provider:'openai', family:'openai', dialect:'openai-json-schema' },
  'gemini-3.8-flash': { provider:'google', family:'google', dialect:'google-response-schema' },
  'gemini-3.5-flash-lite': { provider:'google', family:'google', dialect:'google-response-schema' },
};
// Original rates verified by PR 168; added Flash Lite rate verified against Google on 2026-10-13.
// Standard USD per million tokens; source record: ../gemini-lite-price.json.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://ai.google.dev/gemini-api/docs/pricing
export const PRICES = {
  'gpt-6-luna': { input:.1, cached:.01, output:.5, longContext:272000 },
  'gemini-3.8-flash': { input:.75, output:3.75 },
  'gemini-3.5-flash-lite': { input:.30, output:2.50 },
};
export const settingsFor = model => ({ reasoning:model==='gemini-3.5-flash-lite'?'medium':FROZEN_BENCHMARK_REASONING[model] ?? null,
  timeoutMs:300000, maxTokens:8192, maxBudgetUsd:.1, provider:PROVIDERS[model].provider,
  dialect:PROVIDERS[model].dialect, nativeReservationUsd:.25 });

export function costFromCompletion(model, response) {
  if (model === 'claude-haiku-5-5') return response.costUsd;
  const price = PRICES[model], usage=response.usage;
  if (!Number.isFinite(usage?.input) || !Number.isFinite(usage?.output)) return undefined;
  let cached=0;
  if (model==='gpt-6-luna') cached=Math.min(usage.input,JSON.parse(response.raw).usage?.prompt_tokens_details?.cached_tokens??0);
  const long = price.longContext && usage.input>price.longContext;
  return ((usage.input-cached)*price.input*(long?2:1)+cached*(price.cached??price.input)*(long?2:1)+usage.output*price.output*(long?1.5:1))/1e6;
}

export async function createTransport({ model, settings }) {
  if (JSON.stringify(settings)!==JSON.stringify(settingsFor(model))) throw new Error('Frozen provider settings differ from core registration');
  const env = { ...process.env };
  for(const key of ['OPENAI_JUDGE_MODEL','GOOGLE_JUDGE_MODEL','CLAUDE_JUDGE_MODEL','ANTHROPIC_JUDGE_MODEL',
    'OPENAI_BASE_URL','GOOGLE_BASE_URL','ANTHROPIC_BASE_URL','CLAUDECODE','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY']) delete env[key];
  if(model==='gpt-6-luna') env.OPENAI_API_KEY=readFileSync(join(homedir(),'.nexus-secrets/openai.key'),'utf8').trim();
  if(PROVIDERS[model].provider==='google') env.GEMINI_API_KEY=readFileSync(join(homedir(),'.nexus-secrets/gemini-driftbench.key'),'utf8').trim();
  const transport=createDialectTransport({ provider:settings.provider, model, env, maxRetries:0,
    timeoutMs:settings.timeoutMs, maxTokens:settings.maxTokens, maxBudgetUsd:settings.maxBudgetUsd,
    ...(settings.reasoning?{reasoning:settings.reasoning}:{}) });
  return {
    maximumCostUsd(prompt,schema) {
      if(model==='claude-haiku-5-5') return settings.nativeReservationUsd;
      // UTF-8 bytes bound ordinary text tokens conservatively; overhead covers message/schema framing.
      const maxInput=Buffer.byteLength(JSON.stringify({prompt,schema}),'utf8')+4096;
      const p=PRICES[model], long=p.longContext&&maxInput>p.longContext;
      // Reserve twice the configured output ceiling, including Google's billed thoughts.
      return (maxInput*p.input*(long?2:1)+2*settings.maxTokens*p.output*(long?1.5:1))/1e6;
    },
    async call(prompt,{schema}) {
      const start=Date.now();
      const response=await transport.complete({...prompt,...(schema?{schema}:{})});
      return { ...response, rawProvider:response.raw, costUsd:costFromCompletion(model,response), elapsedMs:Date.now()-start,
        graderError:Boolean(response.refusal || response.truncated) };
    },
  };
}

export async function judgePair({ item, requirements, model, call, settings }) {
  let nonRetry=0, previousOrder, previousResponse;
  let physicalReads=0, transportExhaustedReasksSuppressed=0;
  const client={ id:`ledger-${model}`, cls:'system2',family:PROVIDERS[model].family, model,cost:10,
    dialect:settings.dialect,...(settings.reasoning?{reasoning:settings.reasoning}:{}),
    async judge(request) {
      const attempt=request.budget==='large'?1:0;
      if (attempt && previousResponse?.transportFailure) {
        transportExhaustedReasksSuppressed++;
        return {...parsePairLedgerText(previousResponse.text,request),costUsd:0,metadata:{transportExhaustedReaskSuppressed:true}};
      }
      const order=attempt?previousOrder:['AB','BA','canonical'][nonRetry++];
      previousOrder=order;
      const response=await call(buildPrompt(request),{order,attempt,schema:pairLedgerSchema(request)});
      physicalReads++; previousResponse=response;
      return {...parsePairLedgerText(response.text,request),costUsd:response.costUsd};
    },
  };
  const request=pairLedgerRequest({name:'objective_correctness',rubric:CRITERION,scope:'block'},
    [{role:'user',text:item.question}],item.a,item.b,
    {requirements:requirements.map(({description,...r})=>({...r,rubric:description})),
      ...(settings.reasoning?{reasoning:settings.reasoning}:{})});
  const result=await judgePairLedger(client,request,{stage0:{correctness:true},tiePolicy:'canonical'});
  const decision=result.choice==='first'?'A':result.choice==='second'?'B':result.status==='tie'?'tie':null;
  const rawGames=result.reads.filter(x=>x.order!=='canonical').map(read=>{
    if(!read.result.pairLedger)return null;
    const sign=scoreLedger(read.result.pairLedger,request.assessment.items).sign*(read.order==='swapped'?-1:1);
    return sign>0?'A':sign<0?'B':'tie';
  });
  return {games:[decision,decision],decision,rawGames,graderErrors:result.reads.filter(x=>x.result.unparsed).length,
    repairedAttempts:result.reads.flatMap(x=>x.attempts).filter(x=>x.repaired).length,
    stage0:result.stage0,verdict:result.verdict??null,reads:result.reads,status:result.status,calls:physicalReads,coreReadInvocations:result.calls,transportExhaustedReasksSuppressed,
    endpoint:'Official pair-net score applied to the code-reconciled pair decision in both games. Raw order games retained separately.'};
}
