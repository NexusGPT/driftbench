import { type JournalRow, PILOT_ITERATIONS } from './journal';

/** The gate of docs/validators.md section 12.4: the forecast is at least this, the pilot score at most that. */
export const HARDNESS_MIN_FORECAST = 100;
export const HARDNESS_MAX_SCORE = 0.4;
/** Section 12.4 point 4: distinct causes among the failing items after the pilot. */
export const HARDNESS_MIN_CAUSES = 100;
/** The bank minimum at merge of section 12.1. */
export const BANK_MIN_SIZE = 300;
export const BANK_MIN_FAMILY = 20;

export type Hardness = {
  /** The bank of the latest row: size, items per family and tier, failing items per family. */
  bank: {
    iteration: number;
    size: number;
    passing: number;
    byFamilyTier: Record<string, Record<string, number>>;
    failingByFamily: Record<string, number>;
  };
  iteration0: { bankSize: number; passing: number; score: number };
  pilot: {
    /** Pilot rows present, iterations 1 to 10. */
    iterations: number;
    complete: boolean;
    /** The last pilot row: its bank and score. Null before the first pilot row. */
    end: { iteration: number; bankSize: number; passing: number; score: number } | null;
  };
  /** Mean items fixed per pilot iteration: (passing at the pilot's end minus at iteration 0) / pilot rows. */
  fixedPerIteration: number | null;
  /** Failing items at the end of the pilot. */
  remaining: number | null;
  /** Iterations to 100 percent: remaining / fixedPerIteration; null when the pilot fixed nothing. */
  forecast: number | null;
  /**
   * Distinct causes among the failing items at the end of the pilot, and how many of those items name no cause
   * (each counts as its own). Null when the row does not record them.
   */
  causes: { distinct: number; withoutCause: number | null } | null;
  gate: { holds: boolean; reasons: string[] };
  bankMinimum: { holds: boolean; problems: string[] };
};

/**
 * The hardness measurement from a journal whose first row is iteration 0 (section 12.4). Throws when the
 * journal has no iteration 0 row.
 */
export function measureHardness(rows: readonly JournalRow[]): Hardness {
  const zero = rows.find((row) => row.iteration === 0);
  const latest = rows.at(-1);
  if (!zero || !latest)
    throw new RangeError('the journal holds no iteration 0 row: run and record iteration 0 first');
  const pilotRows = rows.filter((row) => row.iteration >= 1 && row.iteration <= PILOT_ITERATIONS);
  const endRow = pilotRows.at(-1);
  const score = (row: JournalRow) => (row.bankSize === 0 ? 0 : row.passing / row.bankSize);
  const end = endRow
    ? {
        iteration: endRow.iteration,
        bankSize: endRow.bankSize,
        passing: endRow.passing,
        score: score(endRow),
      }
    : null;
  const fixedPerIteration = endRow ? (endRow.passing - zero.passing) / pilotRows.length : null;
  const remaining = endRow ? endRow.bankSize - endRow.passing : null;
  const forecast =
    fixedPerIteration !== null && fixedPerIteration > 0 && remaining !== null
      ? remaining / fixedPerIteration
      : null;
  const complete = pilotRows.length === PILOT_ITERATIONS;
  const reasons: string[] = [];
  if (!complete) reasons.push(`the pilot holds ${pilotRows.length} of ${PILOT_ITERATIONS} iterations`);
  if (fixedPerIteration !== null && fixedPerIteration <= 0) {
    reasons.push('the pilot fixed nothing: the items are miswritten or the component lacks a foundation');
  }
  if (forecast !== null && forecast < HARDNESS_MIN_FORECAST) {
    reasons.push(`the forecast ${round(forecast)} is under ${HARDNESS_MIN_FORECAST}: extend the bank (12.2)`);
  }
  if (end && end.score > HARDNESS_MAX_SCORE) {
    reasons.push(`the score after the pilot ${round(end.score)} is above ${HARDNESS_MAX_SCORE}`);
  }
  const causes =
    endRow?.failingCauses !== undefined
      ? { distinct: endRow.failingCauses, withoutCause: endRow.failingWithoutCause ?? null }
      : null;
  if (endRow && !causes) reasons.push('the last pilot row records no failingCauses');
  if (causes && causes.distinct < HARDNESS_MIN_CAUSES) {
    reasons.push(
      `${causes.distinct} distinct failing causes after the pilot, under ${HARDNESS_MIN_CAUSES}: extend the bank (12.2)`,
    );
  }
  if (!end) reasons.push('no pilot row yet');
  return {
    bank: {
      iteration: latest.iteration,
      size: latest.bankSize,
      passing: latest.passing,
      byFamilyTier: latest.bankByFamilyTier ?? {},
      failingByFamily: latest.failingByFamily,
    },
    iteration0: { bankSize: zero.bankSize, passing: zero.passing, score: score(zero) },
    pilot: { iterations: pilotRows.length, complete, end },
    fixedPerIteration,
    remaining,
    forecast,
    causes,
    gate: { holds: reasons.length === 0, reasons },
    bankMinimum: bankMinimum(latest),
  };
}

