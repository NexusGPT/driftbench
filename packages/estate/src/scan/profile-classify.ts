import {
  folderHolding,
  locateFile,
  locateInside,
  type PartType,
  type RuntimeProfile,
  typeNamed,
} from '@agent-nexus/driftbench-core';
import { FILE_KINDS, type FileKind } from './reader';

/** What a reader asks of a classifier: a file's map kind, and which files beside the layout it reads. */
export type FileClassifier = {
  /** The map kind of a file the reader read, and the name of the folder part (a skill) that holds it. */
  classify(path: string, text: string): { kind: FileKind; owner?: string };
  /** True for a file beside the layout folder that the runtime loads by its place (a nested standing file). */
  besideLayout(path: string): boolean;
};

/** The structure tests a reader implements, by the shape name a type gives. */
export type ShapeTests = Readonly<Record<string, (text: string, path: string) => boolean>>;

/**
 * Classifies files by a profile's part types: the first type, in the profile's order, whose locator matches the
 * file (and whose shape the file has) gives its map kind; a file inside a folder part takes the kind of the first
 * contained type that locates it; the owner is what the folder's glob captured. Only the types of the profile's
 * own runtime with a map kind take part; a file none of them locates is `other`.
 */
export function profileClassifier(profile: RuntimeProfile, shapes: ShapeTests): FileClassifier {
  for (const [type, kind] of Object.entries(profile.mapKinds)) {
    if (!(FILE_KINDS as readonly string[]).includes(kind))
      throw new Error(`profile ${profile.name}: type ${type} maps to ${kind}, which is no file kind`);
    if (!typeNamed(profile.types, type)) throw new Error(`profile ${profile.name}: no type ${type} to map`);
  }
  for (const shape of profile.shapes)
    if (shapes[shape] === undefined)
      throw new Error(`profile ${profile.name}: no test for the shape ${shape}`);
  const kindOf = (type: PartType): FileKind | undefined =>
    profile.mapKinds[type.name] as FileKind | undefined;
  const mapped = profile.types.types.filter(
    (type) => type.runtime === profile.name && type.folder !== undefined && kindOf(type) !== undefined,
  );
  const holds = (type: PartType, text: string, path: string) =>
    type.shape === undefined || shapes[type.shape]?.(text, path) === true;
  const children = new Map(
    mapped.map((type) => [
      type.name,
      type.contains.flatMap((name) => {
        const child = typeNamed(profile.types, name);
        return child && child.runtime === profile.name && kindOf(child) !== undefined ? [child] : [];
      }),
    ]),
  );
  return {
    classify(path, text) {
      for (const type of mapped) {
        const place = locateFile(type, path);
        if (place && holds(type, text, path)) {
          const kind = kindOf(type) as FileKind;
          return place.folder !== undefined && place.match !== undefined
            ? { kind, owner: place.match }
            : { kind };
        }
        const inside = children.get(type.name) ?? [];
        if (inside.length === 0) continue;
        const holder = folderHolding(type, path);
        // The entry of a folder part is the part itself, located above.
        if (!holder || holder.inner === type.entry) continue;
        for (const child of inside) {
          if (!locateInside(child, holder.inner) || !holds(child, text, path)) continue;
          const kind = kindOf(child) as FileKind;
          return holder.match !== undefined ? { kind, owner: holder.match } : { kind };
        }
      }
      return { kind: 'other' };
    },
    besideLayout(path) {
      return mapped.some(
        (type) => type.folder === '.' && type.shape === undefined && locateFile(type, path) !== undefined,
      );
    },
  };
}
