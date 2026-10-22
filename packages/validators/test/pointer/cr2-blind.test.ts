import { beforeAll, describe, expect, it } from 'vitest';
import {
  type BankItem,
  type PointerAdapter,
  pointerBank,
  runItem,
} from '../../src/ladders/pointer/blind/bank';
import { blindBinding } from '../../src/ladders/pointer/sut/blind-binding/index';
import { withReplacedExports } from '../../src/ladders/pointer/sut/blind-binding/reader';
import { assertReaderAvailable } from '../../src/ladders/pointer/sut/reader';

/**
 * The six blind privacy items of a fence and of a comment. A file made of an opaque unit only has nothing to label,
 * so no request leaves and nothing can leak: the check was vacuous. The fixture now carries a prose paragraph beside
 * the opaque text, and the item reads the body of the request that leaves. Each item is shown red on a reader that
 * sends the opaque text or the key in that body, and green on the scripted reference and on the real reader.
 */

const bank = pointerBank();
const SIX = ['fence', 'comment'].flatMap((placement) =>
  ['record', 'ci-hit', 'ci-miss'].map((mode) => `privacy.${placement}.${mode}`),
);
const item = (id: string): BankItem => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

async function realExports(): Promise<Record<string, any>> {
  return (await import('@agent-nexus/driftbench-estate')).pointer as Record<string, any>;
}

const unused = async (): Promise<never> => {
  throw new Error('the privacy operation does not resolve a reader port');
};
const binding: PointerAdapter = blindBinding(unused);

/** The scripted reference: the item's own sample answer and effects, driven through the harness callbacks. */
function reference(target: BankItem, seed: number): PointerAdapter {
  const probes = target.generate(seed).probes;
  let at = 0;
  return {
    async execute(_request, io) {
      const probe = probes[at++];
      if (!probe || !io) throw new Error('missing scripted probe or IO');
      for (const effect of probe.sampleEffects ?? []) {
        switch (effect.kind) {
          case 'key':
            io.readKey();
            break;
          case 'fetch':
            await io.fetch({ url: 'https://example.invalid/', body: {} });
            break;
          case 'cache':
            io.readCassette();
            break;
          case 'write':
            io.writeCassette(effect.path, effect.value, effect.committed);
            break;
          case 'log':
            io.log(effect.value);
            break;
          case 'plan':
            io.plan(effect.value);
            break;
        }
      }
      return structuredClone(probe.sample ?? probe.expected);
    },
  };
}

type Scan = (input: Record<string, any>) => Promise<unknown>;

/** A reader that shows the opaque text as a sentence of the request: the fence or the comment leaves with it. */
const showsOpaqueText =
  (real: Record<string, any>): Scan =>
  (input) =>
    real.pointerScan({
      ...input,
      files: input.files.map((file: { path: string; text: string }) => ({
        ...file,
        text: file.text
          .replace(/```text\n([\s\S]*?)\n```/, 'The fenced note says $1.')
          .replace(/<!-- ([\s\S]*?) -->/, 'The comment says $1.'),
      })),
    });

/** A reader that puts the key into the body of every request: `keys` holds the key of each probe in order. */
const sendsKeyInBody =
  (real: Record<string, any>, keys: string[]): Scan =>
  (input) => {
    const key = keys.shift() as string;
    const labelling = input.labelling;
    return real.pointerScan({
      ...input,
      labelling: {
        ...labelling,
        members: labelling.members.map((member: Record<string, any>) => ({
          ...member,
          render: (...args: unknown[]) => {
            const wire = member.render(...args);
            return { ...wire, body: { ...wire.body, trace: key } };
          },
        })),
      },
    });
  };

/** A reader that drops the file text: the scan has nothing to send. */
const sendsNothing =
  (real: Record<string, any>): Scan =>
  (input) =>
    real.pointerScan({
      ...input,
      files: input.files.map((file: { path: string }) => ({ ...file, text: '' })),
    });

async function passes(id: string, scan?: Scan): Promise<boolean> {
  const target = item(id);
  const run = () => runItem(target, 1, binding).then((outcome) => outcome.pass);
  if (!scan) return run();
  return withReplacedExports({ pointerScan: scan }, run);
}

describe('the six fence and comment privacy items read a request that leaves', () => {
  beforeAll(async () => {
    await assertReaderAvailable(120_000);
  }, 130_000);

  it('carry the opaque-only cause', () => {
    for (const id of SIX) expect(item(id).cause, id).toBe('privacy:opaque-only-file-sends-a-request');
  });

  it('keep the other placements on their own egress cause', () => {
    expect(item('privacy.paragraph.record').cause).toBe('privacy:paragraph-text-and-key-egress');
    expect(item('privacy.html.ci-hit').cause).toBe('privacy:html-text-and-key-egress');
  });

  it('put a prose paragraph beside the opaque text in every probe, on every seed', () => {
    for (const id of SIX)
      for (const seed of [1, 2, 7, 1_000_003]) {
        for (const probe of item(id).generate(seed).probes) {
          const source = (probe.request.input as { source: string }).source;
          const prose = source.split('\n\n').filter((part) => /^Fictional public note v\w+\.$/.test(part));
          expect(prose, `${id} seed ${seed}`).toHaveLength(1);
        }
      }
  });

  it('are green on the scripted reference', async () => {
    for (const id of SIX) expect((await runItem(item(id), 1, reference(item(id), 1))).pass, id).toBe(true);
  });

  it('are green on the real reader, and stay green when an export is replaced by itself', async () => {
    const real = await realExports();
    for (const id of SIX) {
      expect(await passes(id), id).toBe(true);
      expect(await passes(id, (input) => real.pointerScan(input)), `${id} control`).toBe(true);
    }
  }, 120_000);

  it('are red on a reader that sends the fence or the comment text in the request', async () => {
    const real = await realExports();
    for (const id of SIX) expect(await passes(id, showsOpaqueText(real)), id).toBe(false);
  }, 120_000);

  it('are red on a reader that sends the key in the body of the request', async () => {
    const real = await realExports();
    for (const id of SIX) {
      const keys = item(id)
        .generate(1)
        .probes.map((probe) => String(probe.setup?.key));
      expect(await passes(id, sendsKeyInBody(real, keys)), id).toBe(false);
    }
  }, 120_000);

  it('are red on a reader that sends no request at all', async () => {
    const real = await realExports();
    for (const id of SIX) expect(await passes(id, sendsNothing(real)), id).toBe(false);
  }, 120_000);
});
