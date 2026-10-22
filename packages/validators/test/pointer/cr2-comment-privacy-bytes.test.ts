import { describe, expect, it } from 'vitest';
import * as estate from '../../../estate/src/pointer';
import { PROBE_YAML } from '../../src/ladders/pointer/kit/sets';
import { fakeTransport } from '../../src/ladders/pointer/kit/transport';
import { Prose } from '../../src/ladders/pointer/kit/words';
import type { PointerSut, ScanArm, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { type ReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';
import { referenceSut } from './reference';

/**
 * One source of bytes: for every request, the bytes the transport received are the bytes `listed` was computed
 * from. The row keeps the exact string; the test compares it with the string its own transport received, with
 * `===` and no serialisation of its own, on the three arms the link candidate item can use (the `haiku` arm, the
 * `user-yes-no` system 1 arm and the `http` system 2 arm), on seeds 1 to 3, on the reference reader and on the
 * real reader.
 */

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

/**
 * The user system 1 arm answers yes or no questions and has no link kind, so its set is the probe set and its
 * requests list no candidate; its rows, if any, must still hold a string the transport received.
 */
const ARMS: Array<{ arm: ScanArm; url?: string; candidatesInBody: boolean }> = [
  { arm: 'haiku', candidatesInBody: true },
  { arm: 'user-yes-no', candidatesInBody: false },
  { arm: 'http', url: 'https://labeler.invalid/v1/label', candidatesInBody: true },
];

const readers: Array<{ name: string; sut: () => PointerSut }> = [
  { name: 'reference reader', sut: () => referenceSut() },
  {
    name: 'real reader',
    sut: () => ({ ...readerAdapter(estate as unknown as ReaderExports), isolate: false }),
  },
];

for (const { name, sut } of readers) {
  describe(`the bytes a transport received are the bytes listed was computed from (${name})`, () => {
    for (const { arm, url, candidatesInBody } of ARMS) {
      for (const seed of [1, 2, 3]) {
        it(`${arm}, seed ${seed}`, async () => {
          const prose = new Prose(seed, 'bytes');
          const first = prose.next();
          const second = prose.next();
          const fake = fakeTransport({ truth: () => 'none' });
          const received: string[] = [];
          const request: ScanRequest = {
            files: [
              { path: 'harbour/first.md', text: `${first}\n` },
              { path: 'harbour/second.md', text: `${second}\n` },
            ],
            labelsYaml: candidatesInBody ? LINK_YAML : PROBE_YAML,
            model: {
              arm,
              ...(url !== undefined ? { url } : {}),
              transport: async (sent) => {
                received.push(sent.body);
                return fake(sent);
              },
            },
            cassette: { mode: 'record' },
            atoms: [{ id: 'instruction.first', kind: 'instruction', title: first }],
          };
          const res = await sut().scan(request);
          expect(res.ok, `${arm} seed ${seed}: ${res.error ?? ''}`).toBe(true);
          const rows = res.listed ?? [];
          expect(received.length).toBeGreaterThan(0);
          for (const row of rows) {
            expect(typeof row.body, 'a row keeps the string it was computed from').toBe('string');
            expect(
              received.some((body) => body === row.body),
              'the string of a row is a string the transport received',
            ).toBe(true);
          }
          if (candidatesInBody) {
            expect(rows.length).toBeGreaterThan(0);
            const bodies = new Set(rows.map((row) => row.body));
            for (const body of received) {
              expect(bodies.has(body), 'every request the transport received has a row').toBe(true);
            }
          }
        }, 300_000);
      }
    }
  });
}
