#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, readJson, readJsonl, verifySeal } from './harness.mjs';
import { compare, cheaters, noiseFloor, kappa, officialCorrect, validity } from './statistics.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const seal = verifySeal(root);
const data = Object.fromEntries(['pool','dev','fixtures','pilot','noise','validity'].map(name => [name,readJson(join(root,`data/${name}.json`))]));
const calls = readJsonl(join(root,'results/calls.jsonl'));
const cells = [];
for (const model of ['claude-haiku-5-5','gpt-6-luna','gemini-3.8-flash']) {
  const phases = Object.fromEntries(['fixtures','pilot','noise','validity','test'].map(phase=>[phase,readJsonl(join(root,`results/decisions-${phase}-${model}.jsonl`))]));
  const summary = compare(data.pool, phases.test.filter(x=>x.contestant==='ledger'), phases.test.filter(x=>x.contestant==='promptfoo'));
  const fixtureEarning = Object.fromEntries([...new Set(data.fixtures.map(x=>x.group))].map(group=>{
    const items = data.fixtures.filter(x=>x.group===group), measured = phases.fixtures.filter(x=>x.group===group);
    const complete = measured.length === items.length * 3 && new Set(measured.map(x=>`${x.itemId}:${x.repeat}`)).size === items.length*3;
    const correct = measured.filter(row=>row.games[0] === row.label && row.games[1] === row.label && !row.graderErrors).length;
    const observedKappa = complete ? kappa(measured.map(x=>x.label),measured.map(x=>x.games[0] === x.games[1] ? x.games[0] : null)) : null;
    return [group,{ expected:items.length*3, measured:measured.length, correct, kappa:observedKappa,
      earned:complete && correct===items.length*3 && observedKappa>=.8, status:complete?'MEASURED':'PENDING' }];
  }));
  const cost = {};
  for (const contestant of ['ledger','promptfoo']) {
    const paid = calls.filter(x=>x.type==='finish' && x.model===model && x.contestant===contestant && x.phase==='test');
    const measuredCost = paid.reduce((n,x)=>n+x.costUsd,0);
    const units = phases.test.filter(x=>x.contestant===contestant).length;
    cost[contestant]={usd:measuredCost,units,per100:units?100*measuredCost/units:null};
  }
  const noise = Object.fromEntries(['ledger','promptfoo'].map(contestant=>[contestant,noiseFloor(data.noise,phases.noise.filter(x=>x.contestant===contestant))]));
  const pilot = compare(data.pilot,phases.pilot.filter(x=>x.contestant==='ledger'),phases.pilot.filter(x=>x.contestant==='promptfoo'));
  const checks = validity(data.validity, phases.validity);
  const prepItems = [...data.fixtures,...data.pilot,...data.noise];
  const prepRows = [...phases.fixtures,...phases.pilot,...phases.noise].filter(x=>x.contestant==='ledger' && x.repeat===0);
  const prepCheaters = cheaters(prepItems);
  const prepAccuracy = prepRows.length===prepItems.length ? prepRows.reduce((n,row)=>n+officialCorrect(row.games,row.label),0)/prepRows.length : null;
  const cheaterGate = prepAccuracy !== null && Object.values(prepCheaters).every(c=>c.estimate<=.5 || prepAccuracy-c.estimate>=.1);
  const freezeFile = join(root,'freeze.json');
  const readiness = { model, freezeSha256:existsSync(freezeFile)?hash(readFileSync(freezeFile)):null,
    pilotComplete:pilot.n===data.pilot.length, noiseComplete:Object.values(noise).every(x=>x.completed===data.noise.length),
    fixturesComplete:Object.values(fixtureEarning).every(x=>x.status==='MEASURED'),
    validityPassed:Object.values(checks).every(x=>x.passed)&&cheaterGate,
    cheaterGate, prepAccuracy, prepCheaters, checks, fixtureEarning };
  writeFileSync(join(root,`results/readiness-${model}.json`),JSON.stringify(readiness,null,2)+'\n');
  const cell={model,status:summary.n?'MEASURED':'PENDING_CORE',...summary,cost,noise,fixtureEarning,pilot,validity:checks,cheaterGate,prepAccuracy,
    cheaters:{dev:cheaters(data.dev),test:cheaters(data.pool)},powerRegistration:seal.powerRegistration,familyDisclosure:seal.familyDisclosure};
  cells.push(cell);
  writeFileSync(join(root,`results/items-${model}.json`),JSON.stringify(summary.decisions,null,2)+'\n');
}

