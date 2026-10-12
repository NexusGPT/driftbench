import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promptKey, Recordings } from './call';
import { contestantById, type PairDecision } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { majorityPair } from './run';
import { pairGames, scorePairs } from './score';
import { WRITING_AXES, writingBrief } from './wp';
import { writingRowKey } from './wp-study';

type StudyRow = {
  rowKey: string;
  id: string;
  group: string;
  label: 'A' | 'B';
  games: PairDecision[];
  groundedGames?: PairDecision[];
  voted: PairDecision[];
  strict: PairDecision[];
  parsed: { winner: PairDecision; votes?: Record<string, PairDecision>; reason: string }[];
  costUsd: number;
  missing: number;
};
type Study = { variant: string; costPer100: number; newSpendUsd: number; results: StudyRow[] };
const bench = await loadBenchmark('longjudge-wp');
const items = bench.items.filter(
  (i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === 'dev',
);
const recordings = await new Recordings(
  fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
).load();
const adaptive = contestantById('driftbench-adaptive');
const { route: routePrompt, reference: referencePrompt, pair: pairPrompt, parsePair } = adaptive;
if (!routePrompt || !referencePrompt || !pairPrompt || !parsePair)
  throw new Error('Adaptive pairwise contract missing');
const baseline = items.map((item) => {
  const route = recordings.get(promptKey('haiku', routePrompt(item.question)))?.text;
  const reference = /^\s*\**\s*YES/i.test(route ?? '')
    ? recordings.get(promptKey('haiku', referencePrompt(item.question)))?.text
    : undefined;
  const judge = (a: string, b: string) => {
    const p = pairPrompt({
      question: item.question,
      a,
      b,
      criterion: bench.criterion,
      ...(reference ? { reference } : {}),
    });
    return majorityPair(
      Array.from({ length: 3 }, (_, i) => {
        const q = i === 0 ? p : { ...p, user: `${p.user}\n\n(Independent judgement ${i + 1} of 3.)` };
        const r = recordings.get(promptKey('haiku', q));
        if (!r) throw new Error(`Incomplete adaptive baseline for ${item.id}`);
        return parsePair(r.text);
      }),
    );
  };
  return {
    item,
    rowKey: writingRowKey(item),
    games: pairGames(judge(item.a, item.b), judge(item.b, item.a)),
    missing: 0,
  };
});
const studies: Study[] = [];
for (const variant of [
  'criteria',
  'editor',
  'chunked',
  'audit',
  'requirements',
  'reader',
  'factcheck',
  'sections',
]) {
  const file = fileURLToPath(new URL(`../census/wp-${variant}-dev.json`, import.meta.url));
  try {
    studies.push(JSON.parse(await readFile(file, 'utf8')) as Study);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
const baselineByKey = new Map(baseline.map((r) => [r.rowKey, r]));
const details = studies.map((s) => {
  const rr = s.results.map((r) => {
    const item = items.find((i) => writingRowKey(i) === r.rowKey);
    if (!item) throw new Error(`Unknown dev row ${r.rowKey}`);
    return { ...r, item };
  });
  const transitions = rr.reduce(
    (c, r) => {
      const before = baselineByKey.get(r.rowKey);
      if (!before) throw new Error(`Missing baseline ${r.rowKey}`);
      for (let i = 0; i < 2; i++) {
        const key =
          before.games[i] === r.label
            ? r.games[i] === r.label
              ? 'keptRight'
              : 'lostRight'
            : r.games[i] === r.label
              ? 'fixedWrong'
              : 'keptWrong';
        c[key] += 1;
      }
      return c;
    },
    { keptRight: 0, lostRight: 0, fixedWrong: 0, keptWrong: 0 },
  );
  const axes = !['criteria', 'chunked'].includes(s.variant)
    ? undefined
    : Object.fromEntries(
        WRITING_AXES.map((axis) => [
          axis,
          scorePairs(
            bench.id,
            rr.map((r) => ({
              ...r,
              games: pairGames(r.parsed[0]?.votes?.[axis] ?? 'tie', r.parsed[1]?.votes?.[axis] ?? 'tie'),
            })),
          ).value.estimate,
        ]),
      );
  return {
    variant: s.variant,
    costPer100: s.costPer100,
    summary: scorePairs(bench.id, rr),
    transitions,
    axes,
    errors: rr
      .filter((r) => r.games.some((g) => g !== r.label))
      .map(({ item, ...r }) => ({ ...r, instruction: item.question })),
  };
});
const combined = [];
const fullStudy = (variant: string) =>
  studies.find(
    (s) =>
      s.variant === variant && s.results.length === items.length && s.results.every((r) => r.missing === 0),
  );
const groundedRequirements = fullStudy('requirements');
if (groundedRequirements?.results.every((r) => r.groundedGames)) {
  const results = groundedRequirements.results.map((r) => {
    const item = items.find((i) => writingRowKey(i) === r.rowKey);
    if (!item || !r.groundedGames) throw new Error('Grounded requirement row missing');
    return { item, rowKey: r.rowKey, games: r.groundedGames, missing: 0, costUsd: r.costUsd };
  });
  combined.push({
    variant: 'requirements-source-grounded',
    summary: scorePairs(bench.id, results),
    costPer100: groundedRequirements.costPer100,
    results: results.map(({ item, ...r }) => ({ ...r, label: item.label, id: item.id, group: item.group })),
  });
}
const editorial = fullStudy('editor');
const reader = fullStudy('reader');
const facts = fullStudy('factcheck');
const requirements = fullStudy('requirements');
if (editorial && reader && facts) {
  const e = new Map(editorial.results.map((r) => [r.rowKey, r]));
  const f = new Map(facts.results.map((r) => [r.rowKey, r]));
  const results = reader.results.map((r) => {
    const editor = e.get(r.rowKey),
      fact = f.get(r.rowKey);
    const item = items.find((i) => writingRowKey(i) === r.rowKey);
    if (!editor || !fact || !item) throw new Error('Council row mismatch');
    const briefCost = recordings.get(promptKey('haiku', writingBrief(item.question)))?.costUsd;
    if (briefCost === undefined) throw new Error('Missing shared brief cost');
    return {
      item,
      rowKey: r.rowKey,
      games: [0, 1].map((i) =>
        majorityPair([editor.games[i] ?? 'tie', r.games[i] ?? 'tie', fact.games[i] ?? 'tie']),
      ),
      missing: 0,
      costUsd: editor.costUsd + r.costUsd + fact.costUsd - 2 * briefCost,
    };
  });
  combined.push({
    variant: 'editor-reader-factcheck-council',
    summary: scorePairs(bench.id, results),
    costPer100: (results.reduce((n, r) => n + r.costUsd, 0) / items.length) * 100,
    results: results.map(({ item, ...r }) => ({ ...r, label: item.label, id: item.id, group: item.group })),
  });
}
if (requirements && editorial) {
  const e = new Map(editorial.results.map((r) => [r.rowKey, r]));
  const results = requirements.results.map((r) => {
    const editor = e.get(r.rowKey),
      item = items.find((i) => writingRowKey(i) === r.rowKey);
    if (!editor || !item) throw new Error('Requirement fallback row mismatch');
    const fallback = r.games[0] === 'tie';
    return {
      item,
      rowKey: r.rowKey,
      games: fallback ? editor.games : r.games,
      missing: 0,
      costUsd: r.costUsd + (fallback ? editor.costUsd : 0),
      fallback,
    };
  });
  combined.push({
    variant: 'requirements-editor-tie-break',
    summary: scorePairs(bench.id, results),
    costPer100: (results.reduce((n, r) => n + r.costUsd, 0) / items.length) * 100,
    fallbackPairs: results.filter((r) => r.fallback).length,
    results: results.map(({ item, ...r }) => ({ ...r, label: item.label, id: item.id, group: item.group })),
  });
}
const out = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !out) throw new Error('--out is required');
const analysis = {
  split: 'dev',
  items: items.length,
  prompts: new Set(items.map((i) => i.id)).size,
  adaptive: scorePairs(bench.id, baseline),
  adaptiveRows: baseline.map(({ item, ...r }) => ({ ...r, id: item.id, group: item.group, label: item.label })),
  adaptiveByOrder: Object.fromEntries(
    ['en', 'zh'].map((group) => [
      group,
      [0, 1].map((order) => {
        const rows = baseline.filter((r) => r.item.group === group);
        return { games: rows.length, correct: rows.filter((r) => r.games[order] === r.item.label).length };
      }),
    ]),
  ),
  studies: details,
  combined,
};
await writeFile(out, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(
  JSON.stringify(
    { ...analysis, studies: details.map(({ errors, ...r }) => ({ ...r, errorPairs: errors.length })) },
    null,
    2,
  ),
);
