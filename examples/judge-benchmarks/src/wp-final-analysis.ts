import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type WritingMeasuredRow = {
  id: string;
  rowKey: string;
  group: string;
  label: 'A' | 'B';
  games: string[];
};
export function writingAccuracy(rows: readonly WritingMeasuredRow[]) {
  const n = rows.reduce((s, r) => s + r.games.length, 0);
  const correct = rows.reduce((s, r) => s + r.games.filter((g) => g === r.label).length, 0);
  return { items: rows.length, games: n, correct, accuracy: n ? correct / n : 0 };
}

/** Stratified question-id cluster bootstrap: repeated drafts and both order games remain together. */
export function writingInterval(rows: readonly WritingMeasuredRow[], replicates = 5000) {
  if (!rows.length) throw new Error('No evaluation rows');
  const groups = [...new Set(rows.map((r) => r.group))].map((group) => {
    const selected = rows.filter((r) => r.group === group),
      byId = new Map<string, WritingMeasuredRow[]>();
    for (const r of selected) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    return { weight: selected.length / rows.length, clusters: [...byId.values()] };
  });
  let state = Number.parseInt(
    createHash('sha256').update('wp-final-cluster-ci-v1').digest('hex').slice(0, 8),
    16,
  );
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const draws: number[] = [];
  for (let i = 0; i < replicates; i++) {
    let value = 0;
    for (const g of groups) {
      const sample: WritingMeasuredRow[] = [];
      for (let j = 0; j < g.clusters.length; j++)
        sample.push(...g.clusters[Math.floor(random() * g.clusters.length)]!);
      value += g.weight * writingAccuracy(sample).accuracy;
    }
    draws.push(value);
  }
  draws.sort((a, b) => a - b);
  return {
    level: 0.95,
    method: 'Stratified question-id cluster bootstrap; both orders and repeated drafts kept together',
    replicates,
    clusters: groups.reduce((s, g) => s + g.clusters.length, 0),
    estimate: writingAccuracy(rows).accuracy,
    lower: draws[Math.floor(0.025 * (draws.length - 1))],
    upper: draws[Math.ceil(0.975 * (draws.length - 1))],
  };
}

async function main() {
  const arg = (s: string) => {
    const i = process.argv.indexOf(`--${s}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const input = arg('in'),
    out = arg('out');
  if (!input || !out) throw new Error('--in and --out required');
  const measured = JSON.parse(await readFile(input, 'utf8')) as {
    split: string;
    fullPopulation?: number;
    sampled?: boolean;
    results: WritingMeasuredRow[];
    costPer100: number;
  };
  const auditPath = arg('audit');
  const audit = auditPath
    ? (JSON.parse(await readFile(auditPath, 'utf8')) as {
        items: { rowKey: string; status: string; readFully: boolean; certainty?: string }[];
      })
    : undefined;
  const suspect = new Set(
    audit?.items.filter((x) => x.readFully && x.status === 'suspect').map((x) => x.rowKey),
  );
  const trusted = measured.results.filter((x) => !suspect.has(x.rowKey));
  const clearSuspect = new Set(
    audit?.items
      .filter((x) => x.readFully && x.status === 'suspect' && x.certainty?.startsWith('clear-'))
      .map((x) => x.rowKey),
  );
  const strictTrusted = measured.results.filter((x) => !clearSuspect.has(x.rowKey));
  const report = {
    source: input,
    split: measured.split,
    fullPopulation: measured.fullPopulation,
    sampled: measured.sampled,
    official: writingAccuracy(measured.results),
    perOrder: [0, 1].map((i) =>
      writingAccuracy(measured.results.map((r) => ({ ...r, games: [r.games[i] ?? 'tie'] }))),
    ),
    interval95: writingInterval(measured.results),
    costPer100: measured.costPer100,
    auditSensitivity: audit
      ? {
          method:
            'Exclude manually reviewed suspect labels; no labels flipped. This subset score is not official benchmark accuracy.',
          excluded: measured.results.length - trusted.length,
          score: writingAccuracy(trusted),
          strict: {
            excluded: measured.results.length - strictTrusted.length,
            score: writingAccuracy(strictTrusted),
            method:
              'Exclude only clear explicit-deliverable failures; retain conditional interpretation suspects.',
          },
          auditedRows: measured.results.filter((r) =>
            audit.items.some((a) => a.rowKey === r.rowKey && a.readFully),
          ).length,
        }
      : undefined,
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
