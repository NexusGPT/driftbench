import type { TargetRef } from '@agent-nexus/driftbench-core';
import type { LevelSummary, PilotAnalysis } from './analyse';
import type { PilotDesign } from './design';
import type { PilotPlan } from './run';

/** What `driftbench pilot run` writes as pilot-report.json. */
export type PilotReport = {
  generator: 'driftbench pilot';
  campaignId: string;
  createdAt: string;
  target: TargetRef;
  map?: PilotDesign['map'];
  design?: {
    by: string[];
    conversations: number;
    repeats: number;
    wordings: number;
    cells: number;
    conversationsRun: number;
    variants: number;
    /** Conversations whose approved phrases give fewer wordings than asked, by how many they give. */
    wordingsAvailable: Record<string, number>;
    skipped: PilotDesign['skipped'];
    warnings: string[];
  };
  plan?: PilotPlan;
  analysis: PilotAnalysis;
};

export function pilotReport(input: {
  campaignId: string;
  createdAt: string;
  target: TargetRef;
  design?: PilotDesign;
  plan?: PilotPlan;
  analysis: PilotAnalysis;
}): PilotReport {
  const { design } = input;
  return {
    generator: 'driftbench pilot',
    campaignId: input.campaignId,
    createdAt: input.createdAt,
    target: input.target,
    ...(design ? { map: design.map, design: designSummary(design) } : {}),
    ...(input.plan ? { plan: input.plan } : {}),
    analysis: input.analysis,
  };
}

function designSummary(design: PilotDesign): NonNullable<PilotReport['design']> {
  const conversations = design.cells.flatMap((cell) => cell.conversations);
  const available: Record<string, number> = {};
  for (const conversation of conversations) {
    const count = Math.min(conversation.available, design.options.wordings);
    available[String(count)] = (available[String(count)] ?? 0) + 1;
  }
  return {
    by: [...design.options.by],
    conversations: design.options.conversations,
    repeats: design.options.repeats,
    wordings: design.options.wordings,
    cells: design.cells.length,
    conversationsRun: conversations.length,
    variants: conversations.reduce((sum, conversation) => sum + conversation.variants.length, 0),
    wordingsAvailable: available,
    skipped: design.skipped,
    warnings: design.warnings,
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const num = (value: number, digits = 4): string => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');

/** Pads every column but the last, two spaces apart, indented by two. */
export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      `  ${row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ')}`.trimEnd(),
    )
    .join('\n');
}

/** The plan as printed by `driftbench pilot plan`. */
export function formatPilotPlan(design: PilotDesign, plan: PilotPlan): string {
  const lines: string[] = [];
  const o = design.options;
  lines.push(
    `Pilot plan: ${design.cells.length} cells by ${o.by.join(', ')}; per cell up to ${o.conversations} conversations x ${o.wordings} approved wordings x ${o.repeats} repeats.`,
  );
  const usd = (value: number | undefined) => (value === undefined ? 'not measured' : `$${value.toFixed(2)}`);
  lines.push(
    table([
      ['cell', 'conversations', 'wordings', 'runs', 'blocks', 'cost'],
      ...[...plan.cells, plan.total].map((line) => [
        line.cell,
        String(line.conversations),
        String(line.wordings),
        String(line.runs),
        String(line.blocks),
        usd(line.usd),
      ]),
    ]),
  );
  const pricing =
    plan.pricing.kind === 'measured'
      ? `priced at the measured $${plan.pricing.usdPerBlock} per block (${plan.pricing.measuredAt})`
      : plan.pricing.kind === 'in-process'
        ? 'the agent runs in process: no model call, nothing billed'
        : `no block unit is measured for the ${plan.target.adapter} adapter: measure one before a billed pilot`;
  lines.push(`Cost: ${pricing}.`);
  const summary = designSummary(design);
  const short = Object.entries(summary.wordingsAvailable)
    .filter(([count]) => Number(count) < o.wordings)
    .map(([count, n]) => `${n} with ${count}`);
  if (short.length > 0) {
    lines.push(
      `Wordings: the approved phrase bank gives fewer than ${o.wordings} wordings to some conversations (${short.join(', ')}).`,
    );
  }
  for (const skip of design.skipped) lines.push(`Skipped ${skip.spec}: ${skip.reason}.`);
  for (const warning of design.warnings) lines.push(`Note: ${warning}.`);
  return `${lines.join('\n')}\n`;
}