function bankMinimum(row: JournalRow): Hardness['bankMinimum'] {
  const problems: string[] = [];
  if (row.bankSize < BANK_MIN_SIZE)
    problems.push(`the bank holds ${row.bankSize} items, under ${BANK_MIN_SIZE}`);
  if (!row.bankByFamilyTier) {
    problems.push('the row records no bankByFamilyTier, so family and tier sizes are unknown');
    return { holds: false, problems };
  }
  const tiers = new Set<string>();
  for (const [family, perTier] of Object.entries(row.bankByFamilyTier)) {
    const size = Object.values(perTier).reduce((sum, value) => sum + value, 0);
    if (size < BANK_MIN_FAMILY)
      problems.push(`the family ${family} holds ${size} items, under ${BANK_MIN_FAMILY}`);
    for (const [tier, value] of Object.entries(perTier)) if (value > 0) tiers.add(tier);
  }
  const missing = ['1', '2', '3', '4', '5'].filter((tier) => !tiers.has(tier));
  if (missing.length > 0) problems.push(`no item of tier ${missing.join(', ')}`);
  return { holds: problems.length === 0, problems };
}

function round(value: number): string {
  return String(Number(value.toPrecision(4)));
}

/** The measurement as text: the bank per family and tier, the scores, the forecast and the gate verdict. */
export function formatHardness(component: string, h: Hardness): string {
  let text = `Hardness of ${component} (docs/validators.md section 12.4), from validators/${component}/journal.jsonl\n`;
  text += `Bank at iteration ${h.bank.iteration}: ${h.bank.size} items, ${h.bank.passing} pass on every seed.\n`;
  const tiers = ['1', '2', '3', '4', '5', 'none'];
  const header = ['Family', ...tiers.map((tier) => `tier ${tier}`), 'items', 'failing'];
  const rows = Object.entries(h.bank.byFamilyTier)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, perTier]) => [
      family,
      ...tiers.map((tier) => String(perTier[tier] ?? 0)),
      String(Object.values(perTier).reduce((sum, value) => sum + value, 0)),
      String(h.bank.failingByFamily[family] ?? 0),
    ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (row: string[]) =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  text += `${[line(header), ...rows.map(line)].join('\n')}\n`;
  text += `Score at iteration 0: ${round(h.iteration0.score)} (${h.iteration0.passing} of ${h.iteration0.bankSize}).\n`;
  text += h.pilot.end
    ? `Score after the pilot: ${round(h.pilot.end.score)} (${h.pilot.end.passing} of ${h.pilot.end.bankSize}, iteration ${h.pilot.end.iteration}; ${h.pilot.iterations} of ${PILOT_ITERATIONS} pilot iterations).\n`
    : `Score after the pilot: none yet (0 of ${PILOT_ITERATIONS} pilot iterations).\n`;
  text +=
    h.fixedPerIteration === null
      ? 'Items fixed per iteration: none yet.\n'
      : `Items fixed per iteration: ${round(h.fixedPerIteration)} (mean over the pilot).\n`;
  text +=
    h.forecast === null
      ? `Forecast: none (${h.fixedPerIteration === null ? 'no pilot row' : 'the pilot fixed nothing'}).\n`
      : `Forecast: ${round(h.forecast)} iterations to 100 percent (${h.remaining} failing / ${round(h.fixedPerIteration ?? 0)}).\n`;
  text += !h.causes
    ? 'Distinct failing causes after the pilot: not recorded.\n'
    : `Distinct failing causes after the pilot: ${h.causes.distinct}${
        h.causes.withoutCause === null
          ? ' (the row does not say how many items name no cause)'
          : ` (${h.causes.withoutCause} failing items name no cause and count as their own)`
      }.\n`;
  text += h.gate.holds
    ? `Gate: HOLDS (forecast at least ${HARDNESS_MIN_FORECAST}, score after the pilot at most ${HARDNESS_MAX_SCORE}, at least ${HARDNESS_MIN_CAUSES} distinct failing causes).\n`
    : `Gate: NOT MET: ${h.gate.reasons.join('; ')}.\n`;
  text += h.bankMinimum.holds
    ? 'Bank minimum at merge (12.1): holds.\n'
    : `Bank minimum at merge (12.1): not met: ${h.bankMinimum.problems.join('; ')}.\n`;
  return text;
}
