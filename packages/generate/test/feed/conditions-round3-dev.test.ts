import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type Clause, loadStore, unitsOf } from '../../../../examples/variables/conditions/lib';
import { type PlantedRow, primaryScore } from '../../../../examples/variables/conditions/primary-score';
import { ROUND3_THRESHOLD, round3Options } from '../../../../examples/variables/conditions/round3';
import {
  type ConditionSpan,
  type ConditionsRecording,
  type ConditionsReport,
  feedFromConditions,
  replayConditions,
} from '../../src/feed';

const dir = join(__dirname, '../../../../examples/variables/conditions');
type Batch = {
  file: string;
  spans: ConditionSpan[];
  texts: Record<string, string>;
  initialStore: VariableStore;
  recording: ConditionsRecording;
  store: VariableStore;
  report: ConditionsReport;
};

describe('round-3 DEV classes: permissive yes and existing-or-new decisions', () => {
  it('replays both independent seed-store batches above the unchanged 0.95 bars', async () => {
    const evidence = JSON.parse(readFileSync(join(dir, 'round3-dev-selected.json'), 'utf8')) as {
      threshold: number;
      batches: Batch[];
    };
    expect(evidence.threshold).toBe(ROUND3_THRESHOLD);
    expect(evidence.batches.map((b) => b.file)).toEqual(['dev-clauses.json', 'round3-dev-clauses.json']);
    const outcomes = [];
    const gold: PlantedRow[] = [];
    const seed = loadStore();
    const known = new Set(seed.variables.flatMap((v) => v.values.map((x) => v.id + '/' + x.id)));
    for (const batch of evidence.batches) {
      expect(batch.initialStore).toEqual(seed);
      const replayed = await feedFromConditions({
        store: batch.initialStore,
        spans: batch.spans,
        texts: new Map(Object.entries(batch.texts)),
        ...replayConditions(batch.recording),
        options: round3Options,
      });
      expect(replayed.store).toEqual(batch.store);
      expect(replayed.report.outcomes).toEqual(batch.report.outcomes);
      expect(replayed.report.outcomes).toHaveLength(batch.spans.length);
      outcomes.push(...replayed.report.outcomes);
      for (const outcome of replayed.report.outcomes) {
        const span = batch.spans.find((s) => s.id === outcome.span);
        if (!span) throw new Error('outcome lacks its span');
        for (const pair of outcome.values) {
          const [variable, value] = pair.split('/');
          const entry = replayed.store.variables
            .find((v) => v.id === variable)
            ?.values.find((v) => v.id === value);
          expect(entry?.provenance).toContainEqual({ kind: 'quote', path: span.path, quote: span.quote });
        }
      }
      const units = unitsOf(JSON.parse(readFileSync(join(dir, batch.file), 'utf8')) as Clause[]);
      for (const unit of units) {
        const conditions = unit.truths.filter((t) => t !== 'none');
        gold.push({
          id: unit.id,
          kind:
            conditions.length === 0 ? 'none' : conditions.some((c) => c.value === 'NEW') ? 'new' : 'existing',
          conditions,
        });
      }
    }
    const measured = primaryScore(gold, outcomes, known);
    expect(measured.planted).toBe(93);
    expect.soft(measured.precision).toBeGreaterThanOrEqual(0.95);
    expect.soft(measured.recall).toBeGreaterThanOrEqual(0.95);
  });
});
