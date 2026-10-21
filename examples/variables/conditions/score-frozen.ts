import { readFileSync } from 'node:fs';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import type { ConditionJudge } from '../../../packages/generate/src/feed/judge-reader';
import { type PlantedRow, primaryScore, type ScoredOutcome } from './primary-score';
import { hash } from './round2-live';
import { equivalentTitle } from './secondary-score';

type SealedRow = PlantedRow & {
  conditions: Array<{ variable: string; value: string; expected_new_value?: { id: string; title: string } }>;
};

/** Reads the sealed key in memory; returns aggregate numbers only. Never serializes the key or individual labels. */
export async function scoreFrozen(
  answerFile: string,
  expectedHash: string,
  spanIds: readonly string[],
  outcomes: readonly ScoredOutcome[],
  initialStore: VariableStore,
  finalStore: VariableStore,
  secondaryJudge: ConditionJudge,
) {
  const bytes = readFileSync(answerFile);
  if (hash(bytes) !== expectedHash) throw new Error('sealed answer hash differs from pre-registration');
  const gold = JSON.parse(bytes.toString('utf8')) as SealedRow[];
  if (!Array.isArray(gold) || gold.length !== spanIds.length || new Set(gold.map((r) => r.id)).size !== gold.length
    || gold.some((r) => !spanIds.includes(r.id) || !['existing', 'new', 'none'].includes(r.kind)
      || !Array.isArray(r.conditions) || (r.kind === 'none' && r.conditions.length !== 0)
      || r.conditions.some((c) => typeof c.variable !== 'string' || typeof c.value !== 'string'))) {
    throw new Error('sealed answer schema differs from pre-registration');
  }
  const known = new Set(initialStore.variables.flatMap((v) => v.values.map((x) => v.id + '/' + x.id)));
  const primary = primaryScore(gold, outcomes, known);
  const secondary = { equivalent: 0, different: 0, unread: 0, checked: 0, primaryCorrectNew: 0, plantedNew: 0 };
  for (const row of gold) {
    if (row.kind !== 'new') continue;
    secondary.plantedNew += row.conditions.length;
    const outcome = outcomes.find((o) => o.span === row.id);
    const used = new Set<string>();
    for (const condition of row.conditions) {
      const pair = outcome?.status === 'proposed' ? outcome.values.find((p) =>
        !used.has(p) && !known.has(p) && p.split('/')[0] === condition.variable) : undefined;
      if (pair === undefined) continue;
      used.add(pair);
      secondary.primaryCorrectNew++;
      const [variable, value] = pair.split('/');
      const title = finalStore.variables.find((v) => v.id === variable)?.values.find((x) => x.id === value)?.title;
      const reference = condition.expected_new_value?.title;
      if (title === undefined || typeof reference !== 'string') throw new Error('secondary title missing');
      secondary.checked++;
      let equivalent: boolean | undefined;
      try { equivalent = await equivalentTitle(secondaryJudge, title, reference); } catch { equivalent = undefined; }
      if (equivalent === true) secondary.equivalent++;
      else if (equivalent === false) secondary.different++;
      else secondary.unread++;
    }
  }
  return { primary, secondary };
}
