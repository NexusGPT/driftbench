import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { round3Options } from '../../../../examples/variables/conditions/round3';
import {
  type ConditionSpan,
  type ConditionsRecording,
  type ConditionsReport,
  feedFromConditions,
  replayConditions,
} from '../../src/feed';

const root = resolve(__dirname, '../../../..');
const dir = join(root, 'examples/variables/conditions');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('frozen4: single final recording, no network or sealed answers', () => {
  it('replays all outcomes with exact quotes and preserves the historical source evidence', async () => {
    const evidence = JSON.parse(readFileSync(join(dir, 'round3-frozen4.json'), 'utf8')) as {
      initialStore: VariableStore;
      store: VariableStore;
      recording: ConditionsRecording;
      report: ConditionsReport;
      spans: ConditionSpan[];
      texts: Record<string, string>;
      clauseBytesBase64: string;
      hashesBefore: Record<string, string>;
      hashesAfter: Record<string, string>;
    };
    const freeze = JSON.parse(readFileSync(join(dir, 'round3-freeze.json'), 'utf8')) as {
      clausesHash: string;
      readerHash: string;
      pipelineHash: string;
      files: Record<string, string>;
    };
    const totals = JSON.parse(readFileSync(join(dir, 'round3-frozen4.totals.json'), 'utf8')) as {
      hashesAfterScoring: Record<string, string>;
    };
    expect(evidence.spans).toHaveLength(73);
    const clauseBytes = Buffer.from(evidence.clauseBytesBase64, 'base64');
    expect(digest(clauseBytes)).toBe(freeze.clausesHash);
    expect(JSON.parse(clauseBytes.toString('utf8'))).toEqual(evidence.spans);
    expect(evidence.hashesBefore).toEqual(freeze.files);
    expect(evidence.hashesAfter).toEqual(freeze.files);
    expect(totals.hashesAfterScoring).toEqual(freeze.files);
    expect(digest(Buffer.from(JSON.stringify(freeze.files)))).toBe(freeze.pipelineHash);
    // Pin this profile; shared-library hashes preserve the historical run's inputs.
    expect(digest(readFileSync(join(dir, 'round3.ts')))).toBe(freeze.readerHash);
    const replayed = await feedFromConditions({
      store: evidence.initialStore,
      spans: evidence.spans,
      texts: new Map(Object.entries(evidence.texts)),
      ...replayConditions(evidence.recording),
      options: round3Options,
    });
    expect(replayed.store).toEqual(evidence.store);
    expect(replayed.report.outcomes).toEqual(evidence.report.outcomes);
    expect(replayed.report.outcomes).toHaveLength(73);
    console.info(
      'frozen4 post-fix replay',
      JSON.stringify({
        outcomes: replayed.report.outcomes.length,
        changedOutcomes: 0,
        recordedOutcomesHash: digest(Buffer.from(JSON.stringify(evidence.report.outcomes))),
        replayedOutcomesHash: digest(Buffer.from(JSON.stringify(replayed.report.outcomes))),
        storeIdentical: true,
      }),
    );
    for (const outcome of replayed.report.outcomes) {
      const span = evidence.spans.find((s) => s.id === outcome.span);
      if (!span) throw new Error('outcome lacks span');
      for (const pair of outcome.values) {
        const [variable, value] = pair.split('/');
        const entry = replayed.store.variables
          .find((v) => v.id === variable)
          ?.values.find((v) => v.id === value);
        expect(entry?.provenance).toContainEqual({ kind: 'quote', path: span.path, quote: span.quote });
        expect(evidence.texts[span.path]?.includes(span.quote)).toBe(true);
      }
    }
  });
});
