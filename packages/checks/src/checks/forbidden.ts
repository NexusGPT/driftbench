import {
  type Check,
  type CheckContext,
  isZero,
  machineVerdict,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { times } from '../support/values';

const NAME = 'forbidden';

/**
 * Tools that must not run. A tool is forbidden in a block when `rules.forbidden_tools` lists it, when
 * `rules.max_calls` caps it at 0, or when the block expects it 0 times; one verdict per tool names every
 * reason. `rules.max_calls` above 0 caps the calls across the run: the history and this block together.
 * A block fails the cap only when its own calls go past it, so one excess is reported once.
 */
export const forbidden: Check = {
  name: NAME,
  applies: (ctx) => forbiddenTools(ctx).size > 0 || caps(ctx).length > 0,
  evaluate(ctx) {
    const verdicts: Verdict[] = [];
    const calls = ctx.observed.toolCalls;

    for (const [label, reasons] of forbiddenTools(ctx)) {
      const own = calls.filter((call) => call.label === label);
      const why = reasons.join('; ');
      if (own.length === 0) {
        verdicts.push(machineVerdict(NAME, label, 'pass', `${label} not called (${why})`));
      } else {
        const ids = own.map((call, index) => call.id ?? `call ${index + 1}`).join(', ');
        verdicts.push(
          machineVerdict(NAME, label, 'fail', `${label} called ${times(own.length)} (${ids}); ${why}`),
        );
      }
    }

    for (const [label, max] of caps(ctx)) {
      const here = calls.filter((call) => call.label === label).length;
      const before = ctx.history.reduce(
        (sum, block) => sum + block.observed.toolCalls.filter((call) => call.label === label).length,
        0,
      );
      const total = before + here;
      const ok = total <= max || here === 0;
      verdicts.push(
        machineVerdict(
          NAME,
          `max_calls.${label}`,
          ok ? 'pass' : 'fail',
          `${label} ran ${times(total)} in the run so far (${here} in this block, ${before} before), at most ${max} by rules.max_calls`,
        ),
      );
    }
    return verdicts;
  },
};

/** Each forbidden tool with the reasons it is forbidden in this block. */
function forbiddenTools(ctx: CheckContext): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (label: string, reason: string) => out.set(label, [...(out.get(label) ?? []), reason]);
  for (const label of ctx.spec.rules?.forbidden_tools ?? []) add(label, 'forbidden by rules.forbidden_tools');
  for (const [label, max] of Object.entries(ctx.spec.rules?.max_calls ?? {})) {
    if (max === 0) add(label, 'rules.max_calls is 0');
  }
  for (const tool of ctx.expect.tools ?? []) {
    if (isZero(tool.count)) add(tool.label, 'the block expects it 0 times');
  }
  return out;
}

/** The run-wide caps above 0. */
function caps(ctx: CheckContext): Array<[string, number]> {
  return Object.entries(ctx.spec.rules?.max_calls ?? {}).filter(([, max]) => max > 0);
}
