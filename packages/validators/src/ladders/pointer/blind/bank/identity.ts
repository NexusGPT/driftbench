import { type BankItem, type Json, type Probe, type Tier, token } from './types';

/**
 * The hash algorithm and tuple encoding are not specified by the design. These
 * probes compare raw fingerprints/ids, never guessed hash bytes. Representative
 * samples are harness witnesses only, not outputs supplied to the reader.
 */
function fingerprintObservation(actual: unknown): unknown {
  if (
    !Array.isArray(actual) ||
    actual.length !== 2 ||
    !actual.every((value) => typeof value === 'string' && value.length > 0)
  )
    return null;
  return { equal: actual[0] === actual[1] };
}

function fingerprints(left: string, right: string, equal: boolean, container = 'sentence'): Probe {
  return {
    request: {
      operation: 'fingerprint',
      input: {
        units: [
          { text: left, container },
          { text: right, container },
        ],
      },
    },
    expected: { equal },
    observe: fingerprintObservation,
    sample: equal
      ? ['opaque-fingerprint-a', 'opaque-fingerprint-a']
      : ['opaque-fingerprint-a', 'opaque-fingerprint-b'],
  };
}

type FingerprintCase = {
  name: string;
  cause: string;
  tier: Tier;
  container?: string;
  pair: (text: string) => [string, string];
  equal: boolean;
};

const fingerprintCases: FingerprintCase[] = [
  {
    name: 'nfc-acute',
    cause: 'normalise-nfc',
    tier: 1,
    pair: (s) => [`${s} é`, `${s} e\u0301`],
    equal: true,
  },
  {
    name: 'spaces',
    cause: 'collapse-whitespace',
    tier: 1,
    pair: (s) => [`${s} stays here`, `${s}  stays   here`],
    equal: true,
  },
  {
    name: 'tabs',
    cause: 'collapse-whitespace',
    tier: 1,
    pair: (s) => [`${s} stays here`, `${s}\tstays\there`],
    equal: true,
  },
  {
    name: 'case',
    cause: 'preserve-case',
    tier: 1,
    pair: (s) => [`${s} Return`, `${s} RETURN`],
    equal: false,
  },
  {
    name: 'lf-wrap',
    cause: 'collapse-whitespace',
    tier: 2,
    pair: (s) => [`${s} stays here`, `${s}\nstays\nhere`],
    equal: true,
  },
  {
    name: 'crlf-wrap',
    cause: 'collapse-whitespace',
    tier: 2,
    pair: (s) => [`${s} stays here`, `${s}\r\nstays\r\nhere`],
    equal: true,
  },
  {
    name: 'nonbreaking-space',
    cause: 'collapse-whitespace',
    tier: 2,
    pair: (s) => [`${s} stays here`, `${s}\u00a0stays\u00a0here`],
    equal: true,
  },
  {
    name: 'bold',
    cause: 'preserve-emphasis',
    tier: 2,
    pair: (s) => [`${s} stays here`, `**${s} stays here**`],
    equal: false,
  },
  {
    name: 'nfc-hangul',
    cause: 'normalise-nfc',
    tier: 3,
    pair: (s) => [`${s} 가`, `${s} \u1100\u1161`],
    equal: true,
  },
  {
    name: 'bullet-swap',
    cause: 'strip-container-markers',
    tier: 3,
    container: 'list_item',
    pair: (s) => [`- ${s} stays here`, `+ ${s} stays here`],
    equal: true,
  },
  {
    name: 'ordered-renumber',
    cause: 'strip-container-markers',
    tier: 3,
    container: 'list_item',
    pair: (s) => [`3. ${s} stays here`, `17. ${s} stays here`],
    equal: true,
  },
  {
    name: 'italic',
    cause: 'preserve-emphasis',
    tier: 3,
    pair: (s) => [`${s} stays here`, `*${s} stays here*`],
    equal: false,
  },
  {
    name: 'quote-marker',
    cause: 'strip-container-markers',
    tier: 4,
    container: 'blockquote',
    pair: (s) => [`> ${s} stays here`, `${s} stays here`],
    equal: true,
  },
  {
    name: 'pipe-marker',
    cause: 'strip-container-markers',
    tier: 4,
    container: 'table_cell',
    pair: (s) => [`| ${s} stays here |`, `${s} stays here`],
    equal: true,
  },
  {
    name: 'compatibility-ligature',
    cause: 'avoid-nfkc',
    tier: 4,
    pair: (s) => [`${s} ﬁ`, `${s} fi`],
    equal: false,
  },
  { name: 'fullwidth', cause: 'avoid-nfkc', tier: 4, pair: (s) => [`${s} Ａ`, `${s} A`], equal: false },
  {
    name: 'nfc-and-wrap',
    cause: 'compose-normalisation',
    tier: 5,
    pair: (s) => [`${s} ö stays`, `${s}\r\no\u0308\tstays`],
    equal: true,
  },
  {
    name: 'marker-and-nfc',
    cause: 'compose-normalisation',
    tier: 5,
    container: 'list_item',
    pair: (s) => [`- ${s} é stays`, `+ ${s} e\u0301  stays`],
    equal: true,
  },
  {
    name: 'whitespace-must-not-hide-case',
    cause: 'preserve-case',
    tier: 5,
    pair: (s) => [`${s} Keep here`, `${s}\tKEEP\nhere`],
    equal: false,
  },
  {
    name: 'nfc-must-not-hide-emphasis',
    cause: 'preserve-emphasis',
    tier: 5,
    pair: (s) => [`${s} é stays`, `${s} **e\u0301** stays`],
    equal: false,
  },
];

type RawUnit = { id: string; path: string; text: string; sectionPath: string[]; container: string };
function rawId(seed: number, salt: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let n = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  let out = '';
  for (let i = 0; i < 10; i++) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    out += alphabet[(n >>> 16) & 31];
  }
  return out;
}

type LedgerEntry = { id: string; path: string; quote: string; status: string };

/** Observe identities as equivalence classes across the complete scan history.
 * Sorting duplicate ids only assigns local names; no hash byte is an oracle. */
