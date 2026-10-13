#!/usr/bin/env node
import { appendFileSync, existsSync, openSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash, readJson, readJsonl, verifySeal, verifyFreeze, jobs, Journal, promptfooPrompt, parsePromptfoo, REQUIREMENTS } from './harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(root, '../..');
const argv = process.argv.slice(2);
function flag(name, fallback) { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; }
if (argv.includes('--help')) {
  console.log('node examples/ledger-jb/src/run.mjs --phase fixtures|pilot|noise|validity|test --model claude-haiku-5-5|gpt-6-luna|gemini-3.8-flash [--execute --core-dossier PATH --spend-ledger PATH]\nWithout --execute: offline plan only. Paid execution requires committed freeze.json and adapter.');
  process.exit(0);
}
const phase = flag('--phase', 'pilot'), model = flag('--model', 'claude-haiku-5-5');
const data = Object.fromEntries(['fixtures','pilot','noise','pool','validity'].map(name => [name, readJson(join(root, `data/${name}.json`))]));
verifySeal(root);
const planned = jobs(data, phase, model);
if (!argv.includes('--execute')) {
  console.log(JSON.stringify({ phase, model, pairs: data[{fixtures:'fixtures',pilot:'pilot',noise:'noise',test:'pool',validity:'validity'}[phase]].length,
    jobs: planned.length, minimumCalls: planned.length * 2, maxAdditionalCallsPerLedgerPair: 'Frozen core repair and canonical escalation only',
    paid: false, capUsd: 25, poolSha256: hash(readFileSync(join(root,'data/pool.json'))) }, null, 2));
  process.exit(0);
}
const dossierPath = flag('--core-dossier'), spendPath = flag('--spend-ledger');
if (!dossierPath || !spendPath) throw new Error('Both --core-dossier and --spend-ledger are required');
const freezePath = join(root,'freeze.json');
if (!existsSync(freezePath)) throw new Error('No execution freeze: core contract must land before any paid call');
const freeze = readJson(freezePath), freezeSha256 = hash(readFileSync(freezePath));
verifyFreeze(root, repo, freeze, readFileSync(dossierPath,'utf8'));
if (Date.now() >= Date.parse(freeze.lastCallCutoff)) throw new Error('Frozen last-call cutoff reached');
if (phase === 'test') {
  const readiness = readJson(join(root,`results/readiness-${model}.json`));
  if (readiness.freezeSha256 !== hash(readFileSync(freezePath)) || !readiness.pilotComplete || !readiness.noiseComplete || !readiness.fixturesComplete)
    throw new Error('Pre-matrix measurements are not complete for this freeze');
  if (!readiness.validityPassed) throw new Error('Pre-matrix validity checks failed or are pending');
}
const adapterPath = resolve(repo, freeze.adapter);
if (!freeze.hashes[freeze.adapter]) throw new Error('Adapter is not frozen');
const lockPath = join(root, 'results/.paid-run.lock');
const lockFd = openSync(lockPath, 'wx');
process.on('exit', () => { closeSync(lockFd); unlinkSync(lockPath); });
const adapter = await import(pathToFileURL(adapterPath).href);
if (typeof adapter.createTransport !== 'function' || typeof adapter.judgePair !== 'function') throw new Error('Core adapter contract missing');
const transport = await adapter.createTransport({ model, settings: freeze.models[model], root });
const journal = new Journal(join(root,'results/calls.jsonl'), {
  capUsd: 25,
  appendSpend(row) {
    appendFileSync(spendPath, `| ${row.at} | ledger-jb ${row.phase} ${row.contestant} ${row.itemId} ${row.order} | ${row.model} | 1 call | ${row.costUsd.toFixed(8)} USD${row.costEstimated ? " reserved, actual unknown" : ""} | lane liability ${journal.liability().toFixed(8)} USD |\n`);
  },
});
const outputPath = join(root,`results/decisions-${phase}-${model}.jsonl`);
const previous = readJsonl(outputPath), completed = new Set(previous.map(row => row.key));
if (completed.size !== previous.length) throw new Error('Duplicate saved decisions');
const template = readFileSync(join(root,'data/promptfoo-select-best.txt'),'utf8');
let current = completed.size;
const queue = planned.filter(job => !completed.has(job.key));
let next = 0, stopped;
async function runJob(job) {
  const call = async (prompt, { order, attempt = 0, schema } = {}) => {
    if (Date.now() >= Date.parse(freeze.lastCallCutoff)) throw new Error('Frozen last-call cutoff reached');
    const key = `${job.key}:${order}:${attempt}:${hash(JSON.stringify({prompt,schema,settings:(freeze.cacheIdentityModels ?? freeze.models)[model]}))}`;
    const reserveUsd = transport.maximumCostUsd(prompt, schema);
    return journal.transportCall(key, reserveUsd, () => transport.call(prompt, { schema, reserveUsd }),
      { phase, model, contestant: job.contestant, itemId: job.itemId, repeat: job.repeat, order, attempt });
  };
  let result;
  if (job.contestant === 'ledger') {
    result = await adapter.judgePair({ item: job.item, requirements: REQUIREMENTS, model, call, settings: freeze.models[model] });
  } else {
    const games = []; let graderErrors = 0;
    for (const order of ['AB','BA']) {
      const response = await call(promptfooPrompt(template,job.item,order), { order });
      const game = response.graderError ? null : parsePromptfoo(response.text, order);
      graderErrors += Number(game === null); games.push(game);
    }
    result = { games, graderErrors };
  }
  if (!Array.isArray(result.games) || result.games.length !== 2 || result.games.some(x=>!['A','B','tie',null].includes(x))) throw new Error('Invalid adapter pair result');
  const row = { ...result, key: job.key, itemId: job.itemId, group: job.item.group, label: job.item.label,
    phase, model, repeat: job.repeat, contestant: job.contestant, freezeSha256 };
  appendFileSync(outputPath, `${JSON.stringify(row)}\n`); completed.add(job.key); current++;
  console.log(JSON.stringify({ phase, model, completed: current, planned: planned.length, liabilityUsd: journal.liability() }));
}
async function worker() {
  while (!stopped && next < queue.length) {
    const job = queue[next++];
    try { await runJob(job); } catch (error) { stopped ??= error; }
  }
}
const concurrency = freeze.modelConcurrency?.[model] ?? freeze.concurrency ?? 4;
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid frozen concurrency');
await Promise.all(Array.from({ length: concurrency }, worker));
if (stopped) throw stopped;
