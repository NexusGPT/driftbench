/** Free, fail-closed replay. Only --download permits public dataset HTTP reads. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type JudgeClient, type JudgeRequest, judgePairwise } from '@agent-nexus/driftbench-judges';

const SOURCE = '8c1d1ca707d6505028a4e0db80c937dd6cfaef71';
const PREFIX = 'examples/judge-benchmarks/';
const DATA_URL =
  'https://datasets-server.huggingface.co/rows?dataset=DonJoey/rubricbench&config=default&split=train';
const DEV_IDS_SHA256 = '8f421eadc26f082406fb7e58fb6e6e688c97b6731af42e961242768aefadc323';
const DEV_CONTENT_SHA256 = 'f472f9d91180680397a063166b9c02920948356092fdcf1639b957bebc64b66d';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CACHE = resolve(ROOT, '.cache/canonical-replay');
const OUTPUT = resolve(ROOT, 'comparisons/canonical-presentation/replay.json');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type Decision = 'A' | 'B' | 'tie';
type Item = {
  id: string;
  question: string;
  a: string;
  b: string;
  label: 'A' | 'B';
  group: string;
  criterion: string;
};
type Recording = {
  key: string;
  model: string;
  text: string;
  costUsd: number;
  bench?: string;
  contestant?: string;
  item?: string;
  order?: string;
};
type Evidence = { key: string; a: unknown[]; b: unknown[] };
type Historical = {
  atomicPrompt(input: { question: string; a: string; b: string; criterion: string; reference?: string }): {
    system: string;
    user: string;
  };
  atomicChecks(text: string): { checks: unknown[] } | undefined;
  atomicDecision(text: string, method: 'binary'): Decision;
  rubricItems(criterion: string): string[];
  parseRubricBench(rows: unknown[]): Item[];
  codeBlocks(text: string): unknown[];
  evidencePrefix: string;
};
const flip = (d: Decision): Decision => (d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie');
const cost = (rows: Iterable<Recording>) =>
  Number([...rows].reduce((sum, row) => sum + row.costUsd, 0).toFixed(8));
const sourceHashes: Record<string, string> = {};
function source(path: string): string {
  const text = execFileSync('git', ['show', `${SOURCE}:${path}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  sourceHashes[path] = sha(text);
  return text;
}
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Historical source boundary missing: ${start}`);
  return text.slice(from, to);
}
function jsonl<T>(text: string): T[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** Extract only pure routines. Never import call.ts, run.ts or the candidate-code executor. */
async function historical(): Promise<Historical> {
  const atomic = source(`${PREFIX}src/rubric-atomic.ts`);
  const data = source(`${PREFIX}src/data.ts`);
  const execution = source(`${PREFIX}src/code-evidence.ts`);
  const evidencePrefix = execution.match(/return `(Execution observations[^`]+)\$\{JSON\.stringify/);
  assert(evidencePrefix?.[1], 'Missing historical execution evidence prefix');
  const module = [
    "type PairDecision = 'A' | 'B' | 'tie';",
    'type Prompt = { system: string; user: string };',
    'type PairItem = Record<string, unknown>;',
    "const CRITERIA = { rubricbench: 'The response satisfies the rubrics below better.' };",
    "type Rec = Record<string, unknown>; const str = (v: unknown) => typeof v === 'string' ? v : '';",
    section(atomic, 'export const ATOMIC_SYSTEM', 'const AGGREGATIONS:'),
    source(`${PREFIX}src/json.ts`),
    source(`${PREFIX}src/rubric-items.ts`),
    section(data, 'export function parseRubricBench', '/** LongJudgeBench wp_bench'),
    'type CodeBlock = { language: string; code: string };',
    section(execution, 'export function codeBlocks', '\nfunction execute('),
    `export const evidencePrefix = ${JSON.stringify(evidencePrefix[1].replace(/\\n/g, '\n'))};`,
  ].join('\n');
  const path = resolve(CACHE, 'historical-pure.ts');
  await writeFile(path, module);
  return import(pathToFileURL(path).href) as Promise<Historical>;
}

