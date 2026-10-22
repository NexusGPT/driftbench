/**
 * The label set the scan asks once for the cells of the check registries of an estate: what a column header
 * names, and which values of a state column mean a check enforces nothing. Its answer is a recorded label, so
 * a column or a state is never read from a word of the table. Labels build no atom. The role names below are the
 * only vocabulary; the words of a table are the labeler's to read, in any language.
 */
export const REGISTRY_ROLES_SET_NAME = 'registry-roles';

/** The roles a column of a registry table can have. */
export const REGISTRY_ROLES = [
  'id',
  'guard',
  'enforces',
  'watches',
  'event',
  'verdict',
  'state',
  'description',
] as const;
export type RegistryRole = (typeof REGISTRY_ROLES)[number];

/** Each column label and the role it gives. */
export const REGISTRY_ROLE_LABELS: Readonly<Record<string, RegistryRole>> = {
  'col-id': 'id',
  'col-guard': 'guard',
  'col-enforces': 'enforces',
  'col-watches': 'watches',
  'col-event': 'event',
  'col-verdict': 'verdict',
  'col-state': 'state',
  'col-description': 'description',
};

/** The label of a state value under which a check enforces nothing. */
export const STATE_OFF_LABEL = 'state-off';

/**
 * What the scan hands the registry reader: the role of each column of each registry table, by the table's file and
 * its place among the tables of that file and by the column's position, and the state values that are off. A
 * column with no role is `null`. A table is never read by the text of a cell.
 */
export type RegistryRoles = {
  tables: Array<{ file: string; index: number; roles: Array<RegistryRole | null> }>;
  /** State values, as written, under which a check enforces nothing. */
  offStates: string[];
};

/** The tables a caller may decide the roles of: where each is, and its header cells as written. */
export type RegistryTableRef = { file: string; index: number; header: string[] };

/** The roles, or a function that decides them from the tables the reader found (a labeller of the caller's own). */
export type RegistryRolesInput = RegistryRoles | ((tables: readonly RegistryTableRef[]) => RegistryRoles);

export const NO_REGISTRY_ROLES: RegistryRoles = { tables: [], offStates: [] };

export const REGISTRY_ROLES_SET = `labels:
  - set: ${REGISTRY_ROLES_SET_NAME}
    description: The header cells of the check registries of an agent's estate, and the values of their state column. One unit is one header cell or one value. Label each unit with the one label that fits it, or none.
    labels:
      - name: col-id
        description: A header cell of a column that holds the identifier of each check.
      - name: col-guard
        description: A header cell of a column that names the script, hook or adapter that runs each check.
      - name: col-enforces
        description: A header cell of a column that lists the rules each check enforces, by identifier or by quoted passage.
      - name: col-watches
        description: A header cell of a column that says in which situation each check fires, often quoting the rule it watches.
      - name: col-event
        description: A header cell of a column that names the event of the runtime on which each check runs.
      - name: col-verdict
        description: A header cell of a column that gives the verdict each check returns when it triggers.
      - name: col-state
        description: A header cell of a column that gives the rollout or enforcement state of each check.
      - name: col-description
        description: A header cell of a column that says what each check means or does, in free text.
      - name: state-off
        description: A value of a state column under which the check is switched off and enforces nothing.
`;
