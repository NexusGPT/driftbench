import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  type Clause,
  loadStore,
  score,
  textsOf,
  unitsOf,
} from '../../../../examples/variables/conditions/lib';
import {
  type ConditionsRecording,
  type ConditionsReport,
  feedFromConditions,
  replayConditions,
} from '../../src/feed';

const dir = join(__dirname, '../../../../examples/variables/conditions');
type Evidence = {
  recording: ConditionsRecording;
  report: ConditionsReport;
  store: VariableStore;
  model: string;
};
const read = <T>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;

describe('the frozen model reader, recorded on fictional planted conditions', () => {
  it('keeps the frozen reader and prompts byte-identical through the continuation', () => {
    const freeze = read<{ hashes: Record<string, string> }>('model-freeze.json');
    for (const [file, hash] of Object.entries(freeze.hashes)) {
      if (file === 'settings') continue;
      const bytes = readFileSync(join(__dirname, '../../../..', file));
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(hash);
    }
  });

  it('replays only the 32 failed spans as a continuation, retaining all successful outcomes', async () => {
    const partial = read<Evidence>('model-heldout-2.json');
    const completed = read<
      Evidence & {
        continuation: { recording: ConditionsRecording; spans: string[] };
        settingsHash: string;
      }
    >('model-heldout-2-completed.json');
    const units = unitsOf(read<Clause[]>('heldout-clauses-2.json'));
    const failed = new Set(partial.report.outcomes.filter((o) => o.status === 'failed').map((o) => o.span));
    expect(completed.continuation.spans).toEqual(units.filter((u) => failed.has(u.id)).map((u) => u.id));
    expect(failed.size).toBe(32);
    const systems = replayConditions(completed.continuation.recording);
    const continued = await feedFromConditions({
      store: partial.store,
      spans: units.filter((u) => failed.has(u.id)).map(({ id, path, quote }) => ({ id, path, quote })),
      texts: textsOf(units),
      ...systems,
      options: { newVariables: false },
    });
    const replaced = new Map(continued.report.outcomes.map((o) => [o.span, o]));
    const outcomes = partial.report.outcomes.map((o) => replaced.get(o.span) ?? o);
    expect(continued.store).toEqual(completed.store);
    expect(outcomes.map(({ span, status, values }) => ({ span, status, values }))).toEqual(
      completed.report.outcomes.map(({ span, status, values }) => ({ span, status, values })),
    );
    for (const old of partial.report.outcomes.filter((o) => o.status !== 'failed')) {
      expect(outcomes.find((o) => o.span === old.span)).toEqual(old);
    }
    const measured = score(units, { store: continued.store, report: { ...partial.report, outcomes } });
    for (const outcome of outcomes) {
      const unit = units.find((u) => u.id === outcome.span);
      for (const name of outcome.values) {
        const [variable, value] = name.split('/');
        const found = continued.store.variables
          .find((v) => v.id === variable)
          ?.values.find((v) => v.id === value);
        expect(found?.provenance).toContainEqual({
          kind: 'quote',
          path: unit?.path,
          quote: unit?.quote,
        });
      }
    }
    // No reader or prompt changes after seeing the sealed result.
    expect(measured).toMatchObject({ assigned: 53, correct: 46, planted: 60 });
    expect(continued.report.failed).toBe(15);
    expect(measured.correct / measured.assigned).toBeLessThan(0.95);
    expect(measured.correct / measured.planted).toBeLessThan(0.95);
  });

  it('replays the one sealed frozen2 measurement without a model', async () => {
    const evidence = read<Evidence>('model-heldout-2.json');
    const units = unitsOf(read<Clause[]>('heldout-clauses-2.json'));
    const texts = textsOf(units);
    const systems = replayConditions(evidence.recording);
    const result = await feedFromConditions({
      store: loadStore(),
      spans: units.map(({ id, path, quote }) => ({ id, path, quote })),
      texts,
      ...systems,
      options: { newVariables: false },
    });
    const measured = score(units, result);
    expect(evidence.model).toBe('claude-sonnet-5-5');
    expect(result.store).toEqual(evidence.store);
    expect(result.report.outcomes.map(({ span, status, values }) => ({ span, status, values }))).toEqual(
      evidence.report.outcomes.map(({ span, status, values }) => ({ span, status, values })),
    );
    // The measured counts are pinned below after the single blinded run, never tuned on its errors.
    expect(measured).toMatchObject({ assigned: 36, correct: 32, planted: 60 });
    expect(result.report.failed).toBe(32);
    expect(measured.correct / measured.assigned).toBeLessThan(0.95);
    expect(measured.correct / measured.planted).toBeLessThan(0.95);
    for (const outcome of result.report.outcomes) {
      if (outcome.values.length === 0) continue;
      const span = units.find((unit) => unit.id === outcome.span);
      for (const name of outcome.values) {
        const [variable, value] = name.split('/');
        const found = result.store.variables
          .find((entry) => entry.id === variable)
          ?.values.find((entry) => entry.id === value);
        expect(found?.provenance).toContainEqual({
          kind: 'quote',
          path: span?.path,
          quote: span?.quote,
        });
        expect(texts.get(span?.path ?? '')?.includes(span?.quote ?? '')).toBe(true);
      }
    }
  });
});
