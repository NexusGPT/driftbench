import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJudgeValue } from '../../packages/judges/src/assessment';
import type { JudgeRequest } from '../../packages/judges/src/contract';

type LegacyRow = { id: number; weight: number; a: number; b: number; evidence: string };
type Case = {
  id: string;
  sourceTemplate: string;
  question: string;
  rubric: string;
  stableRubricItemId: string;
  intendedLegacyRowId: number;
  intendedRowEvidenceSha256: string;
  clean: string;
  defect: string;
  cleanSha256: string;
  defectSha256: string;
  canonicalClean: 'A' | 'B';
  reversed: boolean;
  recordingDigest: string;
  recordingLine: number;
  raw: string;
  rawSha256: string;
};
/** Deterministic offline replay. Reads local evidence and returns results without writing or logging. */
export function replay() {
  const fixtureText = readFileSync(new URL('./fixture.json', import.meta.url), 'utf8');
  const fixture = JSON.parse(fixtureText) as { schemaVersion: number; sources: unknown; cases: Case[] };
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const expectedIds = [6, 7, 14, 15, 17, 25, 26, 27, 35, 36, 45, 46, 47, 48, 54, 57, 58].map(
    (n) => `rb-bank-${String(n).padStart(3, '0')}`,
  );
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(
    fixture.cases.map((item) => item.id),
    expectedIds,
  );

  function parseRecording(item: Case): { checks: LegacyRow[]; winner: string } {
    assert.equal(sha(item.raw), item.rawSha256, `${item.id}: raw recording hash`);
    assert.equal(sha(item.clean), item.cleanSha256);
    assert.equal(sha(item.defect), item.defectSha256);
    assert.equal(item.cleanSha256 > item.defectSha256, item.reversed);
    assert.equal(item.canonicalClean, item.reversed ? 'B' : 'A');
    const text = item.raw.trim();
    const value = JSON.parse(
      text.startsWith('```json') && text.endsWith('```') ? text.slice(7, -3).trim() : text,
    ) as { checks: LegacyRow[]; winner: string };
    assert.ok(value.checks.length > 1);
    for (const [index, row] of value.checks.entries()) {
      assert.equal(row.id, index + 1);
      assert.ok([0, 1, 2].includes(row.a) && [0, 1, 2].includes(row.b));
      assert.equal(typeof row.evidence, 'string');
    }
    assert.equal(value.winner, item.canonicalClean);
    const intended = value.checks.find((row) => row.id === item.intendedLegacyRowId);
    assert.ok(intended);
    assert.equal(sha(intended.evidence), item.intendedRowEvidenceSha256);
    assert.equal(item.stableRubricItemId, `rubric:${item.sourceTemplate}`);
    assert.equal(item.intendedLegacyRowId, ['rb-bank-025', 'rb-bank-046'].includes(item.id) ? 2 : 1);
    return value;
  }

  function replayCase(item: Case, checks: LegacyRow[], selectedLegacyRowId: number) {
    // Semantic mapping is a verified human annotation, not a parser capability.
    // Scaling preserves 0/2, 1/2, 2/2 fulfillment as production 0/4, 2/4, 4/4.
    const adapted = {
      items: checks.map((row) => ({
        name:
          row.id === selectedLegacyRowId
            ? item.stableRubricItemId
            : `unknown:${item.id}:legacy-row-${row.id}`,
        a: row.a * 2,
        b: row.b * 2,
        reasoning: row.evidence,
      })),
    };
    const request: JudgeRequest = {
      criterion: { name: item.stableRubricItemId, rubric: item.rubric },
      transcript: [{ role: 'user', text: item.question }],
      candidates: item.reversed ? { A: item.defect, B: item.clean } : { A: item.clean, B: item.defect },
      assessment: {
        kind: 'rubric',
        pairwise: true,
        items: [{ name: item.stableRubricItemId, rubric: item.rubric, weight: 1 }],
      },
    };
    const result = parseJudgeValue(adapted, request);
    assert.ok(!result.unparsed, `${item.id}: ${result.answer.reasoning}`);
    assert.ok(result.rubric);
    assert.equal(result.rubric.items.length, 1);
    const retained = result.rubric.items[0];
    const original = checks.find((row) => row.id === selectedLegacyRowId);
    assert.ok(retained && original);
    assert.ok(typeof retained.first === 'number' && typeof retained.second === 'number');
    assert.equal(retained.name, item.stableRubricItemId);
    assert.equal(retained.first, original.a * 2);
    assert.equal(retained.second, original.b * 2);
    assert.equal(retained.reasoning, original.evidence);
    assert.equal(result.rubric.first, original.a / 2);
    assert.equal(result.rubric.second, original.b / 2);
    const ignored = adapted.items
      .filter((row) => row.name !== item.stableRubricItemId)
      .map((row) => row.name);
    assert.deepEqual(result.ignoredRequirementIds, ignored);
    assert.ok(result.ignoredRequirementIds);

    // Invalid required ledgers remain invalid even with otherwise valid extra rows.
    const required = adapted.items.find((row) => row.name === item.stableRubricItemId);
    assert.ok(required);
    const missing = parseJudgeValue({ items: adapted.items.filter((row) => row !== required) }, request);
    const duplicate = parseJudgeValue({ items: [...adapted.items, required] }, request);
    assert.equal(missing.unparsed, true, `${item.id}: missing required item must fail`);
    assert.equal(duplicate.unparsed, true, `${item.id}: duplicate required item must fail`);
    const cleanScore = item.reversed ? retained.second : retained.first;
    const defectScore = item.reversed ? retained.first : retained.second;
    return {
      selectedLegacyRowId,
      cleanScore,
      defectScore,
      cleanAccepted: cleanScore === 4,
      defectRejected: defectScore < 4,
      winner: result.winner,
      ignoredRequirementIds: result.ignoredRequirementIds,
    };
  }

  const cases = fixture.cases.map((item) => {
    const recorded = parseRecording(item);
    return {
      id: item.id,
      recordingDigest: item.recordingDigest,
      recordingLine: item.recordingLine,
      rawSha256: item.rawSha256,
      stableRubricItemId: item.stableRubricItemId,
      recordedWinner: recorded.winner,
      canonicalClean: item.canonicalClean,
      mapped: replayCase(item, recorded.checks, item.intendedLegacyRowId),
      blindId1: replayCase(item, recorded.checks, 1),
    };
  });
  const summarize = (mode: 'mapped' | 'blindId1') => ({
    pairs: cases.length,
    cleanAccepted: cases.filter((item) => item[mode].cleanAccepted).length,
    defectsRejected: cases.filter((item) => item[mode].defectRejected).length,
    unresolvedIds: cases.filter((item) => !item[mode].defectRejected).map((item) => item.id),
  });
  const mapped = summarize('mapped');
  const blindId1 = summarize('blindId1');
  assert.deepEqual(mapped, {
    pairs: 17,
    cleanAccepted: 17,
    defectsRejected: 16,
    unresolvedIds: ['rb-bank-036'],
  });
  assert.deepEqual(blindId1, {
    pairs: 17,
    cleanAccepted: 17,
    defectsRejected: 14,
    unresolvedIds: ['rb-bank-025', 'rb-bank-036', 'rb-bank-046'],
  });
  const ignoredRows = cases.reduce((total, item) => total + item.mapped.ignoredRequirementIds.length, 0);
  assert.equal(ignoredRows, 22);
  const conflict = cases.find((item) => item.id === 'rb-bank-036');
  assert.ok(conflict);
  assert.equal(conflict.mapped.cleanScore, 4);
  assert.equal(conflict.mapped.defectScore, 4);
  assert.equal(conflict.mapped.winner, 'tie');
  return {
    method: 'offline replay of human-mapped recorded rows through production parseJudgeValue',
    fixtureSha256: sha(fixtureText),
    productionAssessmentSha256: sha(
      readFileSync(new URL('../../packages/judges/src/assessment.ts', import.meta.url), 'utf8'),
    ),
    scoreAdapter: { recordedMaximum: 2, productionMaximum: 4, multiplier: 2 },
    modelCalls: 0,
    mapped,
    blindId1,
    ignoredRows,
    negativeControls: { missingRequiredRejected: 34, duplicateRequiredRejected: 34 },
    unresolvedConflict:
      'rb-bank-036 retains structured 2/2 as 4/4; the parser does not repair score/prose disagreement or inherit the recorded winner.',
    scope:
      'These 17 archived failures only. No fresh prompt, retry, grounding, or generalization performance is measured.',
    cases,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(replay(), null, 2));
}
