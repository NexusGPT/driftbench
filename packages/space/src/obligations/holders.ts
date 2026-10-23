import { type ObligationKind, RULINGS, type Rulings } from './rulings';

/**
 * Who holds the obligations of a suite, by the rulings (see `RULINGS`). The interpreter reads a suite as plain data,
 * so the generator validator can hand it the blocks it measured and the generator can hand it the specs it wrote.
 * It reads no agent, no file and no clock.
 */

/** One block of a suite, with the marks the obligations are made of. */
export type ObligationBlock = {
  /** Names the block in the suite. `soleHolders` returns these keys. */
  key: string;
  /** True for a block that injects a deviation class. */
  injected: boolean;
  /** The class the block injects, when it records one. */
  deviation?: string;
  /** The classes of the declared perturbations that reach the block: those declared at or after it. */
  perturbed: readonly string[];
  /** What makes the block the same test as another, as its caller reads it. `SuiteIndex` looks blocks up by it. */
  test?: string;
};

/** One spec of a suite. The fields before `blocks` are the same for every block of the spec. */
export type ObligationSpec = {
  spec: string;
  /** The path the spec walks, '' when it records none. */
  path: string;
  /** What the whole walk of the spec says apart from who it is written for: twins share it. */
  walk: string;
  /** The channel the spec is written for, '' when it names none. */
  channel: string;
  /** The persona tags the spec is written for, joined with a comma, '' when it names none. */
  persona: string;
  /** The metamorphic family of the spec, '' when it is none. */
  family: string;
  /** The number of the variant inside its family, 0 when the spec is none. */
  variant: number;
  /** The size the spec declares for its family, 0 when the spec is none. */
  of: number;
  /** What the spec says apart from its labels. */
  words: string;
  blocks: readonly ObligationBlock[];
  /** The ids of the validity rules this shape of the spec breaks, as its caller found them. */
  broken?: readonly string[];
};

/** The channels and personas the map declares. A persona is written `persona:<id>`, as the spec tags it. */
export type DeclaredAxes = {
  channels: ReadonlySet<string>;
  personas: ReadonlySet<string>;
};

/** The blocks and the specs a suite keeps because each is the sole holder of an obligation. */
export type SoleHolders = {
  blocks: Set<string>;
  specs: Set<string>;
};

/** True when the channel and the persona are named by the map, or empty. A spec on any other axis holds nothing. */
export function isDeclared(subject: { channel: string; persona: string }, declared: DeclaredAxes): boolean {
  return (
    (subject.channel === '' || declared.channels.has(subject.channel)) &&
    (subject.persona === '' || declared.personas.has(subject.persona))
  );
}

/** The kinds of obligation that a spec holds by a key. */
export type HolderKind = Extract<ObligationKind, { keptWhen: unknown }>;
type TwinKind = Extract<ObligationKind, { id: 'twin' }>;

/** A key a spec holds, and the blocks of the spec that hold it. */
export type Held = { key: string; kind: HolderKind; blocks: ReadonlySet<string> };

/**
 * The keys one spec holds. A spec on a channel or a persona the map does not declare holds none. A metamorphic
 * obligation rests on content, not on the labels a spec declares: a variant in range (1 <= variant <= of) whose words
 * are said by this spec on the walk of the path.
 */
export function heldKeys(one: ObligationSpec, declared: DeclaredAxes, rulings: Rulings = RULINGS): Held[] {
  if (!isDeclared(one, declared)) return [];
  const kinds = new Map<HolderKind['id'], HolderKind>();
  for (const kind of rulings.obligations) {
    if (kind.id !== 'twin') kinds.set(kind.id, kind);
  }
  const found = new Map<string, { kind: HolderKind; blocks: Set<string> }>();
  const hold = (kind: HolderKind, key: string, block?: string): void => {
    const entry = found.get(key) ?? { kind, blocks: new Set<string>() };
    if (block !== undefined) entry.blocks.add(block);
    found.set(key, entry);
  };
  const family = kinds.get('family');
  const probe = kinds.get('probe');
  const perturb = kinds.get('perturb');
  if (family && one.family !== '' && one.variant >= 1 && one.variant <= one.of)
    hold(family, `family|${one.path}|${one.walk}|${one.words}`);
  for (const block of one.blocks) {
    if (probe && block.injected) {
      const cls = block.deviation ?? 'injection';
      hold(probe, `inject|${one.path}|${cls}`, block.key);
    }
    if (perturb) {
      for (const cls of block.perturbed) hold(perturb, `perturb|${one.path}|${cls}`, block.key);
    }
  }
  return [...found].map(([key, { kind, blocks }]) => ({ key, kind, blocks }));
}

