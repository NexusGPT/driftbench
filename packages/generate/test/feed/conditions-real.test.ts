import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVariableStoreText } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type ConditionsRecording, feedFromConditions, replayConditions } from '../../src/feed';

/**
 * Replays the recording of the real systems (Jev as system 1, Haiku as system 2) on the planted spans of the
 * three invented estates. examples/variables/conditions/record.ts made the recording; no call is made here.
 * The numbers pinned below are what the recording measured, not a bar: they move only with a new recording or
 * a change of the feed.
 */
const dir = join(__dirname, '../../../../examples/variables/conditions');
const read = (name: string) => readFileSync(join(dir, name), 'utf8');
type Planted = { id: string; path: string; quote: string; truth: string };
const planted = (JSON.parse(read('spans.json')) as { spans: Planted[] }).spans;
const recording = JSON.parse(read('cassette.json')) as ConditionsRecording;
const recordingNo05 = JSON.parse(read('cassette-no-at-0.5.json')) as ConditionsRecording;
const loaded = parseVariableStoreText(read('store.yaml'), 'yaml');
if (!loaded.ok) throw new Error('the candidate store does not load');
const candidates = loaded.store;
const texts = new Map(planted.map((s) => [s.path, readFileSync(join(dir, '../../estates', s.path), 'utf8')]));

async function run(decide?: { yesAt?: number; noAt?: number }) {
  const replayed = replayConditions(decide ? recordingNo05 : recording);
  const result = await feedFromConditions({
    store: candidates,
    spans: planted.map(({ id, path, quote }) => ({ id, path, quote })),
    texts,
    reader: replayed.reader,
    proposer: replayed.proposer,
    ...(decide ? { options: { decide } } : {}),
  });
  return result;
}

/**
 * A known truth is one value. A NEW group is right when its first span was proposed and every later span of the
 * group took the value the first one got. Every value a span ends under counts as assigned.
 */
function score(outcomes: ReadonlyArray<{ span: string; status: string; values: string[] }>) {
  const by = new Map(outcomes.map((o) => [o.span, o]));
  const firstOf = new Map<string, string>();
  let assigned = 0;
  let correct = 0;
  for (const span of planted) {
    const o = by.get(span.id);
    if (!o) continue;
    assigned += o.values.length;
    if (!span.truth.startsWith('NEW:')) {
      if (o.values.includes(span.truth)) correct++;
      continue;
    }
    const group = span.truth;
    const first = firstOf.get(group);
    if (first === undefined) {
      if (o.status === 'proposed') {
        firstOf.set(group, o.values[0] as string);
        correct++;
      }
    } else if (o.values.includes(first)) {
      correct++;
    }
  }
  return { assigned, correct, planted: planted.length };
}

describe('the recording of the real systems on the planted spans', () => {
  it('replays with no call and holds the 26 planted spans', async () => {
    const { report } = await run();
    expect(report.spans).toBe(26);
    expect(report.failed).toBe(0);
    expect(report.refused).toBe(0);
  });

  it('measures the default thresholds (yes at 0.75, no at 0.25)', async () => {
    const { report } = await run();
    expect(report).toMatchObject({ matched: 16, proposed: 1, unsure: 9, unmatched: 0, proposerCalls: 1 });
    expect(score(report.outcomes)).toEqual({ assigned: 19, correct: 17, planted: 26 });
  });

  it('measures no at 0.5, read from its own recording (the candidates grow as values are proposed, so its questions differ)', async () => {
    const { report } = await run({ noAt: 0.5 });
    expect(report.unsure).toBeLessThan(8);
    expect(report).toMatchObject({ matched: 18, proposed: 4, unsure: 4, unmatched: 0, failed: 0 });
    expect(score(report.outcomes)).toEqual({ assigned: 24, correct: 22, planted: 26 });
  });

  it('puts only quotes of the estate files under the values', async () => {
    const { store } = await run();
    for (const variable of store.variables) {
      for (const value of variable.values) {
        for (const p of value.provenance ?? []) {
          if (p.kind === 'quote') expect(texts.get(p.path)?.includes(p.quote)).toBe(true);
        }
      }
    }
  });
});
