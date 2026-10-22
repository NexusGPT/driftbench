import { describe, expect, it } from 'vitest';
import * as estate from '../../../estate/src/pointer';
import { fakeTransport } from '../../src/ladders/pointer/kit/transport';
import { Prose } from '../../src/ladders/pointer/kit/words';
import type { ListedCandidates, ScanArm, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { fetchOf, type ReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';
import { SentRecorder } from '../../src/ladders/pointer/sut/sent';

/**
 * A request is attributed only to the context that rendered its exact wire. Two files issue several requests at
 * once, some nested (a request posted from inside another request's call, carrying a candidate and no render),
 * and every body must list only the candidates of the context that rendered its exact wire; a nested request
 * that no renderer returned lists nothing. The first block drives the recorder with interleaved calls of two
 * files; the second drives the real reader on the arms `haiku` and `http`. Byte equality with the string the
 * transport received uses `===`, as in `cr2-comment-privacy-bytes.test.ts`.
 */

type Candidate = { id: string; title: string };

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const ok = { status: 200, body: '{}' };
const bodyOf = (c: Candidate): string =>
  JSON.stringify({ messages: [{ role: 'user', content: `${c.id} ${c.title}` }] });

describe('two files, concurrent and nested requests, the recorder', () => {
  for (const seed of [1, 2, 3]) {
    it(`each body lists only the candidates of the context that rendered its wire (seed ${seed})`, async () => {
      const into = { rows: [] as ListedCandidates[], seen: new Set<string>() };
      const recorder = new SentRecorder(into);
      const received: string[] = [];
      const fetch = fetchOf(async (request) => {
        await delay((request.body.length + seed) % 4);
        received.push(request.body);
        return ok;
      }, recorder);
      const files = ['harbour/a.md', 'harbour/b.md'];
      const candidatesOf = (file: string, n: number): Candidate => ({
        id: `instruction.${file.slice(8, 9)}${seed}x${n}`,
        title: `the ${file.slice(8, 9)} candidate ${n} of seed ${seed}`,
      });
      const wires = files.flatMap((file) =>
        [1, 2, 3].map((n) => {
          const wire = {};
          const own = candidatesOf(file, n);
          recorder.note(wire, {
            where: { file, window: `w${n}`, set: 'agent-rules' },
            byLink: { topic: [own] },
          });
          return { file, n, wire, own };
        }),
      );
      const nestedBodies: string[] = [];
      const tasks = wires.map(({ file, n, wire, own }, index) =>
        recorder.during(wire, async () => {
          await delay((index + seed) % 3);
          const other = candidatesOf(files.find((f) => f !== file) as string, n);
          // Nested and unrendered: a request with a candidate, posted from inside the call, three ways.
          const nested = [
            JSON.stringify({ nested: `${index}a`, text: `${own.id} ${own.title}` }),
            JSON.stringify({ nested: `${index}b`, text: `${other.id} ${other.title}` }),
            JSON.stringify({ nested: `${index}c`, list: [own, other] }),
          ];
          nestedBodies.push(...nested);
          await Promise.all([
            ...nested.map((body) => recorder.during({}, () => fetch('https://labeler.invalid/', { body }))),
            // A stack of two labelers: the inner one runs another rendered wire of its own file.
            recorder.during({}, async () => {
              await delay(1);
              const inner = wires.find((w) => w.file === file && w.n === (n % 3) + 1);
              if (inner)
                await recorder.during(inner.wire, () =>
                  fetch('https://labeler.invalid/', { body: bodyOf(inner.own) }),
                );
            }),
          ]);
          // The call itself, and a retry of the same wire with the same body.
          await fetch('https://labeler.invalid/', { body: bodyOf(own) });
          await delay(1);
          await fetch('https://labeler.invalid/', { body: bodyOf(own) });
        }),
      );
      await Promise.all(tasks);
      for (const body of nestedBodies) {
        expect(received.includes(body), 'the nested request reached the transport').toBe(true);
        expect(
          into.rows.some((row) => row.body === body),
          'a nested unrendered request lists nothing and has no row',
        ).toBe(false);
      }
      expect(into.rows).toHaveLength(wires.length);
      for (const { file, n, own } of wires) {
        const rows = into.rows.filter((row) => row.file === file && row.window === `w${n}`);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.candidates).toEqual([own]);
        expect(received.some((body) => body === rows[0]?.body)).toBe(true);
        expect(rows[0]?.body).toBe(bodyOf(own));
      }
    });
  }
});

const LINK_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    links:
      - name: topic
        description: The instruction the unit is about.
        to: [instruction]
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        links: [topic]
        atom: { kind: instruction, polarity: obligation }
`;

const ARMS: Array<{ arm: ScanArm; url?: string }> = [
  { arm: 'haiku' },
  { arm: 'http', url: 'https://labeler.invalid/v1/label' },
];

describe('two files, concurrent and nested requests, the real reader', () => {
  for (const { arm, url } of ARMS) {
    for (const seed of [1, 2, 3]) {
      it(`${arm}, seed ${seed}`, async () => {
        const prose = new Prose(seed, 'concurrent');
        const first = prose.next();
        const second = prose.next();
        const marked = new WeakMap<object, Candidate[]>();
        let nestedCount = 0;
        let outer: { call: (wire: unknown, ...rest: unknown[]) => Promise<unknown> } | undefined;
        const product = {
          ...estate,
          pointerScan: async (input: Parameters<typeof estate.pointerScan>[0]) => {
            outer = input.labelling.members[0] as unknown as typeof outer;
            return estate.pointerScan(input);
          },
          buildLabelling: async (...args: Parameters<typeof estate.buildLabelling>) => {
            const built = await estate.buildLabelling(...args);
            if (!built.ok) return built;
            const members = built.labelling.members.map((member) => {
              const original = member.call;
              return Object.create(member, {
                render: {
                  value: (set: unknown, window: unknown, context: any) => {
                    const wire = (member.render as any)(set, window, context);
                    const candidates = Object.values(context?.candidates ?? {}).flatMap((list: any) =>
                      list.map((c: any) => ({ id: c.shown ?? c.id, title: c.label })),
                    );
                    marked.set(wire, candidates);
                    return wire;
                  },
                },
                ...(original
                  ? {
                      call: {
                        value: async (wire: any, ...rest: unknown[]) => {
                          const candidates = marked.get(wire);
                          if (candidates && outer) {
                            const nested = [
                              {
                                ...wire,
                                body: { ...wire.body, nested: `NESTED-${nestedCount}`, candidates },
                              },
                              {
                                ...wire,
                                body: {
                                  nested: `NESTED-${nestedCount + 1}`,
                                  candidates: candidates.slice(0, 1),
                                },
                              },
                            ];
                            nestedCount += 2;
                            await Promise.all(
                              nested.map((copy) => outer?.call(copy, ...rest).catch(() => undefined)),
                            );
                          }
                          return Reflect.apply(original, member, [wire, ...rest]);
                        },
                      },
                    }
                  : {}),
              });
            });
            return { ...built, labelling: { ...built.labelling, members } };
          },
          buildLabellingDetailed: async (...args: Parameters<typeof estate.buildLabellingDetailed>) => {
            const built = await estate.buildLabellingDetailed(...args);
            if (!built.ok) return built;
            const members = built.labelling.members.map((member) => {
              const original = member.call;
              return Object.create(member, {
                render: {
                  value: (set: unknown, window: unknown, context: any) => {
                    const wire = (member.render as any)(set, window, context);
                    const candidates = Object.values(context?.candidates ?? {}).flatMap((list: any) =>
                      list.map((c: any) => ({ id: c.shown ?? c.id, title: c.label })),
                    );
                    marked.set(wire, candidates);
                    return wire;
                  },
                },
                ...(original
                  ? {
                      call: {
                        value: async (wire: any, ...rest: unknown[]) => {
                          const candidates = marked.get(wire);
                          if (candidates && outer) {
                            const nested = [
                              {
                                ...wire,
                                body: { ...wire.body, nested: `NESTED-${nestedCount}`, candidates },
                              },
                              {
                                ...wire,
                                body: {
                                  nested: `NESTED-${nestedCount + 1}`,
                                  candidates: candidates.slice(0, 1),
                                },
                              },
                            ];
                            nestedCount += 2;
                            await Promise.all(
                              nested.map((copy) => outer?.call(copy, ...rest).catch(() => undefined)),
                            );
                          }
                          return Reflect.apply(original, member, [wire, ...rest]);
                        },
                      },
                    }
                  : {}),
              });
            });
            return { ...built, labelling: { ...built.labelling, members } };
          },
        };
        const sut = { ...readerAdapter(product as unknown as ReaderExports), isolate: false };
        const fake = fakeTransport({ truth: () => 'none' });
        const received: string[] = [];
        const request: ScanRequest = {
          files: [
            { path: 'harbour/first.md', text: `${first}\n` },
            { path: 'harbour/second.md', text: `${second}\n` },
          ],
          labelsYaml: LINK_YAML,
          model: {
            arm,
            ...(url !== undefined ? { url } : {}),
            transport: async (sent) => {
              received.push(sent.body);
              return fake(sent);
            },
          },
          cassette: { mode: 'record' },
          atoms: [
            { id: 'instruction.first', kind: 'instruction', title: first },
            { id: 'instruction.second', kind: 'instruction', title: second },
          ],
        };
        const res = await sut.scan(request);
        expect(res.ok, `${arm} seed ${seed}: ${res.error ?? ''}`).toBe(true);
        const rows = res.listed ?? [];
        const nested = received.filter((body) => body.includes('NESTED-'));
        const rendered = received.filter((body) => !body.includes('NESTED-'));
        expect(nested.length, 'nested requests reached the transport').toBeGreaterThan(2);
        expect(rendered.length).toBeGreaterThan(1);
        for (const row of rows) {
          expect(row.body?.includes('NESTED-'), 'a nested unrendered request has no row').toBe(false);
          expect(rendered.some((body) => body === row.body)).toBe(true);
          for (const c of row.candidates) {
            expect(row.body?.includes(JSON.stringify(c.id).slice(1, -1))).toBe(true);
          }
        }
        for (const body of rendered) {
          expect(
            rows.some((row) => row.body === body),
            'every rendered request has a row',
          ).toBe(true);
        }
        expect(rows.some((row) => row.file === 'harbour/second.md' && row.candidates.length > 0)).toBe(true);
      }, 300_000);
    }
  }
});
