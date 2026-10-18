import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { rows } from './generate.mts';
import { recordingLines } from './recordings';

type Result = {
  right: number;
  items: number;
  complete: number;
  wrong: number;
  inconclusive: number;
  costUsd: number;
  ci95: { lower: number; upper: number };
  setSha256: string;
  results: { id: string; label: string; outcome: string }[];
};
const root = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
const calls = recordingLines(root).map((l) => JSON.parse(l));
const interruptions = existsSync(new URL('interrupted.jsonl', root))
  ? read('interrupted.jsonl')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : [];
const models = [...new Set(calls.flatMap((c) => Object.keys(c.modelUsage ?? {})))];
const groups = [];
const tables: string[] = [];
for (const row of rows) {
  const lines = [
    `## ${row}`,
    '',
    '| Procedure | Hard correct / completed (120 requested) | Held-out correct / completed (60 requested) | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD / 100 | Held-out USD / 100 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const records: Record<string, Record<string, Result>> = {};
  for (const set of ['hard', 'heldout']) {
    const suffix = set === 'heldout' ? '-heldout' : '';
    records[set] = {};
    for (const v of row === 'qa' || row === 'fact'
      ? ['ours', 'theirs', 'audit', 'arch']
      : ['ours', 'theirs', 'audit']) {
      const r = JSON.parse(read(`${row}${suffix}-${v}.json`)) as Result;
      const count = set === 'heldout' ? 60 : 120;
      if (r.items !== count) throw new Error(`Wrong set size ${row}/${set}/${v}`);
      records[set][v] = r;
    }
    if (new Set(Object.values(records[set]).map((r) => r.setSha256)).size !== 1)
      throw new Error(`Changed inputs ${row}/${set}`);
  }
  for (const v of row === 'qa' || row === 'fact'
    ? ['ours', 'theirs', 'audit', 'arch']
    : ['ours', 'theirs', 'audit']) {
    const a = records.hard?.[v],
      b = records.heldout?.[v];
    if (!a || !b) throw new Error('Missing result');
    const label =
      v === 'ours'
        ? 'Shipped baseline'
        : v === 'theirs'
          ? 'Inspect default'
          : v === 'arch'
            ? 'PR 115 default (under review)'
            : 'Candidate: not yet the shipped default';
    lines.push(
      `| ${label} | ${a.right}/${a.complete} | ${b.right}/${b.complete} | ${(100 * a.ci95.lower).toFixed(1)} to ${(100 * a.ci95.upper).toFixed(1)}% | ${(100 * b.ci95.lower).toFixed(1)} to ${(100 * b.ci95.upper).toFixed(1)}% | ${a.inconclusive} | ${b.inconclusive} | ${((a.costUsd / (a.complete || 1)) * 100).toFixed(5)} | ${((b.costUsd / (b.complete || 1)) * 100).toFixed(5)} |`,
    );
  }
  const outcome = (set: string) => {
    const a = records[set]?.audit,
      b = records[set]?.theirs;
    if (!a || !b) throw new Error('Missing result');
    if (a.complete !== a.items || b.complete !== b.items) return 'partial, no head-to-head verdict';
    return a.right > b.right
      ? 'ahead on accuracy'
      : a.right < b.right
        ? 'behind on accuracy'
        : a.costUsd < b.costUsd
          ? 'equal accuracy, ahead on cost'
          : 'equal accuracy';
  };
  lines.push('', `Candidate result: hard ${outcome('hard')}; held-out ${outcome('heldout')}.`);
  tables.push(lines.join('\n'));
  groups.push({ row, records, hardOutcome: outcome('hard'), heldoutOutcome: outcome('heldout') });
}
const costUsd = calls.reduce((s, c) => s + c.costUsd, 0);
const experiments = [];
for (const [directory, title, selected] of [
  ['normalized', 'Candidate with decoded quotes', ['panel', 'borderline']],
  ['scoped', 'Candidate with explicit scope rules', rows],
  ['adaptive', 'Adaptive ledger prefix', rows],
  ['compact', 'Compact ledger with bounded retry', ['qa', 'fact']],
] as const) {
  const experimentRows = [];
  const section = [
    `## ${title}`,
    '',
    'This candidate is not yet the shipped default. These fresh sets have their own frozen seeds.',
  ];
  for (const row of selected) {
    const records: Record<string, Record<string, Result>> = {};
    for (const set of ['hard', 'heldout']) {
      const suffix = set === 'heldout' ? '-heldout' : '';
      records[set] = {};
      for (const variant of ['ours', 'audit', 'theirs'])
        records[set][variant] = JSON.parse(read(`${directory}/${row}${suffix}-${variant}.json`));
      if (new Set(Object.values(records[set]).map((r) => r.setSha256)).size !== 1)
        throw new Error(`Changed ${directory}/${row}/${set} inputs`);
    }
    const outcome = (set: string) => {
      const a = records[set]?.audit,
        b = records[set]?.theirs;
      if (!a || !b || a.complete !== a.items || b.complete !== b.items)
        return 'partial, no head-to-head verdict';
      return a.right > b.right
        ? 'ahead on accuracy'
        : a.right < b.right
          ? 'behind on accuracy'
          : a.costUsd < b.costUsd
            ? 'equal accuracy, ahead on cost'
            : 'equal accuracy';
    };
    section.push(
      '',
      `### ${row}`,
      '',
      '| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |',
      '|---|---|---|---|---|---|---|---|---|',
    );
    for (const variant of ['ours', 'audit', 'theirs']) {
      const a = records.hard?.[variant],
        b = records.heldout?.[variant];
      if (!a || !b) throw new Error('Missing experiment result');
      const ci = (r: Result) =>
        r.complete
          ? `${(r.ci95.lower * 100).toFixed(1)} to ${(r.ci95.upper * 100).toFixed(1)}%`
          : 'unmeasured';
      const cost = (r: Result) => (r.complete ? ((r.costUsd / r.complete) * 100).toFixed(5) : 'unmeasured');
      section.push(
        `| ${variant === 'ours' ? 'Shipped baseline' : variant === 'theirs' ? 'Inspect default' : title} | ${a.right}/${a.complete} | ${b.right}/${b.complete} | ${ci(a)} | ${ci(b)} | ${a.inconclusive} | ${b.inconclusive} | ${cost(a)} | ${cost(b)} |`,
      );
    }
    section.push('', `Result: hard ${outcome('hard')}; held-out ${outcome('heldout')}.`);
    experimentRows.push({ row, records, hardOutcome: outcome('hard'), heldoutOutcome: outcome('heldout') });
  }
  tables.push(section.join('\n'));
  experiments.push({
    directory,
    title,
    freeze: JSON.parse(read(`${directory}/freeze.json`)),
    rows: experimentRows,
  });
}
const reservedUsd =
  calls.reduce((s, c) => s + c.reservedUsd, 0) + interruptions.reduce((s, c) => s + c.reserveUsd, 0);
const text = `# Hard and held-out grading results\n\nMeasured ${new Date().toISOString()}. Model: ${models.join(', ')}. Each procedure runs once per set. Each runner permits two calls. Two controllers overlap before an exclusive runner lock is added, exceeding the global two-call limit; every submitted reply and cost is retained. Subsequent runners serialize before loading reservations. Partial rows state completed coverage and have no superiority verdict. Shipped/default panel procedures and three-vote candidates use three sequential votes. The adaptive prefix consumes only through its first conclusive ledger. Unscored results count against the full denominator.\n\n${tables.join('\n\n')}\n\nUnique recorded calls: ${calls.length}. Reported spend: ${costUsd.toFixed(8)} USD. Conservative reserved spend: ${reservedUsd.toFixed(8)} USD, including ${interruptions.length} interrupted attempt reserved at its full cap. Costs per 100 items are logical procedure costs; shared QA/fact recordings are billed once.\n\nThe baseline remains 111/120 on the identical factual cases. The candidate is not yet the shipped default. PR 115 default (under review) is measured at 1270e1cb1eb324b2f3efbca816aa43fbcb092ae6 with only criterion and transcript supplied. No custom system, requirements, assessment, reference or legacy override is used. Zero model calls use the rejected a52e41e3 commit.\n\nHeld-out seed 20261013 uses the same construction functions, new bindings and shuffled template choices. Its labels and candidate hashes were frozen before runs in heldout-freeze.json. No candidate changes follow held-out results. Template-related cases limit the meaning of Wilson intervals; these intervals are descriptive, not a proof of population superiority. Equal-weight panels and strict majority agree on identical votes.\n`;
writeFileSync(new URL('results.md', root), text);
writeFileSync(
  new URL('summary.json', root),
  `${JSON.stringify({ date: new Date().toISOString(), models, calls: calls.length, costUsd, reservedUsd, interruptions, rows: groups, experiments }, null, 2)}\n`,
);
console.log(text);