function ledgerObservation(actual: unknown): unknown {
  if (!Array.isArray(actual) || actual.length < 2) return null;
  const snapshots = actual as { entries?: LedgerEntry[] }[];
  if (!snapshots.every((snapshot) => Array.isArray(snapshot.entries))) return null;
  if (
    !snapshots.every((snapshot) =>
      snapshot.entries?.every(
        (entry) =>
          typeof entry.id === 'string' &&
          /^[a-z2-7]{10}$/.test(entry.id) &&
          typeof entry.path === 'string' &&
          typeof entry.quote === 'string' &&
          (entry.status === 'live' || entry.status === 'deleted'),
      ),
    )
  )
    return null;
  const names = new Map<string, number>();
  return snapshots.map((snapshot) => {
    const groups = new Map<string, { path: string; quote: string; status: string; ids: string[] }>();
    for (const entry of snapshot.entries ?? []) {
      const key = JSON.stringify([entry.path, entry.quote, entry.status]);
      const group = groups.get(key) ?? {
        path: entry.path,
        quote: entry.quote,
        status: entry.status,
        ids: [],
      };
      group.ids.push(entry.id);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => {
        const identities = group.ids
          .sort()
          .map((id) => {
            if (!names.has(id)) names.set(id, names.size);
            return names.get(id) as number;
          })
          .sort((a, b) => a - b);
        return { path: group.path, quote: group.quote, status: group.status, identities };
      });
  });
}

type LedgerCase = { name: string; cause: string; tier: Tier; mode: string };
const ledgerCases: LedgerCase[] = [
  { name: 'independent-clones', cause: 'derive-id-from-estate-tuple', tier: 1, mode: 'clone' },
  { name: 'same-file-occurrences', cause: 'include-occurrence-index', tier: 1, mode: 'duplicate' },
  { name: 'separate-estate-keys', cause: 'include-estate-key', tier: 2, mode: 'estate' },
  { name: 'separate-file-paths', cause: 'include-path-at-mint', tier: 2, mode: 'path' },
  { name: 'display-number-insertion', cause: 'persist-id-after-edit', tier: 3, mode: 'number' },
  { name: 'small-text-edit', cause: 'persist-id-after-edit', tier: 3, mode: 'edit' },
  { name: 'cross-file-move', cause: 'persist-id-after-move', tier: 4, mode: 'move' },
  { name: 'set-description-edit', cause: 'decouple-id-from-label-set', tier: 4, mode: 'set' },
  { name: 'stack-bound-edit', cause: 'decouple-id-from-labeler', tier: 5, mode: 'bounds' },
  { name: 'two-sets-one-unit', cause: 'one-id-per-unit', tier: 5, mode: 'sets' },
];

/** Bank input boundary: files carry their actual fictional Markdown source.
 * hint.start/end are zero-based UTF-16, end-exclusive offsets into that source;
 * line is the one-based line containing hint.start. Positions are input evidence,
 * never identities and never additional requirements on returned ledger entries.
 * Layout controls are generator-only and are removed from the emitted request. */
function ledgerRequest(scans: Json[], independent: boolean): Probe['request'] {
  const positioned = scans.map((value) => {
    const scan = value as Record<string, Json>;
    const files = scan.files as {
      path: string;
      units: { text: string }[];
      leadingNewlines?: number;
      betweenNewlines?: number;
    }[];
    return {
      ...scan,
      files: files.map((file) => {
        let source = '\n'.repeat(file.leadingNewlines ?? 0);
        const units = file.units.map((unit, index) => {
          if (index > 0) source += '\n'.repeat(file.betweenNewlines ?? 2);
          const start = source.length;
          const line = source.slice(0, start).split('\n').length;
          source += unit.text;
          return { ...unit, hint: { start, end: source.length }, line };
        });
        return { path: file.path, source, units };
      }),
    };
  });
  return { operation: 'ledger', input: { scans: positioned, independent } };
}

