import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approveAtoms,
  ClaudeCodeReader,
  type EstateMap,
  type PointerScanOptions,
  parseEstateMapText,
  pointer,
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
    async call(_wire, _set, window) {
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
