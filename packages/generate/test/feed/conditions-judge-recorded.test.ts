import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type Clause, loadStore, textsOf, unitsOf } from '../../../../examples/variables/conditions/lib';
import { primaryScore, type PlantedRow } from '../../../../examples/variables/conditions/primary-score';
import { round2Options } from '../../../../examples/variables/conditions/round2';
import {
  type ConditionsRecording,
  type ConditionsReport,
  type ConditionSpan,
  feedFromConditions,
  replayConditions,
} from '../../src/feed';

const dir = join(__dirname, '../../../../examples/variables/conditions');
const read = <T>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
type Evidence = {
  recording: ConditionsRecording;
  report: ConditionsReport;
  store: VariableStore;
  spans: ConditionSpan[];
  texts: Record<string, string>;
  initialStore: VariableStore;
};

async function replay(evidence: Evidence, spans: readonly ConditionSpan[], texts: ReadonlyMap<string, string>) {
  const result = await feedFromConditions({
    store: evidence.initialStore ?? loadStore(), spans, texts,
    ...replayConditions(evidence.recording), options: round2Options,
  });
  expect(result.store).toEqual(evidence.store);
  expect(result.report.outcomes).toEqual(evidence.report.outcomes);
  for (const outcome of result.report.outcomes) {
    const span = spans.find((s) => s.id === outcome.span);
    if (!span) throw new Error('outcome has no input span');
    for (const pair of outcome.values) {
      const [variable, value] = pair.split('/');
      const entry = result.store.variables.find((v) => v.id === variable)?.values.find((v) => v.id === value);
      expect(entry?.provenance).toContainEqual({ kind: 'quote', path: span.path, quote: span.quote });
      expect(texts.get(span.path)?.includes(span.quote)).toBe(true);
    }
  }
  return result;
}

describe('system-1 condition feed: real recordings, no network', () => {
  it('replays the DEV-selected configuration above both 0.95 bars', async () => {
    const evidence = read<Evidence>('round2-dev-selected.json');
    const units = unitsOf(read<Clause[]>('dev-clauses.json'));
    const result = await replay(evidence, units, textsOf(units));
    const gold: PlantedRow[] = units.map((u) => {
      const conditions = u.truths.filter((t) => t !== 'none');
      return { id: u.id, kind: conditions.length === 0 ? 'none' : conditions.some((c) => c.value === 'NEW') ? 'new' : 'existing', conditions };
    });
    const known = new Set(loadStore().variables.flatMap((v) => v.values.map((x) => v.id + '/' + x.id)));
    const measured = primaryScore(gold, result.report.outcomes, known);
    expect(measured).toMatchObject({ correct: 53, assigned: 54, planted: 54 });
    expect(measured.precision).toBeGreaterThanOrEqual(0.95);
    expect(measured.recall).toBeGreaterThanOrEqual(0.95);
  });

  it('replays every frozen3 outcome and verifies its exact fictional quote', async () => {
    const evidence = read<Evidence>('round2-frozen3.json');
    const freeze = read<{ clausesHash: string }>('round2-freeze.json');
    expect(evidence.spans).toHaveLength(73);
    const bytes = readFileSync(join(dir, 'round2-frozen3-clauses.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(freeze.clausesHash);
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(evidence.spans);
    await replay(evidence, evidence.spans, new Map(Object.entries(evidence.texts)));
  });
});
