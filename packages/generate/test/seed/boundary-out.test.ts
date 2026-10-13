import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { boundarySeeder } from '../../src/seed/seeders';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const prepared = source.prepared;

describe('boundarySeeder on tool output values', () => {
  it('walks a path whose reply states the returned value, so a call with no reply fails the block', () => {
    const { drafts } = boundarySeeder(prepared, { seed: 1, t: 3, max: Number.POSITIVE_INFINITY });
    const outs = drafts.filter((draft) => /Boundary value \S+\.out\./.test(draft.title));
    expect(outs.length).toBeGreaterThan(0);
    for (const draft of outs) {
      const value = /(?:^|=| )(\w+)\.out\.(\w+)\.([\w-]+):/.exec(draft.title);
      expect(value, draft.title).not.toBeNull();
      const [, tool, field, member] = value as RegExpExecArray;
      const said = `${(tool as string).replace(/_/g, ' ')} says ${field} is ${member}\\.`;
      const stating = draft.blocks.filter(
        (block) =>
          (block.must ?? []).includes(said) &&
          (block.tools ?? []).some((call) => call.label === tool && call.count !== 0),
      );
      expect(stating, `${draft.id} ${draft.title}`).toHaveLength(1);
      expect(draft.reasons ?? []).toEqual([]);
    }
  }, 60_000);
});

describe('boundarySeeder on tool input values', () => {
  it('says a value of a read-only tool after the first move, so the turn checks the stage it stays at', () => {
    const { drafts } = boundarySeeder(prepared, { seed: 1, t: 3, max: Number.POSITIVE_INFINITY });
    const inputs = drafts.filter((draft) => /Boundary value (lookup_record|list_options)\.in\./.test(draft.title));
    expect(inputs.length).toBeGreaterThan(0);
    for (const draft of inputs) {
      const value = draft.blocks.find((block) => block.id.endsWith('-value'));
      expect(value?.stage, `${draft.id} ${draft.title}`).toBeDefined();
      expect(draft.blocks.indexOf(value as (typeof draft.blocks)[number])).toBeGreaterThan(0);
      expect(draft.reasons ?? []).toEqual([]);
    }
  }, 60_000);
});
