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
export type NonLimit = { unit: string; number: string; why: string };
export type UnitsTruth = { estate: string; units: UnitRow[]; limits: TruthLimit[]; nonLimits: NonLimit[] };
export type UnitsEstate = { truth: UnitsTruth; files: Array<{ path: string; text: string }> };

const COMPARISONS = new Set(['lt', 'le', 'gt', 'ge']);
const ROLES = new Set(['constraint', 'trigger']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The truth of a units-table estate, checked. Every bad entry is named by its list and position, never dropped and
 * never turned into the text "undefined": an entry that is not a mapping, or that lacks a field, is a problem.
 */
export function parseUnitsTruth(text: string): UnitsTruth {
  // Every scalar stays a string: an id such as 9651728e54 is a number in the default schema. Numbers go through Number().
  const raw: unknown = parseYaml(text, { schema: 'failsafe' });
  const problems: string[] = [];
  if (!isRecord(raw)) throw new Error('the truth file is not a mapping');
  const field = (entry: Record<string, unknown>, where: string, key: string): string => {
    const value = entry[key];
    if (typeof value !== 'string' || value === '') {
      problems.push(`${where}: no ${key}`);
      return '';
    }
    return value;
  };
  const rows = (key: string): Array<[string, Record<string, unknown>]> => {
    const value = raw[key];
    if (!Array.isArray(value)) {
      problems.push(`${key}: not a list`);
      return [];
    }
    const out: Array<[string, Record<string, unknown>]> = [];
    value.forEach((entry: unknown, at: number) => {
      const where = `${key}[${at}]`;
      if (isRecord(entry)) out.push([where, entry]);
      else problems.push(`${where}: not a mapping`);
    });
    return out;
  };
  const units = rows('units').map(([where, entry]) => ({
    file: field(entry, where, 'file'),
    id: field(entry, where, 'id'),
    text: field(entry, where, 'text'),
  }));
  const ids = new Set(units.map((unit) => unit.id));
  if (ids.size !== units.length) problems.push('units: an id is used twice');
  const limits = rows('limits').map(([where, entry]) => ({
    where,
    unit: field(entry, where, 'unit'),
    limit: Number(field(entry, where, 'limit')),
    comparison: field(entry, where, 'comparison'),
    role: field(entry, where, 'role'),
    ...(typeof entry.unit_of === 'string' ? { unit_of: entry.unit_of } : {}),
    governs: field(entry, where, 'governs'),
  }));
  for (const limit of limits) {
    const at = `${limit.where} (${limit.unit})`;
    if (limit.unit !== '' && !ids.has(limit.unit)) problems.push(`${at}: ${limit.unit} is not a unit`);
    if (limit.governs !== '' && !ids.has(limit.governs))
      problems.push(`${at}: ${limit.governs} is not a unit`);
    if (limit.unit !== '' && !Number.isFinite(limit.limit)) problems.push(`${at}: the limit is not a number`);
    if (limit.comparison !== '' && !COMPARISONS.has(limit.comparison))
      problems.push(`${at}: comparison ${limit.comparison}`);
    if (limit.role !== '' && !ROLES.has(limit.role)) problems.push(`${at}: role ${limit.role}`);
  }
  const nonLimits = rows('non_limits').map(([where, entry]) => ({
    where,
    unit: field(entry, where, 'unit'),
    number: field(entry, where, 'number'),
    why: field(entry, where, 'why'),
  }));
  for (const entry of nonLimits)
    if (entry.unit !== '' && !ids.has(entry.unit))
      problems.push(`${entry.where}: ${entry.unit} is not a unit`);
  if (problems.length > 0) throw new Error(`the truth file has problems:\n${problems.join('\n')}`);
  return {
    estate: field(raw, 'the file', 'estate'),
    units,
    limits: limits.map(({ where: _where, ...limit }) => limit),
    nonLimits: nonLimits.map(({ where: _where, ...entry }) => entry),
  };
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
