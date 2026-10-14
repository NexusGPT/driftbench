import { readToolSchemas } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { defaultInput, defaultValue } from '../../src/ladders/generator/follower';
import { DETOUR_TEXT, hiddenSpec } from '../../src/ladders/generator/hidden';
import { hiddenProposal, renderPrompt, renderTools } from '../../src/ladders/generator/render';

describe('the stronger rendered reply contract', () => {
  it('requires a question, actual returned fields and absence of uncalled facts per unique move', () => {
    for (const seed of [1, 2, 7]) {
      const hidden = hiddenSpec(seed);
      const proposal = hiddenProposal(hidden);
      const states = proposal.relations?.filter((relation) => relation.kind === 'states') ?? [];
      const keys = new Set(
        hidden.paths.flatMap((path) =>
          path.stages.slice(1).map((to, index) => `${path.flow}:${path.stages[index]}:${to}`),
        ),
      );
      expect(states, `seed ${seed}`).toHaveLength(keys.size);
      for (const relation of states) {
        if (relation.kind !== 'states') throw new Error('not states');
        const contract = relation as typeof relation & { must_not: string[] };
        const must = relation.must;
        if (!must) throw new Error('missing reply requirements');
        expect(keys.has(`${relation.subject.value}:${relation.stage}:${relation.to}`)).toBe(true);
        const question = hidden.stages.find((stage) => stage.id === relation.to)?.question;
        expect(question).toBeDefined();
        expect(must.some((pattern) => new RegExp(pattern).test(question ?? ''))).toBe(true);
        const called = hidden.tools.find((tool) => tool.stage === relation.to);
        for (const property of called?.output ?? []) {
          expect(must.some((pattern) => pattern.includes(`{${called?.name}_out_${property.name}}`))).toBe(
            true,
          );
        }
        expect(contract.must_not).toContain('Step [0-9]+:');
        for (const tool of hidden.tools.filter((tool) => tool !== called)) {
          expect(
            contract.must_not.some((pattern) =>
              new RegExp(pattern).test(`${tool.name.replace(/_/g, ' ')} says `),
            ),
          ).toBe(true);
        }
        expect(renderPrompt(hidden)).toContain(relation.evidence.quote);
      }
    }
  });

  it('retains explicit inputs and supplies each missing required schema input', () => {
    const hidden = hiddenSpec(1);
    const uses = hiddenProposal(hidden).relations?.filter((relation) => relation.kind === 'uses_tool') ?? [];
    for (const use of hidden.uses) {
      const relation = uses.find(
        (entry) =>
          entry.kind === 'uses_tool' &&
          entry.subject.value === use.flow &&
          entry.stage === use.from &&
          entry.to === use.to &&
          entry.tool === use.tool,
      );
      if (relation?.kind !== 'uses_tool') throw new Error('missing tool use');
      const tool = hidden.tools.find((entry) => entry.name === use.tool);
      if (!tool) throw new Error('missing tool');
      expect(relation.input).toEqual({ ...defaultInput(tool), ...use.input });
    }
  });

  it('keeps original path conditions and binds every valid output from its actual schema value', () => {
    const hidden = hiddenSpec(1);
    const proposal = hiddenProposal(hidden);
    for (const path of hidden.paths) {
      const relation = proposal.relations?.find((entry) => entry.kind === 'path' && entry.id === path.id);
      if (relation?.kind !== 'path') throw new Error('missing path');
      expect(relation.when).toMatchObject(path.when);
      expect(relation.stages).toEqual(path.stages);
      for (const tool of hidden.tools.filter(
        (tool) => tool.stage !== undefined && path.stages.slice(1).includes(tool.stage),
      )) {
        for (const property of tool.output) {
          const dimension = `${tool.name}.out.${property.name}`;
          expect(relation.when?.[dimension]).toEqual(
            hidden.data
              .filter((value) => value.dimension === dimension && !value.invalid)
              .map((value) => value.id),
          );
        }
      }
    }
    for (const value of hidden.data.filter((value) => value.direction === 'out')) {
      const relation = proposal.relations?.find(
        (entry) =>
          entry.kind === 'binds' &&
          entry.subject.dimension === value.dimension &&
          entry.subject.value === value.id,
      );
      if (relation?.kind !== 'binds') throw new Error('missing output binding');
      expect(relation.slots).toMatchObject({ [`${value.tool}_out_${value.field}`]: String(value.value) });
    }
  });

  it('states in the tools file the input every tool gets when the conversation names none', () => {
    for (const seed of [1, 3, 7]) {
      const hidden = hiddenSpec(seed);
      const read = readToolSchemas(renderTools(hidden));
      if (!read.ok) throw new Error(read.message);
      for (const tool of hidden.tools) {
        const schema = read.tools.find((entry) => entry.name === tool.name);
        const inputs = schema?.input?.properties as Record<string, { default?: unknown }> | undefined;
        const outputs = schema?.output?.properties as Record<string, { default?: unknown }> | undefined;
        for (const property of tool.input)
          expect(inputs?.[property.name]?.default, `seed ${seed} ${tool.name}.${property.name}`).toEqual(
            defaultValue(property),
          );
        for (const property of tool.output) expect(outputs?.[property.name]).not.toHaveProperty('default');
      }
    }
  });

  it('makes a nudge recovery hold the pending question, which a reply without it misses', () => {
    for (const seed of [1, 3, 7]) {
      const hidden = hiddenSpec(seed);
      const recovery = hiddenProposal(hidden).relations?.find(
        (entry) => entry.kind === 'recovery' && entry.class === 'D7_silence_or_burst',
      );
      if (!hidden.deviations.includes('D7_silence_or_burst')) continue;
      if (recovery?.kind !== 'recovery') throw new Error(`seed ${seed}: no nudge recovery`);
      const patterns = (recovery.must ?? []).map((pattern) => new RegExp(pattern));
      expect(patterns.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const stage of hidden.stages) {
        const reply = `${DETOUR_TEXT.D7_silence_or_burst} ${stage.question}`;
        expect(
          patterns.every((pattern) => pattern.test(reply)),
          `${seed} ${stage.id}`,
        ).toBe(true);
      }
      expect(patterns.some((pattern) => pattern.test(DETOUR_TEXT.D7_silence_or_burst))).toBe(false);
    }
  });
});
