import { ESTATE_CHECKS, guards as guardsCheck } from '@agent-nexus/driftbench-checks';
import {
  type CheckContext,
  loadSpecFile,
  type Observed,
  type ResolvedGiven,
  type Spec,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import type { GuardJudge, GuardRunRecord, UnitSpecInput } from '@agent-nexus/driftbench-estate';
import { SpecUnit } from '@agent-nexus/driftbench-generate';

/**
 * A generated spec of mode unit, run by `estate unit` with no model. The spec carries its run
 * (`metadata.estate.unit`: the guard and the payloads its test type sends, the script and its minimal
 * fixtures, or the helper); the guard runs become the runtime trace of the spec's block, and the spec's own
 * Then judges them with the checks a replay or a live run uses: `expect.guards`, and the `guard_message` and
 * `guard_finished` rules. What only a model's run can show (skills loaded, files read, the workspace) is not
 * judged in unit mode and the run says so.
 */

/** The custom checks a unit run of a guard can feed: they read only the guard's runs. */
const GUARD_RULES = new Set(['guard_message', 'guard_finished']);

export type LoadedUnitSpec = { input: UnitSpecInput; spec: Spec };

/** A YAML spec of mode unit with its run, or why the file is no such spec. */
export async function loadUnitSpec(file: string): Promise<LoadedUnitSpec | string> {
  const loaded = await loadSpecFile(file);
  if (!loaded.ok) return `not a spec: ${loaded.errors[0]?.message ?? 'invalid'}`;
  const estate = (loaded.spec.metadata as { estate?: Record<string, unknown> } | undefined)?.estate;
  if (estate?.mode !== 'unit') return 'not a unit test, nor a generated spec of mode unit';
  const unit = SpecUnit.safeParse(estate.unit);
  if (!unit.success)
    return 'a unit-mode spec that carries no run (metadata.estate.unit): generate it again with this driftbench';
  return {
    input: { id: loaded.spec.id, testType: String(estate.testType ?? ''), unit: unit.data },
    spec: loaded.spec,
  };
}

/** The guard runs as the runtime trace of a block. */
function observedOf(runs: readonly GuardRunRecord[], name: string): Observed {
  return {
    segments: [],
    text: '',
    toolCalls: [],
    runtime: {
      guards: runs.map((run) => ({
        name,
        verdict: run.verdict,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        outcome: run.ended,
      })),
    },
    cost: { usd: 0, inputTokens: 0, outputTokens: 0 },
    latencyMs: 0,
  } as unknown as Observed;
}

/** Judges the guard runs of unit-mode specs by each spec's own Then. */
export function guardJudge(specs: ReadonlyMap<string, Spec>): GuardJudge {
  return async (input, runs) => {
    const spec = specs.get(input.id);
    const target = input.unit.target;
    if (!spec || target.kind !== 'guard') {
      return { pass: false, failing: ['the spec is not loaded'], detail: 'the spec is not loaded' };
    }
    const observed = observedOf(runs, target.name);
    const verdicts: Verdict[] = [];
    const notes: string[] = [];
    const custom = (spec.rules?.custom ?? {}) as Record<string, unknown>;
    for (const [blockIndex, block] of spec.blocks.entries()) {
      const expect = block.expect ?? {};
      const ctx = {
        spec,
        mode: 'F',
        blockIndex,
        block,
        expect,
        given: {} as ResolvedGiven,
        observed,
        history: [],
        ledger: {},
      } as unknown as CheckContext;
      if (guardsCheck.applies(ctx)) verdicts.push(...(await guardsCheck.evaluate(ctx)));
      const other = Object.keys(expect).filter((key) => key !== 'guards' && key !== 'criteria');
      if (other.length > 0)
        notes.push(`block ${blockIndex}: ${other.join(', ')} need a model's run, not judged in unit mode`);
    }
    for (const [name, options] of Object.entries(custom)) {
      const check = ESTATE_CHECKS[name];
      if (!GUARD_RULES.has(name) || !check) {
        notes.push(`rules.custom.${name} needs a model's run, not judged in unit mode`);
        continue;
      }
      const at =
        typeof (options as { block?: unknown }).block === 'number' ? (options as { block: number }).block : 0;
      const block = spec.blocks[at] ?? spec.blocks[0];
      if (!block) continue;
      const ctx = {
        spec,
        mode: 'F',
        blockIndex: at,
        block,
        expect: block.expect ?? {},
        given: {} as ResolvedGiven,
        observed,
        history: [],
        ledger: {},
      } as unknown as CheckContext;
      const out = await check(ctx, options);
      verdicts.push(...(Array.isArray(out) ? out : [out]));
    }
    const failed = verdicts.filter((verdict) => verdict.gating && verdict.outcome === 'fail');
    const undecided = verdicts.filter((verdict) => verdict.outcome === 'inconclusive');
    for (const verdict of undecided) notes.push(`inert: ${verdict.id}: ${verdict.evidence}`);
    const decided = verdicts.filter((verdict) => verdict.outcome === 'pass').length;
    return {
      pass: failed.length === 0,
      failing: failed.map((verdict) => `${verdict.id}: ${verdict.evidence}`),
      detail:
        failed.length > 0
          ? failed.map((verdict) => `${verdict.id}: ${verdict.evidence}`).join(' | ')
          : `${decided} checks hold on ${runs.length} runs of ${target.name}${undecided.length > 0 ? `, ${undecided.length} inert (the guard gave nothing to judge)` : ''}`,
      notes,
    };
  };
}
