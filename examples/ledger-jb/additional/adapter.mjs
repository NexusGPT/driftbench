import {readFileSync,mkdtempSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {PROVIDERS,judgePair} from '../src/core-adapter.mjs';
import {buildDialectRequest} from '../../../packages/judges/src/clients/transport.ts';
import {CLAUDE_JUDGE_FLAGS,runClaudeCommand} from '../../../packages/judges/src/clients/claude-cli.ts';
import {JudgeError,postJson} from '../../../packages/judges/src/http.ts';

export {judgePair};
export const MODELS=['claude-sonnet-5-5','gpt-6.1-sol'];
// Register new identities without changing the frozen core or original cells.
PROVIDERS[MODELS[0]]={provider:'claude-cli',family:'anthropic',dialect:'scratchpad-json'};
PROVIDERS[MODELS[1]]={provider:'openai',family:'openai',dialect:'openai-json-schema'};
export const PRICE={input:2,cached:.1,cacheWrite:2.5,output:10,longContext:272000};
export function settingsFor(model){
  if(!MODELS.includes(model))throw new Error('New cells only');
  return {...PROVIDERS[model],reasoning:model===MODELS[1]?'medium':null,effort:model===MODELS[0]?'medium':null,
    maxTokens:8192,timeoutMs:300000,maxBudgetUsd:.1,nativeReservationUsd:.5,
    route:model===MODELS[0]?'native-claude-cli-sonnet':'https://api.openai.com/v1/responses',serviceTier:model===MODELS[1]?'default':null};
}
export function responsesBody(prompt,schema,settings){
  return {model:'gpt-6.1-sol',input:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],
    reasoning:{effort:settings.reasoning},max_output_tokens:settings.maxTokens,service_tier:'default',store:false,
    ...(schema?{text:{format:{type:'json_schema',name:'judge_answer',strict:true,schema}}}:{} )};
}
export function responseCost(value){
  const u=value.usage;if(!Number.isFinite(u?.input_tokens)||!Number.isFinite(u?.output_tokens))return undefined;
  const input=u.input_tokens,cached=u.input_tokens_details?.cached_tokens??0,write=u.input_tokens_details?.cache_write_tokens??0;
  if(cached<0||write<0||cached+write>input)throw new Error('Invalid billed token counts');
  const long=input>PRICE.longContext;
  return ((input-cached-write)*PRICE.input*(long?2:1)+cached*PRICE.cached*(long?2:1)+write*PRICE.cacheWrite*(long?2:1)+u.output_tokens*PRICE.output*(long?1.5:1))/1e6;
}
export function readResponses(value){
  const content=(value.output??[]).filter(x=>x.type==='message').flatMap(x=>x.content??[]);
  const text=content.filter(x=>x.type==='output_text').map(x=>x.text).join('');
  const refusal=content.filter(x=>x.type==='refusal').map(x=>x.refusal).join('');
  const truncated=value.incomplete_details?.reason==='max_output_tokens';
  return {text,rawProvider:JSON.stringify(value),returnedAnswer:true,costUsd:responseCost(value),
    usage:{input:value.usage?.input_tokens,output:value.usage?.output_tokens,cached:value.usage?.input_tokens_details?.cached_tokens??0,
      cacheWrite:value.usage?.input_tokens_details?.cache_write_tokens??0,reasoning:value.usage?.output_tokens_details?.reasoning_tokens??0},
    modelActual:value.model,serviceTierActual:value.service_tier,finishReason:value.incomplete_details?.reason??value.status,
    truncated,refusal,graderError:Boolean(truncated||refusal||value.error),tokenCapHit:truncated};
}
export function claudeEnvironment(base){
  const env={...base};
  for(const key of ['OPENAI_JUDGE_MODEL','GOOGLE_JUDGE_MODEL','CLAUDE_JUDGE_MODEL','ANTHROPIC_JUDGE_MODEL','OPENAI_BASE_URL','GOOGLE_BASE_URL',
    'ANTHROPIC_BASE_URL','CLAUDECODE','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','MAX_THINKING_TOKENS',
    'CLAUDE_CODE_DISABLE_THINKING','CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING','CLAUDE_CODE_RETRY_WATCHDOG'])delete env[key];
  return {...env,CLAUDE_CODE_MAX_OUTPUT_TOKENS:'8192',CLAUDE_CODE_EFFORT_LEVEL:'medium',CLAUDE_CODE_MAX_RETRIES:'0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_TERMINAL_TITLE:'1'};
}
export function claudeArgs(prompt){return ['-p','--output-format','json','--model','sonnet','--system-prompt',prompt.system,
  ...CLAUDE_JUDGE_FLAGS,'--effort','medium','--max-budget-usd','0.1'];}
export function readClaude(ran){
  let value;try{value=JSON.parse(ran.stdout);}catch{
    // Non-JSON stdout may contain a model answer. Preserve it and never retry it.
    if(ran.stdout.trim())return {text:ran.stdout,rawProvider:ran.stdout,returnedAnswer:true,graderError:true,finishReason:'invalid-cli-envelope'};
    throw new JudgeError('network',`Claude returned no stdout, exit ${ran.code}: ${ran.stderr.slice(0,500)}`,{retryable:true});
  }
  const text=typeof value.result==='string'?value.result:'';
  const errors=Array.isArray(value.errors)?value.errors.join('\n'):'';
  const models=Object.keys(value.modelUsage??{});
  const usageEntries=Object.values(value.modelUsage??{});
  const usage={input:0,output:0,cached:0,cacheWrite:0};
  for(const u of usageEntries){usage.input+=(u.inputTokens??0)+(u.cacheReadInputTokens??0)+(u.cacheCreationInputTokens??0);
    usage.output+=u.outputTokens??0;usage.cached+=u.cacheReadInputTokens??0;usage.cacheWrite+=u.cacheCreationInputTokens??0;}
  const costUsd=Number.isFinite(value.total_cost_usd)?value.total_cost_usd:undefined;
  const tokenCapHit=/max.?tokens|output.?token.?limit|token.?limit|65536|65,536/i.test(`${value.subtype} ${errors}`)||usage.output>=8192;
  // A nonempty result is a returned answer even if the envelope also reports an error.
  if(!text&&value.is_error&&!tokenCapHit){
    const status=Number(errors.match(/\b(402|429|5\d\d)\b/)?.[1])||undefined;
    const error=new JudgeError('http',`Claude ${value.subtype}: ${errors||'no model answer'}`,{status,retryable:!status||status===429||status>=500});
    error.raw=ran.stdout;error.costUsd=costUsd;error.usage=usage;throw error;
  }
  return {text,rawProvider:ran.stdout,returnedAnswer:true,costUsd,usage,modelActual:models.join(','),finishReason:value.subtype,
    tokenCapHit,truncated:tokenCapHit||value.subtype!=='success',graderError:value.subtype!=='success'||Boolean(value.is_error),
    providerErrors:errors||null};
}
export function createTransport(model,settings){
  if(JSON.stringify(settings)!==JSON.stringify(settingsFor(model)))throw new Error('Settings differ from frozen registration');
  const isClaude=model===MODELS[0];
  const key=isClaude?null:readFileSync(join(homedir(),'.nexus-secrets/openai.key'),'utf8').trim();
  const env=isClaude?claudeEnvironment(process.env):null;
  const cwd=isClaude?mkdtempSync(join(tmpdir(),'ledger-jb-sonnet-empty-')):null;
  return {
    maximumCostUsd(prompt,schema){
      if(isClaude)return settings.nativeReservationUsd;
      const bound=Buffer.byteLength(JSON.stringify(responsesBody(prompt,schema,settings)))+4096;
      const long=bound>PRICE.longContext;
      return (bound*Math.max(PRICE.input,PRICE.cacheWrite)*(long?2:1)+settings.maxTokens*PRICE.output*(long?1.5:1))/1e6;
    },
    async call(prompt,{schema}){
      const started=Date.now();let result;
      if(isClaude){
        const built=buildDialectRequest('claude-cli',{...prompt,...(schema?{schema}:{})});
        result=readClaude(await runClaudeCommand('claude',claudeArgs(prompt),built.payload.user,{cwd,env,timeoutMs:settings.timeoutMs}));
      }else result=readResponses(await postJson(settings.route,{authorization:`Bearer ${key}`},responsesBody(prompt,schema,settings),{timeoutMs:settings.timeoutMs,maxRetries:0}));
      return {...result,elapsedMs:Date.now()-started};
    },
  };
}
