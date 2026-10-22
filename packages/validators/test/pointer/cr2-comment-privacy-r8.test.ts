import { afterEach, expect, it } from 'vitest';
import * as estate from '../../../estate/src/pointer';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { executeHere } from '../../src/ladders/pointer/bank/run';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { type ReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';
import { referenceSut } from './reference';
import { referenceBugsPrivacy } from './reference/bugs-privacy';

/**
 * The probe of the codex review of the head 742d3c0fc (run 39771608937), committed as written by the review
 * (the first test), and its variant: a positive witness counts only when its body is byte-equal to a request
 * body the transport received for file B, and the candidate is in that exact body. A side body posted inside a
 * rendered call, with or without the text of file B, is not the request for file B.
 */
const ref = referenceSut();
const item = pointerBank().find((i) => i.id === 'privacy.comment-text-never-leaves-link-candidate')!;
afterEach(() => referenceBugsPrivacy.clear());
const run = async (sut: PointerSut, seed: number) => {
  const r = await executeHere(item, seed, sut);
  console.log('REVIEW1171R8', sut.name, seed, JSON.stringify(r));
  return r;
};

it('honest reference control holds all three seeds', async () => {
  for (const seed of [1, 2, 3]) expect((await run(ref, seed)).pass).toBe(true);
});

/**
 * A product whose rendered wire for every file is built without the candidates, and whose call first posts a
 * side body through the fetch of the reader options. The side body is `sideOf(candidates, other)`.
 */
function sideBodyProduct(sideOf: (candidates: unknown[], other: string) => string, state: { other: string }) {
  const auxiliary = new WeakMap<object, string>();
  return {
    ...estate,
    buildLabelling: async (...args: Parameters<typeof estate.buildLabelling>) => {
      const built = await estate.buildLabelling(...args);
      if (!built.ok) return built;
      const send = (args[1] as any).fetch;
      if (typeof send !== 'function') throw new Error('the reader options have no fetch');
      const members = built.labelling.members.map((member) =>
        Object.create(member, {
          render: {
            value: (set: any, window: any, context: any) => {
              const wire = member.render(set, window, { ...context, candidates: {} });
              const candidates = Object.values(context?.candidates ?? {}).flatMap((list: any) =>
                list.map((c: any) => ({ id: c.shown ?? c.id, title: c.label })),
              );
              auxiliary.set(wire, sideOf(candidates, state.other));
              return wire;
            },
          },
          call: {
            value: async (wire: any, ...rest: any[]) => {
              const body = auxiliary.get(wire);
              if (body !== undefined)
                await send('https://api.anthropic.com/v1/messages', { method: 'POST', body });
              return (member.call as any).call(member, wire, ...rest);
            },
          },
        }),
      );
      return { ...built, labelling: { ...built.labelling, members } };
    },
    buildLabellingDetailed: async (...args: Parameters<typeof estate.buildLabellingDetailed>) => {
      const built = await estate.buildLabellingDetailed(...args);
      if (!built.ok) return built;
      const send = (args[1] as any).fetch;
      if (typeof send !== 'function') throw new Error('the reader options have no fetch');
      const members = built.labelling.members.map((member) =>
        Object.create(member, {
          render: {
            value: (set: any, window: any, context: any) => {
              const wire = member.render(set, window, { ...context, candidates: {} });
              const candidates = Object.values(context?.candidates ?? {}).flatMap((list: any) =>
                list.map((c: any) => ({ id: c.shown ?? c.id, title: c.label })),
              );
              auxiliary.set(wire, sideOf(candidates, state.other));
              return wire;
            },
          },
          call: {
            value: async (wire: any, ...rest: any[]) => {
              const body = auxiliary.get(wire);
              if (body !== undefined)
                await send('https://api.anthropic.com/v1/messages', { method: 'POST', body });
              return (member.call as any).call(member, wire, ...rest);
            },
          },
        }),
      );
      return { ...built, labelling: { ...built.labelling, members } };
    },
  };
}

async function measureSideBody(sideOf: (candidates: unknown[], other: string) => string, textInSide = false) {
  const state = { other: '' };
  const sut = readerAdapter(sideBodyProduct(sideOf, state) as unknown as ReaderExports);
  let observed: any;
  let requestedB: string[] = [];
  const measured: PointerSut = {
    ...sut,
    scan: async (request) => {
      state.other = request.files.find((f) => f.path === 'harbour/second.md')!.text.trim();
      const result = await sut.scan({
        ...request,
        model: request.model
          ? {
              ...request.model,
              transport: async (wire) => {
                if (wire.body.includes(state.other)) requestedB.push(wire.body);
                return request.model!.transport(wire);
              },
            }
          : undefined,
      });
      observed = result;
      return result;
    },
  };
  const results = [];
  for (const seed of [1, 2, 3]) {
    requestedB = [];
    const out = await run(measured, seed);
    const rows = (observed.listed ?? []).filter((r: any) => r.file === 'harbour/second.md');
    const listed = rows.flatMap((r: any) => r.candidates);
    expect(requestedB.length).toBeGreaterThan(0);
    for (const c of textInSide ? [] : listed) {
      expect(requestedB.some((body) => body.includes(c.id))).toBe(false);
      expect(requestedB.some((body) => body.includes(c.title))).toBe(false);
    }
    results.push(out.pass);
  }
  return results;
}

it('a direct auxiliary body must not supply the absent candidate of the request that actually asks about file B', async () => {
  const results = await measureSideBody((candidates) => JSON.stringify({ candidates }));
  expect(results).toEqual([false, false, false]);
}, 120000);

it('a side body that also holds the text of file B is not the request for file B', async () => {
  const results = await measureSideBody(
    (candidates, other) => JSON.stringify({ candidates, text: other }),
    true,
  );
  expect(results).toEqual([false, false, false]);
}, 120000);
