import type { Spec } from '@agent-nexus/driftbench-core';
import {
  faultAdapter,
  GATE_DEFAULTS,
  GATE_REASONS,
  type GateResult,
  runGate,
} from '@agent-nexus/driftbench-generate';
import { DEVIATIONS } from '@agent-nexus/driftbench-users';
import type { BankItem, SeedData, Verdict } from './bank';
import { expectedMeasures } from './bank3';
import { FAULT_CLASSES, faultFamily } from './faults';
import { createFollower } from './follower';
import { DEVIATION_POOL } from './hidden';
import { followerAdapter, type Generation, runContext } from './measure';

/**
 * Three more families of the generator bank:
 *
 * - gate: the generated suite meets driftbench's own validity gate (`runGate`, docs/concepts on the gate):
 *   no complete block is rejected for any of the gate's reasons, every seeder keeps most of its blocks, every
 *   planted class keeps a gated killer. The gate runs on the follower, the gate's trivial agents and the
 *   every-time instance of each drift and deviation class.
 * - carriers (in the perturbation family): each deviation class reaches the agent the way the users package
 *   defines its carrier (a user message, a burst, or a change of the world with no user text).
 * - report per seeder: the report states, for each seeder, the share of machine Thens, the judged-only
 *   blocks, the cells it covers and their evenness, as `seeders.<seeder>.measures.<name>`.
 */

const verdict = (pass: boolean, detail: string): Verdict => ({ pass, detail });

const SEEDERS = ['graph', 'twise', 'boundary', 'deviation', 'metamorphic'] as const;

/** The gate run of a seed's suite, once per seed. */
async function gated(data: SeedData): Promise<GateResult> {
  return data.memoized('gate', async () => {
    const generated = await data.generated();
    const target = `function:${generated.hidden.agent}`;
    const provider = () => {
      throw new Error('function faults only');
    };
    const faults = faultFamily(
      generated.hidden,
      FAULT_CLASSES.filter((cls) => cls.family !== 'code'),
    )
      .filter((fault) => fault.where === 'any' && fault.rate === 1)
      .map((fault) => ({ def: fault.def, adapter: faultAdapter(fault.def, provider) }));
    return runGate({
      candidates: generated.complete.map((loaded) => ({
        spec: loaded.spec,
        hash: loaded.hash,
        path: loaded.path,
      })),
      targetOf: () => target,
      references: new Map([
        [
          target,
          followerAdapter((data.parts.follower ?? ((spec) => createFollower(spec)))(generated.hidden)),
        ],
      ]),
      faults,
      run: runContext(),
      options: { ...GATE_DEFAULTS, seed: data.seed, date: '2026-10-11', k: 2 },
      concurrency: 1,
    });
  });
}

function gateItems(): BankItem[] {
  const items: BankItem[] = [];
  const rejects = Object.entries(GATE_REASONS).flatMap(([stage, reasons]) =>
    ['difficulty', 'label_audit', 'freshness'].includes(stage)
      ? []
      : reasons.map((reason) => ({ stage, reason })),
  );
  for (const { stage, reason } of rejects) {
    items.push({
      id: `gate.${stage}.${reason}`,
      family: 'gate',
      tier: stage === 'red_first' || stage === 'contrast' ? 4 : 3,
      level: 'gate',
      component: 'packages/generate/src/seed/assemble.ts#renderDraft',
      async check(data) {
        const result = await gated(data);
        const hit = result.blocks.filter((block) => block.reason === reason);
        return verdict(
          hit.length === 0,
          `${hit.length} complete blocks are rejected by the gate stage ${stage} for ${reason}: ${hit
            .slice(0, 3)
            .map((block) => block.key)
            .join(', ')}`,
        );
      },
    });
  }
  for (const seeder of SEEDERS) {
    items.push({
      id: `gate.accepted.${seeder}`,
      family: 'gate',
      tier: 4,
      level: 'gate',
      component: `packages/generate/src/seed/seeders.ts#${seeder}Seeder`,
      async check(data) {
        const result = await gated(data);
        const own = result.blocks.filter((block) => block.family === seeder);
        const accepted = own.filter((block) => block.status === 'accepted').length;
        return verdict(
          own.length > 0 && accepted / own.length >= 0.9,
          `${accepted} of ${own.length} ${seeder} blocks pass the gate (at least 0.9)`,
        );
      },
    });
  }
  items.push({
    id: 'gate.killers',
    family: 'gate',
    tier: 4,
    level: 'gate',
    component: 'packages/generate/src/seed/seeders.ts',
    async check(data) {
      const result = await gated(data);
      const unkilled = result.faults
        .filter((fault) => !fault.equivalent && !fault.suite.killed)
        .map((fault) => fault.id);
      return verdict(
        unkilled.length === 0,
        `classes with no killer in the gated suite: ${unkilled.slice(0, 8).join(', ') || 'none'}`,
      );
    },
  });
  return items;
}

