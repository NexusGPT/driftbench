import type { Spec } from '../schema/spec';
import { error, type Issue } from './issues';
import { specParentRef } from './spec-parents';

/** Stable dependency order; indices always refer to the authored spec. */
export function parentOrder(spec: Spec): { order: number[]; issues: Issue[] } {
  const ids = new Map(
    spec.blocks.flatMap((block, index) => (block.id === undefined ? [] : [[block.id, index] as const])),
  );
  const marks = new Map<number, 'visiting' | 'done'>();
  const order: number[] = [];
  const issues: Issue[] = [];
  /** The blocks being visited, child first: a cycle is the part of it from the block met again. */
  const stack: number[] = [];
  const visit = (index: number) => {
    if (marks.get(index) === 'done') return;
    if (marks.get(index) === 'visiting') {
      const path = [...stack.slice(stack.indexOf(index)), index].map(
        (at) => spec.blocks[at]?.id ?? `blocks.${at}`,
      );
      issues.push(
        error('PARENT_CYCLE', `blocks.${index}.parent`, `parent links form a cycle: ${path.join(' -> ')}`),
      );
      return;
    }
    marks.set(index, 'visiting');
    stack.push(index);
    const parent = spec.blocks[index]?.parent;
    // A block of another spec is resolved by the loader, over the specs loaded together; here only where it
    // may stand is checked.
    if (specParentRef(parent)) crossSpecIssues(spec, index, issues);
    else if (parent !== undefined) {
      const at = ids.get(parent);
      if (at === undefined)
        issues.push(
          error(
            'PARENT_MISSING',
            `blocks.${index}.parent`,
            `parent block "${parent}" does not exist in this spec`,
          ),
        );
      else visit(at);
    }
    stack.pop();
    marks.set(index, 'done');
    order.push(index);
  };
  spec.blocks.forEach((_, index) => {
    visit(index);
  });
  return { order, issues };
}

/** Where a `<spec id>#<block id>` parent may stand: on block 0, in a spec with no parent links of its own. */
function crossSpecIssues(spec: Spec, index: number, issues: Issue[]): void {
  const at = `blocks.${index}.parent`;
  if (index > 0) {
    issues.push(
      error('PARENT_SPEC_POSITION', at, 'a block of another spec can be the parent of block 0 only'),
    );
    return;
  }
  if (spec.blocks.slice(1).some((block) => block.parent !== undefined))
    issues.push(
      error(
        'PARENT_SPEC_POSITION',
        at,
        'a spec whose block 0 starts from another spec has no parent links of its own',
      ),
    );
  if (spec.blocks[0]?.given?.prefix !== undefined)
    issues.push(
      error(
        'PARENT_WITH_PREFIX',
        'blocks.0.given.prefix',
        'a block that starts from another spec cannot also write its prefix',
      ),
    );
}
