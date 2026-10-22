import type { CutResult, PointerSut } from '../../sut/port';

/**
 * Planted readers for the harness controls (`controls.ts`, `harness-probe.ts`). Each one is a reader that fails the
 * control honestly: it cuts nothing or cuts a marker, and scans nothing. The cheat modules next to this file add
 * the code a cheating reader would run at load; the control must still fail on them.
 */

/** What the reader of `cheat-env.ts` cuts. */
export const MARKER_PLANTED = 'planted-reader-a';
/** What the reader the cheat points the environment at cuts. */
export const MARKER_REDIRECT = 'redirected-reader-b';

function unit(text: string) {
  return {
    container: 'sentence',
    start: 0,
    end: text.length,
    text,
    fp: 'planted',
    path: [] as string[],
    opaque: false,
  };
}

/** A reader that cuts nothing, or one marker unit, and refuses every scan. */
export function brokenReader(name: string, marker?: string): PointerSut {
  const cut: CutResult = { units: marker === undefined ? [] : [unit(marker)], cutDigest: name };
  return {
    name,
    isolate: true,
    cut: async () => cut,
    scan: async () => ({ ok: false, error: 'planted reader: it scans nothing', atoms: [], diagnostics: [] }),
  };
}
