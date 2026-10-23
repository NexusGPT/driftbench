import {
  folderHolding,
  locateFile,
  locateInside,
  type PartType,
  type ReferenceRule,
  type RuntimeProfile,
} from '@agent-nexus/driftbench-core';

/**
 * A file read as prose that no part type locates (a document a skill names, outside the layout) points at other
 * files by path, as any prose does.
 */
export const DEFAULT_RULES: readonly ReferenceRule[] = [{ by: 'path' }];

/**
 * The part type of a file: the first type of the profile's runtime, in the profile's order, that locates it. A file
 * inside a folder part (a skill) takes the first contained type that locates it. The files are classified the way
 * the reader classifies them for the map, over every type and not only the mapped ones.
 */
export function typeOfFile(profile: RuntimeProfile, path: string): PartType | undefined {
  const owned = profile.types.types.filter((type) => type.runtime === profile.name);
  for (const type of owned) {
    if (locateFile(type, path)) return type;
    if (type.contains.length === 0) continue;
    const holder = folderHolding(type, path);
    if (!holder || holder.inner === type.entry) continue;
    for (const name of type.contains) {
      const child = owned.find((entry) => entry.name === name);
      if (child && locateInside(child, holder.inner)) return child;
    }
  }
  return undefined;
}

/** The reference rules that apply to a file: its type's, else the default. */
export function referenceRulesOf(profile: RuntimeProfile, path: string): readonly ReferenceRule[] {
  const type = typeOfFile(profile, path);
  return type ? type.references : DEFAULT_RULES;
}
