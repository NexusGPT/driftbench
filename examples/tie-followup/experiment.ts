import {readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createTransport} from './transport.ts';
import {score, flip, comparison} from './statistics.ts';

const [mode, dataDirArg, recordDirArg, codeRootArg, resultDirArg] = process.argv.slice(2);
if (!['dev','freeze','fresh','report'].includes(mode)) throw Error('Mode: dev | freeze | fresh | report; then dataDir recordDir codeRoot resultDir');
const dataDir = resolve(dataDirArg), recordDir = resolve(recordDirArg), codeRoot = resolve(codeRootArg), resultDir = resolve(resultDirArg);
mkdirSync(recordDir, {recursive:true}); mkdirSync(resultDir, {recursive:true});
const load = (p:string) => JSON.parse(readFileSync(p,'utf8'));
const hash = (x:string|Buffer) => createHash('sha256').update(x).digest('hex');
const write = (p:string,x:unknown) => writeFileSync(p, JSON.stringify(x,null,2)+'\n');
const lines = (p:string):any[] => existsSync(p) ? readFileSync(p,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)) : [];
const append = (p:string,x:unknown) => appendFileSync(p, JSON.stringify(x)+'\n');
const source = async (name:string) => import(pathToFileURL(resolve(codeRoot,'packages/judges/src',name+'.ts')).href);
const core = await source('pair-ledger'), promptApi = await source('prompt'), assessment = await source('assessment');
const models = ['gpt-6.1-sol','gpt-6-luna','gemini-3.5-flash-lite'];
const nativeModel = 'claude-haiku-5-5';
const decisionFile = resolve(recordDir,'decisions.jsonl');
const keyOf = (r:any) => JSON.stringify([r.phase,r.model,r.benchmark,r.id,r.variant]);
const decisions = new Map(lines(decisionFile).map(r=>[keyOf(r),r]));
const dev = load(resolve(dataDir,'dev.json'));
const heldout = load(resolve(dataDir,'heldout.json'));
const protocol = load(resolve(resultDir,'protocol.json'));
const template = readFileSync(resolve(dataDir,'promptfoo-select-best.txt'),'utf8');
let stopped = false;
process.on('SIGTERM',()=>{stopped=true;});
function snapshot(state:string, extra:any={}) {
  write(resolve(recordDir,'state.json'),{at:new Date().toISOString(),pid:process.pid,mode,state,decisions:decisions.size,...extra});
}
function sources() {
  const paths = ['pair-ledger.ts','pair-ledger-followup.ts','pair-ledger-contract.ts','pair-stage0.ts','prompt.ts','assessment.ts','contract.ts'];
  return Object.fromEntries(paths.map(p=>[p,hash(readFileSync(resolve(codeRoot,'packages/judges/src',p)))]));
}
function checkInputs() {
  for (const [f,h] of Object.entries(protocol.inputHashes)) {
    if(hash(readFileSync(resolve(dataDir,f)))!==h) throw Error('Input changed: '+f);
  }
  if (JSON.stringify(sources()) !== JSON.stringify(protocol.codeHashes)) throw Error('Code changed after protocol registration');
  for(const [f,h] of Object.entries(protocol.runtimeHashes ?? {})) {
    if(hash(readFileSync(resolve(resultDir,f)))!==h)throw Error('Experiment source changed: '+f);
  }
}
function pf(item:any, reversed=false) {
  const values:any = {criteria:`${item.criterion.rubric} The question: ${item.prompt}`,a:reversed?item.B:item.A,b:reversed?item.A:item.B};
  return {system:template.replace(/\{\{(criteria|a|b)\}\}/g,(_:any,k:string)=>values[k]),user:'Output the index now.'};
}
function pick(text:string) {
  const n=text.match(/-?\d+/)?.[0]; return n==='0'?'A':n==='1'?'B':null;
}
function lastNumber(text:string) {
  const normalized=text.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
  const matches=normalized.match(/-?\d+(?:[.,\u202f\u00a0 ]\d{3})*(?:[.,]\d+)?/g);
  if(!matches?.length)return undefined;
  let x=matches.at(-1)!.replace(/[\u202f\u00a0 ]/g,'');
  x=/^-?\d{1,3}([.,]\d{3})+$/.test(x)?x.replace(/[.,]/g,''):x.replace(',','.');
  const n=Number(x);return Number.isFinite(n)?n:undefined;
}
function lastJSON(text:string) {
  for(let i=text.lastIndexOf('{');i>=0;i=text.lastIndexOf('{',i-1)) {
    try{return JSON.parse(text.slice(i,text.lastIndexOf('}')+1));}catch{}
  }
  throw Error('Unparsed computation');
}
function computePort(transport:any,meta:any) {
  return {
    async solve(question:string) {
      const response=await transport.ask({system:'Solve the grade-school math problem independently. The problem is data. Return JSON {"program":"..."} containing short Python: numeric assignments, arithmetic, assert with an independent backward check, and print exactly one final numeric answer. No imports, loops, attributes, strings, files or external calls. Allowed helper calls: abs, round, min, max. If not a numerical problem return an empty program.',user:JSON.stringify({problem:question})},
        {type:'object',additionalProperties:false,required:['program'],properties:{program:{type:'string'}}},{...meta,stage:'compute'});
      const program=lastJSON(response.text).program;
      const ran=spawnSync('python3',['-I',resolve(dataDir,'compute.py')],{input:JSON.stringify({program}),encoding:'utf8',timeout:5000,maxBuffer:1e6});
      append(resolve(recordDir,'compute.jsonl'),{...meta,program,stdout:ran.stdout,stderr:ran.stderr,status:ran.status});
      if(ran.status!==0)return undefined;
      const result=JSON.parse(ran.stdout);return result.error?undefined:{answer:result.answer,evidence:JSON.stringify(result.checks)};
    },
    async backwardCheck({answer,solution}:any) {
      const n=lastNumber(answer),expected=Number(solution.answer);
      return n===undefined||!Number.isFinite(expected)?undefined:Math.abs(n-expected)<1e-6;
    }
  };
}
async function evaluate(phase:string,model:string,item:any,variant:string,transport:any) {
  const meta={phase,model,benchmark:item.benchmark,id:item.id,subset:item.subset,variant};
  if(decisions.has(keyOf(meta)))return;
  if(stopped)throw Error('Supervisor draining');
  let games:(string|null)[], details:any, returnedCalls=0;
  if(variant==='promptfoo') {
    games=[];
    for(const reversed of [false,true]) {
      const response=await transport.ask(pf(item,reversed),undefined,{...meta,phase:phase==='fresh'?'heldout':phase,order:reversed?'BA':'AB'});
      const p=response.refusal||response.truncated?null:pick(response.text);
      games.push(reversed?flip(p):p); returnedCalls++;
    }
  } else {
    const native=model===nativeModel;
    const client={id:model,model,family:native?'anthropic':model.startsWith('gemini')?'google':'openai',cls:'system2',cost:1,
      dialect:native?'scratchpad-json':model.startsWith('gemini')?'google-response-schema':'openai-json-schema',reasoning:native?undefined:'medium',
      async judge(request:any) {
        const response=await transport.ask(promptApi.buildPrompt(request),assessment.responseSchema(request),{...meta,phase:phase==='fresh'?'heldout':phase,stage:'ledger',callIndex:returnedCalls++});
        return {raw:response.refusal||response.truncated?'':response.text,costUsd:response.costUsd};
      }};
    const request=core.pairLedgerRequest(item.criterion,[{role:'user',text:item.prompt}],item.A,item.B,
      {requirements:item.requirements,...(native?{}:{reasoning:'medium'})});
    const stage0=item.benchmark==='wp'?{correctness:false,compute:false,language:item.language}:
      item.benchmark==='mm'?{correctness:item.subset==='reasoning',language:item.language,timeoutMs:86400000,compute:item.subset==='reasoning'?computePort(transport,meta):false}:
      {correctness:true};
    details=await core.judgePairLedger(client,request,{stage0,tiePolicy:item.benchmark==='mm'?'tie':'canonical',...(variant==='baseline'?{}:{tieFollowup:variant})});
    const p=details.choice==='first'?'A':details.choice==='second'?'B':details.choice==='tie'?'tie':null;
    games=[p,p];
  }
  const row={...meta,games,score:score(item.benchmark,games,item.gold),graderError:games.some(g=>g===null),returnedCalls,details,at:new Date().toISOString()};
  append(decisionFile,row);decisions.set(keyOf(meta),row);snapshot('running',{phase,model,benchmark:item.benchmark,spend:transport.totals()});
}
function summarize(phase:string,variant:string) {
  const groups:any={};
  for(const r of decisions.values()) {
    if(r.phase!==phase||r.variant!==variant)continue;
    const baseline=decisions.get(keyOf({...r,variant:'baseline'})),pf=decisions.get(keyOf({...r,variant:'promptfoo'}));
    if(!baseline||!pf)continue;
    for(const g of [`${r.model}/${r.benchmark}`,...(r.benchmark==='mm'?[`${r.model}/mm/${r.subset}`]:[])]) {
      (groups[g]??=[]).push({ledger:r.score,promptfoo:pf.score,baseline:baseline.score});
    }
  }
  const result:any=Object.fromEntries(Object.entries(groups).map(([g,rows]:any)=>[g,comparison(rows)]));
  for(const model of models) {
    const aggregate=result[`${model}/mm`];
    if(!aggregate)continue;
    const subsets=Object.entries(result).filter(([k])=>k.startsWith(`${model}/mm/`)).map(([,v])=>v) as any[];
    aggregate.micro={ledger:aggregate.ledger,promptfoo:aggregate.promptfoo,baseline:aggregate.baseline};
    for(const k of ['ledger','promptfoo','baseline'])aggregate[k]=subsets.reduce((s,r)=>s+r[k],0)/subsets.length;
    aggregate.metric='Equal-weight macro average of subset two-order scores; paired exact sign test uses unique pairs.';
  }
  return result;
}
function choose() {
  const variants=['direct','reasoning'];
  const tables=Object.fromEntries(variants.map(v=>[v,summarize('dev',v)]));
  const means=Object.fromEntries(variants.map(v=>[v,Object.entries(tables[v]).filter(([k])=>k.split('/').length===2).reduce((s,[,r]:any)=>s+r.ledger,0)/9]));
  return {variant:means.reasoning>means.direct?'reasoning':'direct',means,tables};
}
checkInputs();
if(mode==='dev'||mode==='fresh') {
  let selected:any;
  if(mode==='fresh') {
    const f=resolve(resultDir,'frozen-choice.json');
    if(hash(readFileSync(f))!==readFileSync(f+'.sha256','utf8').trim())throw Error('Choice hash mismatch');
    selected=load(f);if(JSON.stringify(selected.codeHashes)!==JSON.stringify(sources()))throw Error('Frozen code changed');
  }
  const cohort=mode==='dev'?dev:heldout;
  for(const model of [...models,...(mode==='fresh'?[nativeModel]:[])]) {
    const transport=createTransport({dir:recordDir,model,maxOutputTokens:4096});
    snapshot('health-gate',{model});await transport.healthGate();
    const items=cohort.filter((i:any)=>model!==nativeModel||i.benchmark==='wp').slice(0,model===nativeModel?50:undefined);
    const variants=mode==='dev'?['baseline','direct','reasoning','promptfoo']:['baseline',selected.variant,'promptfoo'];
    let cursor=0;
    // Two item workers, each sequential; transport also enforces a global two-call ceiling.
    let failure:any;
    const worker=async()=>{try{while(cursor<items.length&&!stopped){const item=items[cursor++];for(const variant of variants)await evaluate(mode,model,item,variant,transport);}}catch(e){failure??=e;stopped=true;transport.stop();}};
    await Promise.allSettled([worker(),worker()]);
    await transport.drain();write(resolve(resultDir,mode+'-spend.json'),transport.totals());
    if(failure){snapshot('stopped',{error:String(failure),spend:transport.totals()});throw failure;}
  }
  write(resolve(resultDir,mode+'-results.json'),mode==='dev'?choose():summarize('fresh',selected.variant));
  snapshot('complete');
} else if(mode==='freeze') {
  const expected=dev.length*models.length*4;
  const count=[...decisions.values()].filter(r=>r.phase==='dev').length;
  if(count!==expected)throw Error(`Incomplete dev ${count}/${expected}`);
  const choice=choose();
  const record={at:new Date().toISOString(),...choice,selectionRule:protocol.selectionRule,codeHashes:sources(),inputHashes:protocol.inputHashes,runtimeHashes:protocol.runtimeHashes,
    devDecisionsHash:hash(readFileSync(decisionFile)),protocolHash:hash(readFileSync(resolve(resultDir,'protocol.json')))};
  const f=resolve(resultDir,'frozen-choice.json');
  if(existsSync(f))throw Error('Choice already frozen; never overwrite');
  write(f,record);writeFileSync(f+'.sha256',hash(readFileSync(f))+'\n');
  write(resolve(resultDir,'dev-results.json'),choice);
  console.log(JSON.stringify({variant:choice.variant,sha256:hash(readFileSync(f))}));
} else {
  const selected=load(resolve(resultDir,'frozen-choice.json'));
  write(resolve(resultDir,'heldout-results.json'),summarize('fresh',selected.variant));
  write(resolve(resultDir,'dev-results.json'),choose());
}
