import { expect, it } from 'vitest';
import * as estate from '../../../estate/src/pointer';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { ListedCandidates, PointerSut } from '../../src/ladders/pointer/sut/port';
import {
  fetchOf,
  type ReaderExports,
  readerAdapter,
  recordingMember,
} from '../../src/ladders/pointer/sut/reader';
import { SentRecorder } from '../../src/ladders/pointer/sut/sent';

/**
 * The probes of the codex review of the head 5bc5382d0 (run 39758483621): the body of a request was serialised
 * twice, once by the binding to read the candidates and once by the product to send them, so a body that
 * serialises differently the second time listed candidates the transport never received.
 */

const CANDIDATE = 'privacy.comment-text-never-leaves-link-candidate';

const ANSWER = JSON.stringify({
  labels: [],
  probabilities: {},
  model: 'fictional',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"labels":[]}' }],
});

for (const arm of ['Anthropic', 'user', 'HTTP'] as const) {
  for (const mode of ['stable', 'debug', 'header', 'url', 'changing'] as const) {
    it(`${arm}: listed equals the candidates in exactly the bytes postJson sends (${mode})`, async () => {
      let sent = '';
      const into = { rows: [] as ListedCandidates[], seen: new Set<string>() };
      const recorder = new SentRecorder(into);
      const fetch = fetchOf((request) => {
        sent = request.body;
        return { status: 200, body: ANSWER };
      }, recorder);
      const client =
        arm === 'Anthropic'
          ? estate.createAnthropicLabeler({ key: 'fictional-not-real', fetch: fetch as never, maxRetries: 0 })
          : estate.createHttpLabeler({
              url: 'https://labeler.invalid/',
              cls: arm === 'user' ? 'system1' : 'system2',
              fetch: fetch as never,
              maxRetries: 0,
            });
      const candidate = { id: 'instruction.known', title: 'a "quoted"\nknown title' };
      const withCandidate = { messages: [{ role: 'user', content: `${candidate.id} ${candidate.title}` }] };
      const withoutCandidate = { messages: [{ role: 'user', content: 'the surrounding sentence' }] };
      let serializations = 0;
      const body =
        mode === 'stable'
          ? withCandidate
          : mode === 'changing'
            ? Object.defineProperty({ ...withCandidate }, 'toJSON', {
                value() {
                  serializations += 1;
                  return serializations === 1 ? withCandidate : withoutCandidate;
                },
              })
            : withoutCandidate;
      const wire = {
        labeler: client.id,
        body,
        ...(mode === 'debug' ? { candidateDebug: JSON.stringify(candidate) } : {}),
        ...(mode === 'header' ? { headers: { 'x-candidate': JSON.stringify(candidate) } } : {}),
        ...(mode === 'url' ? { url: `https://labeler.invalid/${JSON.stringify(candidate)}` } : {}),
      };
      const recording = recordingMember(
        Object.create(client, { render: { value: () => wire } }) as never,
        recorder,
      );
      const set = { set: 'agent-rules', description: 'd', labels: [] };
      const window = { id: 'w', path: 'fictional.md', headingPath: [], units: [] };
      const context = { candidates: { topic: [{ id: candidate.id, label: candidate.title }] } };
      const outgoing = recording.render(set as never, window as never, context as never);
      await recording.call?.(outgoing as never, set as never, window as never);
      expect(sent.length).toBeGreaterThan(0);
      const expected =
        sent.includes(JSON.stringify(candidate.id).slice(1, -1)) &&
        sent.includes(JSON.stringify(candidate.title).slice(1, -1))
          ? [candidate]
          : [];
      const listed = into.rows.flatMap((row) => row.candidates);
      expect(listed).toEqual(expected);
    });
  }
}

type Member = {
  render(set: unknown, window: unknown, context: unknown): { labeler: string; body: Record<string, unknown> };
};

it('the actual item rejects a body whose later transport serialisation drops the candidates', async () => {
  const product = {
    ...estate,
    buildLabelling: async (...args: Parameters<typeof estate.buildLabelling>) => {
      const built = await estate.buildLabelling(...args);
      if (!built.ok) return built;
      return {
        ...built,
        labelling: {
          ...built.labelling,
          members: built.labelling.members.map((member) =>
            Object.create(member, {
              render: {
                value: (set: unknown, window: unknown, context: { candidates?: object }) => {
                  const own = member as unknown as Member;
                  const full = own.render(set, window, context);
                  const dropped = own.render(set, window, { ...context, candidates: {} });
                  let serializations = 0;
                  return {
                    ...full,
                    body: Object.defineProperty({ ...full.body }, 'toJSON', {
                      value() {
                        serializations += 1;
                        return serializations === 1 ? full.body : dropped.body;
                      },
                    }),
                  };
                },
              },
            }),
          ),
        },
      };
    },
  };
  const sut: PointerSut = { ...readerAdapter(product as unknown as ReaderExports), isolate: false };
  const item = pointerBank().find((x) => x.id === CANDIDATE);
  if (!item) throw new Error(`no item ${CANDIDATE}`);
  for (const seed of [1, 2, 3]) {
    clearSeedFreeCache();
    const out = await runItem(item, seed, sut);
    expect(out.pass, `seed ${seed}: ${out.detail}`).toBe(false);
  }
}, 300_000);
