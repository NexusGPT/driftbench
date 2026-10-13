import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL('./fixtures/criterion-decoder-recordings.json.gz', import.meta.url)),
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

describe('zero-cost recorded criterion decoder replay', () => {
  for (const summary of fixture.summaries.filter((s) => s.total > 0)) {
    it(`${summary.set}: ${summary.fixes} fixes, ${summary.breaks} breaks`, () => {
      const rows = fixture.rows.filter((r) => r.set === summary.set);
      expect(rows).toHaveLength(summary.total);
      let before = 0;
      let after = 0;
      let fixes = 0;
      let breaks = 0;
      for (const row of rows) {
        const read = (version: 1 | 2) => {
          if (row.transportError) return 'inconclusive';
          const result = parseJudgeText(row.raw, { ...row.request, criterionDecoderVersion: version });
          return result.unparsed
            ? row.set.startsWith('bench-')
              ? 'inconclusive'
              : null
            : result.answer.outcome;
        };
        const old = read(1);
        const current = read(2);
        expect(old, row.id).toBe(row.baseline);
        expect(current, row.id).toBe(row.candidate);
        before += Number(old === row.truth);
        after += Number(current === row.truth);
        fixes += Number(old !== row.truth && current === row.truth);
        breaks += Number(old === row.truth && current !== row.truth);
      }
      expect({ before, after, fixes, breaks }).toEqual({
        before: summary.baselineCorrect,
        after: summary.candidateCorrect,
        fixes: summary.fixes,
        breaks: summary.breaks,
      });
      expect(breaks).toBe(0);
    });
  }
  it('confirms the pre-registered scores without treating absent recordings as passes', () => {
    expect(fixture.summaries.find((s) => s.set === 'long')).toMatchObject({
      total: 240,
      baselineCorrect: 205,
      candidateCorrect: 229,
      fixes: 24,
      breaks: 0,
    });
    expect(fixture.summaries.find((s) => s.set === 'short')).toMatchObject({
      total: 240,
      baselineCorrect: 238,
      candidateCorrect: 240,
      fixes: 2,
      breaks: 0,
    });
    for (const missing of fixture.summaries.filter((s) => s.total === 0)) {
      expect(missing).toMatchObject({ status: 'not recorded', fixes: null, breaks: null });
    }
  });
});
