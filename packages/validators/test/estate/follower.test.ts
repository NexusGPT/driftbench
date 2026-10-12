import { mapSession, parseJsonl } from '@driftbench/adapters';
import { describe, expect, it } from 'vitest';
import { drawEstate, follow, type HiddenEstate, situationsOf } from '../../src/ladders/estate/index';

/** An estate of seed 1 with its situations, and the follower's session for one ask, mapped. */
function setup(seed = 1) {
  const estate = drawEstate(seed);
  const situations = situationsOf(estate);
  const session = (asks: string[], mutant?: string) => {
    const raw = follow(estate, situations, asks, mutant ? { mutant } : {});
    return {
      raw,
      mapped: mapSession({
        transcript: parseJsonl(raw.transcript),
        decisions: parseJsonl(raw.decisions),
        steps: parseJsonl(raw.steps),
      }),
    };
  };
  const ask = (id: string) => {
    const situation = situations.find((candidate) => candidate.id === id);
    if (!situation) throw new Error(`no situation ${id}`);
    return situation.phrases[0] as string;
  };
  return { estate, situations, session, ask };
}

function labels(observed: { toolCalls: Array<{ label: string }> }): string[] {
  return observed.toolCalls.map((call) => call.label);
}

function firstSkill(estate: HiddenEstate) {
  return [...estate.skills].sort((a, b) =>
    a.topic.skill < b.topic.skill ? -1 : 1,
  )[0] as HiddenEstate['skills'][0];
}

describe('the estate rule follower', { timeout: 120_000 }, () => {
  it('obeys a skill task: loads, reads before it edits, runs the script, walks the steps, keeps the output rules', () => {
    const { estate, session, ask } = setup();
    const skill = firstSkill(estate);
    const { mapped } = session([ask(`${skill.topic.skill}-task`)]);
    expect(mapped.blocks).toHaveLength(1);
    const observed = mapped.blocks[0]?.observed;
    if (!observed) throw new Error('no block');
    expect(observed.runtime?.skills?.map((entry) => entry.name)).toEqual([skill.topic.skill]);
    const calls = labels(observed);
    expect(calls[0]).toBe('Skill');
    expect(calls.lastIndexOf('Read')).toBeLessThan(calls.indexOf('Edit'));
    expect(observed.workspaceDiff).toEqual({ created: [], changed: [skill.topic.target], deleted: [] });
    expect((observed.executions ?? []).map((run) => run.exitCode)).toEqual([0]);
    expect(observed.executions?.[0]?.command).toContain(skill.topic.script.file);
    expect(observed.runtime?.stages?.map((stage) => stage.name)).toEqual(['plan', 'do', 'verify', 'report']);
    expect(observed.text).toContain('Next:');
    expect(observed.text).toContain(skill.topic.register.word);
    expect(observed.text).not.toMatch(/obviously|simply/);
    expect(calls).not.toContain('WebFetch');
  });

  it('records a verdict for each guard its acts run into, allow when nothing is wrong', () => {
    const { estate, session, ask } = setup();
    const skill = firstSkill(estate);
    const { mapped } = session([ask(`${skill.topic.skill}-task`)]);
    const guards = mapped.blocks[0]?.observed.runtime?.guards ?? [];
    expect(guards.length).toBeGreaterThan(0);
    expect(new Set(guards.map((guard) => guard.verdict))).toEqual(new Set(['allow']));
  });

  it('gives a guard its declared verdict on the act it watches', () => {
    const { estate, session, ask } = setup();
    for (const guard of estate.guards) {
      const { mapped } = session([ask(`${guard.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-event`)]);
      const fired = mapped.blocks[0]?.observed.runtime?.guards ?? [];
      expect(fired, guard.name).toContainEqual(
        expect.objectContaining({ name: guard.name, verdict: guard.verdict }),
      );
    }
  });

  it('answers an ask outside every skill with no tool, no skill and no step', () => {
    const { estate, session, ask } = setup();
    const { mapped } = session([ask(`${firstSkill(estate).topic.skill}-near`)]);
    const observed = mapped.blocks[0]?.observed;
    expect(observed?.toolCalls).toEqual([]);
    expect(observed?.runtime?.skills).toEqual([]);
    expect(observed?.runtime?.stages).toEqual([]);
    expect(observed?.text).toContain('Next:');
  });

  it('writes one block per ask, in order', () => {
    const { estate, session, ask } = setup();
    const helper = estate.helpers[0];
    if (!helper) throw new Error('no helper');
    const { mapped } = session([ask(`${helper.topic.name}-task`), ask(`${helper.topic.name}-resume`)]);
    expect(mapped.blocks).toHaveLength(2);
    for (const block of mapped.blocks) {
      expect(
        block.observed.toolCalls.map((call) => (call.input as { subagent_type?: string }).subagent_type),
      ).toEqual([helper.topic.name]);
    }
  });

  it('drops what a deleted atom asks for: the skill load, a step, a guard, a word, the read before the edit', () => {
    const { estate, session, ask } = setup();
    const skill = firstSkill(estate);
    const task = [ask(`${skill.topic.skill}-task`)];
    const clean = session(task).mapped.blocks[0]?.observed;
    const without = (hid: string) => session(task, hid).mapped.blocks[0]?.observed;

    expect(without(skill.hid)?.runtime?.skills).toEqual([]);
    expect(without('stage:verify')?.runtime?.stages?.map((stage) => stage.name)).toEqual([
      'plan',
      'do',
      'report',
    ]);
    expect(without('rule:verify-before-report')?.runtime?.stages?.map((stage) => stage.name)).toEqual([
      'plan',
      'do',
      'report',
      'verify',
    ]);
    expect(without('rule:next-line')?.text).not.toContain('Next:');
    expect(without('rule:no-filler-words')?.text).toContain('simply');
    expect(labels(without('rule:no-webfetch') ?? { toolCalls: [] })).toContain('WebFetch');
    const reordered = labels(without('rule:read-before-edit') ?? { toolCalls: [] });
    expect(reordered.indexOf('Edit')).toBeLessThan(reordered.lastIndexOf('Read'));
    const guard = estate.guards[0];
    if (!guard) throw new Error('no guard');
    expect(without(guard.hid)?.runtime?.guards?.map((entry) => entry.name)).not.toContain(guard.name);
    expect(clean?.runtime?.guards?.map((entry) => entry.name).length).toBeGreaterThan(
      without(guard.hid)?.runtime?.guards?.length ?? 0,
    );
  });
});
