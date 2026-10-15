import { z } from 'zod';
import type { CheckContext } from '../contracts/check';
import type { UsedObject } from '../objects/layers';
import { type ObjectRegistry, objectRegistry, type ResolvedObject } from '../objects/resolve';
import { describeError } from '../runner/retry';
import type { By, Diagnosis, Verdict } from '../schema/run';
import { Diagnosis as DiagnosisSchema } from '../schema/run';

/**
 * Diagnostics: procedures that run after a block's checks, read its verdicts and what was observed, and write
 * diagnoses. A diagnosis explains, attributes or measures; it never changes a verdict or `pass`.
 */

/** What a step costs: `static` reads the record only; `run` runs the agent or a tool again; `model` calls a model. */
export const StepCost = z.enum(['static', 'run', 'model']);
export type StepCost = z.infer<typeof StepCost>;

/** What one step reads: the block as its checks saw it, its verdicts, its objects, its params, the earlier steps' output. */
export type DiagnosticStepContext = {
  readonly check: CheckContext;
  readonly verdicts: readonly Verdict[];
  readonly objects: readonly UsedObject[];
  readonly params: Readonly<Record<string, unknown>>;
  /** What the earlier steps of the same diagnostic wrote on this block. */
  readonly earlier: readonly Diagnosis[];
};

/** What a step writes: a diagnosis without its stamp; the runner adds `diagnostic`, `step` and `by`. */
export type StepOutput = Omit<Diagnosis, 'diagnostic' | 'step' | 'by'>;

/** A step implementation a diagnostic item names by its impl. */
export type DiagnosticStep = {
  /** The schema the item's params must pass, checked when the diagnostic resolves. */
  params: z.ZodType;
  cost: StepCost;
  summary?: string;
  run(
    ctx: DiagnosticStepContext,
  ): StepOutput | StepOutput[] | undefined | Promise<StepOutput | StepOutput[] | undefined>;
};

const steps = new Map<string, DiagnosticStep>();

/**
 * Registers a diagnostic step under an implementation name: `builtin:<name>` for a driftbench package,
 * `plugin:<name>` for a plugin. A name registered twice is refused. A diagnostic item naming a step nobody
 * registered is refused when the diagnostic resolves: at load.
 */
export function registerDiagnosticStep(
  name: string,
  step: DiagnosticStep,
  registry: ObjectRegistry = objectRegistry,
): void {
  if (steps.has(name)) throw new Error(`the diagnostic step ${name} is already registered`);
  registry.registerImpl(name, {
    params: step.params,
    kinds: ['diagnostic'],
    ...(step.summary === undefined ? {} : { summary: step.summary }),
  });
  steps.set(name, step);
}

/** The step registered under an implementation name. */
export function diagnosticStep(name: string): DiagnosticStep | undefined {
  return steps.get(name);
}

/** How much a block's diagnostics may spend: the number of `run` and `model` steps they may take. Default 0. */
export type DiagnosticBudget = { runs?: number };

/** Does the diagnostic's `when` hold for these verdicts? Absent `when` fires always. */
export function triggers(object: ResolvedObject, verdicts: readonly Verdict[]): boolean {
  const when = object.fields.when as
    | { always?: true; any_verdict?: { name?: string; outcome?: string; id_contains?: string } }
    | undefined;
  if (when === undefined || when.always === true) return true;
  const match = when.any_verdict;
  if (!match) return false;
  return verdicts.some(
    (verdict) =>
      (match.name === undefined || verdict.name === match.name) &&
      (match.outcome === undefined || verdict.outcome === match.outcome) &&
      (match.id_contains === undefined || verdict.id.includes(match.id_contains)),
  );
}

/**
 * Runs a block's diagnostics after its checks, in order, each step in its diagnostic's item order. A diagnostic
 * fires on its `when`; a disabled step is left out; a step of cost class `run` or `model` runs only while the
 * budget lasts, and is counted in `skippedForBudget` otherwise. A step that throws writes a diagnosis that says
 * so. The verdicts are read, never changed.
 */
export async function runDiagnostics(
  diagnostics: readonly ResolvedObject[],
  input: { check: CheckContext; verdicts: readonly Verdict[]; objects: readonly UsedObject[] },
  budget: DiagnosticBudget = {},
): Promise<{ diagnoses: Diagnosis[]; skippedForBudget: number }> {
  const diagnoses: Diagnosis[] = [];
  let left = budget.runs ?? 0;
  let skippedForBudget = 0;
  for (const diagnostic of diagnostics) {
    if (!triggers(diagnostic, input.verdicts)) continue;
    const own: Diagnosis[] = [];
    for (const item of diagnostic.items) {
      if (!item.enabled) continue;
      const step = steps.get(item.impl);
      const by: By = { object: diagnostic.ref, item: item.id, impl: item.impl, layer: item.layer };
      const stamp = (output: StepOutput): Diagnosis => ({
        ...output,
        diagnostic: diagnostic.ref,
        step: item.id,
        by,
      });
      if (!step) {
        own.push(stamp({ summary: `no diagnostic step is registered as ${item.impl}` }));
        continue;
      }
      if (step.cost !== 'static') {
        if (left <= 0) {
          skippedForBudget += 1;
          continue;
        }
        left -= 1;
      }
      try {
        const out = await step.run({ ...input, params: item.params, earlier: own });
        for (const output of out === undefined ? [] : Array.isArray(out) ? out : [out]) {
          const parsed = DiagnosisSchema.safeParse(stamp(output));
          own.push(
            parsed.success
              ? parsed.data
              : stamp({
                  summary:
                    `the step returned a diagnosis the schema refuses: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
                }),
          );
        }
      } catch (cause) {
        own.push(stamp({ summary: `the step threw ${describeError(cause)}` }));
      }
    }
    diagnoses.push(...own);
  }
  return { diagnoses, skippedForBudget };
}
