import { fileURLToPath } from 'node:url';
import { loadEstateMap, Plan } from '@driftbench/estate';
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

/** The paths the committed suite records, relative to its folder. */
export const COMMITTED_PATHS = {
  map: '../approved.yaml',
  plan: '../../../../packages/generate/test/estate/fixtures/plan.yaml',
  phrases: '../phrases.yaml',
  sessions: '../sessions/index.yaml',
};

export async function fixtureInputs(): Promise<EstateGenerateInput> {
  const map = await loadEstateMap(FIXTURE_MAP);
  if (!map.ok) throw new Error(`fixture map: ${map.errors.map((error) => error.message).join('; ')}`);
  const plan = await readEstateYaml(HAND_PLAN, Plan);
  const bank = await readEstateYaml(FIXTURE_PHRASES, PhraseBank);
  const sessions = await readEstateYaml(FIXTURE_SESSIONS, SessionIndex);
  for (const [name, read] of Object.entries({ plan, bank, sessions })) {
    if (!read.ok) throw new Error(`${name}: ${JSON.stringify(read.issues)}`);
  }
  if (!plan.ok || !bank.ok || !sessions.ok) throw new Error('unreachable');
  return { map: map.map, plan: plan.value, bank: bank.value, sessions: sessions.value };
}
