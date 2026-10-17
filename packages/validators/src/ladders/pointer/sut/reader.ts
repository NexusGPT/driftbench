import type {
  Atom,
  CutResult,
  CutUnit,
  Diagnostic,
  LedgerEntry,
  LedgerView,
  PointerSut,
  ScanRequest,
  ScanResult,
  SourceFile,
  Transport,
} from './port';
import { ReaderNotReachable } from './port';

/**
 * The one file that knows the real pointer reader. It maps the reader's exports (names and types only, as listed in
 * the seam) onto the bank's port. Nothing else in the bank imports the reader. The module is loaded at run time,
 * so a checkout without the reader still compiles and every item fails with "not reachable".
 */

type RUnit = {
  container: string;
  start: number;
  end: number;
  text: string;
  fp: string;
  path: string[];
  key?: string;
};
type RCut = { units: RUnit[]; digest: string };
type RLabel = { label: string; setHash: string; source: string; target?: string };
type REntry = {
  id: string;
  path: string;
  index: number;
  sectionPath: string[];
  container: string;
  fp: string;
  ctxFp: string;
  quote: string;
  prefix: string;
  suffix: string;
  status: 'live' | 'deleted';
  labels: Record<string, RLabel>;
};
type RLedger = { version: 1; cutDigests: Record<string, string>; entries: REntry[] };
type RSet = { set: string; description: string; labels: unknown[] };
type RWindow = {
  id: string;
  path: string;
  headingPath: string[];
  units: Array<{ n: number; text: string; index: number }>;
};
type RLabelled = { units: string; label: string; target?: number };
type RRecorded = {
  labels?: RLabelled[];
  probabilities?: Record<string, number>;
  returnedModel: string;
  stopReason: string;
  usage: { input: number; output: number };
};
type RWire = { labeler: string; body: Record<string, unknown> };
type RLabeler = {
  id: string;
  family: string;
  model: string;
  maxUnits(set: RSet, wanted: number): number;
  render(set: RSet, window: RWindow): RWire;
  interpret(answer: RRecorded, set: RSet, window: RWindow): RLabelled[];
  call?(wire: RWire, set: RSet, window: RWindow): Promise<RRecorded>;
};
type RCassette = { render(): string };
type RLabelledUnit = unknown;
type RResult = {
  ledger: RLedger;
  events: Record<string, number>;
  cuts: Map<string, RCut>;
  labelled: RLabelledUnit[];
  windows: number;
  carried: number;
  calls: number;
  unlabeled: number;
  refusals: string[];
  failed: string[];
  recorded: number;
};
type RAtom = {
  kind: string;
  provenance: { file: string; startLine: number; endLine: number; quote: string };
  producedBy: string;
  approved: boolean;
  fields?: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
};

type Reader = {
  AGENT_RULES_SET: string;
  AtomBuilder: new (files: ReadonlyMap<string, unknown>) => { atoms: RAtom[] };
  Cassette: { parse(text: string): RCassette };
  cut(source: string): RCut;
  LabelerError: new (message: string) => Error;
  labelerByName(
    name: string,
    options: {
      model?: string;
      env?: Record<string, string | undefined>;
      record: boolean;
      threshold?: number;
      fetch?: unknown;
    },
  ): RLabeler | undefined;
  parseDenseAnswer(text: string): RLabelled[];
  parseLabelSets(text: string): { ok: true; sets: RSet[] } | { ok: false; message: string };
  parseLedger(text: string): RLedger | undefined;
  renderLedger(ledger: RLedger): string;
  setHash(set: RSet): string;
  pointerScan(input: Record<string, unknown>): Promise<RResult>;
  pointerAtoms(
    labelled: readonly RLabelledUnit[],
    texts: ReadonlyMap<string, string>,
    builder: { atoms: RAtom[] },
    labeler: string,
  ): { accepted: RAtom[]; refusals: string[]; duplicates: string[] };
};

const NAMES = [
  'AtomBuilder',
  'AGENT_RULES_SET',
  'Cassette',
  'cut',
  'LabelerError',
  'labelerByName',
  'parseDenseAnswer',
  'parseLabelSets',
  'parseLedger',
  'renderLedger',
  'setHash',
  'pointerScan',
  'pointerAtoms',
] as const;

const SPECIFIER = '@agent-nexus/driftbench-estate';
let loaded: Promise<Reader> | undefined;

function load(): Promise<Reader> {
  loaded ??= (async () => {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ SPECIFIER)) as Record<string, unknown>;
    } catch (cause) {
      throw new ReaderNotReachable(
        `${SPECIFIER} cannot be loaded (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    // The reader is exported as the `pointer` namespace of the estate package, and its atom builder as `scan.AtomBuilder`.
    const ns = (mod.pointer ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...ns, AtomBuilder: mod.AtomBuilder };
    const missing = NAMES.filter((n) => merged[n] === undefined);
    if (missing.length > 0)
      throw new ReaderNotReachable(`${SPECIFIER} does not export ${missing.join(', ')} (namespace pointer)`);
    return merged as unknown as Reader;
  })();
  return loaded;
}

/* ----- cut ----- */

function bankContainer(unit: RUnit): string {
  if (unit.container === 'front_matter_value') return 'front_matter';
  if (unit.container === 'opaque') return /^\s*(```|~~~)/.test(unit.text) ? 'fence' : 'comment';
  return unit.container;
}

