import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import emptySourceFixes from './fixtures/whole-empty-source-fixes.json';

// Recorded met false ledgers that quote an empty `{}` file exactly. The frozen fixture holds them as
// inconclusive; grounding the whole empty source decodes each to its true verdict, fail.
const movedBy = emptySourceFixes as Record<string, string[]>;

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL('./fixtures/evidence-source-alias-recordings.json.gz', import.meta.url)),
  ).toString(),
) as {
  summaries: {
    set: string;
    total: number;
    recordedFingerprint?: string;
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
  it('covers all 14 sets for both recorded models and labels Gemini as not recorded', () => {
    const current = fixture.summaries.filter((s) => s.set.startsWith('bench-current/'));
    expect(current).toHaveLength(42);
    for (const model of ['haiku', 'gpt-6-luna']) {
      const sets = current.filter((s) => s.set.endsWith(`/${model}`));
      expect(sets).toHaveLength(14);
      expect(sets.reduce((n, s) => n + s.total, 0)).toBe(1798);
      for (const set of sets)
        expect(set).toMatchObject({ status: 'recorded', recordedFingerprint: '398673b792c1', breaks: 0 });
    }
    for (const set of current.filter((s) => s.set.endsWith('/gemini-3.8-flash')))
      expect(set).toMatchObject({ total: 0, status: 'not recorded', fixes: null, breaks: null });
  });
  for (const summary of fixture.summaries.filter((s) => s.total > 0)) {
    it(`${summary.set}: ${summary.fixes} fixes, ${summary.breaks} breaks`, () => {
      const rows = fixture.rows.filter((r) => r.set === summary.set);
      expect(rows).toHaveLength(summary.total);
      let correct = 0;
      let fixes = 0;
      let breaks = 0;
      for (const row of rows) {
        // Keep this alias-only replay independent of decoder PR 182's default version.
        const request = { ...row.request, criterionDecoderVersion: 1 as const };
        const result = row.transportError ? undefined : parseJudgeText(row.raw, request);
        const outcome =
          !result || result.unparsed
            ? row.set.startsWith('bench-')
              ? 'inconclusive'
              : null
            : result.answer.outcome;
        const moved = movedBy[row.set]?.includes(row.id) ?? false;
        if (moved) expect([row.candidate, row.truth], row.id).toEqual(['inconclusive', 'fail']);
        expect(outcome, row.id).toBe(moved ? row.truth : row.candidate);
        correct += Number(outcome === row.truth);
        fixes += Number(row.baseline !== row.truth && outcome === row.truth);
        breaks += Number(row.baseline === row.truth && outcome !== row.truth);
      }
      expect({ correct, fixes, breaks }).toEqual({
        correct: (summary.candidateCorrect ?? 0) + (movedBy[summary.set]?.length ?? 0),
        fixes: (summary.fixes ?? 0) + (movedBy[summary.set]?.length ?? 0),
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
