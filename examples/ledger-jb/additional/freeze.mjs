import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,readJson,verifySeal} from '../src/harness.mjs';
import {MODELS,settingsFor,PRICE} from './adapter.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(root,'../..');
const old=readJson(join(root,'freeze.json'));verifySeal(root);
const paths=[...Object.keys(old.hashes),...readdirSync(join(root,'additional')).filter(x=>x.endsWith('.mjs')).map(x=>`examples/ledger-jb/additional/${x}`)];
const hashes=Object.fromEntries([...new Set(paths)].sort().map(p=>[p,hash(readFileSync(join(repo,p)))]));
for(const model of MODELS){
  const cell=join(root,'cells',model);mkdirSync(cell,{recursive:true});
  const price=model==='gpt-6.1-sol'?{status:'published price verified',usdPerMillionTokens:PRICE,url:'https://developers.openai.com/api/docs/pricing',
    modelUrl:'https://developers.openai.com/api/docs/models/gpt-6.1-sol',serviceTier:'standard',retrievedAt:'2026-10-13',
    note:'Input and cache rates double above 272000 input tokens; output rate multiplies by 1.5. Bill all output including reasoning.'}:
    {status:'actual cost from Claude CLI total_cost_usd',route:'native CLI alias sonnet in isolated empty folder',publishedPrice:'not used; provider-reported request cost'};
  writeFileSync(join(cell,'price.json'),JSON.stringify(price,null,2)+'\n');
  const freeze={version:1,createdAt:new Date().toISOString(),model,coreCommit:old.coreCommit,corePr:old.corePr,
    priorExecutionFreezeSha256:hash(readFileSync(join(root,'freeze.json'))),sealSha256:hash(readFileSync(join(root,'data/seal.json'))),
    poolSha256:hash(readFileSync(join(root,'data/pool.json'))),settings:settingsFor(model),capUsd:25,
    authorization:'Owner: 25 USD per new model cell, separate from the earlier 25 USD total. Measure first five Sonnet requests, project the cell, and stop if either projection passes 25 USD. Go ahead with both transports now.',
    priorLiabilityUsd:14.11485872,budgetScope:'This model only; no transfer from or to the existing cell budget or other new model.',
    transportPolicy:{timeoutMs:300000,maxNonQuotaAttempts:3,quotaBackoffMs:[60000,120000,240000],returnedAnswerRetries:0,
      schemaReask:'Unchanged core single re-ask per malformed reading; enabled.',billing:'402 stops immediately, no retry or judge error; only proven rejection releases holds.'},
    workers:model==='gpt-6.1-sol'?8:4,claudeFallback:{workers:2,loadGreaterThan:60,transportFailures:2,windowMs:600000,latched:true},
    tokenCap:{totalOutputIncludingThinking:8192,reasoningEffort:'medium',claudeFixedThinkingTokens:null,
      note:'Sonnet 5.5 always uses adaptive reasoning, so positive MAX_THINKING_TOKENS is ignored. Total output cap bounds thinking and answer together.',
      source:'https://code.claude.com/docs/en/env-vars',openaiSource:'https://developers.openai.com/api/docs/guides/reasoning'},
    phases:['pilot','fixtures','noise','validity','test'],probe:'First five physical pilot requests, sequential, saved for missing-only replay. Both contestants represented. No extra probe payloads.',
    projection:'Mean request cost per contestant times all planned decisions; ledger assumes 2.2 reads plus 2% schema re-asks, then at least the observed full pilot rate. Check after five requests and after the complete pilot. Stop when projection exceeds 25 USD.',
    lastCallCutoff:old.lastCallCutoff,testPairs:270,winRule:'TIE-only for wins; an uncorrected significant observed loss remains a LOSS. No equivalence claim.',
    registration:'Additional model cell authorized after prior cells were measured. Same sealed set once, no tuning. Original 18-cell family unchanged; parent assigns additional-cell multiplicity family.',
    familyDisclosure:model==='claude-sonnet-5-5'?'Anthropic judge shares the Claude response generator family.':'OpenAI judge does not share the Claude response generator family.',
    overlapDisclosure:'159 source-question IDs and 91 exact texts overlap earlier evaluations; 270 pairs contain 269 distinct exact question texts.',
    priceRecord:`examples/ledger-jb/cells/${model}/price.json`,hashes:{...hashes,[`examples/ledger-jb/cells/${model}/price.json`]:hash(readFileSync(join(cell,'price.json')))}};
  writeFileSync(join(cell,'freeze.json'),JSON.stringify(freeze,null,2)+'\n');
  console.log(JSON.stringify({model,freezeSha256:hash(readFileSync(join(cell,'freeze.json')))}));
}