function ledgerProbe(seed: number, mode: string, lifecycle: boolean): Probe {
  const text = `Retain the fictional parcel ${token(seed)} until the sealed carrier returns with its receipt.`;
  const trackedText = `Inspect the fictional vessel ${token(seed, 3)} under the painted cabinet before its keeper closes the register.`;
  const editedText = trackedText.replace('painted', 'marked');
  const estate = `estate-${token(seed, 2)}`;
  const unit = (quote: string) => ({
    text: quote,
    container: 'sentence',
    labels: { demo: 'kept' },
    linked: false,
  });
  const files = (tracked = trackedText, moved = false, removed = false) => [
    { path: 'a.md', units: [unit(text), unit(text)] },
    { path: 'b.md', units: [unit(text)] },
    ...(removed ? [] : [{ path: moved ? 'relocated/tracked.md' : 'tracked.md', units: [unit(tracked)] }]),
  ];
  const initial = { estateKey: estate, files: files(), labelSets: { demo: 'Keep parcel instructions.' } };
  const entries: LedgerEntry[] = [
    { id: rawId(seed, 0), path: 'a.md', quote: text, status: 'live' },
    { id: rawId(seed, 1), path: 'a.md', quote: text, status: 'live' },
    { id: rawId(seed, 2), path: 'b.md', quote: text, status: 'live' },
    { id: rawId(seed, 3), path: 'tracked.md', quote: trackedText, status: 'live' },
  ];
  const reviseTracked = (quote: string, path: string, status = 'live') =>
    entries.map((entry, index) => (index === 3 ? { ...entry, quote, path, status } : { ...entry }));
  let scans: Json[] = [initial, initial];
  let later = entries.map((entry) => ({ ...entry }));
  let independent = mode === 'clone' || mode === 'estate' || mode === 'path';
  if (mode === 'estate') {
    scans = [initial, { ...initial, estateKey: `${estate}-other` }];
    later = entries.map((entry, index) => ({ ...entry, id: rawId(seed, index + 40) }));
  }
  if (mode === 'path') {
    scans = [
      initial,
      { ...initial, files: initial.files.map((file) => ({ ...file, path: `other/${file.path}` })) },
    ];
    later = entries.map((entry, index) => ({
      ...entry,
      path: `other/${entry.path}`,
      id: rawId(seed, index + 40),
    }));
  }
  if (mode === 'number') {
    scans = [
      initial,
      {
        ...initial,
        files: files().map((file) => ({
          ...file,
          units: file.units.map((u, index) => ({ ...u, displayNumber: index + 8 })),
        })),
      },
    ];
  }
  if (mode === 'edit') {
    scans = [initial, { ...initial, files: files(editedText) }];
    later = reviseTracked(editedText, 'tracked.md');
  }
  if (mode === 'move') {
    scans = [initial, { ...initial, files: files(trackedText, true) }];
    later = reviseTracked(trackedText, 'relocated/tracked.md');
  }
  if (mode === 'set') scans = [initial, { ...initial, labelSets: { demo: 'Keep all parcel instructions.' } }];
  if (mode === 'bounds')
    scans = [
      { ...initial, bounds: { passAt: 0.9, failAt: 0.1 } },
      { ...initial, bounds: { passAt: 0.95, failAt: 0.05 } },
    ];
  if (mode === 'sets')
    scans = [
      initial,
      {
        ...initial,
        files: files().map((file) => ({
          ...file,
          units: file.units.map((u) => ({ ...u, labels: { demo: 'kept', second: 'selected' } })),
        })),
        labelSets: { demo: 'Keep parcel instructions.', second: 'Select carrier procedures.' },
      },
    ];
  let sample: Json = [{ entries }, { entries: later }];
  if (lifecycle) {
    // These are the same occurrence/path identities as the named scenario, now
    // followed through edits, a relocation, and a tombstone. Duplicate boilerplate
    // remains live throughout; only the distinctive tracked unit changes.
    independent = false;
    scans = [
      initial,
      { ...initial, files: files(editedText) },
      { ...initial, files: files(editedText, true) },
      { ...initial, files: files(editedText, true, true) },
    ];
    sample = [
      { entries },
      { entries: reviseTracked(editedText, 'tracked.md') },
      { entries: reviseTracked(editedText, 'relocated/tracked.md') },
      { entries: reviseTracked(editedText, 'relocated/tracked.md', 'deleted') },
    ];
  }
  return {
    request: ledgerRequest(scans, independent),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

/** Independent minting must include the fingerprint. All positional evidence,
 * including UTF-16 lengths, is identical across these fresh snapshots. */
function freshFingerprintProbe(seed: number): Probe {
  const estateKey = `fresh-${token(seed, 90)}`;
  const texts = [
    `Retain the fictional 📦 parcel ${token(seed, 91)} until its carrier presents receipt X.`,
    `Inspect the fictional cabinet ${token(seed, 92)} before its keeper closes register X.`,
    `Return the fictional vessel ${token(seed, 93)} after its custodian checks marker X.`,
  ];
  const changed = texts.map((text) => text.replace(' X.', ' Y.'));
  const unit = (text: string) => ({ text, container: 'sentence', labels: { demo: 'kept' }, linked: false });
  const scan = (quotes: string[]): Json => ({
    estateKey,
    files: [
      { path: 'fresh/a.md', units: quotes.slice(0, 2).map(unit) },
      { path: 'fresh/b.md', units: quotes.slice(2).map(unit) },
    ],
    labelSets: { demo: 'Keep the fictional handling instructions.' },
  });
  const entries = (quotes: string[], salt: number): LedgerEntry[] =>
    quotes.map((quote, index) => ({
      id: rawId(seed, salt + index),
      path: index < 2 ? 'fresh/a.md' : 'fresh/b.md',
      quote,
      status: 'live',
    }));
  const sample: Json = [{ entries: entries(texts, 120) }, { entries: entries(changed, 140) }];
  return {
    request: ledgerRequest([scan(texts), scan(changed)], true),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

/** An identity follows a unique unit through genuine structural changes. Array
 * order, file order, line number and offset are deliberately independent axes. */
function positionHistoryProbe(seed: number): Probe {
  const estateKey = `history-${token(seed, 150)}`;
  const texts = [
    `Retain the fictional 📦 parcel ${token(seed, 151)} beside the blue compartment until its courier presents the receipt.`,
    `Inspect the fictional cabinet ${token(seed, 152)} beside the copper doorway before its keeper closes the register.`,
    `Return the fictional vessel ${token(seed, 153)} to the green alcove after its custodian verifies the marker.`,
    `Place the fictional envelope ${token(seed, 154)} beneath the silver panel while its steward reviews the manifest.`,
    `Secure the fictional container ${token(seed, 155)} behind the amber screen until its attendant checks the seal.`,
    `Count the fictional receipts ${token(seed, 156)} above the violet drawer before its auditor opens the ledger.`,
  ];
  const extended = `${(texts[2] as string).slice(0, -1)} beside the additional fictional reference ${token(seed, 157)}.`;
  type Placement = { path: string; indices: number[]; leadingNewlines?: number; betweenNewlines?: number };
  type Phase = { placements: Placement[]; deleted: number[]; extend?: boolean };
  const initial: Placement[] = [
    { path: 'history/a.md', indices: [0, 1, 2] },
    { path: 'history/b.md', indices: [3, 4] },
  ];
  const permuted: Placement[] = [
    { path: 'history/b.md', indices: [4, 3] },
    { path: 'history/a.md', indices: [2, 0, 1] },
  ];
  const spaced = permuted.map((file) => ({ ...file, leadingNewlines: 3, betweenNewlines: 4 }));
  const phases: Phase[] = [
    { placements: initial, deleted: [] },
    // Real insertion before all three surviving units, not a display-number edit.
    { placements: [{ path: 'history/a.md', indices: [5, 0, 1, 2] }, initial[1] as Placement], deleted: [] },
    { placements: initial, deleted: [5] },
    // Both the input file array and the unique units within each file are permuted.
    { placements: permuted, deleted: [5] },
    // Indices and text stay fixed while preceding blank lines move every position.
    { placements: spaced, deleted: [5] },
    // Same lines and indices: a longer earlier unit shifts later UTF-16 offsets.
    { placements: spaced, deleted: [5], extend: true },
    // Remove a middle unit, retaining its tombstone and the later unit's identity.
    {
      placements: [spaced[0] as Placement, { ...spaced[1], path: 'history/a.md', indices: [2, 1] }],
      deleted: [5, 0],
      extend: true,
    },
  ];
  const quoteAt = (index: number, phase: Phase) =>
    index === 2 && phase.extend ? extended : (texts[index] as string);
  const scans: Json[] = phases.map((phase) => ({
    estateKey,
    labelSets: { demo: 'Keep the fictional handling instructions.' },
    files: phase.placements.map((file) => ({
      path: file.path,
      leadingNewlines: file.leadingNewlines ?? 0,
      betweenNewlines: file.betweenNewlines ?? 2,
      units: file.indices.map((index) => ({
        text: quoteAt(index, phase),
        container: 'sentence',
        labels: { demo: 'kept' },
        linked: false,
      })),
    })),
  }));
  const sample: Json = phases.map((phase) => ({
    entries: [
      ...phase.placements.flatMap((file) =>
        file.indices.map((index) => ({
          id: rawId(seed, 170 + index),
          path: file.path,
          quote: quoteAt(index, phase),
          status: 'live',
        })),
      ),
      ...phase.deleted.map((index) => ({
        id: rawId(seed, 170 + index),
        path: 'history/a.md',
        quote: texts[index] as string,
        status: 'deleted',
      })),
    ],
  }));
  return {
    request: ledgerRequest(scans, false),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

/** A seeded order of `n` positions in which no position keeps its place (a derangement), so a reorder always moves. */
function movedOrder(seed: number, salt: number, n: number): number[] {
  for (let attempt = 0; attempt < 64; attempt++) {
    const order = Array.from({ length: n }, (_, i) => i);
    let state = (seed ^ Math.imul(salt + attempt * 977 + 1, 0x9e3779b1)) >>> 0;
    for (let i = n - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = (state >>> 8) % (i + 1);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    if (order.every((value, at) => value !== at)) return order;
  }
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

/** A seeded choice among `n` things. */
function choose(seed: number, salt: number, n: number): number {
  return ((Math.imul(seed ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0) >>> 5) % n;
}

/**
 * Several distinct units that begin with the same word. Identity must follow the whole unit, not its first word:
 * the units are reordered within and across files, one is inserted before the others, two are edited a little at
 * once and swapped, one is replaced by an unrelated unit of the same first word, and positions shift. Every unit
 * has its own sentence; only the first word is shared. The units to move, edit and replace are chosen by the seed.
 */
function sharedFirstWordProbe(seed: number, salt: number): Probe {
  const base = 300 + salt * 20;
  const estateKey = `shared-${token(seed, base)}`;
  const t = (n: number) => token(seed, base + 1 + n);
  const frames = [
    (n: number) =>
      `Keep the fictional 📦 parcel ${t(n)} beside the blue compartment until its courier presents the receipt.`,
    (n: number) =>
      `Keep every cabinet key ${t(n)} inside the copper doorway while a keeper closes the register.`,
    (n: number) => `Keep a spare vessel ${t(n)} in the green alcove after custodians verify each marker.`,
    (n: number) =>
      `Keep the sealed envelope ${t(n)} beneath the silver panel whenever stewards review the manifests.`,
    (n: number) =>
      `Keep one amber container ${t(n)} behind the folding screen unless an attendant checks every seal.`,
    (n: number) =>
      `Keep two violet receipts ${t(n)} above the narrow drawer before auditors open the ledger.`,
    (n: number) =>
      `Keep the temporary lantern ${t(n)} on the northern landing during the evening inspection.`,
    (n: number) =>
      `Keep that crimson ribbon ${t(n)} under the oak counter once the florist locks the shutters.`,
  ];
  const original = frames.map((frame, n) => frame(n));
  // Two small edits (one word of about fifteen), and a longer unit.
  const edited = new Map<number, string>([
    [3, (original[3] as string).replace('silver', 'pewter')],
    [4, (original[4] as string).replace('amber', 'ochre')],
  ]);
  const extended = `${(original[5] as string).slice(0, -1)} beside the additional fictional reference ${t(9)}.`;
  type Placement = { path: string; indices: number[]; leadingNewlines?: number; betweenNewlines?: number };
  type Phase = { placements: Placement[]; gone: number[]; edit: boolean; extend: boolean };

  const moved = choose(seed, base + 1, 3); // the unit of a.md that crosses into b.md
  const replaced = (moved + 1 + choose(seed, base + 2, 2)) % 3; // the other unit of a.md that is replaced
  const stays = [0, 1, 2].find((n) => n !== moved && n !== replaced) as number;
  const within = movedOrder(seed, base + 3, 3);
  const aInitial = [0, 1, 2];
  const bInitial = [3, 4, 5];
  const aReordered = within.map((k) => aInitial[k] as number);
  const bReordered = movedOrder(seed, base + 4, 3).map((k) => bInitial[k] as number);
  const onlyOrder = (list: number[], keep: number[]) => list.filter((n) => keep.includes(n));
  const space = (files: Placement[]) => files.map((f) => ({ ...f, leadingNewlines: 3, betweenNewlines: 4 }));
  const phases: Phase[] = [];
  const add = (placements: Placement[], gone: number[], edit = false, extend = false) =>
    phases.push({ placements, gone, edit, extend });
  add(
    [
      { path: 'shared/a.md', indices: aInitial },
      { path: 'shared/b.md', indices: bInitial },
    ],
    [],
  );
  // Both files reorder inside, and the file array reverses.
  add(
    [
      { path: 'shared/b.md', indices: bReordered },
      { path: 'shared/a.md', indices: aReordered },
    ],
    [],
  );
  // A new unit of the same first word goes in front; one unit moves across files, to the front of the other.
  const aWithout = onlyOrder(aReordered, [stays, replaced]);
  add(
    [
      { path: 'shared/b.md', indices: [moved, ...bReordered] },
      { path: 'shared/a.md', indices: [6, ...aWithout] },
    ],
    [],
  );
  // Two units edited a little at once, and their relative order swapped.
  const swapped = (list: number[]) => {
    const a = list.indexOf(3);
    const b = list.indexOf(4);
    const out = [...list];
    out[a] = 4;
    out[b] = 3;
    return out;
  };
  const bAfterMove = [moved, ...bReordered];
  add(
    [
      { path: 'shared/b.md', indices: swapped(bAfterMove) },
      { path: 'shared/a.md', indices: [6, ...aWithout] },
    ],
    [],
    true,
  );
  // An unrelated unit of the same first word takes the place of a removed one.
  add(
    [
      { path: 'shared/b.md', indices: swapped(bAfterMove) },
      { path: 'shared/a.md', indices: [6, ...aWithout.map((n) => (n === replaced ? 7 : n))] },
    ],
    [replaced],
    true,
  );
  // Blank lines move every position; an earlier unit grows and shifts later offsets.
  add(
    space([
      { path: 'shared/b.md', indices: swapped(bAfterMove) },
      { path: 'shared/a.md', indices: [6, ...aWithout.map((n) => (n === replaced ? 7 : n))] },
    ]),
    [replaced],
    true,
    true,
  );
  const quoteAt = (index: number, phase: Phase) =>
    phase.extend && index === 5
      ? extended
      : phase.edit && edited.has(index)
        ? (edited.get(index) as string)
        : (original[index] as string);
  const scans: Json[] = phases.map((phase) => ({
    estateKey,
    labelSets: { demo: 'Keep the fictional handling instructions.' },
    files: phase.placements.map((file) => ({
      path: file.path,
      leadingNewlines: file.leadingNewlines ?? 0,
      betweenNewlines: file.betweenNewlines ?? 2,
      units: file.indices.map((index) => ({
        text: quoteAt(index, phase),
        container: 'sentence',
        labels: { demo: 'kept' },
        linked: false,
      })),
    })),
  }));
  // A removed unit keeps its last seen path and text as a tombstone from then on.
  const lastSeen = new Map<number, { path: string; quote: string }>();
  const sample: Json = phases.map((phase) => {
    const live = phase.placements.flatMap((file) =>
      file.indices.map((index) => {
        const entry = {
          id: rawId(seed, base + 40 + index),
          path: file.path,
          quote: quoteAt(index, phase),
          status: 'live',
        };
        lastSeen.set(index, { path: file.path, quote: entry.quote });
        return entry;
      }),
    );
    return {
      entries: [
        ...live,
        ...phase.gone.map((index) => ({
          id: rawId(seed, base + 40 + index),
          path: (lastSeen.get(index) as { path: string }).path,
          quote: (lastSeen.get(index) as { quote: string }).quote,
          status: 'deleted',
        })),
      ],
    };
  });
  return {
    request: ledgerRequest(scans, false),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

/** Words for the grid probe: none holds a `v` or a digit, so the token and digit slots are the only such words. */
const GRID_WORDS = [
  'amber',
  'basket',
  'candle',
  'drawer',
  'ember',
  'folder',
  'garden',
  'harbor',
  'island',
  'jacket',
  'kettle',
  'lantern',
  'marble',
  'napkin',
  'orchard',
  'pencil',
  'quilt',
  'ribbon',
  'saddle',
  'tablet',
  'umbrella',
  'window',
  'yellow',
  'zipper',
  'brass',
  'cedar',
  'dusty',
  'eager',
  'faded',
  'gentle',
  'hollow',
  'inner',
  'jolly',
  'keen',
  'light',
  'mossy',
  'noble',
  'outer',
  'plain',
  'quiet',
  'rusty',
  'silent',
  'tidy',
  'upper',
  'woolen',
  'young',
  'zesty',
  'crisp',
  'bright',
  'calm',
  'dark',
  'early',
  'fresh',
  'green',
  'heavy',
  'idle',
  'late',
  'mild',
  'neat',
  'open',
];
const GRID_VERBS = [
  'Keep',
  'Count',
  'Shelve',
  'Weigh',
  'Label',
  'Store',
  'Mend',
  'Sort',
  'Stack',
  'Wrap',
  'Check',
  'Move',
];
const GRID_SLOTS = 12;
const GRID_UNITS = 8;
const TOKEN_SLOT = 6;
const DIGIT_SLOT = 8;
const FIFTH_SLOT = 4;

function gridRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Levenshtein similarity (1 minus distance over the longer length). */
function textSimilarity(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number;
      row[j] = Math.min(above + 1, (row[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - (row[b.length] as number) / Math.max(a.length, b.length, 1);
}

/**
 * Units that agree in many words and differ in many others. Eight units have twelve slots; each slot takes one of
 * three values, every value is shared by at least two units, and any two units differ in at least six slots. So
 * no single word position, no token and no digit word names a unit, whatever the key. An edit changes one slot of
 * one unit to a fourth value; across the history every slot is edited once, so any feature a key might read is
 * changed on some unit that must keep its identity. A replacement unit and a distractor are unrelated sentences
 * that copy the feature words of the replaced unit and of a survivor (first, fifth and last word, the token and
 * the digit word): they must get new identities, and the survivor must keep its own.
 */
const gridCache = new Map<string, Probe>();
function gridKeyProbe(seed: number, salt: number): Probe {
  let built = gridCache.get(`${seed}|${salt}`);
  if (!built) {
    built = buildGridKeyProbe(seed, salt);
    gridCache.set(`${seed}|${salt}`, built);
  }
  return {
    ...built,
    request: structuredClone(built.request),
    expected: structuredClone(built.expected),
    sample: structuredClone(built.sample),
  };
}

function buildGridKeyProbe(seed: number, salt: number): Probe {
  const base = 600 + salt * 100;
  const rng = gridRandom(seed ^ Math.imul(salt + 7, 0x9e3779b1));
  const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)] as T;
  // Four words per slot: values 0 to 2 are used by units, value 3 is the edit word.
  const pool = (list: string[]): string[] => {
    const copy = [...list];
    const out: string[] = [];
    while (out.length < 4) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0] as string);
    return out;
  };
  const tokens = [0, 1, 2, 3].map((k) => token(seed, base + k));
  const slots: string[][] = Array.from({ length: GRID_SLOTS }, (_, slot) => {
    if (slot === 0) return pool(GRID_VERBS);
    if (slot === TOKEN_SLOT) return tokens;
    if (slot === DIGIT_SLOT) return [0, 1, 2, 3].map((k) => `r${2 + ((seed + k * 3 + salt) % 7)}${k}`);
    return pool(GRID_WORDS);
  });
  let code: number[][] = [];
  const differing = (a: number[], b: number[]) => a.filter((value, slot) => value !== b[slot]).length;
  // Each slot is a column: eight units over three values, every value used by none or by at least two units.
  const SPLITS = [
    [2, 3, 3],
    [2, 2, 4],
    [4, 4, 0],
    [3, 5, 0],
    [2, 6, 0],
    [4, 2, 2],
  ];
  const column = (): number[] => {
    const split = pick(SPLITS) as number[];
    const values = split.flatMap((count, value) => Array.from({ length: count }, () => value));
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [values[i], values[j]] = [values[j] as number, values[i] as number];
    }
    return values;
  };
  for (let attempt = 0; attempt < 2000 && code.length === 0; attempt++) {
    const columns = Array.from({ length: GRID_SLOTS }, column);
    const candidate = Array.from({ length: GRID_UNITS }, (_, n) => columns.map((col) => col[n] as number));
    const apart = candidate.every((a, i) => candidate.every((b, j) => i >= j || differing(a, b) >= 6));
    if (apart) code = candidate;
  }
  if (code.length === 0) throw new Error('no grid code for this seed');
  const sentence = (words: string[]) => `${words.join(' ')}.`;
  const unitWords = (n: number): string[] =>
    (code[n] as number[]).map((value, slot) => (slots[slot] as string[])[value] as string);
  const original = Array.from({ length: GRID_UNITS }, (_, n) => unitWords(n));
  // Phase edits: slot k of unit (k % 6) takes the fourth value of its slot, once per slot, cumulatively.
  const editsBy = (phase: number): Map<number, Map<number, string>> => {
    const byUnit = new Map<number, Map<number, string>>();
    for (let slot = 0; slot < Math.min(phase, GRID_SLOTS); slot++) {
      const unit = (slot * 5 + 1) % 6; // units 0 to 5 survive to the end; 6 and 7 are removed or replaced
      const edit = byUnit.get(unit) ?? new Map<number, string>();
      edit.set(slot, (slots[slot] as string[])[3] as string);
      byUnit.set(unit, edit);
    }
    return byUnit;
  };
  const textAt = (n: number, phase: number): string => {
    const words = [...(original[n] as string[])];
    for (const [slot, word] of editsBy(phase).get(n) ?? []) words[slot] = word;
    return sentence(words);
  };
  // Unrelated sentences that copy feature words: first, fifth, last word, token and digit word.
  const used = new Set(original.flat());
  const filler = GRID_WORDS.filter((word) => !used.has(word));
  // A copy is kept as the words the item chose: its sentence is only their rendering.
  const copyOf = (n: number, salt2: number): string[] => {
    const own = original[n] as string[];
    const words = Array.from({ length: GRID_SLOTS + 2 }, () => pick(filler));
    words[0] = own[0] as string;
    words[FIFTH_SLOT] = own[FIFTH_SLOT] as string;
    words[TOKEN_SLOT + 1] = own[TOKEN_SLOT] as string;
    words[DIGIT_SLOT + 2] = own[DIGIT_SLOT] as string;
    words[words.length - 1] = own[GRID_SLOTS - 1] as string;
    void salt2;
    return words;
  };
  // Cheap screen first (shared words, from the word arrays the item chose, never from the rendered sentences),
  // the edit-distance similarity only for the survivors of the screen.
  const unrelated = (candidate: string[]): boolean => {
    const w = new Set(candidate);
    const text = sentence(candidate);
    return original.every((unit) => {
      const shared = [...new Set(unit)].filter((x) => w.has(x)).length;
      return shared / w.size <= 0.45 && textSimilarity(sentence(unit), text) < 0.5;
    });
  };
  let replacementWords = copyOf(7, 0);
  let distractorWords = copyOf(2, 1);
  for (let tries = 0; tries < 200 && !(unrelated(replacementWords) && unrelated(distractorWords)); tries++) {
    replacementWords = copyOf(7, tries);
    distractorWords = copyOf(2, tries + 1);
  }
  const replacement = sentence(replacementWords);
  const distractor = sentence(distractorWords);

  type Placement = { path: string; texts: { id: number; text: string }[] };
  type Phase = { placements: Placement[]; gone: number[] };
  const live = (n: number, phase: number) => ({ id: n, text: textAt(n, phase) });
  const phases: Phase[] = [];
  const at = (a: Placement['texts'], b: Placement['texts'], gone: number[] = []) =>
    phases.push({
      placements: [
        { path: 'grid/a.md', texts: a },
        { path: 'grid/b.md', texts: b },
      ],
      gone,
    });
  // Phase p holds the edits of slots below p.
  at(
    [0, 1, 2, 3].map((n) => live(n, 0)),
    [4, 5, 6, 7].map((n) => live(n, 0)),
  );
  // Reorder inside both files, and move unit 3 across.
  at(
    [2, 0, 1].map((n) => live(n, 0)),
    [3, 7, 5, 4, 6].map((n) => live(n, 0)),
  );
  for (let p = 1; p <= GRID_SLOTS; p++) {
    const rotate = <T>(list: T[]) => (p % 2 === 0 ? [...list].reverse() : list);
    let a = rotate([0, 1, 2].map((n) => live(n, p)));
    let b = rotate([3, 4, 5, 6, 7].map((n) => live(n, p)));
    let gone: number[] = [];
    if (p >= 4) {
      // Unit 5 is removed; its tombstone stays from here on.
      b = b.filter((entry) => entry.id !== 5);
      gone = [5];
    }
    if (p >= 7) {
      // Unit 7 is replaced by an unrelated sentence that copies its feature words.
      b = b.map((entry) => (entry.id === 7 ? { id: 20, text: replacement } : entry));
      gone = [5, 7];
    }
    if (p >= 9) a = [{ id: 21, text: distractor }, ...a];
    at(a, b, gone);
  }
  const scans: Json[] = phases.map((phase) => ({
    estateKey: `grid-${token(seed, base + 9)}`,
    labelSets: { demo: 'Keep the fictional handling instructions.' },
    files: phase.placements.map((file) => ({
      path: file.path,
      leadingNewlines: 0,
      betweenNewlines: 2,
      units: file.texts.map((entry) => ({
        text: entry.text,
        container: 'sentence',
        labels: { demo: 'kept' },
        linked: false,
      })),
    })),
  }));
  const lastSeen = new Map<number, { path: string; quote: string }>();
  const sample: Json = phases.map((phase) => {
    const entries = phase.placements.flatMap((file) =>
      file.texts.map((entry) => {
        lastSeen.set(entry.id, { path: file.path, quote: entry.text });
        return { id: rawId(seed, base + 50 + entry.id), path: file.path, quote: entry.text, status: 'live' };
      }),
    );
    return {
      entries: [
        ...entries,
        ...phase.gone.map((id) => ({
          id: rawId(seed, base + 50 + id),
          path: (lastSeen.get(id) as { path: string }).path,
          quote: (lastSeen.get(id) as { quote: string }).quote,
          status: 'deleted',
        })),
      ],
    };
  });
  return {
    request: ledgerRequest(scans, false),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

function reanchorObservation(actual: unknown): unknown {
  if (!Array.isArray(actual)) return null;
  const entries = actual as {
    id?: unknown;
    path?: unknown;
    quote?: unknown;
    status?: unknown;
    lineage?: { event?: unknown }[];
    candidates?: { path?: unknown; quote?: unknown }[];
  }[];
  if (
    !entries.every(
      (entry) =>
        typeof entry.id === 'string' &&
        typeof entry.path === 'string' &&
        typeof entry.quote === 'string' &&
        (entry.status === 'live' || entry.status === 'deleted') &&
        Array.isArray(entry.lineage) &&
        entry.lineage.length > 0,
    )
  )
    return null;
  return entries
    .map((entry) => ({
      id: entry.id,
      path: entry.path,
      quote: entry.quote,
      status: entry.status,
      event: entry.lineage?.at(-1)?.event,
      candidates: (entry.candidates ?? [])
        .map((candidate) => ({ path: candidate.path, quote: candidate.quote }))
        .sort((a, b) => String(a.path).localeCompare(String(b.path))),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

type AnchorCase = { name: string; cause: string; tier: Tier; mode: string };
const anchorCases: AnchorCase[] = [
  { name: 'unchanged', cause: 'histogram-anchors-before-fuzzy', tier: 1, mode: 'unchanged' },
  { name: 'deleted', cause: 'retain-deleted-quote', tier: 1, mode: 'deleted' },
  { name: 'cross-file-move', cause: 'search-exact-estate-move', tier: 2, mode: 'move' },
  { name: 'small-edit', cause: 'accept-high-text-similarity', tier: 2, mode: 'edit' },
  { name: 'rewrite-floor', cause: 'enforce-text-floor', tier: 3, mode: 'rewrite' },
  { name: 'ambiguous-move', cause: 'retain-all-exact-candidates', tier: 3, mode: 'ambiguous' },
  { name: 'exact-before-near', cause: 'exact-before-fuzzy', tier: 4, mode: 'exact-first' },
  { name: 'original-plus-copy', cause: 'keep-anchor-before-twin', tier: 4, mode: 'copy' },
  { name: 'exact-concatenation-split', cause: 'compare-neighbour-concatenation', tier: 5, mode: 'split' },
  { name: 'exact-concatenation-merge', cause: 'compare-neighbour-concatenation', tier: 5, mode: 'merged' },
];

/** Three independent stressors compose with every transition: Unicode, repeated
 * local context, and Markdown emphasis. They change evidence, not fixture names. */
const contexts = ['unicode', 'repeated-neighbours', 'emphasis'] as const;

/** Lineage edges expose the old ids and the event, never which new child owns
 * an id. The design does not fix child-id assignment for splits and merges. */
function concatenationObservation(actual: unknown): unknown {
  if (!Array.isArray(actual)) return null;
  const events = actual as { event?: unknown; sourceIds?: unknown; targetTexts?: unknown }[];
  if (
    !events.every(
      (edge) =>
        typeof edge.event === 'string' &&
        Array.isArray(edge.sourceIds) &&
        edge.sourceIds.every((id) => typeof id === 'string') &&
        Array.isArray(edge.targetTexts) &&
        edge.targetTexts.every((text) => typeof text === 'string'),
    )
  )
    return null;
  return events
    .map((edge) => ({
      event: edge.event,
      sourceIds: [...(edge.sourceIds as string[])].sort(),
      targetTexts: edge.targetTexts,
    }))
    .sort((a, b) => a.sourceIds.join(',').localeCompare(b.sourceIds.join(',')));
}

function concatenationProbe(
  seed: number,
  mode: 'split' | 'merged',
  context: (typeof contexts)[number],
  control: boolean,
): Probe {
  const nonce = token(seed);
  const firstBase = `Retain the fictional parcel ${nonce} inside the sealed chamber until its carrier brings the receipt.`;
  const secondBase = `Place the fictional vessel ${nonce} beside the painted cabinet while its keeper checks the register.`;
  const decorate = (text: string) =>
    context === 'unicode' ? `${text} Café.` : context === 'emphasis' ? `**${text}**` : text;
  const first = decorate(firstBase);
  const second = decorate(secondBase);
  const joined = first + second;
  const path = `${nonce}/concatenated.md`;
  const ids = [rawId(seed, 81), rawId(seed, 82)];
  const neighbours = context === 'repeated-neighbours' ? 'Identical neighbouring context. '.repeat(4) : nonce;
  const make = (text: string, index: number): Json => ({
    id: ids[index] as string,
    path,
    text,
    container: 'list_item',
    sectionPath: ['Parcel records'],
    prefix: neighbours,
    suffix: neighbours,
  });
  const before = mode === 'split' ? [make(joined, 0)] : [make(first, 0), make(second, 1)];
  const targetTexts = mode === 'split' ? [first, second] : [joined];
  const after = control
    ? before
    : targetTexts.map((text) => ({
        path,
        text,
        container: 'list_item',
        sectionPath: ['Parcel records'],
        prefix: neighbours,
        suffix: neighbours,
      }));
  const sources = mode === 'split' ? [ids[0] as string] : ids;
  const sample: Json = control
    ? before.map((unit, index) => ({
        event: 'unchanged',
        sourceIds: [sources[index] as string],
        targetTexts: [(unit as { text: string }).text],
      }))
    : [{ event: mode, sourceIds: sources, targetTexts }];
  return {
    request: {
      operation: 'reanchor',
      input: {
        before,
        after,
        // Isolate step 4: individual halves cannot clear this configured threshold,
        // but their exact concatenation scores 1. No fuzzy-score tie is asserted.
        settings: { threshold: 0.99, textFloor: 0.4, exactLengthFloor: 20 },
        selectIds: sources,
        observation: 'lineage-edges',
      },
    },
    expected: concatenationObservation(sample) as Json,
    observe: concatenationObservation,
    sample,
  };
}

function anchorProbe(
  seed: number,
  mode: string,
  context: (typeof contexts)[number],
  control: boolean,
): Probe {
  if (mode === 'split' || mode === 'merged') return concatenationProbe(seed, mode, context, control);
  const nonce = token(seed);
  const base = `Retain the fictional parcel ${nonce} inside the sealed chamber until the returning carrier presents the numbered receipt.`;
  const text =
    context === 'unicode' ? `${base} Café ${nonce}.` : context === 'emphasis' ? `**${base}**` : base;
  const id = rawId(seed, 71);
  const before: RawUnit = {
    id,
    path: `${nonce}/before.md`,
    text,
    sectionPath: ['Parcel records'],
    container: 'sentence',
  };
  const prefix =
    context === 'repeated-neighbours' ? 'The repeated context remains. '.repeat(4) : `Prior ${nonce}.`;
  const suffix = context === 'repeated-neighbours' ? prefix : `Later ${nonce}.`;
  const origin = { ...before, prefix, suffix };
  const candidate = (path: string, nextText = text): Json => ({
    path,
    text: nextText,
    container: 'sentence',
    sectionPath: ['Parcel records'],
    prefix,
    suffix,
  });
  let after: Json[] = [candidate(before.path)];
  let event = 'unchanged';
  let path = before.path;
  let quote = text;
  let candidates: { path: string; quote: string }[] = [];
  if (mode === 'deleted') {
    after = [];
    event = 'deleted';
  }
  if (mode === 'move') {
    path = `${nonce}/moved.md`;
    after = [candidate(path)];
    event = 'moved';
  }
  if (mode === 'edit') {
    quote = text.replace('sealed', 'closed');
    after = [candidate(path, quote)];
    event = 'changed';
  }
  if (mode === 'rewrite') {
    // Disjoint alphabets force text similarity below .4 even with identical context.
    const replacement = '界'.repeat(text.length);
    after = [candidate(path, replacement)];
    event = 'deleted';
  }
  if (mode === 'ambiguous') {
    const paths = [`${nonce}/one.md`, `${nonce}/two.md`];
    after = paths.map((p) => candidate(p));
    candidates = paths.map((p) => ({ path: p, quote: text }));
    event = 'ambiguous';
  }
  if (mode === 'exact-first') {
    path = `${nonce}/exact.md`;
    after = [candidate(before.path, text.replace('sealed', 'closed')), candidate(path)];
    event = 'moved';
  }
  if (mode === 'copy') after = [candidate(before.path), candidate(`${nonce}/copy.md`)];
  if (control) {
    after = mode === 'deleted' || mode === 'rewrite' ? [candidate(before.path)] : [];
    event = after.length ? 'unchanged' : 'deleted';
    path = before.path;
    quote = text;
    candidates = [];
  }
  const sample = [
    { id, path, quote, status: event === 'deleted' ? 'deleted' : 'live', lineage: [{ event }], candidates },
  ];
  return {
    request: {
      operation: 'reanchor',
      input: {
        before: [origin],
        after,
        settings: { threshold: 0.45, textFloor: 0.4, exactLengthFloor: 20 },
        selectIds: [id],
      },
    },
    expected: reanchorObservation(sample) as Json,
    observe: reanchorObservation,
    sample,
  };
}

export function identityItems(): BankItem[] {
  const fingerprintsBank: BankItem[] = fingerprintCases.map((c) => ({
    id: `pointer.ids.${c.name}`,
    family: 'ids',
    tier: c.tier,
    level: c.tier,
    component: 'pointer.fingerprint',
    title: c.name,
    cause: c.cause,
    design: '4. Layer A: the ledger — Fingerprint',
    generate(seed) {
      const text = `Parcel ${token(seed)}`;
      const [left, right] = c.pair(text);
      return {
        probes: [
          fingerprints(left, right, c.equal, c.container),
          // A distinct-byte equal pair proves normalization even in semantic-
          // inequality cases; returning a hash of the raw text cannot pass.
          fingerprints(
            `${left.normalize('NFC')} Café witness`,
            `${left}  Cafe\u0301\twitness`,
            true,
            c.container,
          ),
          fingerprints(left, `${left} extra`, false, c.container),
        ],
      };
    },
  }));
  const ledgerBank: BankItem[] = ledgerCases.map((c) => ({
    id: `pointer.ids.${c.name}`,
    family: 'ids',
    tier: c.tier,
    level: c.tier,
    component: 'pointer.ledger',
    title: c.name,
    cause: c.cause,
    design: '4. Layer A: the ledger — Id; 1. Label sets; 3. The default stack',
    generate: (seed) => ({
      probes: [
        ledgerProbe(seed, c.mode, false),
        ledgerProbe(seed, c.mode, true),
        freshFingerprintProbe(seed),
        positionHistoryProbe(seed),
        sharedFirstWordProbe(seed, c.name.length % 3),
        gridKeyProbe(seed, c.name.length % 3),
      ],
    }),
  }));
  const anchorBank: BankItem[] = anchorCases.flatMap((c) =>
    contexts.map((context) => ({
      id: `pointer.re-anchoring.${c.name}.${context}`,
      family: 're-anchoring',
      tier: c.tier,
      level: c.tier,
      component: 'pointer.reanchor',
      title: `${c.name} with ${context}`,
      cause: c.cause,
      design: '4. Layer A: the ledger — Re-anchoring on a changed file',
      generate: (seed: number) => ({
        probes: [anchorProbe(seed, c.mode, context, false), anchorProbe(seed, c.mode, context, true)],
      }),
    })),
  );
  return [...fingerprintsBank, ...ledgerBank, ...anchorBank];
}
