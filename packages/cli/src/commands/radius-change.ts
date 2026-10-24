import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { loadChangeManifest, validateSpec } from '@agent-nexus/driftbench-core';
import { EstateDiff, ImpactReport, validateEstateMap } from '@agent-nexus/driftbench-estate';
import { parse as parseYaml } from 'yaml';
import { estatePromptManifest } from './radius-estate-prompt';

/**
 * An artifact of driftbench a user can hold in a folder and pass to `radius --change` by mistake. A kind is
 * recognised by its structure alone (a schema, or the keys the command writes), never by words in the file or in
 * an error message. Adding an artifact a command writes is one entry here and one case in the matrix of
 * `outside-radius-variants.test.ts`, which fails until both exist.
 */
export type ArtifactKind = {
  /** What the artifact is called in the hint. */
  id: string;
  /** True when the parsed value has this artifact's structure. */
  is(value: unknown): boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  { id: 'estate diff', is: (value) => EstateDiff.safeParse(value).success },
  { id: 'estate impact', is: (value) => ImpactReport.safeParse(value).success },
  { id: 'estate map', is: (value) => validateEstateMap(value).ok },
  { id: 'spec', is: (value) => validateSpec(value).ok },
  // The report `radius --json` prints holds no schema of its own: it is the object with these four keys.
  {
    id: 'radius report',
    is: (value) =>
      isRecord(value) &&
      isRecord(value.manifest) &&
      Array.isArray(value.modes) &&
      Array.isArray(value.specs) &&
      isRecord(value.totals),
  },
];

/** The commands that write a change manifest, which is what a user who passed another artifact wants. */
export const CHANGE_MANIFEST_SOURCES: readonly string[] = [
  'estate diff --change-out <file> (with --old-ledger and --new-ledger), for an edit of an estate',
  'radius ledger <map>, for an edit of the estate prose read from the ledger of the last scan',
  'radius auto, for the diff of two versions of a prompt file',
  'radius sections reanchor --change-out <file>, for a prompt section',
];

/** The kind of artifact a file holds, when it holds one: the file is parsed as YAML, which reads JSON too. */
async function artifactOf(path: string): Promise<ArtifactKind | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = extname(path).toLowerCase() === '.json' ? JSON.parse(text) : parseYaml(text);
  } catch {
    return undefined;
  }
  return isRecord(value) ? ARTIFACT_KINDS.find((kind) => kind.is(value)) : undefined;
}

/**
 * All CLI consumers revalidate auto evidence before allowing an empty version transition. A file that fails as a
 * manifest and is another artifact of driftbench by its structure gets one more error: what it is, and the
 * commands a change manifest comes from.
 */
export async function loadRadiusChangeManifest(path: string) {
  const loaded = await loadManifestFile(path);
  if (loaded.ok) return loaded;
  const kind = await artifactOf(path);
  if (kind === undefined) return loaded;
  return {
    ...loaded,
    errors: [
      ...loaded.errors,
      `This file is ${/^[aeiou]/.test(kind.id) ? 'an' : 'a'} ${kind.id}, not a change manifest. A change manifest comes from one of: ${CHANGE_MANIFEST_SOURCES.join('; ')}.`,
    ],
  };
}

function loadManifestFile(path: string) {
  return loadChangeManifest(path, {
    validatePromptMap: ({ map, source, before, after }) => {
      const checked = validateEstateMap(map);
      if (!checked.ok || !checked.map.atoms.some((atom) => atom.provenance.file === source)) return false;
      return (
        estatePromptManifest(checked.map, source, before, after, { from: 'same', to: 'same' }).changes
          .length === 0
      );
    },
  });
}
