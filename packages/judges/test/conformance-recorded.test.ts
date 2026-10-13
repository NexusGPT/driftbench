import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  CONFORMANCE_SYSTEM_PROMPT,
  createAnthropicJudge,
  emptyCassette,
  type JudgeRequest,
  judgeConformance,
  playerClient,
  recordingClient,
  TranscriptEntry,
} from '../src/index';
import freeze from './fixtures/conformance/freeze.json';
import provenance from './fixtures/conformance/provenance.json';

const root = new URL('./fixtures/conformance/', import.meta.url);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const decoded = (name: string) => gunzipSync(readFileSync(new URL(name, root)));
const json = <T>(name: string): T => JSON.parse(decoded(name).toString('utf8')) as T;
type Item = {
  id: string;
  adapterVersion: number;
  scenario: string;
  criteria: string[];
  entries: TranscriptEntry[];
  truth: string[];
};
type Report = {
  expected: number;
  complete: boolean;
  fixtureSha256: string;
  answers: { id: string; predictions: string[]; request_sha256s: string[] }[];
};
type Call = {
  request_sha256: string;
  system: string;
  user: string;
  text: string;
  failed: boolean;
};
const calls = decoded('calls.jsonl.gz')
  .toString('utf8')
  .trimEnd()
  .split('\n')
  .map((line) => JSON.parse(line) as Call);
const byHash = new Map(calls.map((call) => [call.request_sha256, call]));

// Exact request flags from PR109 runner.mts for these unstructured audit calls.
function researchRequestHash(system: string, user: string): string {
  const flags = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'haiku',
    '--system-prompt',
    system,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--max-budget-usd',
    '0.03',
  ];
  return sha(JSON.stringify({ flags, user }));
}

