import type { Rng } from '../seed/random';
import { type Condition, type Constraint, type FamilyFile, isRange, type KnobValue } from './schema';

/** One drawn value per knob. */
export type Knobs = Readonly<Record<string, KnobValue>>;

/** The most draws tried before the generator says the constraints leave no instance. */
export const MAX_DRAWS = 1000;

/** True when every knob the condition names holds its value, or one of its values. */
export function meets(knobs: Knobs, condition: Condition | undefined): boolean {
  for (const [name, wanted] of Object.entries(condition ?? {})) {
    const value = knobs[name];
    const options = Array.isArray(wanted) ? wanted : [wanted];
    if (!options.some((option) => String(option) === String(value))) return false;
  }
  return true;
}

/** The constraints a draw breaks, by id. */
export function broken(knobs: Knobs, constraints: readonly Constraint[]): string[] {
  const out: string[] = [];
  for (const constraint of constraints) {
    if ('compare' in constraint) {
      const { left, op, right } = constraint.compare;
      const a = Number(knobs[left]);
      const b = typeof right === 'number' ? right : Number(knobs[right]);
      const holds =
        op === '<'
          ? a < b
          : op === '<='
            ? a <= b
            : op === '=='
              ? a === b
              : op === '!='
                ? a !== b
                : op === '>='
                  ? a >= b
                  : a > b;
      if (!holds) out.push(constraint.id);
    } else if (meets(knobs, constraint.implies.when) && !meets(knobs, constraint.implies.require)) {
      out.push(constraint.id);
    }
  }
  return out;
}

/** Every value a knob can hold, in order. */
export function valuesOf(family: FamilyFile, name: string): KnobValue[] {
  const knob = family.knobs[name];
  if (knob === undefined) return [];
  if (!isRange(knob)) return [...knob.values];
  return Array.from({ length: knob.max - knob.min + 1 }, (_, index) => knob.min + index);
}

/**
 * One allowed draw of every knob, uniform over each knob's values, redrawn until no constraint is broken.
 * Knobs are drawn in name order, so a family's knob order in the file never changes a draw.
 */
export function drawKnobs(family: FamilyFile, rng: Rng): Knobs {
  const names = Object.keys(family.knobs).sort();
  for (let attempt = 0; attempt < MAX_DRAWS; attempt += 1) {
    const knobs: Record<string, KnobValue> = {};
    for (const name of names) {
      const values = valuesOf(family, name);
      knobs[name] = values[Math.floor(rng() * values.length)] as KnobValue;
    }
    if (broken(knobs, family.constraints).length === 0) return knobs;
  }
  throw new FamilyError(`no draw of the knobs meets every constraint after ${MAX_DRAWS} tries`);
}

/** The other values of one knob that keep every constraint, the rest of the draw held. */
export function alternatives(family: FamilyFile, knobs: Knobs, name: string): KnobValue[] {
  return valuesOf(family, name).filter(
    (value) => value !== knobs[name] && broken({ ...knobs, [name]: value }, family.constraints).length === 0,
  );
}

/** A defect of the family or its oracle, found while instances are built: nothing is written. */
export class FamilyError extends Error {
  override readonly name = 'FamilyError';
}
