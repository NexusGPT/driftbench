import type { Check } from '@driftbench/core';
import { artifacts } from './checks/artifacts';
import { budget } from './checks/budget';
import { cards } from './checks/cards';
import { type CheckRegistry, createCustomCheck, defaultRegistry } from './checks/custom';
import { endState } from './checks/end_state';
import { execution } from './checks/execution';
import { forbidden } from './checks/forbidden';
import { guards } from './checks/guards';
import { lang } from './checks/lang';
import { must, mustNot } from './checks/must';
import { pii } from './checks/pii';
import { safety } from './checks/safety';
import { schemaStrict } from './checks/schema_strict';
import { skills } from './checks/skills';
import { stage } from './checks/stage';
import { tools } from './checks/tools';
import { workspace } from './checks/workspace';

export type DefaultChecksOptions = {
  /** Where `rules.custom` names are resolved. The default registry when absent. */
  registry?: CheckRegistry;
};

/**
 * Every machine check, in the order the runner applies them: what the agent called, what it said, what its
 * runtime did, what it changed in its workspace, then budget, end state and the checks users register.
 * The list is new on each call; the checks themselves hold no state.
 */
export function defaultChecks(options: DefaultChecksOptions = {}): Check[] {
  return [
    tools,
    forbidden,
    must,
    mustNot,
    lang,
    pii,
    cards,
    stage,
    skills,
    guards,
    execution,
    workspace,
    safety,
    artifacts,
    schemaStrict,
    budget,
    endState,
    createCustomCheck(options.registry ?? defaultRegistry),
  ];
}
