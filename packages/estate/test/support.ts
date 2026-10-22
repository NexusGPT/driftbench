import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRegistryRoles,
  approveAtoms,
  ClaudeCodeReader,
  type EstateMap,
  type PointerScanOptions,
  parseEstateMapText,
  pointer,
  type RawEstate,
  type RegistryRole,
  type RegistryRolesInput,
  renderEstateMap,
  scanEstate,
} from '../src/index';
import { namedPaths } from '../src/scan/code';

/** The hand-written Northwind fixture estate. */
export const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));
export const NOW = () => new Date('2026-10-11T00:00:00.000Z');

/** Writes a small estate to a temporary folder: a map of relative paths to file contents. */
export async function estate(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/**
 * The pointer reader of an example estate: the shipped label set and the default stack, answering from the
 * `cassette.jsonl` beside the estate. With a ledger, the units it holds keep their labels and only the others
 * come from the cassette. No network and no key.
 */
export async function replayPointer(root: string, ledger?: string): Promise<PointerScanOptions> {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const specs = pointer.DEFAULT_LABELER_SPECS.map((text) => {
    const spec = pointer.parseLabelerSpec(text);
    if (!spec.ok) throw new Error(spec.message);
    return spec.spec;
  });
  const built = await pointer.buildLabelling(specs, { env: {}, record: false, cwd: root });
  if (!built.ok) throw new Error(built.message);
  const cassette = pointer.Cassette.parse(await readFile(join(root, 'cassette.jsonl'), 'utf8'));
  const previous = ledger ? pointer.parseLedger(await readFile(ledger, 'utf8')) : undefined;
  if (ledger && !previous) throw new Error(`${ledger} is not a ledger`);
  return {
    sets: sets.sets,
    labelling: built.labelling,
    cassette,
    mode: 'replay',
    ...(previous ? { previous } : {}),
  };
}

/** The fixture scanned with its recorded labels, as the committed map was. */
export async function scanFixture() {
  return scanEstate({
    root: FIXTURE,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: await replayPointer(FIXTURE),
  });
}

/** A map with every atom approved, as a person who read each one would have it. */
export function approvedAll(map: EstateMap): EstateMap {
  const approved = approveAtoms(renderEstateMap(map), { all: true });
  if (!approved.ok) throw new Error(JSON.stringify(approved.errors));
  const parsed = parseEstateMapText(approved.text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.map;
}

/** One answer of the prose contract, as JSON text. */
export function answer(chunk: string, atoms: unknown[]): string {
  return JSON.stringify({ chunk, atoms });
}

/**
 * A pointer reader for tests of how the scan finds, resolves and ignores the files a prose names: a planted
 * system 2 labeller that calls a unit a reference exactly when it names a path (a code span, a link, a quoted
 * file name, a wiki link, an import). The meaning of the sentence is not read; what the scan does with the path is
 * the thing under test.
 */
export type PlantedGate = {
  /** A unit that holds this text is a gate. */
  contains: string;
  /** The words of the act the read comes before, as the unit gives them. */
  act: string;
  /** The tool that act uses. */
  tool: string;
};

/**
 * The same planted labeller, with units it calls a gate: for the tests of what the plan does with a gate, where the
 * sentence that makes the gate is not the thing under test.
 */
export function structurePointer(gates: readonly PlantedGate[] = []): PointerScanOptions {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const labeler: pointer.Labeler = {
    id: 'structure',
    cls: 'system2',
    family: 'test',
    model: 'structure-1',
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: 'structure',
      body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
    }),
    opinions: pointer.denseOpinions,
    async call(_wire, set, window) {
      if (set.set === pointer.REGISTRY_ROLES_SET_NAME) {
        return {
          labels: window.units.map((unit) => ({
            units: String(unit.n),
            label: handRoleLabel(unit.text.replace(/^[-*]\s+/, '')),
          })),
          returnedModel: 'structure-1',
          stopReason: 'end_turn',
          usage: { input: 0, output: 0 },
        };
      }
      return {
        labels: window.units.map((unit) => {
          const gate = gates.find((entry) => unit.text.includes(entry.contains));
          const from = gate ? unit.text.indexOf(gate.act) : -1;
          if (gate && from >= 0) {
            return {
              units: String(unit.n),
              label: 'gate',
              spans: [{ kind: 'governed-action', from, to: from + gate.act.length }],
              links: [{ kind: 'act-tool', to: gate.tool }],
            };
          }
          return {
            units: String(unit.n),
            // A standing import line is loaded by the runtime and read by nobody: it is no reference. A unit that
            // is one bare token (a front matter value such as a helper's name) names nothing for the reader to
            // read: a labeller that reads the sentence gives it no reference either.
            label:
              namedPaths(unit.text).length > 0 &&
              !/^@\S+$/.test(unit.text.trim()) &&
              !/^[\w.-]+$/.test(unit.text.trim())
                ? 'reference'
                : 'none',
          };
        }),
        returnedModel: 'structure-1',
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
      };
    },
  };
  return {
    sets: sets.sets,
    labelling: pointer.singleLabelling(labeler),
    cassette: new pointer.Cassette(),
    mode: 'record',
  };
}