async function dataset(download: boolean, h: Historical): Promise<{ items: Item[]; total: number }> {
  const rows: { row: unknown; row_idx: number }[] = [];
  let total = 0;
  for (let offset = 0; ; offset += 100) {
    const path = resolve(CACHE, `rows-${offset}.json`);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      assert(download, `Missing dataset page ${offset}; run once with --download`);
      const response = await fetch(`${DATA_URL}&offset=${offset}&length=100`);
      assert(response.ok, `Dataset page ${offset}: HTTP ${response.status}`);
      text = await response.text();
      JSON.parse(text);
      await writeFile(path, text);
    }
    const page = JSON.parse(text);
    assert(Number.isInteger(page.num_rows_total) && Array.isArray(page.rows));
    if (offset === 0) total = page.num_rows_total;
    assert.equal(page.num_rows_total, total, 'Dataset changed during pagination');
    assert.equal(page.rows.length, Math.min(100, total - offset), 'Incomplete dataset page');
    for (const [i, row] of page.rows.entries()) assert.equal(row.row_idx, offset + i);
    rows.push(...page.rows);
    if (offset + 100 >= total) break;
  }
  const all = h.parseRubricBench(rows);
  assert.equal(new Set(all.map((item) => item.id)).size, total, 'Duplicate dataset IDs');
  const items = all.filter(
    (item) => createHash('sha256').update(`split:rubricbench:${item.id}`).digest().readUInt8(0) < 77,
  );
  assert.equal(items.length, 357, 'Dev population drift');
  assert.equal(
    sha(
      `${items
        .map((item) => item.id)
        .sort()
        .join('\n')}\n`,
    ),
    DEV_IDS_SHA256,
  );
  assert.equal(sha(JSON.stringify(items)), DEV_CONTENT_SHA256, 'Normalized dev content drift');
  return { items, total };
}

function requestFor(
  h: Historical,
  item: Item,
  a: string,
  b: string,
  journal: Map<string, Evidence>,
  executed: boolean,
) {
  let reference: string | undefined;
  if (executed && (h.codeBlocks(a).length > 0 || h.codeBlocks(b).length > 0)) {
    const key = sha(JSON.stringify(['code-evidence-v6', item.question, a, b]));
    const evidence = journal.get(key);
    assert(evidence, `Missing execution journal key ${key} for ${item.id}`);
    reference = h.evidencePrefix + JSON.stringify({ A: evidence.a, B: evidence.b });
  }
  const prompt = h.atomicPrompt({
    question: item.question,
    criterion: item.criterion,
    a,
    b,
    ...(reference === undefined ? {} : { reference }),
  });
  return { key: sha(JSON.stringify(['haiku', prompt.system, prompt.user])).slice(0, 20), prompt };
}

