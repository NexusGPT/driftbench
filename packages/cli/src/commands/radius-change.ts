import { readFile } from 'node:fs/promises';
import { loadChangeManifest } from '@agent-nexus/driftbench-core';
import { parseEstateDiff, validateEstateMap } from '@agent-nexus/driftbench-estate';
import { estatePromptManifest } from './radius-estate-prompt';

/** The line that follows the errors of a file that is an estate diff, not a change manifest. */
export const ESTATE_DIFF_AS_MANIFEST =
  'This file is an estate diff (from estate diff --out), not a change manifest. Write the manifest with estate diff --change-out, with --old-ledger and --new-ledger.';

/**
 * All CLI consumers revalidate auto evidence before allowing an empty version transition. A file that fails as a
 * manifest and is an estate diff by its structure gets one more error: where the manifest comes from.
 */
export async function loadRadiusChangeManifest(path: string) {
  const loaded = await loadRadiusManifestFile(path);
  if (loaded.ok) return loaded;
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined || !parseEstateDiff(text).ok) return loaded;
  return { ...loaded, errors: [...loaded.errors, ESTATE_DIFF_AS_MANIFEST] };
}

function loadRadiusManifestFile(path: string) {
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
