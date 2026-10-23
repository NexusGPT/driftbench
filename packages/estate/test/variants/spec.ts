/**
 * The spec of an agent setup over units and links, and the oracle that says what a reader must find in it. No
 * path, no file name and no layout is named here: a spec speaks of an instruction, capabilities (parts the
 * instruction routes to, that instruct), and references (parts a capability references). The names are
 * invented. The expected values come from the rules of the docs (a link names its target exactly; a part kept
 * out of the setup is not part of it), never from what the product printed.
 */

export type Spelling = 'lower' | 'upper' | 'title';
export const SPELLINGS: readonly Spelling[] = ['lower', 'upper', 'title'];

/** A reference: a part a capability can point at. `stem` is lower case letters and unique in the setup. */
export type RefUnit = { stem: string; stored: Spelling };
/** A `references` link from a capability to a reference, written in a spelling that may differ from the stored one. */
export type Link = { ref: string; written: Spelling };
/** A capability: a part the instruction routes to, with its links. */
export type CapUnit = { name: string; refs: RefUnit[]; links: Link[] };
export type Spec = { caps: CapUnit[] };

/** The key of a part, the same in every layout. */
export type UnitKey = string;
export const capKey = (cap: CapUnit): UnitKey => `capability:${cap.name}`;
export const refKey = (cap: CapUnit, ref: RefUnit): UnitKey =>
  `reference:${cap.name}:${ref.stem}:${ref.stored}`;
export const junkKey = (cap: CapUnit): UnitKey => `junk:${cap.name}`;

const WORDS = [
  'harbor',
  'lantern',
  'meadow',
  'quarry',
  'thimble',
  'willow',
  'cobalt',
  'saffron',
  'tundra',
  'marmot',
  'bramble',
  'gantry',
  'sextant',
  'ferrule',
  'windlass',
  'capstan',
] as const;

/** A seeded generator of numbers in [0, 1): the same seed gives the same spec. */
export function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function spell(stem: string, spelling: Spelling): string {
  if (spelling === 'upper') return stem.toUpperCase();
  if (spelling === 'title') return stem.charAt(0).toUpperCase() + stem.slice(1);
  return stem;
}

/** Names no two units share, even in other letters: the words are lower case and each is used once. */
function names(random: () => number, count: number, taken: Set<string>): string[] {
  const out: string[] = [];
  while (out.length < count) {
    const word = `${WORDS[Math.floor(random() * WORDS.length)]}${WORDS[Math.floor(random() * WORDS.length)]}`;
    if (taken.has(word)) continue;
    taken.add(word);
    out.push(word);
  }
  return out;
}

/**
 * The spec of a seed. `mismatch` is the share of links written in other letters than the reference is stored
 * in: 0 gives a setup whose every link is exact, 1 one whose every link is spelled otherwise.
 */
export function specOf(seed: number, mismatch = 0.4): Spec {
  const random = rng(seed);
  const taken = new Set<string>();
  const caps = names(random, 1 + Math.floor(random() * 3), taken).map((name): CapUnit => {
    const refs = names(random, Math.floor(random() * 4), taken).map(
      (stem): RefUnit => ({ stem, stored: SPELLINGS[Math.floor(random() * 3)] ?? 'lower' }),
    );
    const links = refs.map((ref): Link => {
      const other = SPELLINGS.filter((spelling) => spelling !== ref.stored);
      const differs = random() < mismatch;
      return { ref: ref.stem, written: differs ? (other[Math.floor(random() * 2)] ?? 'lower') : ref.stored };
    });
    return { name, refs, links };
  });
  return { caps };
}

/** The matrix: several seeds along three mismatch shares, so the shape of one setup is never the only one. */
export const MATRIX: Array<{ seed: number; mismatch: number }> = [0, 0.4, 1].flatMap((mismatch) =>
  [1, 2, 3, 4, 5, 6].map((seed) => ({ seed: seed * 7 + Math.round(mismatch * 10), mismatch })),
);

/** The same spec with every link written as its reference is stored. */
export function exactLinks(spec: Spec): Spec {
  return {
    caps: spec.caps.map((cap) => ({
      ...cap,
      links: cap.links.map((link) => ({
        ...link,
        written: cap.refs.find((ref) => ref.stem === link.ref)?.stored ?? link.written,
      })),
    })),
  };
}

export type Expected = {
  /** `references` links whose target is the part of that exact name: they resolve. */
  resolved: number;
  /** Links written in other letters: they name no part, so each is an unresolved link. */
  unresolved: number;
  /** References no resolved link points at: nothing includes or references them. */
  orphans: number;
};

export function expectedOf(spec: Spec): Expected {
  let resolved = 0;
  let unresolved = 0;
  let orphans = 0;
  for (const cap of spec.caps) {
    for (const link of cap.links) {
      const ref = cap.refs.find((candidate) => candidate.stem === link.ref);
      if (ref && ref.stored === link.written) resolved += 1;
      else unresolved += 1;
    }
    for (const ref of cap.refs) {
      if (!cap.links.some((link) => link.ref === ref.stem && link.written === ref.stored)) orphans += 1;
    }
  }
  return { resolved, unresolved, orphans };
}