/** `$.description`, `$.items[0].name` or `$['a b']` as path parts. */
function yamlPathOf(key: string | undefined): string[] | undefined {
  if (key === undefined) return undefined;
  const parts: string[] = [];
  const pattern = /\.([^.[\]]+)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]/g;
  let m: RegExpExecArray | null = pattern.exec(key);
  while (m !== null) {
    parts.push((m[1] ?? m[2] ?? m[3] ?? m[4]) as string);
    m = pattern.exec(key);
  }
  return parts;
}

function toUnit(unit: RUnit): CutUnit {
  const yamlPath = yamlPathOf(unit.key);
  return {
    container: bankContainer(unit),
    start: unit.start,
    end: unit.end,
    text: unit.text,
    fp: unit.fp,
    path: unit.path,
    ...(yamlPath ? { yamlPath } : {}),
    opaque: unit.container === 'opaque',
  };
}

/* ----- ledger view and events ----- */

function viewOf(reader: Reader, ledger: RLedger, cuts: Map<string, RCut>): LedgerView {
  const entries: LedgerEntry[] = ledger.entries.map((e) => {
    const unit = cuts.get(e.path)?.units[e.index];
    const container =
      e.container === 'front_matter_value'
        ? 'front_matter'
        : e.container === 'opaque'
          ? /^\s*(```|~~~)/.test(e.quote)
            ? 'fence'
            : 'comment'
          : e.container;
    const labels: LedgerEntry['labels'] = {};
    for (const [name, label] of Object.entries(e.labels))
      Object.defineProperty(labels, name, {
        value: label,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return {
      id: e.id,
      path: e.path,
      sectionPath: e.sectionPath,
      container,
      fp: e.fp,
      ctxFp: e.ctxFp,
      quote: e.quote,
      prefix: e.prefix,
      suffix: e.suffix,
      ...(unit && e.status === 'live' ? { hint: { start: unit.start, end: unit.end } } : {}),
      status: e.status,
      labels,
      lineage: [],
      twinOf: null,
    };
  });
  return { raw: reader.renderLedger(ledger), entries };
}

/** What happened to each id, read off the two ledgers. The reader reports only counts; `split`, `merged` and `ambiguous` per id are not derivable. */
function eventsOf(previous: RLedger | undefined, current: RLedger): Record<string, string> {
  const events: Record<string, string> = {};
  const before = new Map((previous?.entries ?? []).filter((e) => e.status === 'live').map((e) => [e.id, e]));
  for (const e of current.entries) {
    if (e.status === 'deleted') {
      if (before.has(e.id)) events[e.id] = 'deleted';
      continue;
    }
    const was = before.get(e.id);
    if (!was) events[e.id] = 'new';
    else if (was.quote !== e.quote) events[e.id] = 'changed';
    else if (was.path !== e.path || was.index !== e.index) events[e.id] = 'moved';
    else events[e.id] = 'unchanged';
  }
  return events;
}

/* ----- labelers ----- */

function plantedLabeler(
  reader: Reader,
  request: ScanRequest,
  cuts: Map<string, RCut>,
  counter: { calls: number },
): RLabeler {
  const planted = request.labeler;
  return {
    id: 'planted',
    family: 'planted',
    model: 'planted',
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({ labeler: 'planted', body: { set: set.set, window } }),
    interpret: (answer) => answer.labels ?? [],
    async call(_wire, set, window) {
      if (!planted) throw new reader.LabelerError('no labeller');
      counter.calls += 1;
      const cutOf = cuts.get(window.path);
      const answer = await planted({
        set: set.set,
        setHash: reader.setHash(set),
        labels: (set.labels as never[]) ?? [],
        window: {
          id: window.id,
          file: window.path,
          path: window.headingPath,
          units: window.units.map((u) => {
            const unit = cutOf?.units[u.index];
            return {
              n: u.n,
              text: u.text,
              container: unit ? bankContainer(unit) : 'sentence',
              path: unit?.path ?? window.headingPath,
              mode: unit?.container === 'opaque' ? ('opaque' as const) : ('label' as const),
            };
          }),
        },
      });
      const labels =
        'raw' in answer
          ? reader.parseDenseAnswer(answer.raw)
          : answer.labels.map((l) => ({
              units: String(l.units),
              label: l.label,
              ...(l.target !== undefined ? { target: l.target } : {}),
            }));
      return { labels, returnedModel: 'planted', stopReason: 'end_turn', usage: { input: 0, output: 0 } };
    },
  };
}

const TEST_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'test-key-not-real',
  JEV_API_KEY: 'test-key-not-real',
  JEV_KEY: 'test-key-not-real',
};

function fetchOf(
  transport: Transport,
): (url: unknown, init?: { headers?: unknown; body?: unknown }) => Promise<Response> {
  return async (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw instanceof Headers)
      raw.forEach((v, k) => {
        headers[k] = v;
      });
    else if (Array.isArray(raw)) for (const [k, v] of raw as Array<[string, string]>) headers[k] = v;
    else if (raw && typeof raw === 'object') Object.assign(headers, raw);
    const out = await transport({
      url: String(url),
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(out.body, { status: out.status });
  };
}

/* ----- scan ----- */

async function scan(request: ScanRequest): Promise<ScanResult> {
  const reader = await load();
  const fail = (error: string): ScanResult => ({
    ok: false,
    error,
    warnings: [],
    atoms: [],
    diagnostics: [],
  });
  const labelsText = request.labelsYaml ?? reader.AGENT_RULES_SET;
  const parsed = reader.parseLabelSets(labelsText);
  if (!parsed.ok) return fail(parsed.message);
  let previous: RLedger | undefined;
  if (request.previousLedger !== undefined) {
    previous = reader.parseLedger(request.previousLedger);
    if (!previous) return fail('the previous ledger cannot be read');
  }
  const cuts = new Map<string, RCut>();
  for (const file of request.files) cuts.set(file.path, reader.cut(file.text));
  const counter = { calls: 0 };
  const mode = request.cassette?.mode ?? 'record';
  const cassette = reader.Cassette.parse(request.cassette?.text ?? '');
  let labeler: RLabeler | undefined;
  if (request.model) {
    try {
      labeler = reader.labelerByName(request.model.arm, {
        record: mode === 'record',
        env: TEST_ENV,
        fetch: fetchOf(request.model.transport),
        ...(request.model.threshold !== undefined ? { threshold: request.model.threshold } : {}),
      });
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : String(cause));
    }
    if (!labeler) return fail(`the reader has no labeller named ${request.model.arm}`);
  } else {
    labeler = plantedLabeler(reader, request, cuts, counter);
  }
  const effectiveMode = request.model ? mode : 'record';
  let result: RResult;
  try {
    result = await reader.pointerScan({
      files: request.files,
      sets: parsed.sets,
      labeler,
      cassette,
      mode: effectiveMode,
      ...(previous ? { previous } : {}),
    });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
  const view = viewOf(reader, result.ledger, result.cuts);
  if (request.check && request.previousLedger !== undefined && view.raw !== request.previousLedger)
    return { ...fail('the ledger is stale'), ledger: view };

  const texts = new Map(request.files.map((f: SourceFile) => [f.path, f.text]));
  let atoms: Atom[] = [];
  const diagnostics: Diagnostic[] = [
    ...result.refusals.map((detail) => ({ code: 'refusal', detail })),
    ...result.failed.map((detail) => ({ code: 'failed-window', detail })),
  ];
  try {
    const builder = new reader.AtomBuilder(new Map());
    const made = reader.pointerAtoms(result.labelled, texts, builder, labeler.id);
    atoms = made.accepted.map(atomOf);
    diagnostics.push(
      ...made.refusals.map((detail) => ({ code: 'atom-refusal', detail })),
      ...made.duplicates.map((detail) => ({ code: 'duplicate', detail })),
    );
  } catch (cause) {
    diagnostics.push({
      code: 'atoms-failed',
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return {
    ok: true,
    warnings: [],
    ledger: view,
    atoms,
    diagnostics,
    cassette: cassette.render(),
    events: eventsOf(previous, result.ledger),
    eventCounts: result.events,
    windows: result.windows,
    calls: request.model ? result.calls : counter.calls,
  };
}

function atomOf(atom: RAtom): Atom {
  const fields = atom.fields ?? {};
  const polarity = typeof fields.polarity === 'string' ? fields.polarity : undefined;
  return {
    kind: atom.kind,
    ...(polarity ? { polarity } : {}),
    file: atom.provenance.file,
    startLine: atom.provenance.startLine,
    endLine: atom.provenance.endLine,
    quote: atom.provenance.quote,
    producedBy: atom.producedBy,
    approved: atom.approved,
    fields: {
      extraction: String(fields.extraction ?? ''),
      unit: String(fields.unit ?? ''),
      labelSet: String(fields.labelSet ?? fields.set ?? ''),
      ...(typeof fields.cassette === 'string' ? { cassette: fields.cassette } : {}),
    },
    evidence: atom.evidence.map((e) => ({
      type: String(e.type),
      name: String(e.name ?? ''),
      ...(typeof e.reviewRequired === 'boolean' ? { reviewRequired: e.reviewRequired } : {}),
    })),
  };
}

/** The real reader as a PointerSut. Layer C is not built in the reader, so `links` is absent. */
export function realReader(): PointerSut {
  return {
    name: 'pointer-reader',
    async cut(file: SourceFile): Promise<CutResult> {
      const reader = await load();
      const out = reader.cut(file.text);
      return { units: out.units.map(toUnit), cutDigest: out.digest };
    },
    scan,
  };
}
