import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL('./fixtures/evidence-source-alias-recordings.json.gz', import.meta.url)),
  ).toString(),
) as {
  summaries: {
    set: string;
    total: number;
    baselineCorrect?: number;
    candidateCorrect?: number;
    fixes: number | null;
    breaks: number | null;
    status?: string;
  }[];
  rows: {
    set: string;
    id: string;
    truth: string;
    request: JudgeRequest;
    raw: string;
    baseline: string | null;
    candidate: string | null;
    transportError?: boolean;
  }[];
};

describe('recorded source alias replay, separate from string-only decoding', () => {
  for (const summary of fixture.summaries.filter((s) => s.total > 0)) {
    it(`${summary.set}: ${summary.fixes} fixes, ${summary.breaks} breaks`, () => {
      const rows = fixture.rows.filter((r) => r.set === summary.set);
      expect(rows).toHaveLength(summary.total);
      let correct = 0;
      let fixes = 0;
      let breaks = 0;
      for (const row of rows) {
        const result = row.transportError ? undefined : parseJudgeText(row.raw, row.request);
        const outcome =
          !result || result.unparsed
            ? row.set.startsWith('bench-')
              ? 'inconclusive'
              : null
            : result.answer.outcome;
        expect(outcome, row.id).toBe(row.candidate);
        correct += Number(outcome === row.truth);
        fixes += Number(row.baseline !== row.truth && outcome === row.truth);
        breaks += Number(row.baseline === row.truth && outcome !== row.truth);
      }
      expect({ correct, fixes, breaks }).toEqual({
        correct: summary.candidateCorrect,
        fixes: summary.fixes,
        breaks: summary.breaks,
      });
      expect(breaks).toBe(0);
    });
  }
  it('recovers the 15 source naming failures while preserving missing-set status', () => {
    expect(fixture.summaries.find((s) => s.set === 'bench-current/hard-factuality/haiku')).toMatchObject({
      total: 120,
      baselineCorrect: 104,
      candidateCorrect: 119,
      fixes: 15,
      breaks: 0,
    });
    for (const missing of fixture.summaries.filter((s) => s.total === 0)) {
      expect(missing).toMatchObject({ status: 'not recorded', fixes: null, breaks: null });
    }
  });
});
