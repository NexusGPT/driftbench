import type { Observed, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { completionComponents } from '../../src/ladders/estate/completion';

// Hand-written: a guard of the invented estate "Orrery" and its own spec. Nothing here is a bank phrase.

type GuardRun = NonNullable<NonNullable<Observed['runtime']>['guards']>[number];

const specOf = (name: string): Spec =>
  ({
    version: 1,
    id: 'orrery.guard-message',
    title: 'The dome guard keeps its output rules',
    kind: 'task',
    blocks: [{ when: 'Open the dome at noon.', expect: {} }],
    rules: { custom: { guard_message: { name, mustNot: ['[0-9]{4}'] } } },
  }) as unknown as Spec;

const observed = (guards: Array<Partial<GuardRun>>): Observed =>
  ({
    text: '',
    toolCalls: [],
    runtime: { guards: guards.map((guard) => ({ stdout: 'The dome stays shut.', ...guard })) },
  }) as unknown as Observed;

const find = (spec: Spec, clause: string) => {
  const found = completionComponents(spec).components.find((component) => component.id.endsWith(clause));
  if (!found) throw new Error(`no component ${clause}`);
  return found;
};

describe('guard_message derives its components for every verdict by which a guard acts', () => {
  it.each(['deny', 'block', 'warn', 'nudge'])(
    'removing the %s runs of the named guard removes the intervention the check judges',
    (verdict) => {
      const component = find(specOf('dome-guard'), 'intervention.exists');
      const before = observed([
        { name: 'dome-guard', verdict },
        { name: 'other-guard', verdict },
      ]);
      component.change(before);
      expect(before.runtime?.guards?.map((guard) => guard.name)).toEqual(['other-guard']);
    },
  );

  it('keeps a run that is no intervention where it is', () => {
    const component = find(specOf('dome-guard'), 'intervention.exists');
    const before = observed([{ name: 'dome-guard', verdict: 'allow' }]);
    component.change(before);
    expect(before.runtime?.guards).toHaveLength(1);
  });

  it('does not offer a verdict by which a guard acts as a run that is no intervention', () => {
    const ids = completionComponents(specOf('dome-guard')).components.map((component) => component.id);
    for (const verdict of ['warn', 'nudge', 'deny', 'block'])
      expect(ids, verdict).not.toContain(`0.custom.guard_message.intervention.exclude.${verdict}`);
    expect(ids.some((id) => id.includes('intervention.exclude.allow'))).toBe(true);
  });
});