const finishes=calls.filter(x=>x.type==='finish'),finishedKeys=new Set(finishes.map(x=>x.key));
const measuredUsd=finishes.reduce((n,x)=>n+x.costUsd,0), pending=calls.filter(x=>x.type==='start'&&!finishedKeys.has(x.key));
const summary={sealSha256:hash(readFileSync(join(root,'data/seal.json'))),poolSha256:seal.hashes['pool.json'],
  coreFreeze:existsSync(join(root,'freeze.json'))?hash(readFileSync(join(root,'freeze.json'))):null,
  totalCalls:finishes.length,measuredUsd,unresolvedCalls:pending.length,reservedUsd:pending.reduce((n,x)=>n+x.reserveUsd,0),cells};
writeFileSync(join(root,'results/cells.json'),JSON.stringify(summary,null,2)+'\n');
const fmt=x=>x==null?'pending':(100*x).toFixed(2)+'%';
const text=['# JudgeBench cell table','',`Pool: ${seal.eligibleCount} Claude-response pairs. ${seal.questionOverlapCount} source-question IDs overlap earlier GPT evaluations, including ${seal.exactQuestionOverlapCount} exact texts.`,'',
'| Model | Coverage | Ledger accuracy (Wilson 95%) | promptfoo accuracy (Wilson 95%) | Wins / losses | Exact p | Holm p | USD per 100 ledger / peer | Noise ledger / peer | Status |',
'|---|---|---|---|---|---|---|---|---|---|'];
for(const c of cells) {
  if(!c.ledger){text.push(`| ${c.model} | 0/${seal.eligibleCount} | pending | pending | pending | pending | pending | pending | pending | ${c.status} |`);continue;}
  const score=x=>x.estimate==null?'pending':`${fmt(x.estimate)} (${fmt(x.lower)} to ${fmt(x.upper)})`;
  text.push(`| ${c.model} | ${c.n}/${c.planned} | ${score(c.ledger)} | ${score(c.promptfoo)} | ${c.n?`${c.wins} / ${c.losses}`:'pending'} | ${c.n?c.p:'pending'} | pending global family | ${c.cost.ledger.per100?.toFixed(4)??'pending'} / ${c.cost.promptfoo.per100?.toFixed(4)??'pending'} | ${fmt(c.noise.ledger.rate)} / ${fmt(c.noise.promptfoo.rate)} | ${c.status} |`);
}
text.push('', '| Cheater | GPT dev accuracy | Claude test-pool accuracy |', '|---|---|---|');
for (const [name, c] of Object.entries(cheaters(data.dev))) {
  const t = cheaters(data.pool)[name];
  text.push(`| ${name} | ${c.correct}/${c.n} (${fmt(c.estimate)}) | ${t.correct}/${t.n} (${fmt(t.estimate)}) |`);
}
text.push('',`Measured spend: ${measuredUsd.toFixed(8)} USD. Completed calls: ${finishes.length}. Unresolved calls: ${pending.length}.`,
'',seal.powerRegistration,'',seal.familyDisclosure,'','Holm correction awaits the full 18-cell family. Missing cells never count as ties or wins.','',
'Inputs and all measured quantities: data/seal.json and results/cells.json. Per-item decisions: results/items-<model>.json.');
writeFileSync(join(root,'results/cells.md'),text.join('\n')+'\n');
console.log(text.join('\n'));
