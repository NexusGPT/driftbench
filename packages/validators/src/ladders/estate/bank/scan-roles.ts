import type { RegistryRow } from '@agent-nexus/driftbench-estate';
import { GUARDS_DIR, STANDING } from '../layout';
import { type PlantedRole, plantedHeader } from '../registry-record';
import type { Check, PlantedEstate } from './planted';

/**
 * The registry-roles items of scan.registry: one planted registry table with a column for each role, its headers in French so that no
 * English word names a column, and a distinct value in each. The planter records the role of each column by its
 * position when it writes the header (registry-record.ts); the scan asks the labeller table by table and reads the
 * row by those roles. One item per role: it holds when the row field that role feeds carries the planted value.
 * A labeller that drops a role, or gives it to another column, fails the item of that role.
 */

type Role = PlantedRole;

/** The columns of the planted table, in order: the role, its French header, and the value planted in the row. */
/** An id with no digit: only the recorded id role makes it the id of the row. */
const ROW_ID = 'CONTROLE-ORAL';
/** A passage the enforces column gives in backticks, a form only the enforces column reads. */
const BACKTICKED = 'Toujours citer la source';
const PASSAGE = 'Ne jamais promettre une date de remboursement';
const DESCRIPTION = 'Contrôle les promesses faites au client';
const COLUMNS: ReadonlyArray<{ role: Role; header: string; cell: string }> = [
  { role: 'id', header: 'Identifiant', cell: ROW_ID },
  { role: 'guard', header: 'Script', cell: 'juge-reponse' },
  { role: 'event', header: 'Événement', cell: 'PreToolUse' },
  { role: 'enforces', header: 'Règles', cell: `R1, \`${BACKTICKED}\`` },
  { role: 'watches', header: 'Quand', cell: `“${PASSAGE}”` },
  { role: 'verdict', header: 'Sortie', cell: 'deny' },
  { role: 'state', header: 'Phase', cell: 'actif' },
  { role: 'description', header: 'Sens', cell: DESCRIPTION },
];

const ITEMS: Array<{ role: Role; title: string }> = [
  { role: 'id', title: 'the id column names the check' },
  { role: 'guard', title: 'the guard column names the guard the row records' },
  { role: 'event', title: 'the event column gives the row its event' },
  { role: 'enforces', title: 'the enforces column gives the row its rule labels' },
  { role: 'watches', title: 'the watches column gives the row the passages it quotes' },
  { role: 'verdict', title: 'the verdict column gives the row its verdict' },
  { role: 'state', title: 'the state column gives the row its state' },
  { role: 'description', title: 'the description column gives the row its description' },
];

/** The items of the roles: one per role, keyed `role-<role>` in the family that plants the table. */
export const ROLE_ITEMS = ITEMS.map(({ role, title }) => ({
  key: `role-${role}`,
  tier: 3 as const,
  title: `the reader reads ${title}`,
}));

/** Plants the table of the roles in an estate, in a file owned by `owner`. */
export function plantRolesTable(estate: PlantedEstate, owner: string): void {
  estate
    .file(`${GUARDS_DIR}/REGISTRE.md`, owner)
    .lines_([
      '# Registre',
      '',
      plantedHeader(COLUMNS.map(({ role, header }) => [role, header] as const)),
      `|${COLUMNS.map(() => '---').join('|')}|`,
      `| ${COLUMNS.map(({ cell }) => cell).join(' | ')} |`,
    ]);
}

/** The check of one role: the row field that role feeds carries the planted value. */
export function roleCheck(role: PlantedRole): Check {
  return (scan) => {
    const row = rowOf(scan.raw.registry);
    return row === undefined ? `no row for ${ROW_ID} was read` : reads[role](row);
  };
}

const reads: Record<Role, (row: RegistryRow) => string | undefined> = {
  id: (row) => (row.id === ROW_ID ? undefined : `the id is ${row.id}`),
  guard: (row) => (row.guard === 'juge-reponse' ? undefined : `the guard is ${row.guard}`),
  event: (row) => (row.event === 'PreToolUse' ? undefined : `the event is ${String(row.event)}`),
  enforces: (row) =>
    row.enforces.some((rule) => 'id' in rule && rule.id === 'R1') &&
    row.enforces.some((rule) => 'quote' in rule && rule.quote === BACKTICKED)
      ? undefined
      : `the rule labels and backticked passages are ${JSON.stringify(row.enforces)}`,
  watches: (row) =>
    row.enforces.some((rule) => 'quote' in rule && rule.quote === PASSAGE)
      ? undefined
      : `the quoted passages are ${JSON.stringify(row.enforces)}`,
  verdict: (row) => (row.verdict === 'deny' ? undefined : `the verdict is ${String(row.verdict)}`),
  state: (row) => (row.state === 'actif' ? undefined : `the state is ${String(row.state)}`),
  description: (row) =>
    row.description?.startsWith(DESCRIPTION) ? undefined : `the description is ${String(row.description)}`,
};

function rowOf(rows: readonly RegistryRow[]): RegistryRow | undefined {
  // The row is found by the place it was read from, not by its id, so a dropped id role fails the id item alone.
  return rows.find((row) => row.at.quote.includes(ROW_ID));
}