function carrierOf(spec: Spec, cls: string): string[] {
  const out: string[] = [];
  spec.blocks.forEach((block) => {
    if (!block.when || !('injection' in block.when) || block.when.injection.class !== cls) return;
    const worldChange = Object.keys(block.given?.world ?? {}).length > 0;
    const text = block.when.injection.user.trim();
    out.push(worldChange && (text === '' || cls === 'D8_tool_failure') ? 'world' : 'user');
  });
  for (const perturbation of spec.perturbations ?? []) {
    if (perturbation.class !== cls) continue;
    out.push(perturbation.world ? 'world' : 'user');
  }
  return out;
}

function carrierItems(): BankItem[] {
  return DEVIATION_POOL.map(
    (cls): BankItem => ({
      id: `perturbation.carrier.${cls}`,
      family: 'perturbation',
      tier: 3,
      level: 'modes',
      component: 'packages/generate/src/seed/scenario.ts#buildScenario',
      async check(data) {
        const generated: Generation = await data.generated();
        const wanted = DEVIATIONS[cls].carrier;
        const seen = generated.complete.flatMap(({ spec }) => carrierOf(spec, cls));
        const ok =
          seen.length > 0 &&
          seen.every((carrier) => (wanted === 'world' ? carrier === 'world' : carrier === 'user'));
        return verdict(
          ok,
          `${cls} is carried by ${wanted} in the users package; the suite carries it by ${[...new Set(seen)].join(', ') || 'nothing'}`,
        );
      },
    }),
  );
}

const SEEDER_MEASURES = ['machine_then_share', 'judged_only_blocks', 'hill_q0', 'pielou'] as const;

function seederReportItems(): BankItem[] {
  return SEEDERS.flatMap((seeder) =>
    SEEDER_MEASURES.map(
      (name): BankItem => ({
        id: `report.${seeder}.${name}`,
        family: 'report',
        tier: 3,
        level: 'report',
        component: 'packages/generate/src/enumerate/generate.ts#generateSuite',
        async check(data) {
          const generated = await data.generated();
          const own: Generation = {
            ...generated,
            complete: generated.complete.filter(
              (loaded) =>
                (loaded.spec.metadata?.generated as { seeder?: string } | undefined)?.seeder === seeder,
            ),
          };
          const measures = expectedMeasures(own);
          const expected = measures?.[name];
          const stated = (
            generated.report?.seeders as Record<string, { measures?: Record<string, unknown> }> | undefined
          )?.[seeder]?.measures?.[name];
          if (typeof stated !== 'number')
            return verdict(
              false,
              `generate-report.json states no seeders.${seeder}.measures.${name}; the validator computes ${expected}`,
            );
          return verdict(
            expected !== undefined && Math.abs(stated - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
            `the report states ${stated}, the validator computes ${expected}`,
          );
        },
      }),
    ),
  );
}

/** The gate, carrier and per-seeder report families. */
export function gateFamilyItems(): BankItem[] {
  return [...gateItems(), ...carrierItems(), ...seederReportItems()];
}
