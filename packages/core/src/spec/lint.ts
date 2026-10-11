import type { Expect, Spec } from '../schema/spec';
import { type Issue, warning } from './issues';
import { parseCriterionRef } from './semantics';

/** Advice on a valid spec. Every issue returned is a warning. */
export function lintSpec(spec: Spec): Issue[] {
  const issues: Issue[] = [];

  if (!spec.criteria) {
    const names = new Set<string>();
    const collect = (expect: Expect | undefined) => {
      for (const ref of expect?.criteria ?? []) {
        const parsed = parseCriterionRef(ref);
        if (parsed) names.add(parsed.name);
      }
    };
    for (const block of spec.blocks) collect(block.expect);
    for (const perturbation of spec.perturbations ?? []) collect(perturbation.expect);
    if (names.size > 0) {
      issues.push(
        warning(
          'CRITERION_UNRESOLVED',
          'criteria',
          `criteria referenced without local definitions (${[...names].join(', ')}); they must come from a shared catalogue`,
        ),
      );
    }
  }

  spec.blocks.forEach((block, index) => {
    if (!hasExpectation(block.expect)) {
      issues.push(warning('BLOCK_NO_EXPECTATION', `blocks.${index}`, 'this block checks nothing'));
    }
  });

  if (spec.kind === 'task') {
    const checksOutcome = spec.blocks.some(
      (block) => block.expect?.artifacts || block.expect?.workspace || block.expect?.execution,
    );
    if (!checksOutcome && spec.end_state === undefined) {
      issues.push(
        warning(
          'TASK_WITHOUT_OUTCOME',
          'blocks',
          'a task spec should check what the agent produced: artifacts, workspace, execution or end_state',
        ),
      );
    }
  }

  spec.perturbations?.forEach((perturbation, index) => {
    if (!perturbation.recovery) {
      issues.push(
        warning(
          'PERTURBATION_NO_RECOVERY',
          `perturbations.${index}`,
          'without a recovery expectation this deviation is run but its recovery is not measured',
        ),
      );
    }
  });

  return issues;
}

function hasExpectation(expect: Expect | undefined): boolean {
  if (!expect) return false;
  return Object.values(expect).some(
    (value) => value !== undefined && !(Array.isArray(value) && value.length === 0),
  );
}