const bothIn = (values: ReadonlySet<string>, one: string, two: string): boolean =>
  values.has(one) && values.has(two);

/**
 * The twin pairs of a suite: two specs that write the same walk and differ in the value of one axis alone (the channel
 * with the persona equal, the persona with the channel equal), both values declared by the map. The key is
 * `<path>|<axis>`. The specs are the ones a map declares; the caller leaves the others out.
 */
export function twinPairs(
  heads: readonly ObligationSpec[],
  declared: DeclaredAxes,
  rulings: Rulings = RULINGS,
): Map<string, Array<[string, string]>> {
  const pairs = new Map<string, Array<[string, string]>>();
  const twin = rulings.obligations.find((kind): kind is TwinKind => kind.id === 'twin');
  if (!twin) return pairs;
  const axes = new Set<string>(twin.axes);
  for (const [index, one] of heads.entries()) {
    for (const two of heads.slice(index + 1)) {
      if (one.path !== two.path || one.walk !== two.walk) continue;
      const sameChannel = one.channel === two.channel;
      const samePersona = one.persona === two.persona;
      const channelsOk = !twin.onlyDeclared || bothIn(declared.channels, one.channel, two.channel);
      const personasOk = !twin.onlyDeclared || bothIn(declared.personas, one.persona, two.persona);
      const found: string[] = [];
      if (axes.has('channel') && !sameChannel && samePersona && channelsOk) found.push('channel');
      if (axes.has('persona') && !samePersona && sameChannel && personasOk) found.push('persona');
      for (const axis of found) {
        const key = `${one.path}|${axis}`;
        pairs.set(key, [...(pairs.get(key) ?? []), [one.spec, two.spec]]);
      }
    }
  }
  return pairs;
}

/**
 * The blocks and specs the suite keeps. Every obligation is collected with ALL its holders first. A holder is kept
 * when removing it would leave the obligation with no holder, so the answer does not depend on the order the suite
 * lists its specs in. A spec is a holder only when the map declares its channel and its persona.
 */
export function soleHolders(
  specs: readonly ObligationSpec[],
  declared: DeclaredAxes,
  rulings: Rulings = RULINGS,
): SoleHolders {
  const carried = new Map<string, { kind: HolderKind; holders: Map<string, ReadonlySet<string>> }>();
  for (const one of specs) {
    for (const held of heldKeys(one, declared, rulings)) {
      const entry = carried.get(held.key) ?? { kind: held.kind, holders: new Map() };
      entry.holders.set(one.spec, held.blocks);
      carried.set(held.key, entry);
    }
  }
  const blocks = new Set<string>();
  const kept = new Set<string>();
  for (const { kind, holders } of carried.values()) {
    if (kind.keptWhen === 'sole-holder' && holders.size !== 1) continue;
    for (const [spec, keys] of holders) {
      if (kind.id === 'family') kept.add(spec);
      else for (const key of keys) blocks.add(key);
    }
  }
  // Removing a spec drops the pair obligation of a path and axis below one holder only when the spec belongs to every
  // pair of it. With one pair, both members are protected; where a spec has two partners, it is the shared one.
  const heads = specs.filter((one) => isDeclared(one, declared));
  for (const list of twinPairs(heads, declared, rulings).values()) {
    for (const spec of new Set(list.flat())) {
      if (list.every((pair) => pair.includes(spec))) kept.add(spec);
    }
  }
  return { blocks, specs: kept };
}
