import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mcnemar } from '../shipped/stats';
import { clusteredExact, generateReport, overlap } from './report.mts';

type Case = { id: string; label: string; submission: string; question: string };
type Result = { id: string; label: string; outcome: string; complete: boolean; request_sha256: string[] };
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

function recordedPairs() {
  return ['qa', 'fact', 'panel'].flatMap((row) => {
    const cases = read<Case[]>(`heldout-480/${row}.json`);
    const results = (side: string) =>
      new Map(read<{ results: Result[] }>(`heldout-480/${row}-${side}.json`).results.map((r) => [r.id, r]));
    const ours = results('split');
    const theirs = results('theirs');
    return cases.map((c) => ({
      submission: c.submission,
      ours: ours.get(c.id)?.complete === true && ours.get(c.id)?.outcome === c.label,
      theirs: theirs.get(c.id)?.complete === true && theirs.get(c.id)?.outcome === c.label,
    }));
  });
}

describe('clustered exact sign permutation', () => {
  it('keeps repeated submission texts under one sign', () => {
    const repeated = Array.from({ length: 8 }, () => ({ submission: 'same', ours: true, theirs: false }));
    expect(clusteredExact(repeated)).toMatchObject({ clusters: 1, observed: 8, p: 1 });
    expect(clusteredExact(repeated.map((p, i) => ({ ...p, submission: String(i) }))).p).toBe(0.0078125);
  });
  it('returns one for ties and clusters whose row differences cancel', () => {
    expect(clusteredExact([]).p).toBe(1);
    expect(
      clusteredExact([
        { submission: 'same', ours: true, theirs: false },
        { submission: 'same', ours: false, theirs: true },
        { submission: 'other', ours: true, theirs: true },
      ]),
    ).toMatchObject({ clusters: 2, nonzero: 0, observed: 0, p: 1 });
  });
  it('matches direct enumeration for unequal cluster weights and either direction', () => {
    const deltas = [3, 2, -1, -1];
    const expected =
      Array.from({ length: 16 }, (_, mask) =>
        deltas.reduce((sum, d, i) => sum + d * (mask & (1 << i) ? 1 : -1), 0),
      ).filter((total) => Math.abs(total) >= 3).length / 16;
    const pairs = deltas.flatMap((delta, i) =>
      Array.from({ length: Math.abs(delta) }, () => ({
        submission: String(i),
        ours: delta > 0,
        theirs: delta < 0,
      })),
    );
    expect(clusteredExact(pairs).p).toBe(expected);
    expect(clusteredExact(pairs.map((p) => ({ ...p, ours: p.theirs, theirs: p.ours }))).p).toBe(expected);
  });
  it('reproduces the reviewed correction from frozen cases and recorded outcomes', () => {
    const pairs = recordedPairs();
    expect(pairs).toHaveLength(1440);
    const result = clusteredExact(pairs);
    expect(result).toMatchObject({ clusters: 960, nonzero: 34, observed: 15 });
    expect(result.p).toBeCloseTo(0.07199961598962545, 15);
    expect(result.p).toBeGreaterThan(0.05);
    const unclustered = clusteredExact(pairs.map((p, i) => ({ ...p, submission: String(i) })));
    expect(unclustered.p).toBeCloseTo(0.03153949735315109, 15);
  });
  it('retains the distinct QA lead and proves the fact row shares all split answers', () => {
    const qa = read<Case[]>('heldout-480/qa.json');
    const fact = read<Case[]>('heldout-480/fact.json');
    expect(new Set(qa.map((c) => c.submission)).size).toBe(480);
    const results = (name: string) => read<{ results: Result[] }>(`heldout-480/${name}.json`).results;
    const qaOurs = results('qa-split');
    const qaTheirs = results('qa-theirs');
    expect(mcnemar(qaOurs, qaTheirs)).toEqual({ first: 20, second: 0, p: 0.0000019073486328125 });
    const byText = new Map(qa.map((c) => [c.submission, qaOurs.find((r) => r.id === c.id)]));
    const factOurs = results('fact-split');
    for (const c of fact) {
      expect(byText.has(c.submission)).toBe(true);
      expect(factOurs.find((r) => r.id === c.id)?.request_sha256).toEqual(
        byText.get(c.submission)?.request_sha256,
      );
    }
  });
});

describe('reports from recorded evidence', () => {
  it('discloses exact submission exclusion separately from question reuse', () => {
    const practice = read<Case[]>('practice-panel/panel.json');
    const heldout = read<Case[]>('heldout-panel/panel.json');
    expect(overlap(practice, heldout)).toEqual({ submissions: 0, rows: 446, questions: 16 });
    const report = generateReport('heldout-panel');
    expect(report).toContain('446 of 480');
    expect(report).toContain('16 shared distinct questions');
    expect(report).toContain('0 exact submission overlaps');
  });
  it('labels the pooled correction post hoc and does not round the QA p-value to zero', () => {
    const report = generateReport('heldout-480');
    expect(report).toContain('Post-hoc correction of the pre-registered pooled test');
    expect(report).toContain('The pooled lead is not significant');
    expect(report).toContain('960 | 0.07199962 | 0.03153950');
    expect(report).toContain('0.0000019073486');
  });
  it.each(['heldout-480', 'heldout-panel', 'practice', 'practice-panel'])(
    'reproduces %s/results.md byte for byte',
    (dir) => {
      expect(generateReport(dir)).toBe(readFileSync(new URL(`${dir}/results.md`, import.meta.url), 'utf8'));
    },
  );
});
