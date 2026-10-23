import { folderHolding, locateFile, type RuntimeProfile } from '@agent-nexus/driftbench-core';

/**
 * True for a file only the settings of the runtime can name: code that a part of another source runs, which no
 * folder part (a skill) holds and so no text of the estate besides the settings can point at. It is read from the
 * profile's part types: a type with the aspect `executes`, loaded `by-reference`, that locates the file by its
 * place, when no folder part holds the file. Without the settings the estate cannot say who names such a file.
 */
export function namedOnlyByWiring(profile: RuntimeProfile, path: string): boolean {
  const types = profile.types.types;
  if (types.some((type) => folderHolding(type, path) !== undefined)) return false;
  return types.some(
    (type) =>
      type.shape === undefined &&
      type.aspects.includes('executes') &&
      type.loaded.when === 'by-reference' &&
      locateFile(type, path) !== undefined,
  );
}
