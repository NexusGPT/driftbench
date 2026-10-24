/**
 * The record of the registry tables the bank plants. The code that writes a table's header line names the role of
 * each column by its position, and this record keeps those roles under the header line it wrote. The planted
 * labeller answers the scan's registry-roles questions from it: the scan asks one table at a time (its header
 * line number and file are in the path of the question) and a unit's answer is the role at that column position.
 * A column the planter gave no role (free text) has none and is answered `none`. No word of a cell is read.
 *
 * The off states are the values the planter wrote as the state under which a check enforces nothing.
 */
export type PlantedRole =
  | 'id'
  | 'guard'
  | 'enforces'
  | 'watches'
  | 'event'
  | 'verdict'
  | 'state'
  | 'description';

const tables = new Map<string, Array<PlantedRole | null>>();
const offStates = new Set<string>();

/**
 * The header line of a planted table. Each column is its cell text and, by its position, the role the planter
 * gives it (`null` for a column of free text). Returns the markdown line and records the roles under it.
 */
export function plantedHeader(columns: ReadonlyArray<readonly [PlantedRole | null, string]>): string {
  const line = `| ${columns.map(([, text]) => text).join(' | ')} |`;
  const roles = columns.map(([role]) => role);
  const known = tables.get(line);
  if (known !== undefined && JSON.stringify(known) !== JSON.stringify(roles)) {
    throw new Error(`the header line ${line} is planted with two different column roles`);
  }
  tables.set(line, roles);
  return line;
}

/** A state value the planter wrote as one under which a check enforces nothing; returns it unchanged. */
export function plantedOffState(value: string): string {
  offStates.add(value);
  return value;
}

/** The label of the column at `position` in the planted table whose header line is `line`, if one was planted. */
export function plantedColumn(line: string, position: number): string | undefined {
  const role = tables.get(line)?.[position];
  return role === undefined || role === null ? undefined : `col-${role}`;
}

/** Whether the planter wrote the value as an off state. */
export function plantedIsOff(value: string): boolean {
  return offStates.has(value);
}