async function replayAtomic(
  h: Historical,
  items: Item[],
  recordings: Map<string, Recording>,
  journal: Map<string, Evidence>,
  executed: boolean,
) {
  const used = new Map<string, Recording>();
  const details = [];
  let requests = 0;
  let invalidParse = 0;
  let countMismatch = 0;
  for (const item of items) {
    const seen: string[] = [];
    const client: JudgeClient = {
      id: 'historical-atomic-recordings',
      family: 'anthropic',
      cls: 'system2',
      cost: 0,
      async judge(request: JudgeRequest) {
        requests += 1;
        assert(request.candidates);
        assert.equal(request.transcript[0]?.text, item.question);
        const { key } = requestFor(h, item, request.candidates.A, request.candidates.B, journal, executed);
        seen.push(JSON.stringify(request));
        const recording = recordings.get(key);
        assert(recording, `Missing exact prompt recording ${key} for ${item.id}`);
        assert.equal(recording.model, 'haiku');
        used.set(key, recording);
        const decision = h.atomicDecision(recording.text, 'binary');
        return {
          raw: recording.text,
          answer: {
            outcome: decision === 'A' ? 'pass' : decision === 'B' ? 'fail' : 'inconclusive',
            reasoning: 'Historical binary atomic aggregation.',
          },
        };
      },
    };
    const criterion = { name: 'benchmark', rubric: item.criterion };
    const transcript = [{ role: 'user' as const, text: item.question }];
    const options = { presentation: 'canonical' as const };
    const original = await judgePairwise(client, criterion, transcript, item.a, item.b, options);
    const swapped = await judgePairwise(client, criterion, transcript, item.b, item.a, options);
    assert.equal(
      original.aIsFirst,
      sha(item.a) < sha(item.b) || (sha(item.a) === sha(item.b) && item.a <= item.b),
    );
    assert.equal(original.calls, 1);
    assert.equal(swapped.calls, 1);
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1], `Caller order changed the canonical request: ${item.id}`);
    const winner: Decision = original.choice === 'first' ? 'A' : original.choice === 'second' ? 'B' : 'tie';
    const reverseWinner: Decision =
      swapped.choice === 'first' ? 'B' : swapped.choice === 'second' ? 'A' : 'tie';
    assert.equal(winner, reverseWinner, `Content identity mapping failed: ${item.id}`);
    const a = original.aIsFirst ? item.a : item.b;
    const b = original.aIsFirst ? item.b : item.a;
    const { key } = requestFor(h, item, a, b, journal, executed);
    const recorded = recordings.get(key);
    assert(recorded);
    const parsed = h.atomicChecks(recorded.text);
    if (!parsed) invalidParse += 1;
    else if (parsed.checks.length !== h.rubricItems(item.criterion).length) countMismatch += 1;
    details.push({ id: item.id, label: item.label, winner, key });
  }
  return {
    items: items.length,
    reusedIdentityMappings: details.length,
    nonTieReusedJudgements: details.filter((d) => d.winner !== 'tie').length,
    ties: details.filter((d) => d.winner === 'tie').length,
    correct: details.filter((d) => d.winner === d.label).length,
    accuracy: details.filter((d) => d.winner === d.label).length / items.length,
    invalidParse,
    countMismatch,
    apiInvocations: items.length * 2,
    adapterCalls: requests,
    uniqueHistoricalCalls: used.size,
    historicalCostUsd: cost(used.values()),
    details,
  };
}

/** Opportunistic complete-recording subset, not a representative sample. */
async function replayControlled(
  h: Historical,
  items: Item[],
  recordings: Map<string, Recording>,
  journal: Map<string, Evidence>,
) {
  const canonical = await replayAtomic(h, items, recordings, journal, false);
  const used = new Map<string, Recording>();
  const verdicts = [];
  let adapterCalls = 0;
  for (const item of items) {
    const seen: string[] = [];
    const client: JudgeClient = {
      id: 'controlled-atomic-recordings',
      family: 'anthropic',
      cls: 'system2',
      cost: 0,
      async judge(request: JudgeRequest) {
        adapterCalls += 1;
        assert(request.candidates);
        assert.equal(request.transcript[0]?.text, item.question);
        const { key } = requestFor(h, item, request.candidates.A, request.candidates.B, journal, false);
        const recording = recordings.get(key);
        assert(recording, `Missing controlled recording ${key}`);
        assert.equal(recording.model, 'haiku');
        seen.push(key);
        used.set(key, recording);
        const decision = h.atomicDecision(recording.text, 'binary');
        return {
          raw: recording.text,
          answer: {
            outcome: decision === 'A' ? 'pass' : decision === 'B' ? 'fail' : 'inconclusive',
            reasoning: 'Historical binary atomic aggregation, no execution evidence.',
          },
        };
      },
    };
    const verdict = await judgePairwise(
      client,
      { name: 'benchmark', rubric: item.criterion },
      [{ role: 'user', text: item.question }],
      item.a,
      item.b,
    );
    assert.equal(verdict.calls, 2);
    assert.deepEqual(seen, [
      requestFor(h, item, item.a, item.b, journal, false).key,
      requestFor(h, item, item.b, item.a, journal, false).key,
    ]);
    const canonicalDetail = canonical.details.find((detail) => detail.id === item.id);
    assert(
      canonicalDetail && seen.includes(canonicalDetail.key),
      'Canonical must reuse one of the same raw prompts',
    );
    verdicts.push(verdict);
  }
  const parsed = [...used.values()].filter((recording) => h.atomicChecks(recording.text) === undefined);
  return {
    selection: 'Opportunistic complete-recording subset; no population inference.',
    sortedIdsSha256: sha(
      `${items
        .map((item) => item.id)
        .sort()
        .join('\n')}\n`,
    ),
    defaultBothOrders: {
      apiInvocations: items.length,
      adapterCalls,
      consistent: verdicts.filter((verdict) => verdict.consistent).length,
      positionBias: verdicts.filter((verdict) => verdict.positionBias).length,
      ties: verdicts.filter((verdict) => verdict.choice === 'tie').length,
      uniqueHistoricalCalls: used.size,
      historicalCostUsd: cost(used.values()),
      invalidRawParses: parsed.length,
    },
    canonical: {
      apiInvocations: canonical.apiInvocations,
      adapterCalls: canonical.adapterCalls,
      reusedIdentityMappings: canonical.reusedIdentityMappings,
      nonTieReusedJudgements: canonical.nonTieReusedJudgements,
      ties: canonical.ties,
      uniqueHistoricalCalls: canonical.uniqueHistoricalCalls,
      historicalCostUsd: canonical.historicalCostUsd,
      invalidRawParses: canonical.invalidParse,
      rubricCountMismatches: canonical.countMismatch,
    },
  };
}

