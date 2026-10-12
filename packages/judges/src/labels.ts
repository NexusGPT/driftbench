import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { LabelledBlock } from './calibration';

/**
 * Writing hand labels: the file `judge calibrate --labels <dir>` reads, one YAML file per criterion named
 * after it, holding `criterion`, `labelled_by` and the labelled `blocks`. A block labelled again replaces
 * its earlier label; every other block and the file's `labelled_by` stay as they were.
 */

const CRITERION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The path of a criterion's labels file; throws on a name that is not a plain file name. */
export function labelFilePath(dir: string, criterion: string): string {
  if (!CRITERION_NAME.test(criterion) || criterion.includes('..')) {
    throw new RangeError(`not a criterion name: ${JSON.stringify(criterion)}`);
  }
  return join(dir, `${criterion}.yaml`);
}

const LooseFile = z.looseObject({
  criterion: z.string().optional(),
  labelled_by: z.string().optional(),
  blocks: z.array(LabelledBlock).optional(),
});

async function readLoose(path: string): Promise<z.infer<typeof LooseFile> | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
  const parsed = LooseFile.safeParse(parseYaml(text));
  if (!parsed.success)
    throw new Error(`${path} is not a labels file: ${parsed.error.issues[0]?.message ?? ''}`);
  return parsed.data;
}

/** The labelled blocks of a criterion, or an empty list when it has no labels file yet. */
export async function readLabelFile(dir: string, criterion: string): Promise<LabelledBlock[]> {
  return (await readLoose(labelFilePath(dir, criterion)))?.blocks ?? [];
}

/**
 * Saves one hand label: adds the block to the criterion's labels file, or replaces the block with the same
 * id. Makes the folder and the file when they do not exist; writes through a temporary file, so a reader
 * never sees half a file.
 */
export async function saveLabel(
  dir: string,
  criterion: string,
  block: LabelledBlock,
  labelledBy: string,
): Promise<void> {
  const path = labelFilePath(dir, criterion);
  const parsed = LabelledBlock.parse(block);
  // Written in the order a reader scans a labels file: the id, the verdict, why, then the evidence.
  const { id, label, note, ...rest } = parsed;
  const checked: LabelledBlock = { id, label, ...(note === undefined ? {} : { note }), ...rest };
  const held = await readLoose(path);
  const blocks = [...(held?.blocks ?? [])];
  const at = blocks.findIndex((entry) => entry.id === checked.id);
  if (at >= 0) blocks[at] = checked;
  else blocks.push(checked);
  const file = { criterion, labelled_by: held?.labelled_by ?? labelledBy, blocks };
  await mkdir(dir, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, stringifyYaml(file, { lineWidth: 0 }));
  await rename(temporary, path);
}
