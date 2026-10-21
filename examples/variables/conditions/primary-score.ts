export type PlantedRow = {
  id: string;
  kind: 'existing' | 'new' | 'none';
  conditions: readonly { variable: string; value: string }[];
};

export type ScoredOutcome = { span: string; status: string; values: readonly string[] };

/**
 * Primary rule: right variable AND right decision. Existing requires the exact
 * value id; new requires a proposal outside the initial candidates, with no id
 * or title comparison. Each prediction can explain at most one planted condition.
 */
export function primaryScore(
  gold: readonly PlantedRow[],
  outcomes: readonly ScoredOutcome[],
  initialCandidates: ReadonlySet<string>,
) {
  const bySpan = new Map(outcomes.map((o) => [o.span, o]));
  let assigned = 0;
  let correct = 0;
  let planted = 0;
  const misses: Record<string, number> = {};
  const extras: Record<string, number> = {};
  const add = (counts: Record<string, number>, key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  for (const row of gold) {
    const outcome = bySpan.get(row.id);
    const values = outcome?.values ?? [];
    assigned += values.length;
    const used = new Set<number>();
    for (const condition of row.conditions) {
      planted++;
      const hit = values.findIndex((pair, index) => !used.has(index) && (
        row.kind === 'existing'
          ? pair === `${condition.variable}/${condition.value}`
          : row.kind === 'new' && outcome?.status === 'proposed'
            && pair.split('/')[0] === condition.variable && !initialCandidates.has(pair)
      ));
      if (hit >= 0) {
        correct++;
        used.add(hit);
      } else {
        const sameVariable = values.some((p) => p.split('/')[0] === condition.variable);
        const reason = outcome?.status === 'failed' || outcome?.status === 'unsure'
          ? 'unread_or_unsettled'
          : values.length === 0 ? 'no_assignment'
            : !sameVariable ? 'wrong_variable'
              : row.kind === 'new' ? 'new_mapped_to_existing_or_not_proposed'
                : outcome?.status === 'proposed' ? 'existing_reproposed' : 'wrong_existing_value';
        add(misses, reason);
      }
    }
    values.forEach((_, index) => {
      if (!used.has(index)) add(extras, row.kind === 'none' ? 'assignment_on_none' : 'incorrect_or_extra_assignment');
    });
  }
  // Unexpected span ids must not disappear from precision's denominator.
  const ids = new Set(gold.map((row) => row.id));
  for (const outcome of outcomes) if (!ids.has(outcome.span)) {
    assigned += outcome.values.length;
    for (const _ of outcome.values) add(extras, 'unknown_span');
  }
  return {
    correct, assigned, planted,
    falsePositives: assigned - correct, falseNegatives: planted - correct,
    precision: assigned === 0 ? 0 : correct / assigned,
    recall: planted === 0 ? 0 : correct / planted,
    missClasses: misses, extraClasses: extras,
  };
}