async function adaptive(items: Item[], recordings: Map<string, Recording>) {
  // The historical parser is self-contained except zod. Preserve its exact parsing behavior.
  const contract = source('packages/judges/src/contract.ts');
  const require = createRequire(resolve(ROOT, 'packages/judges/package.json'));
  const path = resolve(CACHE, 'historical-contract.ts');
  await writeFile(
    path,
    contract.replace("from 'zod'", `from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`),
  );
  const { parseAnswerText } = await import(pathToFileURL(path).href);
  const ids = new Set(items.map((item) => item.id));
  const rows = [...recordings.values()].filter(
    (r) => r.contestant === 'driftbench-adaptive' && r.bench === 'rubricbench' && ids.has(r.item ?? ''),
  );
  const byItem = new Map<string, Map<string, Recording>>();
  for (const row of rows) {
    assert.equal(row.model, 'haiku');
    assert(row.item && row.order);
    const orders = byItem.get(row.item) ?? new Map<string, Recording>();
    assert(!orders.has(row.order), `Ambiguous adaptive metadata ${row.item} ${row.order}`);
    orders.set(row.order, row);
    byItem.set(row.item, orders);
  }
  const details = [];
  let invalidSamples = 0;
  for (const item of items) {
    const orders = byItem.get(item.id);
    assert(orders?.has('route'), `Missing adaptive route ${item.id}`);
    const route = orders.get('route');
    assert(route);
    const needsReference = /^yes\b/i.test(route.text.trim());
    assert.equal(orders.has('reference'), needsReference, `Adaptive route/reference mismatch: ${item.id}`);
    const games: Decision[] = [];
    for (const order of ['AB', 'BA']) {
      const decisions = [1, 2, 3].map((sample): Decision => {
        const row = orders.get(`${order}#${sample}`);
        assert(row, `Missing adaptive sample ${item.id} ${order}#${sample}`);
        const { answer, unparsed } = parseAnswerText(row.text);
        if (unparsed) invalidSamples += 1;
        return unparsed || answer.outcome === 'inconclusive' ? 'tie' : answer.outcome === 'pass' ? 'A' : 'B';
      });
      const a = decisions.filter((d) => d === 'A').length;
      const b = decisions.filter((d) => d === 'B').length;
      const decision = a > b ? 'A' : b > a ? 'B' : 'tie';
      games.push(order === 'AB' ? decision : flip(decision));
    }
    assert.equal(orders.size, needsReference ? 8 : 7, 'Unexpected adaptive call metadata');
    details.push({ id: item.id, label: item.label, games });
  }
  return {
    items: items.length,
    decisiveConsistent: details.filter((d) => d.games[0] !== 'tie' && d.games[0] === d.games[1]).length,
    identityConsistentIncludingTies: details.filter((d) => d.games[0] === d.games[1]).length,
    bothTies: details.filter((d) => d.games.every((g) => g === 'tie')).length,
    correctGames: details.reduce((n, d) => n + d.games.filter((g) => g === d.label).length, 0),
    totalGames: items.length * 2,
    invalidSamples,
    routeCalls: rows.filter((r) => r.order === 'route').length,
    referenceCalls: rows.filter((r) => r.order === 'reference').length,
    sampleCalls: rows.filter((r) => /^(AB|BA)#[123]$/.test(r.order ?? '')).length,
    uniqueHistoricalCalls: rows.length,
    historicalCostUsd: cost(rows),
    validation:
      'Metadata-selected dev item, model, contestant and order; exact historical prompt keys not reconstructed.',
  };
}

async function main() {
  assert(
    process.argv.slice(2).every((arg) => ['--download', '--check'].includes(arg)),
    'Only --download and --check are supported',
  );
  await mkdir(CACHE, { recursive: true });
  const h = await historical();
  const { items, total } = await dataset(process.argv.includes('--download'), h);
  const recordings = new Map<string, Recording>();
  for (let shard = 0; shard <= 4; shard += 1) {
    for (const row of jsonl<Recording>(
      source(`${PREFIX}recordings/rubricbench/haiku-${String(shard).padStart(3, '0')}.jsonl`),
    )) {
      assert(Number.isFinite(row.costUsd) && row.costUsd >= 0);
      recordings.set(row.key, row); // Matches historical Recordings.load: last key wins.
    }
  }
  const journal = new Map<string, Evidence>();
  for (const row of jsonl<Evidence>(source(`${PREFIX}experiments/rb/execution.jsonl`))) {
    if (!journal.has(row.key)) journal.set(row.key, row); // Historical journal lookup uses find.
  }
  const canonical = await replayAtomic(h, items, recordings, journal, true);
  const baseline = await adaptive(items, recordings);
  const audit = JSON.parse(source(`${PREFIX}experiments/rb/audit.json`));
  const auditRow = audit.reports.find(
    (r: { contestant: string }) => r.contestant === 'driftbench-rb-binary-canonical-executed',
  );
  assert(auditRow && auditRow.completeItems === items.length);
  for (const detail of canonical.details) {
    const previous = auditRow.details.find((d: { id: string }) => d.id === detail.id);
    assert(previous, `Missing historical audit item ${detail.id}`);
    assert.equal(previous.label, detail.label);
    assert.deepEqual(previous.games, [detail.winner, detail.winner]);
  }
  const executedReport = JSON.parse(source(`${PREFIX}experiments/rb/atomic-executed-dev.json`))
    .contestants[0];
  const baselineReport = JSON.parse(source(`${PREFIX}experiments/rb/baselines.json`)).contestants.find(
    (r: { contestant: string }) => r.contestant === 'driftbench-adaptive',
  );
  assert.equal(canonical.uniqueHistoricalCalls, executedReport.uniqueCalls);
  assert(Math.abs(canonical.historicalCostUsd - executedReport.uniqueCostUsd) < 1e-10);
  assert.equal(canonical.accuracy, executedReport.summary.value.estimate);
  // The historical field counts non-tie reused judgements; it does not measure consistency.
  assert.equal(canonical.nonTieReusedJudgements / items.length, executedReport.summary.positionConsistency);
  assert.equal(baseline.uniqueHistoricalCalls, baselineReport.uniqueCalls);
  assert(Math.abs(baseline.historicalCostUsd - baselineReport.uniqueCostUsd) < 1e-10);
  assert.equal(baseline.decisiveConsistent / items.length, baselineReport.summary.positionConsistency);
  assert.equal(baseline.correctGames / baseline.totalGames, baselineReport.summary.value.estimate);

  // Probe both raw orders of the same atomic prompt without execution evidence. Never fill missing calls.
  const controlledPairs = items.filter((item) =>
    (
      [
        [item.a, item.b],
        [item.b, item.a],
      ] as const
    ).every(([a, b]) => recordings.has(requestFor(h, item, a, b, journal, false).key)),
  );
  const controlled = {
    procedure: 'Atomic binary, no execution evidence, both raw candidate orders',
    completePairs: controlledPairs.length,
    population: items.length,
    fullPopulationComparison: controlledPairs.length === items.length,
    replay: await replayControlled(h, controlledPairs, recordings, journal),
  };
  const { details: _details, ...canonicalSummary } = canonical;
  let syntheticCalls = 0;
  const syntheticClient: JudgeClient = {
    id: 'structural-probe',
    family: 'fake',
    cls: 'system2',
    cost: 0,
    async judge() {
      syntheticCalls += 1;
      return {
        raw: 'synthetic pass',
        answer: { outcome: 'pass', reasoning: 'Synthetic call-count probe only.' },
      };
    },
  };
  const probeCriterion = { name: 'probe', rubric: 'Synthetic call-count probe' };
  const single = await judgePairwise(syntheticClient, probeCriterion, [], 'one', 'two', {
    presentation: 'canonical',
  });
  const both = await judgePairwise(syntheticClient, probeCriterion, [], 'one', 'two');
  assert.equal(single.calls, 1);
  assert.equal(both.calls, 2);
  assert.equal(syntheticCalls, 3);
  const result = {
    schemaVersion: 1,
    replaySpendUsd: 0,
    modelCalls: 0,
    currentApi: {
      importedFrom: '@agent-nexus/driftbench-judges',
      tsxResolution: 'tsconfig source alias to packages/judges/src/index.ts',
      pairwiseSourceSha256: sha(await readFile(resolve(ROOT, 'packages/judges/src/pairwise.ts'), 'utf8')),
      syntheticPrimaryCallProbe: {
        canonical: single.calls,
        defaultBothOrders: both.calls,
        includesRetries: false,
      },
    },
    candidateExecutions: 0,
    source: { revision: SOURCE, originalRef: 'origin/codex/rb-judge', filesSha256: sourceHashes },
    dataset: {
      url: DATA_URL,
      totalRows: total,
      devItems: items.length,
      split: "SHA256('split:rubricbench:' + id)[0] < 77",
      sortedDevIdsSha256: DEV_IDS_SHA256,
      normalizedDevSha256: sha(JSON.stringify(items)),
      cache: '.cache/canonical-replay/rows-*.json',
      redistribution: 'Dataset rows are not committed; license not established by this replay.',
    },
    canonicalAtomicExecuted: canonicalSummary,
    historicalAdaptiveBothOrders: baseline,
    crossProcedureCostRatio: canonical.historicalCostUsd / baseline.historicalCostUsd,
    controlledAtomicCoverage: controlled,
    limitations: [
      'The adapter translates new public API requests into historical atomic prompts. It verifies ordering and identity mapping, not current prompt quality.',
      'Canonical reversed callers reuse one judgement. Their mapped identity is a replay check, with no consistency measurement.',
      'The canonical 96.36 percent figure counts 344 non-tie reused judgements out of 357; it does not measure consistency.',
      'The cost ratio compares different procedures: atomic plus recorded execution evidence versus routing, optional reference and three samples per order. It is not a canonical-only saving.',
      'Dev data was used to tune the historical judges. These are not held-out generalization results.',
      'Recorded execution evidence is reused verbatim. No candidate is run, and these observations are not a proof of correctness.',
      'Adaptive samples are matched by metadata, not reconstructed exact prompt keys.',
      'Only 8 of 357 dev pairs have both raw orders of the same atomic prompt recorded. No full-population controlled comparison is available.',
      'Historical malformed outputs and rubric-count mismatches remain in the historical score and are counted explicitly.',
    ],
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (process.argv.includes('--check'))
    assert.equal(await readFile(OUTPUT, 'utf8'), output, 'Committed replay report differs');
  else await writeFile(OUTPUT, output);
  console.log(
    JSON.stringify(
      {
        canonical: canonicalSummary,
        adaptive: baseline,
        controlled,
        report: 'comparisons/canonical-presentation/replay.json',
      },
      null,
      2,
    ),
  );
}

await main();
