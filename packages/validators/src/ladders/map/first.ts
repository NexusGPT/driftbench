import { defineLadder, type Item, type Ladder, type Measure } from '../../ladder';
import {
  CONSTRAINT_RECALL,
  constraintLevel,
  diffItem,
  MAP_COMPONENTS,
  metamorphicLevel,
  PROSE_RECALL,
  precisionLevel,
  proseLevel,
  rolesLevel,
  structuredLevel,
} from './levels';
import { diffFacts, type MapRun, mapFacts, type PipelineDeps, runPipeline } from './run';
import { hiddenSpec, mixSeed } from './spec';
import { baseOptions, halves, TRANSFORMS, transformOptions, withOneMoreConstraint } from './transforms';
import { forbidKey, truthOf } from './truth';

export { MAP_COMPONENTS } from './levels';
export { oracleRecording } from './oracle';
export { render } from './render';
export { mapFacts, runPipeline } from './run';
export { hiddenSpec } from './spec';
export { halves, TRANSFORMS, transformOptions, withOneMoreConstraint } from './transforms';
export { truthOf } from './truth';

/** Level 6 runs additivity and unit response on this many specifications derived from the seed. */
export const COMPOSITION_SPECS = 20;

export type MapLadderOptions = PipelineDeps;

/** The two composition checks on one specification: additivity, then unit response. */
async function compositionChecks(
  subseed: number,
  deps: PipelineDeps,
): Promise<{ checks: number; items: Item[] }> {
  const spec = hiddenSpec(subseed);
  const items: Item[] = [];
  const full = await runPipeline(spec, baseOptions(spec), deps);
  if (!full.result.ok) {
    return {
      checks: 2,
      items: [
        {
          id: `additivity:${subseed}`,
          component: MAP_COMPONENTS.renderer,
          detail: `the extractor refused the full rendering: ${full.result.errors[0]?.message}`,
        },
      ],
    };
  }
  const facts = { roles: false, order: false };
  const [a, b] = halves(spec);
  const union = new Set<string>();
  for (const half of [a, b]) {
    const run = await runPipeline(half, baseOptions(half), deps);
    if (!run.result.ok) {
      items.push({
        id: `additivity:${subseed}`,
        component: MAP_COMPONENTS.renderer,
        detail: `the extractor refused a half rendering: ${run.result.errors[0]?.message}`,
      });
      break;
    }
    for (const fact of mapFacts(run.result.proposal, facts)) union.add(fact);
  }
  if (items.length === 0) {
    const item = diffItem(
      `additivity:${subseed}`,
      `the union of the two half maps of specification ${subseed} differs from its full map`,
      mapFacts(full.result.proposal, facts),
      union,
    );
    if (item) items.push({ ...item, component: MAP_COMPONENTS.extract });
  }

  const more = withOneMoreConstraint(spec);
  if (more) {
    const run = await runPipeline(more.spec, baseOptions(more.spec), deps);
    const before = new Set(
      full.result.proposal.constraints.map((constraint) => forbidKey(constraint.forbid)),
    );
    const after = new Set(
      run.result.ok ? run.result.proposal.constraints.map((constraint) => forbidKey(constraint.forbid)) : [],
    );
    const { missing, extra } = diffFacts(before, after);
    const expected = forbidKey(more.added.forbid);
    if (!run.result.ok || missing.length > 0 || extra.length !== 1 || extra[0] !== expected) {
      items.push({
        id: `unit:${subseed}`,
        component: MAP_COMPONENTS.accept,
        detail: `one more constraint (${more.added.id}) gave ${extra.length} more and ${missing.length} fewer constraints${
          extra.length > 0 ? `; gained ${extra.join(', ')}` : ''
        }${missing.length > 0 ? `; lost ${missing.join(', ')}` : ''}`,
      });
    }
  }
  return { checks: more ? 2 : 1, items };
}

/**
 * The map validator (docs/validators.md section 2). A hidden agent specification drawn from the seed is
 * rendered into a prompt, an inventory and tool schemas; the extractor runs on them with the perfect model's
 * recorded answers; the proposal is scored against the specification by id. Level 1: structured entities,
 * recall 1. Level 2: prose atoms recall 0.9, each quote inside its span. Level 3: precision 1. Level 4:
 * constraints recall 0.9. Level 5: metamorphic invariance under four transforms. Level 6: additivity and unit
 * response on 20 derived specifications. Level 7: roles match the declared roles.
 */
export function mapLadderV1(options: MapLadderOptions = {}): Ladder {
  const deps: PipelineDeps = { ...options };
  const cache = new Map<number, Promise<MapRun>>();
  const base = (seed: number): Promise<MapRun> => {
    let run = cache.get(seed);
    if (!run) {
      const spec = hiddenSpec(seed);
      run = runPipeline(spec, baseOptions(spec), deps);
      cache.set(seed, run);
    }
    return run;
  };
  const measure =
    (level: (run: MapRun, truth: ReturnType<typeof truthOf>) => Measure) =>
    async ({ seed }: { seed: number }): Promise<Measure> => {
      const run = await base(seed);
      return level(run, truthOf(run.spec));
    };
  return defineLadder({
    component: 'map',
    levels: [
      {
        id: 'structured',
        name: 'structured entities',
        metric: 'inventory and tool schema values recovered / values planted',
        threshold: 1,
        compute: measure(structuredLevel),
      },
      {
        id: 'prose-atoms',
        name: 'prose atoms',
        metric: 'prose atoms recovered with the quote inside their span / prose atoms planted',
        threshold: PROSE_RECALL,
        compute: measure(proseLevel),
      },
      {
        id: 'precision',
        name: 'no invented entry',
        metric: 'reported entries traced to a planted one / entries reported',
        threshold: 1,
        compute: measure(precisionLevel),
      },
      {
        id: 'constraints',
        name: 'constraints',
        metric: 'planted constraints recovered / constraints planted',
        threshold: CONSTRAINT_RECALL,
        compute: measure(constraintLevel),
      },
      {
        id: 'metamorphic',
        name: 'metamorphic invariance',
        metric: 'transforms leaving the map equal up to quotes / transforms applied',
        threshold: 1,
        compute: async ({ seed }) => {
          const run = await base(seed);
          const variants = [];
          for (const transform of TRANSFORMS) {
            variants.push({
              transform,
              run: await runPipeline(run.spec, transformOptions(run.spec, transform), deps),
            });
          }
          return metamorphicLevel(run, variants);
        },
      },
      {
        id: 'composition',
        name: 'additivity and unit response',
        metric: `checks holding / checks run, over ${COMPOSITION_SPECS} specifications derived from the seed`,
        threshold: 1,
        compute: async ({ seed }) => {
          let checks = 0;
          const items: Item[] = [];
          for (let index = 0; index < COMPOSITION_SPECS; index++) {
            const outcome = await compositionChecks(mixSeed(seed, 1000 + index), deps);
            checks += outcome.checks;
            items.push(...outcome.items);
          }
          return { value: checks === 0 ? 1 : (checks - items.length) / checks, items };
        },
      },
      {
        id: 'roles',
        name: 'roles',
        metric: 'dimensions with their declared role / dimensions declared',
        threshold: 1,
        compute: measure(rolesLevel),
      },
    ],
  });
}
