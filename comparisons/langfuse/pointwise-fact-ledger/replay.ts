/** Offline import and replay of frozen candidate responses through the public package only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  buildPrompt,
  type Cassette,
  type JudgeOutcome,
  type JudgeRequest,
  PROMPT_FINGERPRINT,
  playerClient,
  requestKey,
} from '@agent-nexus/driftbench-judges';

export const fixtureUrl = new URL(
  '../../../packages/judges/test/fixtures/pointwise-fact-ledger.json',
  import.meta.url,
);
export const reportUrl = new URL('./replay.json', import.meta.url);

type FrozenRow = {
  id: string;
  family: string;
  label: string;
  user: string;
  raw: string;
  requestSha256: string;
};
type Frozen = {
  sourceBranch: string;
  sourceCommit: string;
  system: string;
  slices: { name: string; sources: Record<string, string>; rows: FrozenRow[] }[];
};
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export async function replayPointwiseFacts() {
  const fixtureBytes = await readFile(fixtureUrl, 'utf8');
  const frozen = JSON.parse(fixtureBytes) as Frozen;
  const judge = {
    id: 'frozen-facts',
    family: 'anthropic',
    cls: 'system2' as const,
    model: 'claude-haiku-5-5',
    cost: 0,
  };
  const slices = [];
  for (const slice of frozen.slices) {
    const cassette: Cassette = { version: 1, judges: [judge], entries: [] };
    const inputs = slice.rows.map((row) => {
      const data = JSON.parse(row.user) as { query: string; reference: string; reply: string };
      const request: JudgeRequest = {
        assessment: { kind: 'fact-ledger' },
        criterion: {
          name: 'reference-facts',
          rubric: 'Every requested fact matches; no unsupported claims.',
        },
        reference: data.reference,
        transcript: [
          { role: 'user', text: data.query },
          { role: 'agent', text: data.reply },
        ],
      };
      const strict: JudgeRequest = { ...request, assessment: { kind: 'fact-ledger', grounding: 'strict' } };
      const prompt = buildPrompt(request);
      assert.equal(prompt.system, frozen.system, `${row.id}: frozen system changed`);
      assert.equal(prompt.user, row.user, `${row.id}: frozen user changed`);
      assert.deepEqual(buildPrompt(strict), prompt, `${row.id}: strict changes the model prompt`);
      assert.equal(
        sha256(JSON.stringify([prompt.system, prompt.user])),
        row.requestSha256,
        `${row.id}: request digest changed`,
      );
      // Only byte-identical prompts can import a historical raw response. Strict replays the same
      // response through the stricter parser; it is not a new model measurement.
      for (const input of [request, strict])
        cassette.entries.push({
          judge: judge.id,
          key: requestKey(input, judge),
          answerContract: 'ledger',
          raw: row.raw,
        });
      return { row, request, strict };
    });
    assert.equal(new Set(inputs.map(({ row }) => row.id)).size, inputs.length);
    const player = playerClient(cassette, judge.id);
    const transitions: Record<string, number> = {};
    const rows: {
      id: string;
      family: string;
      label: string;
      semantic: JudgeOutcome;
      strict: JudgeOutcome;
      strictReason?: string;
    }[] = [];
    for (const { row, request, strict } of inputs) {
      const semanticResult = await player.judge(request);
      const strictResult = await player.judge(strict);
      const semantic = semanticResult.answer.outcome;
      const strictOutcome = strictResult.answer.outcome;
      const transition = `${semantic}->${strictOutcome}`;
      transitions[transition] = (transitions[transition] ?? 0) + 1;
      rows.push({
        id: row.id,
        family: row.family,
        label: row.label,
        semantic,
        strict: strictOutcome,
        ...(strictResult.unparsed ? { strictReason: strictResult.answer.reasoning } : {}),
      });
    }
    const counts = (mode: 'semantic' | 'strict') => ({
      correct: rows.filter((row) => row[mode] === row.label).length,
      wrong: rows.filter((row) => row[mode] !== 'inconclusive' && row[mode] !== row.label).length,
      inconclusive: rows.filter((row) => row[mode] === 'inconclusive').length,
    });
    slices.push({
      name: slice.name,
      sources: slice.sources,
      n: rows.length,
      semantic: counts('semantic'),
      strict: counts('strict'),
      changed: rows.filter((row) => row.semantic !== row.strict).length,
      transitions,
      rows,
    });
  }
  return {
    sourceBranch: frozen.sourceBranch,
    sourceCommit: frozen.sourceCommit,
    fixtureSha256: sha256(fixtureBytes),
    systemSha256: sha256(frozen.system),
    defaultPromptFingerprint: PROMPT_FINGERPRINT,
    liveCalls: 0,
    slices,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await replayPointwiseFacts();
  if (process.argv.includes('--write')) await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
  else
    assert.deepEqual(
      report,
      JSON.parse(await readFile(reportUrl, 'utf8')),
      'committed replay report differs',
    );
  console.log(
    JSON.stringify(
      { ...report, slices: report.slices.map(({ rows: _rows, sources: _sources, ...summary }) => summary) },
      null,
      2,
    ),
  );
}