function levelRows(levels: readonly LevelSummary[]): string[][] {
  return levels.map((level) => [
    level.level,
    num(level.variance),
    pct(level.share),
    level.shareInterval ? `${pct(level.shareInterval.lower)} to ${pct(level.shareInterval.upper)}` : '',
    level.estimable ? '' : 'not identified (one child per group)',
  ]);
}

/** The report as printed by `driftbench pilot run` and `pilot analyse`. */
export function formatPilotReport(report: PilotReport): string {
  const a = report.analysis;
  const lines: string[] = [];
  lines.push(
    `Pilot ${report.campaignId} on ${report.target.adapter}${report.target.agent ? `:${report.target.agent}` : ''}: ${a.observations} runs${a.errored > 0 ? `, ${a.errored} did not complete and are left out` : ''}.`,
  );
  lines.push(
    `Pass rate ${pct(a.passRate.estimate)} (${pct(a.passRate.interval.lower)} to ${pct(a.passRate.interval.upper)}, Wilson on ${a.passRate.effectiveRuns.toFixed(1)} effective runs).`,
  );
  const boot = a.pooled.bootstrap;
  const drawn =
    boot.resample === 'cells'
      ? `the ${boot.cells} cells`
      : boot.resample === 'conversations'
        ? 'conversations inside each cell'
        : `the ${boot.cells} cells, then conversations inside each`;
  lines.push(
    `Where the spread comes from (pooled; 95% bootstrap interval, ${boot.iterations} draws of ${drawn}):`,
  );
  lines.push(table([['level', 'variance', 'share', 'interval', ''], ...levelRows(a.pooled.levels)]));
  lines.push(
    `Intraclass correlation: ${a.pooled.icc.map((entry) => `${entry.level} ${num(entry.icc, 3)}`).join(', ')}.`,
  );
  lines.push(
    `Design effect: ${num(a.designEffect.value, 2)} for ${num(a.designEffect.m, 1)} runs per conversation at rho ${num(a.designEffect.rho, 3)}; ${a.designEffect.note}.`,
  );
  lines.push(
    `Noise floor ${pct(a.noiseFloor.floor)}: run-to-run variance ${num(a.noiseFloor.variance)}; ${a.noiseFloor.perBlock.repeats} repeat(s) per block (floor reached ${pct(a.noiseFloor.perBlock.floor)}), ${a.noiseFloor.perCell.repeats} per block for a cell figure over ${a.noiseFloor.perCell.blocks} conversations; this pilot's repeats reach ${pct(a.noiseFloor.reached)} on one block.`,
  );
  lines.push(
    `Flip rate: ${a.flip.flipping} of ${a.flip.blocks} blocks flip between repeats; mean ${num(a.flip.mean, 3)}.`,
  );
  lines.push(
    a.wording.flagged.length > 0
      ? `Wording-sensitive cells (a conversation's pass rates span more than ${pct(a.wording.threshold)} across wordings, and the cell's wording F test holds at a false discovery rate of ${a.wording.q}): ${a.wording.flagged.join(', ')}.`
      : `No cell is wording-sensitive (a range above ${pct(a.wording.threshold)} with the cell's wording F test holding at a false discovery rate of ${a.wording.q}).`,
  );
  lines.push(`Per cell, and Neyman allocation of a pool of ${a.allocation.pool} conversations:`);
  lines.push(
    table([
      ['cell', 'conv', 'runs', 'pass', 'interval', 'wording range', 'flip', 'allocate'],
      ...a.cells.map((cell) => [
        cell.cell,
        String(cell.conversations),
        String(cell.runs),
        pct(cell.passRate),
        `${pct(cell.passInterval.lower)} to ${pct(cell.passInterval.upper)}`,
        cell.wording.maxRange === undefined
          ? `- (${cell.wording.conversations})`
          : `${pct(cell.wording.maxRange)} (${cell.wording.conversations})${cell.wording.flagged ? ' flagged' : ''}`,
        num(cell.flip.mean, 3),
        String(cell.allocation.allocated),
      ]),
    ]),
  );
  if (a.planted) {
    lines.push(
      `Control: planted shares against the estimates (${a.planted.recovered ? 'every planted share lies inside its interval' : 'NOT every planted share lies inside its interval'}):`,
    );
    lines.push(
      table([
        ['level', 'planted', 'estimate', 'interval', ''],
        ...a.planted.levels.map((level) => [
          level.level,
          pct(level.share),
          pct(level.estimate),
          level.interval ? `${pct(level.interval.lower)} to ${pct(level.interval.upper)}` : '',
          level.recovered ? 'recovered' : 'missed',
        ]),
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}