describe('PR109 conformance recordings through the public provider client', () => {
  it('pins provenance, original raw recordings and the frozen prompt', () => {
    expect(provenance.sourceCommit).toBe('73939d09686bd7d214acc6dfcc74b831d1ed991d');
    expect(sha(CONFORMANCE_SYSTEM_PROMPT)).toBe(freeze.promptSha256);
    for (const [name, expected] of Object.entries(provenance.fixtures)) {
      const bytes = readFileSync(new URL(name, root));
      expect(sha(bytes), name).toBe(expected.sha256);
      const original = name.endsWith('.gz') ? gunzipSync(bytes) : bytes;
      expect(sha(original), name).toBe(expected.decodedSha256);
      expect(original.length, name).toBe(expected.decodedBytes);
    }
    expect(calls).toHaveLength(480);
    expect(byHash.size).toBe(480);
    for (const call of calls) {
      expect(call.failed).toBe(false);
      expect(call.system).toBe(CONFORMANCE_SYSTEM_PROMPT);
      expect(researchRequestHash(call.system, call.user)).toBe(call.request_sha256);
    }
  });

  for (const [population, correctVectors, correctCriteria] of [
    ['short', 120, 240],
    ['long', 119, 239],
  ] as const) {
    it(`replays ${population}: ${correctVectors}/120 exact vectors and ${correctCriteria}/240 criteria with zero model calls`, async () => {
      const items = json<Item[]>(`${population}-inputs.json.gz`);
      const report = json<Report>(`${population}-report.json.gz`);
      expect(items).toHaveLength(120);
      expect(report.expected).toBe(120);
      expect(report.complete).toBe(true);
      expect(report.answers).toHaveLength(120);
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Live network is forbidden in recorded replay.'));
      let transportCalls = 0;
      const mismatches: { id: string; truth: string[]; predictions: string[] }[] = [];
      let criteriaMatched = 0;
      try {
        for (const [itemIndex, item] of items.entries()) {
          const recorded = report.answers[itemIndex];
          expect(recorded?.id).toBe(item.id);
          expect(item.adapterVersion).toBe(2);
          expect(item.entries.length).toBeGreaterThan(0);
          expect(item.criteria).toHaveLength(2);
          const transcript = item.entries.map((entry) => TranscriptEntry.parse(entry));
          const predictions: string[] = [];
          for (const [criterionIndex, rubric] of item.criteria.entries()) {
            const digest = recorded?.request_sha256s[criterionIndex];
            expect(digest).toBeDefined();
            const call = byHash.get(digest as string);
            if (!call) throw new Error(`Missing frozen recording ${digest}`);
            const client = createAnthropicJudge({
              env: {
                ANTHROPIC_API_KEY: 'fixture-only',
                ANTHROPIC_JUDGE_MODEL: 'haiku',
                ANTHROPIC_BASE_URL: 'https://fixture.invalid',
              },
              maxRetries: 0,
              async fetch(url, init) {
                transportCalls += 1;
                expect(url).toBe('https://fixture.invalid/v1/messages');
                const body = JSON.parse(String(init.body)) as {
                  system: string;
                  messages: { role: string; content: string }[];
                };
                expect(body.system).toBe(call.system);
                expect(body.messages).toEqual([{ role: 'user', content: call.user }]);
                expect(researchRequestHash(body.system, body.messages[0]?.content as string)).toBe(digest);
                return new Response(
                  JSON.stringify({
                    content: [{ type: 'text', text: call.text }],
                    stop_reason: 'end_turn',
                  }),
                  { status: 200 },
                );
              },
            });
            const request: JudgeRequest = {
              criterion: { name: `requirement_${criterionIndex + 1}`, rubric, scope: 'conversation' },
              transcript,
            };
            const result = await judgeConformance(client, request, item.scenario);
            expect(result.raw).toBe(call.text);
            expect(result.unparsed, item.id).not.toBe(true);
            expect(result.conformance, item.id).toBeDefined();
            predictions.push(result.answer.outcome);
            criteriaMatched += Number(result.answer.outcome === item.truth[criterionIndex]);
          }
          expect(predictions, item.id).toEqual(recorded?.predictions);
          if (predictions.some((prediction, index) => prediction !== item.truth[index])) {
            mismatches.push({ id: item.id, truth: item.truth, predictions });
          }
        }
        expect(transportCalls).toBe(240);
        expect(network).not.toHaveBeenCalled();
        expect(items.length - mismatches.length).toBe(correctVectors);
        expect(criteriaMatched).toBe(correctCriteria);
        expect(mismatches).toEqual(
          population === 'short'
            ? []
            : [
                {
                  id: 'longtrace-v2-units-07',
                  truth: ['pass', 'pass'],
                  predictions: ['fail', 'pass'],
                },
              ],
        );
      } finally {
        network.mockRestore();
      }
    });
  }

  it('round trips a frozen provider result through cassette storage and rejects a changed reference', async () => {
    const item = json<Item[]>('short-inputs.json.gz')[0] as Item;
    const report = json<Report>('short-report.json.gz');
    const call = byHash.get(report.answers[0]?.request_sha256s[0] as string) as Call;
    let transportCalls = 0;
    const provider = createAnthropicJudge({
      env: { ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_JUDGE_MODEL: 'haiku' },
      async fetch() {
        transportCalls += 1;
        return new Response(
          JSON.stringify({ content: [{ type: 'text', text: call.text }], stop_reason: 'end_turn' }),
        );
      },
    });
    const cassette = emptyCassette();
    const request: JudgeRequest = {
      criterion: { name: 'requirement_1', rubric: item.criteria[0] as string, scope: 'conversation' },
      transcript: item.entries.map((entry) => TranscriptEntry.parse(entry)),
    };
    const original = await judgeConformance(recordingClient(provider, cassette), request, item.scenario);
    expect(cassette.entries).toHaveLength(1);
    expect(cassette.entries[0]?.raw).toBe(call.text);
    const player = playerClient(cassette, provider.id);
    expect(await judgeConformance(player, request, item.scenario)).toEqual(original);
    await expect(
      judgeConformance(player, request, `${item.scenario} Different reference.`),
    ).rejects.toMatchObject({ code: 'cassette_miss' });
    expect(transportCalls).toBe(1);
  });
});