/**
 * The labels of the registry tables of the test estates, written by hand: the header cells and the off states the
 * fixtures use, each with the role a labeller would record for it. The reader knows none of these words; a test
 * that names a column here is the one that says what the column is.
 */
const HAND_WORDS: Record<RegistryRole, string[]> = {
  id: ['id', 'check id', 'code'],
  guard: [
    'guard',
    'guards',
    'script',
    'scripts',
    'check',
    'checks',
    'hook',
    'hooks',
    'adapter',
    'adapters',
    'handler',
    'handlers',
    'run',
    'runs',
  ],
  enforces: ['enforces', 'enforced rules', 'rule', 'rules', 'rule ids', 'gates', 'covers'],
  watches: ['fires when', 'fires on', 'watches', 'watch', 'trigger', 'triggers'],
  event: ['event', 'events'],
  verdict: ['verdict', 'mode'],
  state: ['rollout', 'status', 'state', 'enforcement'],
  description: [
    'description',
    'meaning',
    'purpose',
    'summary',
    'what it checks',
    'what it does',
    'check description',
  ],
};

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
/** The role a test gives a header cell, by the words of its own estate. The reader never sees this table. */
const HAND_COLUMNS: Readonly<Record<string, RegistryRole>> = Object.fromEntries(
  (Object.entries(HAND_WORDS) as Array<[RegistryRole, string[]]>).flatMap(([role, words]) =>
    words.flatMap((word) => [word, capitalised(word), word.toUpperCase()].map((key) => [key, role])),
  ),
);
const HAND_OFF_STATES = ['off', 'disabled', 'retired', 'removed', 'dead'];
const stripCell = (cell: string) => cell.replace(/^[`*"]+|[`*"]+$/g, '').trim();

/** The hand-written roles of a test: decided for each table from its header cells, recorded per table. */
export const HAND_ROLES: RegistryRolesInput = (tables) => ({
  tables: tables.map((table) => ({
    file: table.file,
    index: table.index,
    roles: table.header.map((cell) => HAND_COLUMNS[stripCell(cell)] ?? null),
  })),
  offStates: HAND_OFF_STATES,
});

/** What a labeller records for a cell of the registry-roles questions, from the hand-written table above. */
export function handRoleLabel(cell: string): string {
  const role = HAND_COLUMNS[cell.trim()];
  if (role !== undefined) return `col-${role}`;
  return HAND_OFF_STATES.includes(cell.trim()) ? 'state-off' : 'none';
}

/** The reader's raw estate with the hand-written registry roles applied, as a scan with a labeller gives it. */
export async function readRaw(root: string, reader = new ClaudeCodeReader()): Promise<RawEstate> {
  const raw = await reader.read(root);
  applyRegistryRoles(raw, HAND_ROLES);
  return raw;
}
