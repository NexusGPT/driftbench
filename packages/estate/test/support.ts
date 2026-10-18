import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeReader, type PointerScanOptions, pointer, scanEstate } from '../src/index';
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
 * `cassette.jsonl` beside the estate. No network and no key.
 */
export async function replayPointer(root: string): Promise<PointerScanOptions> {
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
  return { sets: sets.sets, labelling: built.labelling, cassette, mode: 'replay' };
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
export function structurePointer(): PointerScanOptions {
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
        labels: window.units.map((unit) => ({
          units: String(unit.n),
          // A standing import line is loaded by the runtime and read by nobody: it is no reference.
          label: namedPaths(unit.text).length > 0 && !/^@\S+$/.test(unit.text.trim()) ? 'reference' : 'none',
        })),
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
