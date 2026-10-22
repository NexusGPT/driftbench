/**
 * The logical normal form of a limit, so that two readings of one fact compare equal.
 *
 * A prohibition forbids an act in a range of a quantity. "Do not draw a chart for fewer than four numbers" can be
 * written as a trigger (the rule applies when the quantity is lt 4) or as a constraint (the act is compliant when the
 * quantity is ge 4). The two state the same fact, because the compliant range of the act is the complement of the
 * range where the prohibition applies. The normal form expresses the limit of a prohibition as the compliant range of
 * the act, so as a constraint: a trigger is converted by negating its comparison (lt and ge, le and gt).
 *
 * The conversion is applied only to a prohibition. For any other rule a trigger and a constraint state different
 * facts (the rule applies in a range, or the act is allowed in a range), so nothing is converted and they stay apart.
 */
export type Comparison = 'lt' | 'le' | 'gt' | 'ge';
export type Role = 'constraint' | 'trigger';
export type Reading = { limit: number; comparison: Comparison; role: Role };

const NEGATION: Readonly<Record<Comparison, Comparison>> = { lt: 'ge', le: 'gt', gt: 'le', ge: 'lt' };

/** The reading as the compliant range of the act when the governing unit is a prohibition; unchanged otherwise. */
export function normalForm(reading: Reading, prohibition: boolean): Reading {
  if (!prohibition || reading.role === 'constraint') return reading;
  return { limit: reading.limit, comparison: NEGATION[reading.comparison], role: 'constraint' };
}
