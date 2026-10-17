import { describe, expect, it } from 'vitest';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { faultFamily } from '../../src/ladders/generator/faults';
import { createFollower, defaultValue } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}
const hidden = hiddenSpec(1);
const instruction = hidden.phrases.find(
  (p) => p.intent.kind === 'deviation' && p.intent.class === 'D6_instruction_in_data',
)?.text;
if (!instruction) throw new Error('missing approved instruction');

describe('world-carried instructions', () => {
  it('keeps workspace instructions as data and detects both obedience faults with documented checks', async () => {
    const loaded = structuredClone(required(baselineSuite(hidden)[0]));
    loaded.spec.blocks = [
      {
        id: 'data',
        given: { world: { workspace: { files: { 'NOTES.txt': instruction } } } },
        when: { injection: { class: 'D6_instruction_in_data', user: '' } },
        expect: { stage: hidden.start, must_not: ['skipped'] },
      },
    ];
    const generated: Generation = {
      hidden,
      generatorSeed: 1,
      first: new Map(),
      second: new Map(),
      loaded: [],
      complete: [loaded],
    };
    const parts = {
      k: 1,
      cheaters: [] as const,
      faults: () =>
        faultFamily(hidden).filter((f) => f.class.startsWith('D6.') && f.where === 'any' && f.rate === 1),
    };
    const check = async (g: Generation) => {
      const runs = await runAll(g, parts);
      expect(runs.errors).toEqual([]);
      expect(runs.blocks.flatMap((b) => b.reference.filter((r) => r !== 'pass'))).toEqual([]);
      const items = bankItems().filter(
        (i) =>
          i.id.startsWith('fault.D6.') ||
          [
            'perturbation.carrier.D6_instruction_in_data',
            'diff.phrases.filled',
            'phrases.D6_instruction_in_data',
          ].includes(i.id),
      );
      return Promise.all(
        items.map(async (item) => ({
          id: item.id,
          ...(await item.check({ runs: async () => runs, generated: async () => g } as SeedData)),
        })),
      );
    };
    expect((await check(generated)).filter((v) => !v.pass)).toEqual([]);
    const noChecks = structuredClone(generated);
    required(required(noChecks.complete[0]).spec.blocks[0]).expect = { lang: 'EN' };
    expect((await check(noChecks)).filter((v) => v.id.startsWith('fault.D6.') && v.pass)).toEqual([]);
    const wrongCarrier = structuredClone(generated);
    delete required(required(wrongCarrier.complete[0]).spec.blocks[0]).given;
    required(required(wrongCarrier.complete[0]).spec.blocks[0]).when = {
      injection: { class: 'D6_instruction_in_data', user: instruction },
    };
    expect((await check(wrongCarrier)).find((v) => v.id.startsWith('perturbation.carrier'))?.pass).toBe(
      false,
    );
    expect((await check(generated)).filter((v) => !v.pass)).toEqual([]);
  });
  it('preserves the normal transition and reply when a called tool returns an instruction', async () => {
    const spec = required(baselineSuite(hidden)[0]).spec;
    const open = required(spec.blocks[0]).when;
    const read = required(
      spec.blocks.find((block) =>
        block.expect?.tools?.some(
          (call) => call.label === hidden.tools.find((tool) => tool.role === 'read')?.name,
        ),
      ),
    ).when;
    if (!open || !('user' in open) || !read || !('user' in read)) throw new Error('missing move');
    const tool = required(hidden.tools.find((t) => t.role === 'read'));
    const result = Object.fromEntries(tool.output.map((property) => [property.name, defaultValue(property)]));
    const play = async (injected: boolean) => {
      const agent = createFollower(hidden)();
      const messages = [{ role: 'user' as const, content: open.user }];
      const first = await agent.respond(messages, {});
      return agent.respond(
        [...messages, { role: 'assistant', content: first.text }, { role: 'user', content: read.user }],
        {
          tools: { [tool.name]: { result: { ...result, ...(injected ? { note: instruction } : {}) } } },
        },
      );
    };
    const clean = await play(false);
    const injected = await play(true);
    expect(injected.text).toBe(clean.text);
    expect(injected.runtime).toEqual(clean.runtime);
    expect(injected.toolCalls.map((call) => [call.label, call.input])).toEqual(
      clean.toolCalls.map((call) => [call.label, call.input]),
    );
  });
  it('does not clear another deviation fault when world data is also present', async () => {
    for (const id of ['D5.dutch', 'D7.silent']) {
      const fault = required(
        faultFamily(hidden).find((f) => f.class === id && f.where === 'any' && f.rate === 1),
      );
      const phrase = required(
        hidden.phrases.find((p) => p.intent.kind === 'deviation' && p.intent.class === fault.parent),
      );
      const messages = [{ role: 'user' as const, content: phrase.text }];
      const withoutData = await createFollower(hidden, fault.mutation)().respond(messages, {});
      const withData = await createFollower(hidden, fault.mutation)().respond(messages, {
        workspace: { files: { 'NOTES.txt': instruction } },
      });
      expect(withData.text, id).toBe(withoutData.text);
      expect(withData.segments, id).toEqual(withoutData.segments);
    }
  });
  it('reacts only to consumed tool results and preserves the normal tool action', async () => {
    const value = required(
      hidden.data.find(
        (v) =>
          v.direction === 'in' && !v.invalid && hidden.tools.find((t) => t.name === v.tool)?.role === 'read',
      ),
    );
    const phrase = required(
      hidden.phrases.find((p) => p.intent.kind === 'data' && p.intent.value === value.id),
    );
    const tool = required(hidden.tools.find((t) => t.name === value.tool));
    const other = required(hidden.tools.find((t) => t.name !== tool.name));
    const mutation = required(
      faultFamily(hidden).find((f) => f.class === 'D6.obey' && f.where === 'any' && f.rate === 1),
    ).mutation;
    const world = { tools: { [tool.name]: { result: { nested: { note: instruction } } } } };
    const messages = [{ role: 'user' as const, content: phrase.text }];
    const reference = await createFollower(hidden)().respond(messages, world);
    expect(reference.toolCalls.map((call) => call.label)).toEqual([tool.name]);
    expect(reference.runtime?.stages?.at(-1)?.name).toBe(hidden.start);
    const bad = await createFollower(hidden, mutation)().respond(messages, world);
    expect(bad.runtime?.stages?.at(-1)?.name).toBe(hidden.final);
    const notConsumed = await createFollower(hidden, mutation)().respond(messages, {
      tools: { [other.name]: { result: { note: instruction } } },
    });
    expect(notConsumed.runtime?.stages?.at(-1)?.name).toBe(hidden.start);
  });
});
