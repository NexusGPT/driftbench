import { fileURLToPath } from 'node:url';
import { loadEstateMap, Plan } from '@agent-nexus/driftbench-estate';
import { readEstateYaml } from '../../src/estate/files';
import type { EstateGenerateInput } from '../../src/estate/generate';
import { PhraseBank, SessionIndex } from '../../src/estate/inputs';

export const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
export const FIXTURE_MAP = `${FIXTURE}approved.yaml`;
export const FIXTURE_PHRASES = `${FIXTURE}phrases.yaml`;
export const FIXTURE_SESSIONS = `${FIXTURE}sessions/index.yaml`;
export const FIXTURE_GENERATED = `${FIXTURE}generated/`;
/** The hand-written plan of the lane, until the planner's plan lands on main. */
export const HAND_PLAN = fileURLToPath(new URL('./fixtures/plan.yaml', import.meta.url));

/** The planner's plan as main holds it: every row proposed, as a fresh `estate plan` writes it. */
export const PLANNER_PLAN = `${FIXTURE}plan.yaml`;
/**
 * The planner's plan with every row approved by the lane for the fixture estate, by `estate plan approve
 * --all` on a copy: approving main's file in place would break the planner's byte-for-byte tests.
 */
export const APPROVED_PLAN = fileURLToPath(new URL('./fixtures/planner-plan.approved.yaml', import.meta.url));

/** Paths for suites of the hand plan, which only unit tests generate (in memory or in a temporary folder). */
export const HAND_PATHS = {
  map: '../../approved.yaml',
  plan: '../../../../../packages/generate/test/estate/fixtures/plan.yaml',
  phrases: '../../phrases.yaml',
  sessions: '../../sessions/index.yaml',
};

/** The paths the suite of the planner's plan records, relative to its folder. */
export const PLANNER_PATHS = {
  map: '../approved.yaml',
  plan: '../../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml',
  phrases: '../phrases.yaml',
  sessions: '../sessions/index.yaml',
};

export async function fixtureInputs(planPath = HAND_PLAN): Promise<EstateGenerateInput> {
  const map = await loadEstateMap(FIXTURE_MAP);
  if (!map.ok) throw new Error(`fixture map: ${map.errors.map((error) => error.message).join('; ')}`);
  const plan = await readEstateYaml(planPath, Plan);
  const bank = await readEstateYaml(FIXTURE_PHRASES, PhraseBank);
  const sessions = await readEstateYaml(FIXTURE_SESSIONS, SessionIndex);
  for (const [name, read] of Object.entries({ plan, bank, sessions })) {
    if (!read.ok) throw new Error(`${name}: ${JSON.stringify(read.issues)}`);
  }
  if (!plan.ok || !bank.ok || !sessions.ok) throw new Error('unreachable');
  return { map: map.map, plan: plan.value, bank: bank.value, sessions: sessions.value };
}
