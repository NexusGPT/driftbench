import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import decoderTwoMoves from './fixtures/decoder-2-moves.json';
import emptySourceFixes from './fixtures/whole-empty-source-fixes.json';

// Recorded met false ledgers that quote an empty `{}` file exactly. The frozen fixture holds them as
// inconclusive; grounding the whole empty source decodes each to its true verdict, fail.
const movedBy = emptySourceFixes as Record<string, string[]>;

// Recorded span lists that version 3 now reads: a quote of symbols alone found in the source it names, an
// input source label spelled another way (`input/<path>`), or a span quoting the criterion, which is dropped.
// The frozen candidate column holds these rows as inconclusive; version 3 keeps the recorded met.
const symbolMoved = decoderTwoMoves as Record<string, Record<string, string>>;

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL('./fixtures/criterion-decoder-recordings.json.gz', import.meta.url)),
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

describe('zero-cost recorded criterion decoder replay', () => {
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
      let before = 0;
      let after = 0;
      let fixes = 0;
      let breaks = 0;
      let movedBefore = 0;
      let movedAfter = 0;
      let symbolAfter = 0;
      let symbolFixes = 0;
      for (const row of rows) {
        const read = (version: 1 | 2 | 3) => {
          if (row.transportError) return 'inconclusive';
          const result = parseJudgeText(row.raw, { ...row.request, criterionDecoderVersion: version });
          return result.unparsed
            ? row.set.startsWith('bench-')
              ? 'inconclusive'
              : null
            : result.answer.outcome;
        };
        const old = read(1);
        const current = read(3);
        const moved = movedBy[row.set]?.includes(row.id) ?? false;
        if (moved) {
          // Version 2 already kept the verdict where the archived evidence was one string.
          expect([row.baseline, row.truth], row.id).toEqual(['inconclusive', 'fail']);
          movedBefore += 1;
          movedAfter += Number(row.candidate !== row.truth);
        }
        expect(old, row.id).toBe(moved ? row.truth : row.baseline);
        expect(read(2), `historical decoder 2: ${row.id}`).toBe(moved ? row.truth : row.candidate);
        const symbol = symbolMoved[row.set]?.[row.id];
        expect(current, row.id).toBe(moved ? row.truth : (symbol ?? row.candidate));
        if (symbol !== undefined) {
          expect(row.candidate, row.id).toBe('inconclusive');
          symbolAfter += Number(current === row.truth) - Number(row.candidate === row.truth);
          symbolFixes +=
            Number(old !== row.truth && current === row.truth) -
            Number(old !== row.truth && row.candidate === row.truth);
        }
        before += Number(old === row.truth);
        after += Number(current === row.truth);
        fixes += Number(old !== row.truth && current === row.truth);
        breaks += Number(old === row.truth && current !== row.truth);
      }
      expect({ before, after, fixes, breaks }).toEqual({
        before: (summary.baselineCorrect ?? 0) + movedBefore,
        after: (summary.candidateCorrect ?? 0) + movedAfter + symbolAfter,
        fixes: (summary.fixes ?? 0) - (movedBefore - movedAfter) + symbolFixes,
        breaks: summary.breaks,
      });
      expect(breaks).toBe(0);
    });
  }
  it('lists only recorded rows for the version 2 moves', () => {
    for (const [set, ids] of Object.entries(symbolMoved))
      for (const id of Object.keys(ids))
        expect(
          fixture.rows.some((r) => r.set === set && r.id === id),
          `${set} ${id}`,
        ).toBe(true);
  });
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
