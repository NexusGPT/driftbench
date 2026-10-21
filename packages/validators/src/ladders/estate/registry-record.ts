/**
 * The record of the registry tables the bank plants. The code that writes a table's header line names the role of
 * each column by its position, and this record keeps the role of every header cell it wrote; the planted labeller
 * answers the scan's registry-roles questions from it. A cell the planter gave no role (a column of free text)
 * has no entry and is answered `none`. No word is read: the record holds what was planted, not a vocabulary.
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

const planted = new Map<string, string>();

/** A header cell as the scan shows it to the labeller: without markup at its ends. */
const shown = (cell: string): string => cell.replace(/^[`*"]+|[`*"]+$/g, '').trim();

/**
 * The header line of a planted table. Each column is its cell text and, by its position, the role the planter
 * gives it (`null` for a column of free text). Returns the markdown line and records the roles.
 */
export function plantedHeader(columns: ReadonlyArray<readonly [PlantedRole | null, string]>): string {
  for (const [role, text] of columns) {
    if (role === null) continue;
    const label = `col-${role}`;
    const key = shown(text);
    const known = planted.get(key);
    if (known !== undefined && known !== label) {
      throw new Error(`the header cell "${key}" is planted as ${known} and as ${label}`);
    }
    planted.set(key, label);
  }
  return `| ${columns.map(([, text]) => text).join(' | ')} |`;
}

/** The label the planter recorded for a header cell, or undefined when it recorded none. */
export function plantedLabel(cell: string): string | undefined {
  return planted.get(shown(cell));
}
