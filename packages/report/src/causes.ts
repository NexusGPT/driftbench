import { blockStatus, type RunResult } from '@agent-nexus/driftbench-core';
import { esc } from './format';

/** A failed root that passed in other repeats of the same line: how many of its scored repeats passed. */
export type FlakyRoot = { passed: number; scored: number };

export type ParentCause = {
  root: string;
  status: 'fail' | 'not_run';
  blocked: string[];
  /** Set on a failed root with mixed results over the repeats of its line. */
  flaky?: FlakyRoot;
};

/**
 * A failed or unrun cause counted once, with all children that it prevented from running. `repeats` are the
 * runs of the same line (lineKey), this one included: a failed root that passed in one of them is labelled
 * flaky, with how many of its scored repeats passed, so a flaky stem is read apart from a broken one.
 */
export function parentCauses(run: RunResult, repeats: readonly RunResult[] = [run]): ParentCause[] {
  const causes = run.blocks.filter(
    (block) => blockStatus(block) === 'fail' || blockStatus(block) === 'not_run',
  );
  return causes.map((block) => {
    const root = block.blockId ?? `block ${block.index}`;
    const status = blockStatus(block) as 'fail' | 'not_run';
    const flaky =
      status === 'fail' && block.blockId !== undefined ? flakyOf(block.blockId, repeats) : undefined;
    return {
      root,
      status,
      blocked: run.blocks
        .filter((child) => child.blocked?.root === root)
        .map((child) => child.blockId ?? `block ${child.index}`),
      ...(flaky === undefined ? {} : { flaky }),
    };
  });
}

/** The scored results of one block id over the repeats; mixed when some passed and some failed. */
function flakyOf(blockId: string, repeats: readonly RunResult[]): FlakyRoot | undefined {
  const statuses = repeats.flatMap((repeat) =>
    repeat.blocks.filter((block) => block.blockId === blockId).map(blockStatus),
  );
  const passed = statuses.filter((status) => status === 'pass').length;
  const scored = passed + statuses.filter((status) => status === 'fail').length;
  return passed > 0 && passed < scored ? { passed, scored } : undefined;
}

/** Shared by the scorecard drawer and the standalone run page. */
export function parentCausesHtml(causes: readonly ParentCause[] | undefined): string {
  if (causes === undefined) return '';
  return `<h3>Causes: ${causes.filter((cause) => cause.status === 'fail').length} failed, ${causes.filter((cause) => cause.status === 'not_run').length} not run</h3><ul>${causes.map((cause) => `<li>${esc(cause.root)}: ${esc(cause.status)}${cause.flaky ? `, flaky: passed ${cause.flaky.passed} of ${cause.flaky.scored} repeats` : ''}${cause.blocked.length ? `<ul>${cause.blocked.map((child) => `<li>${esc(child)}: blocked</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`;
}
