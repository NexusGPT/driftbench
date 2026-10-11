import * as stats from '@driftbench/stats';
import { defineLadder, type Ladder } from '../../ladder';
import { type ChainState, type EffectState, runChain, runEffect } from './chain';
import { type FamilyFault, loadFamily } from './family';
import {
  calibrationLevel,
  classLevel,
  parityLevel,
  precisionLevel,
  recallLevel,
  recoveryLevel,
  replayLevel,
  type SystemStats,
  storedLevel,
} from './levels';
import { CALIBRATION_BAR, DETECTION_BAR } from './plant';

export {
  type ChainState,
  type EffectState,
  PLANTED_TARGET,
  runChain,
  runEffect,
  runPassed,
  verdictProjection,
} from './chain';
export { CHECK_COMPONENTS, SYSTEM_COMPONENTS } from './components';
export {
  FAMILY_TARGET,
  FAULT_FAMILY,
  type FamilyFault,
  loadFamily,
  OPERATORS,
  type Operator,
} from './family';
export type { SystemStats } from './levels';
export * from './plant';

export type SystemLadderOptions = {
  /** Replaces statistics functions the levels use: tests plant a fault this way. */
  stats?: Partial<SystemStats>;
  /** Replaces the fault family: tests plant a family whose class has no operator. */
  family?: FamilyFault[];
  /** Changes what the chain stored before the levels read it: tests plant a fault in a record this way. */
  tamper?: (state: ChainState) => void;
  /** Changes the planted-effect flags before levels 6 and 7 read them. */
  tamperEffect?: (state: EffectState) => void;
  /** Effect and clustered campaigns per seed. Default EFFECT_CAMPAIGNS (100); tests may run fewer. */
  campaigns?: number;
};

/**
 * The system validator (docs/validators.md section 5): does the whole chain report the truth. A seeded
 * plant of defects, recoveries and an effect runs through the loader, the campaign runner with its resume,
 * the runner and the machine checks, the store and the replay cache, and each level compares what was
 * stored with the plant.
 *
 * Levels 1 to 4 read one campaign of planted defects; level 5 the perturbed campaign; levels 6 and 7 the
 * planted effect (100 campaigns of three agent versions, 100 clustered campaigns); level 8 the replay.
 * Each seed's chain runs once and its levels share it.
 */
export function systemLadder(options: SystemLadderOptions = {}): Ladder {
  const s: SystemStats = { ...stats, ...options.stats };
  const chains = new Map<string, Promise<ChainState>>();
  const effects = new Map<string, Promise<EffectState>>();
  const chain = (seed: number, root: string): Promise<ChainState> => {
    const key = `${seed} ${root}`;
    let held = chains.get(key);
    if (!held) {
      held = (async () => {
        const family = options.family ?? (await loadFamily(root));
        const state = await runChain(seed, family);
        options.tamper?.(state);
        return state;
      })();
      chains.set(key, held);
    }
    return held;
  };
  const effect = (seed: number): Promise<EffectState> => {
    const key = String(seed);
    let held = effects.get(key);
    if (!held) {
      held = runEffect(seed, options.campaigns).then((state) => {
        options.tamperEffect?.(state);
        return state;
      });
      effects.set(key, held);
    }
    return held;
  };
  return defineLadder({
    component: 'system',
    levels: [
      {
        id: 'stored-resumable',
        name: 'runs stored, campaign resumable',
        metric: 'cells stored, loadable and resumed right / cells planned',
        threshold: 1,
        compute: async ({ seed, root }) => storedLevel(await chain(seed, root)),
      },
      {
        id: 'defect-recall',
        name: 'defect recall',
        metric: 'planted defects with a failing block at the planted index / planted defects',
        threshold: 1,
        compute: async ({ seed, root }) => recallLevel(await chain(seed, root)),
      },
      {
        id: 'defect-precision',
        name: 'defect precision',
        metric: 'failing blocks with a planted defect / failing blocks',
        threshold: 1,
        compute: async ({ seed, root }) => precisionLevel(await chain(seed, root)),
      },
      {
        id: 'drift-class',
        name: 'drift class',
        metric: 'failing planted blocks carrying the planted class / failing planted blocks',
        threshold: 1,
        compute: async ({ seed, root }) => classLevel(await chain(seed, root), root),
      },
      {
        id: 'recovery',
        name: 'recovery metrics',
        metric: 'perturbed runs whose recovery record equals the plant / perturbed runs',
        threshold: 1,
        compute: async ({ seed, root }) => recoveryLevel(await chain(seed, root), root),
      },
      {
        id: 'calibration',
        name: 'calibration',
        metric:
          'the lower of: Wilson intervals holding the true rate / intervals computed (100 campaigns), and the true design effect inside the bootstrap interval (1 or 0)',
        threshold: CALIBRATION_BAR,
        compute: async ({ seed }) => calibrationLevel(await effect(seed), seed, s),
      },
      {
        id: 'parity-power',
        name: 'parity power and false alarms',
        metric:
          'the lower of: campaigns detecting the planted drop / campaigns, and campaigns with no false alarm / campaigns (100 each)',
        threshold: DETECTION_BAR,
        compute: async ({ seed }) => parityLevel(await effect(seed), seed, s),
      },
      {
        id: 'replay',
        name: 'replay equals live',
        metric: 'runs replayed from the cache with the live verdicts / runs',
        threshold: 1,
        compute: async ({ seed, root }) => replayLevel(await chain(seed, root)),
      },
    ],
  });
}
