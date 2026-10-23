import { type Files, type Hiding, place } from './claude-layout';
import { junkKey, specOf, type UnitKey } from './spec';

/** A setup of a seed with one part that a form may keep out, and where every unit lies. */
export type Setup = { files: Files; paths: Map<UnitKey, string>; junk: { key: UnitKey; path: string } };

/**
 * The setup of a seed (no link in other letters) with the part a form is about, and the files that keep it out
 * (or, for a control, leave it in). Without a form there is no part. `withPart: false` leaves the part out of
 * the setup but keeps the files of the form, to show that the form alone changes nothing.
 */
export function setupOf(seed: number, form: Hiding | undefined, withPart: boolean): Setup {
  const spec = specOf(seed, 0);
  const cap = spec.caps[0];
  if (!cap) throw new Error('the spec holds no capability');
  const placed = place(spec);
  const files: Files = { ...placed.files };
  const paths = new Map(placed.paths);
  const key = junkKey(cap);
  let path = 'none';
  if (form) {
    const built = form.build(cap);
    path = built.path;
    for (const [file, text] of Object.entries(built.files)) {
      if (!withPart && file === built.path) continue;
      files[file] = text;
    }
    paths.set(key, built.path);
  }
  return { files, paths, junk: { key, path } };
}
