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

function ledgerObservation(actual: unknown): unknown {
  if (!Array.isArray(actual)) return null;
  const snapshots = actual as { entries?: { id?: unknown; status?: unknown; quote?: unknown }[] }[];
  if (snapshots.length !== 2 || !snapshots.every((snapshot) => Array.isArray(snapshot.entries))) return null;
  const first = snapshots[0]?.entries ?? [];
  const second = snapshots[1]?.entries ?? [];
  if (
    ![...first, ...second].every((entry) => typeof entry.id === 'string' && /^[a-z2-7]{10}$/.test(entry.id))
  )
    return null;
  return {
    counts: [first.length, second.length],
    sameIds: first.length === second.length && first.every((entry, index) => entry.id === second[index]?.id),
    distinct: [new Set(first.map((entry) => entry.id)).size, new Set(second.map((entry) => entry.id)).size],
  };
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

function ledgerProbe(seed: number, mode: string, control: boolean): Probe {
  const text = `Retain the fictional parcel ${token(seed)} until the sealed carrier returns with its receipt.`;
  const estate = `estate-${token(seed, 2)}`;
  const unit = { text, container: 'sentence', labels: { demo: 'kept' }, linked: false };
  const initial = {
    estateKey: estate,
    files: [{ path: 'a.md', units: [unit] }],
    labelSets: { demo: 'Keep parcel instructions.' },
  };
  let scans: Json[] = [initial, initial];
  let same = true;
  let count = 1;
  let independent = false;
  if (mode === 'clone') independent = true;
  if (mode === 'duplicate') {
    count = 2;
    const twice = { ...initial, files: [{ path: 'a.md', units: [unit, unit] }] };
    scans = [twice, twice];
  }
  if (mode === 'estate') {
    independent = true;
    same = false;
    scans = [initial, { ...initial, estateKey: `${estate}-other` }];
  }
  if (mode === 'path') {
    independent = true;
    same = false;
    scans = [initial, { ...initial, files: [{ path: 'b.md', units: [unit] }] }];
  }
  if (mode === 'number')
    scans = [initial, { ...initial, files: [{ path: 'a.md', units: [{ ...unit, displayNumber: 8 }] }] }];
  if (mode === 'edit')
    scans = [
      initial,
      { ...initial, files: [{ path: 'a.md', units: [{ ...unit, text: text.replace('sealed', 'closed') }] }] },
    ];
  if (mode === 'move') scans = [initial, { ...initial, files: [{ path: 'relocated/b.md', units: [unit] }] }];
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
        files: [{ path: 'a.md', units: [{ ...unit, labels: { demo: 'kept', second: 'selected' } }] }],
        labelSets: { demo: 'Keep parcel instructions.', second: 'Select carrier procedures.' },
      },
    ];
  if (control) {
    // This distinct cardinality witness rejects even a constant valid ledger.
    scans = [
      { estateKey: estate, files: [] },
      { estateKey: estate, files: [] },
    ];
    count = 0;
    same = true;
  }
  const entries = Array.from({ length: count }, (_, i) => ({
    id: rawId(seed, i),
    status: 'live',
    quote: text,
  }));
  const later = entries.map((entry, i) => ({ ...entry, id: same ? entry.id : rawId(seed, i + 40) }));
  return {
    request: { operation: 'ledger', input: { scans, independent } },
    expected: { counts: [count, count], sameIds: same, distinct: [count, count] },
    observe: ledgerObservation,
    sample: [{ entries }, { entries: later }],
  };
}

function reanchorObservation(actual: unknown): unknown {
  if (!Array.isArray(actual)) return null;
  const entries = actual as {
    id?: unknown;
    path?: unknown;
    quote?: unknown;
    lineage?: { event?: unknown }[];
    candidates?: { path?: unknown; quote?: unknown }[];
  }[];
  if (
    !entries.every(
      (entry) =>
        typeof entry.id === 'string' &&
        typeof entry.path === 'string' &&
        typeof entry.quote === 'string' &&
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
  const sample = [{ id, path, quote, lineage: [{ event }], candidates }];
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
      const contrast: [string, string] = c.equal ? [left, `${left} extra`] : [left, left];
      return {
        probes: [
          fingerprints(left, right, c.equal, c.container),
          fingerprints(...contrast, !c.equal, c.container),
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
    generate: (seed) => ({ probes: [ledgerProbe(seed, c.mode, false), ledgerProbe(seed, c.mode, true)] }),
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
