import type { GoldUnit } from '../../../estate/test/gold/gold';
import type { Truth } from '../../../estate/test/gold/truth';

export const INSTRUCTION_LABELS: ReadonlySet<string> = new Set(['rule', 'prohibition', 'gate']);

/**
 * The scopes of a truth file the pointer reader can hold. It gives a unit one label and one target: the first scope
 * of a condition unit applies; every other scope is a gap of the product, returned in `dropped` with the unit and its
 * target, and fails the labels step.
 */
export function appliedScopes(
  gold: readonly GoldUnit[],
  scopes: Truth['scopes'],
): { applied: Map<string, Truth['scopes'][number]>; dropped: string[] } {
  const byId = new Map(gold.map((unit) => [unit.id, unit]));
  const applied = new Map<string, Truth['scopes'][number]>();
  const dropped: string[] = [];
  for (const scope of scopes) {
    const label = byId.get(scope.unit)?.label ?? '';
    if (INSTRUCTION_LABELS.has(label)) {
      dropped.push(
        `scope dropped: ${scope.unit} is an instruction (${label}) and cannot also be a condition; target ${scope.target}`,
      );
    } else if (applied.has(scope.unit)) {
      dropped.push(
        `scope dropped: ${scope.unit} has a second target ${scope.target} (first ${applied.get(scope.unit)?.target}); a unit takes one target`,
      );
    } else applied.set(scope.unit, scope);
  }
  return { applied, dropped };
}
