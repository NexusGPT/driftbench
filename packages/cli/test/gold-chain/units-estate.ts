import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * An estate that carries its own units table (examples/estates/<name>/truth.yaml) instead of gold5 ids: the prose
 * files, the units of those files with an id each, the limits and the numbers that are not limits. The harness
 * reads it in place of gold5.json; nothing else about the estate is special.
 */
export type UnitRow = { file: string; id: string; text: string };
export type TruthLimit = {
  unit: string;
  limit: number;
  comparison: string;
  role: string;
  unit_of?: string;
  governs: string;
};
export type NonLimit = { unit: string; number: string | number; why: string };
export type UnitsTruth = { estate: string; units: UnitRow[]; limits: TruthLimit[]; nonLimits: NonLimit[] };
export type UnitsEstate = { truth: UnitsTruth; files: Array<{ path: string; text: string }> };

const COMPARISONS = new Set(['lt', 'le', 'gt', 'ge']);
const ROLES = new Set(['constraint', 'trigger']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The truth of a units-table estate, checked: a problem is named, never repaired. */
export function parseUnitsTruth(text: string): UnitsTruth {
  const raw: unknown = parseYaml(text);
  const problems: string[] = [];
  if (!isRecord(raw)) throw new Error('the truth file is not a mapping');
  const list = (key: string): Array<Record<string, unknown>> => {
    const value = raw[key];
    if (!Array.isArray(value)) {
      problems.push(`${key}: not a list`);
      return [];
    }
    return value.filter(isRecord);
  };
  const units = list('units').map((entry) => ({
    file: String(entry.file),
    id: String(entry.id),
    text: String(entry.text),
  }));
  const ids = new Set(units.map((unit) => unit.id));
  if (ids.size !== units.length) problems.push('units: an id is used twice');
  const limits = list('limits').map((entry) => ({
    unit: String(entry.unit),
    limit: Number(entry.limit),
    comparison: String(entry.comparison),
    role: String(entry.role),
    ...(entry.unit_of === undefined ? {} : { unit_of: String(entry.unit_of) }),
    governs: String(entry.governs),
  }));
  for (const limit of limits) {
    if (!ids.has(limit.unit)) problems.push(`limits: ${limit.unit} is not a unit`);
    if (!ids.has(limit.governs)) problems.push(`limits: ${limit.governs} is not a unit`);
    if (!Number.isFinite(limit.limit)) problems.push(`limits: ${limit.unit} has no number`);
    if (!COMPARISONS.has(limit.comparison)) problems.push(`limits: ${limit.unit} comparison ${limit.comparison}`);
    if (!ROLES.has(limit.role)) problems.push(`limits: ${limit.unit} role ${limit.role}`);
  }
  const nonLimits = list('non_limits').map((entry) => ({
    unit: String(entry.unit),
    number: typeof entry.number === 'number' ? entry.number : String(entry.number),
    why: String(entry.why),
  }));
  for (const entry of nonLimits) if (!ids.has(entry.unit)) problems.push(`non_limits: ${entry.unit} is not a unit`);
  if (problems.length > 0) throw new Error(`the truth file has problems:\n${problems.join('\n')}`);
  return { estate: String(raw.estate), units, limits, nonLimits };
}

/** The units table and the prose files (every .md file of the folder, in name order) of a units-table estate. */
export async function loadUnitsEstate(folder: string): Promise<UnitsEstate> {
  const truth = parseUnitsTruth(await readFile(join(folder, 'truth.yaml'), 'utf8'));
  const names = (await readdir(folder)).filter((name) => name.endsWith('.md') && name !== 'README.md').sort();
  const files = await Promise.all(
    names.map(async (path) => ({ path, text: await readFile(join(folder, path), 'utf8') })),
  );
  return { truth, files };
}
