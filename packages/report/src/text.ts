import type { CompareResult } from './compare';
import { count, fixed, interval, pct, points, pValue } from './format';

/** Pads every column but the last to its widest cell, two spaces apart, indented by two. */
export function textTable(rows: readonly string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join('  ')}`.trimEnd(),
  );
}

const VERDICT: Record<CompareResult['verdict'], string> = {
  'non-inferior': 'NON-INFERIOR',
  regressed: 'REGRESSED',
  unproven: 'NOT SHOWN NON-INFERIOR',
};

/** The comparison as plain text, the way `driftbench compare` prints it. */
export function compareText(result: CompareResult): string {
  const lines: string[] = [];
  const all = result.allPass;
  const t = all.table;
  lines.push(
    `Baseline ${result.baseline.campaignId} (${result.baseline.targets.join(', ')}) against candidate ${result.candidate.campaignId} (${result.candidate.targets.join(', ')}).`,
    `Paired: ${count(result.pairs.length, 'golden')} (one golden in one mode, one perturbation in P), modes ${result.modes.join(', ')}; ${count(result.unpaired.length, 'golden')} not paired. Margin ${fixed(result.margin * 100, 1)} points.`,
    '',
    'All repeats pass, per golden:',
    ...textTable([
      ['side', 'passing', 'rate', '95% interval'],
      [
        'baseline',
        `${all.baseline.k} of ${all.baseline.n}`,
        pct(all.baseline.estimate),
        interval(all.baseline, pct),
      ],
      [
        'candidate',
        `${all.candidate.k} of ${all.candidate.n}`,
        pct(all.candidate.estimate),
        interval(all.candidate, pct),
      ],
    ]),
    `  Both pass ${t.bothPass}, regressed ${t.regressed}, improved ${t.improved}, both fail ${t.bothFail}. McNemar exact p = ${pValue(all.mcnemar.pValue)}.`,
    `  Effect, baseline minus candidate: ${points(all.effect.estimate)} points, interval ${interval(all.effect, points)} (Newcombe, paired).`,
    `Drift count per golden (mean over repeats): baseline ${fixed(result.drift.baselineMean, 2)}, candidate ${fixed(result.drift.candidateMean, 2)}; Wilcoxon signed-rank p = ${pValue(result.drift.wilcoxon.pValue)} (${result.drift.wilcoxon.method}, ${count(result.drift.wilcoxon.n, 'golden')} differ).`,
    '',
    `Criteria: McNemar exact per criterion, Benjamini-Hochberg across ${count(result.criteria.length, 'criterion', 'criteria')} at q ${fixed(result.q, 2)}. Effect in points, baseline minus candidate.`,
    ...textTable([
      [
        'criterion',
        'gating',
        'goldens',
        'regressed',
        'improved',
        'p',
        'q',
        'effect',
        'interval',
        'margin',
        'verdict',
      ],
      ...result.criteria.map((row) => [
        row.criterion,
        row.gating ? 'yes' : 'no',
        String(row.units),
        String(row.regressed),
        String(row.improved),
        pValue(row.pValue),
        pValue(row.adjusted),
        points(row.effect.estimate),
        interval(row.effect, points),
        row.gating ? (row.nonInferior ? 'within' : 'not within') : '',
        row.significantRegression ? 'regressed' : '',
      ]),
    ]),
  );
  if (result.newFlags.length > 0) {
    lines.push('', `New gating flags (${result.flagFamilies.join(', ')}), firing for the candidate only:`);
    lines.push(
      ...textTable([['golden', 'family'], ...result.newFlags.map((flag) => [flag.unit, flag.family])]),
    );
  }
  if (result.unpaired.length > 0) {
    lines.push('', 'Not paired:');
    lines.push(...textTable(result.unpaired.map((entry) => [entry.unit, entry.reason])));
  }
  lines.push('', `Verdict: ${VERDICT[result.verdict]}.`);
  for (const reason of result.reasons) lines.push(`  ${reason}`);
  return `${lines.join('\n')}\n`;
}
