import { parse as parseYaml } from 'yaml';
import type {
  Atom,
  CassetteMissView,
  CutResult,
  CutUnit,
  Diagnostic,
  EditClass,
  LedgerEntry,
  LedgerView,
  ListedCandidates,
  ManifestAtom,
  ManifestChange,
  PointerSut,
  RerunApi,
  ScanFailure,
  ScanRequest,
  ScanResult,
  SettingsApi,
  SettingsIssue,
  SourceFile,
  StackApi,
  Transport,
} from './port';
import { ReaderNotReachable } from './port';
import { SentRecorder } from './sent';

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
  lineage?: LedgerEntry['lineage'];
  twinOf?: LedgerEntry['twinOf'];
};
type RLedger = { version: 1; cutDigests: Record<string, string>; entries: REntry[] };
type RSet = { set: string; description: string; labels: unknown[] };
/** A structured diagnostic of the reader: a stable `code` beside the text, and the identifiers the text names. */
type RDiag = {
  code: string;
  detail: string;
  window?: string;
  unit?: string;
  units?: string;
  target?: string;
  kind?: string;
  span?: string;
  set?: string;
  label?: string;
  path?: string;
  labeler?: string;
  repeats?: string;
  parent?: string;
  sum?: number;
};
/** A label file the reader refused, with its code, reason and the offending names. */
type RLabelFailure = {
  ok: false;
  message: string;
  code?: string;
  reason?: string;
  set?: string;
  label?: string;
  kind?: string;
  parent?: string;
  path?: string;
};
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
  cls: 'system1' | 'system2';
  settings: Readonly<Record<string, unknown>>;
  model: string;
  runs?: number;
  maxUnits(set: RSet, wanted: number): number;
  render(set: RSet, window: RWindow, context?: RContext): RWire;
  opinions(answer: RRecorded, set: RSet, window: RWindow): unknown;
  call?(wire: RWire, set: RSet, window: RWindow): Promise<RRecorded>;
};
/** What a request lists for a labeler to point at, as the reader hands it to `render`. */
type RContext = {
  candidates?: Readonly<Record<string, ReadonlyArray<{ id: string; label: string; shown?: string }>>>;
};
type RLabelling = { members: readonly RLabeler[]; describe: string };
type RCassette = { render(): string };
type RLabelledUnit = unknown;
type RResult = {
  ledger: RLedger;
  events: Record<string, number>;
  /** Observability extensions: absence is not an empty observation. */
  eventsById?: Record<string, string>;
  warnings?: string[];
  cuts: Map<string, RCut>;
  labelled: RLabelledUnit[];
  windows: number;
  carried: number;
  calls: number;
  unlabeled: number;
  refusals: string[];
  failed: string[];
  /** One record for each text of the lists beside them, in the same order; absent in a reader without codes. */
  refusalRecords?: RDiag[];
  droppedRecords?: RDiag[];
  failedRecords?: RDiag[];
  recorded: number;
  /** Units one member of a stack decided alone because the other gave no opinion. */
  fellBack?: number;
};
type RAtom = {
  kind: string;
  title?: string;
  situation?: string;
  provenance: { file: string; startLine: number; endLine: number; quote: string };
  producedBy: string;
  approved: boolean;
  fields?: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
};

type RChange = { id: string; class: string; path: string; sectionPath: string[]; quote: string };
type RRerun = { units: Map<string, string[]>; advisory: Map<string, string[]>; whole: string | null };
type RManifest = { changes: Array<{ kind: string; id?: string; global?: boolean }> };

type RSettings =
  | {
      ok: true;
      settings: { threshold?: { labeler?: number; passAt?: number; failAt?: number; marginCut?: number } };
    }
  | { ok: false; errors: string[]; issues?: SettingsIssue[] };

type BuildLabelling = (
  specs: Array<{ cls: 'system1' | 'system2'; client: string; target?: string }>,
  options: {
    env: Record<string, string | undefined>;
    cwd: string;
    record: boolean;
    threshold?: number;
    marginCut?: number;
    fetch?: unknown;
  },
) => Promise<
  { ok: true; labelling: RLabelling } | { ok: false; message: string; code?: string; set?: string }
>;

export type ReaderExports = {
  /** Optional reader of the settings file. */
  parsePointerSettings?(value: unknown): RSettings;
  /** The same read, with one structured issue (`code`, `key`, `reason`) beside each error text. */
  parsePointerSettingsDetailed?(value: unknown): RSettings;
  /** Optional rerun rule of the ledger: absent exports fail the items that need them, explicitly. */
  ledgerChanges?(before: RLedger, after: RLedger): RChange[];
  rerunOf?(changes: readonly RChange[], before: RLedger): RRerun;
  /** Optional change manifest of a rerun set: absent exports fail the items that need them, explicitly. */
  atomsByUnit?(atoms: ReadonlyArray<{ id: string; fields?: Record<string, unknown> }>): Map<string, string[]>;
  ledgerChangeManifest?(
    rerun: RRerun,
    options: { from: string; to: string; atomsByUnit?: ReadonlyMap<string, readonly string[]> },
  ): RManifest;
  /** Optional stack observables. Unsupported rules fail explicitly. */
  margin?: StackApi['margin'];
  stackDecision?: StackApi['decide'];
  AGENT_RULES_SET: string;
  AtomBuilder: new (files: ReadonlyMap<string, unknown>) => { atoms: RAtom[] };
  Cassette: { parse(text: string): RCassette };
  cut(source: string): RCut;
  LabelerError: new (message: string) => Error;
  buildLabelling: BuildLabelling;
  /** The same build, and a refusal that also carries a `code` and the `set` it is about. */
  buildLabellingDetailed?: BuildLabelling;
  singleLabelling(labeler: RLabeler): RLabelling;
  denseOpinions(answer: RRecorded, set: RSet, window: RWindow): unknown;
  /** Optional validator seam; the adapter never implements lockfile semantics. */
  checkLedger?(
    previous: string | undefined,
    current: RLedger,
  ): { ok: boolean; error?: string; code?: string; files?: string[] };
  parseDenseAnswer(text: string, expected?: { window?: string; set?: string }): RLabelled[];
  parseLabelSets(text: string): { ok: true; sets: RSet[] } | RLabelFailure;
  /** The same read, and a refusal that also carries a `code`, a `reason` and the offending names. */
  parseLabelSetsDetailed?(text: string): { ok: true; sets: RSet[] } | RLabelFailure;
  parseLedger(text: string): RLedger | undefined;
  renderLedger(ledger: RLedger): string;
  setHash(set: RSet): string;
  pointerScan(input: Record<string, unknown>): Promise<RResult>;
  pointerAtoms(
    labelled: readonly RLabelledUnit[],
    texts: ReadonlyMap<string, string>,
    builder: { atoms: RAtom[] },
    labeler: string,
  ): {
    accepted: RAtom[];
    refusals: string[];
    duplicates: string[];
    refusalRecords?: RDiag[];
    duplicateRecords?: RDiag[];
  };
};

const NAMES = [
  'AtomBuilder',
  'AGENT_RULES_SET',
  'Cassette',
  'cut',
  'LabelerError',
  'buildLabelling',
  'singleLabelling',
  'denseOpinions',
  'parseDenseAnswer',
  'parseLabelSets',
  'parseLedger',
  'renderLedger',
  'setHash',
  'pointerScan',
  'pointerAtoms',
] as const;

const SPECIFIER = '@agent-nexus/driftbench-estate';
let loaded: Promise<ReaderExports> | undefined;

/** Bounds module loading once, before a baseline can spend an item timeout on a missing component. */
export async function loadReaderExports(
  importer: () => Promise<Record<string, unknown>>,
  timeoutMs = 5_000,
  timeout: (message: string) => Error = (message) => new ReaderNotReachable(message),
): Promise<ReaderExports> {
  let timer: NodeJS.Timeout | undefined;
  const importing = (async () => {
    let mod: Record<string, unknown>;
    try {
      mod = await importer();
    } catch (cause) {
      throw new ReaderNotReachable(
        `${SPECIFIER} cannot be loaded (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    const ns = (mod.pointer ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...ns, AtomBuilder: mod.AtomBuilder };
    const missing = NAMES.filter((n) => merged[n] === undefined);
    if (missing.length > 0)
      throw new ReaderNotReachable(`${SPECIFIER} does not export ${missing.join(', ')} (namespace pointer)`);
    return merged as unknown as ReaderExports;
  })();
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          timeout(
            `${SPECIFIER} import did not settle within ${timeoutMs} ms; the reader component must be available before a baseline`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([importing, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The import did not settle in time. The import goes on in the background, so another attempt can succeed. */
class ReaderLoadTimeout extends ReaderNotReachable {}

/**
 * Loads the reader, trying again when the import is slow. A slow load is a property of the machine (a busy one
 * transforms the package for longer than one bound), never of the reader; any other failure is final.
 */
export async function loadReaderWithRetry(
  importer: () => Promise<Record<string, unknown>>,
  timeoutMs = 5_000,
  attempts = 12,
): Promise<ReaderExports> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await loadReaderExports(importer, timeoutMs, (message) => new ReaderLoadTimeout(message));
    } catch (cause) {
      if (!(cause instanceof ReaderLoadTimeout)) throw cause;
      last = cause;
    }
  }
  throw last;
}

function load(timeoutMs?: number): Promise<ReaderExports> {
  // A failed load is not kept: the next call tries again instead of failing every later item the same way.
  loaded ??= loadReaderWithRetry(
    async () => (await import(/* @vite-ignore */ SPECIFIER)) as Record<string, unknown>,
    timeoutMs,
  ).catch((cause: unknown) => {
    loaded = undefined;
    throw cause;
  });
  return loaded;
}

/** A real baseline requires the actual reader exports before it runs any item or writes any score. */
export async function assertReaderAvailable(timeoutMs?: number): Promise<void> {
  await load(timeoutMs);
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

function viewOf(reader: ReaderExports, ledger: RLedger, cuts: Map<string, RCut>): LedgerView {
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
      ...(e.lineage !== undefined ? { lineage: e.lineage } : {}),
      ...(e.twinOf !== undefined ? { twinOf: e.twinOf } : {}),
    };
  });
  return { raw: reader.renderLedger(ledger), entries };
}

/* ----- labelers ----- */

/**
 * A labeler member that reports which candidates each request it sends was meant to list. Its renderer notes the
 * context it was handed against the wire it returns; its call runs inside the scope of that wire, so the body the
 * transport receives (see `fetchOf`) is paired with the context of exactly that request. The member serialises
 * nothing: a candidate is listed from the string the transport received and from nothing else (`sut/sent.ts`).
 * A renderer that drops candidates, prints another title, or keeps them in a field that is not sent, lists fewer.
 */
export function recordingMember(member: RLabeler, recorder: SentRecorder): RLabeler {
  const render = (set: RSet, window: RWindow, context?: RContext): RWire => {
    const wire = member.render(set, window, context);
    const byLink = Object.fromEntries(
      Object.entries(context?.candidates ?? {}).map(([link, list]) => [
        link,
        list.map((c) => ({ id: c.shown ?? c.id, title: c.label })),
      ]),
    );
    recorder.note(wire, { where: { file: window.path, window: window.id, set: set.set }, byLink });
    return wire;
  };
  const original = member.call;
  const call = original
    ? (wire: RWire, ...rest: unknown[]): Promise<RRecorded> =>
        recorder.during(wire, () => Reflect.apply(original, member, [wire, ...rest]) as Promise<RRecorded>)
    : undefined;
  return Object.create(member, {
    render: { value: render },
    ...(call ? { call: { value: call } } : {}),
  }) as RLabeler;
}

function plantedLabeler(reader: ReaderExports, request: ScanRequest, cuts: Map<string, RCut>): RLabeler {
  const planted = request.labeler;
  return {
    id: 'planted',
    family: 'planted',
    cls: 'system2',
    settings: {},
    model: 'planted',
    ...(request.labelerRuns !== undefined ? { runs: request.labelerRuns } : {}),
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({ labeler: 'planted', body: { set: set.set, window } }),
    opinions: (answer, set, window) => reader.denseOpinions(answer, set, window),
    async call(_wire, set, window) {
      if (!planted) throw new reader.LabelerError('no labeller');
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

/**
 * The offline environment of a recording scan. Every labeler needs its key and, for the system 1 client, an address
 * before the reader lets a run record. Nothing here is real: the address is a reserved `.invalid` name, and the
 * scan sends every request through the fake transport of the item, so no socket opens.
 */
const TEST_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'test-key-not-real',
  JEV_API_KEY: 'test-key-not-real',
  JEV_KEY: 'test-key-not-real',
  JEV_URL: 'https://jev.invalid/v1/systemone',
  OPENAI_API_KEY: 'test-key-not-real',
  OPENAI_BASE_URL: 'https://openai.invalid',
  OPENAI_DECISIONS_MODEL: 'decisions-fake-1',
};

/** The address of the `user-yes-no` labeler: a reserved `.invalid` name only the fake transport answers. */
const USER_LABELER_URL = 'https://labeler.invalid/v1/label';

/**
 * The environment of a scan whose item watches the key of the `haiku` arm: the same values, with the key
 * behind a getter that reports each read. The reader decides when it reads the key; the binding reports it.
 */
function envOf(onKeyRead: (() => void) | undefined): Record<string, string | undefined> {
  if (!onKeyRead) return TEST_ENV;
  const env: Record<string, string | undefined> = { ...TEST_ENV };
  Object.defineProperty(env, 'ANTHROPIC_API_KEY', {
    enumerable: true,
    configurable: true,
    get() {
      onKeyRead();
      return TEST_ENV.ANTHROPIC_API_KEY;
    },
  });
  return env;
}

/** The labelers the model port of a request names: one arm, or a choice system 1 arm then the `haiku` arm. */
function specsOf(
  model: NonNullable<ScanRequest['model']>,
): Array<{ cls: 'system1' | 'system2'; client: string; target?: string }> | string {
  const { arm } = model;
  if (model.stack) {
    if (arm !== 'jev' && arm !== 'jev-unit') return `a stack takes a choice system 1 arm, not ${arm}`;
    return [
      { cls: 'system1', client: arm },
      { cls: 'system2', client: 'anthropic' },
    ];
  }
  if (arm === 'user-yes-no') return [{ cls: 'system1', client: 'http', target: USER_LABELER_URL }];
  if (arm === 'http') return [{ cls: 'system2', client: 'http', target: model.url ?? '' }];
  if (arm === 'haiku') return [{ cls: 'system2', client: 'anthropic' }];
  return [{ cls: 'system1', client: arm }];
}

/**
 * The fetch the product posts through. The body string it is handed is the one string handed on to the transport,
 * and the one the recorder reads the listed candidates from.
 */
export function fetchOf(
  transport: Transport,
  recorder?: SentRecorder,
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
    const body = typeof init?.body === 'string' ? init.body : '';
    recorder?.received(body);
    const out = await transport({ url: String(url), headers, body });
    return new Response(out.body, { status: out.status });
  };
}

/* ----- scan ----- */

/** The structured fields of a thrown cassette miss (its properties, not its message), or nothing for another failure. */
function missOf(cause: unknown): CassetteMissView | undefined {
  if (!(cause instanceof Error) || cause.name !== 'CassetteMiss') return undefined;
  const fields = cause as Error & Record<'key' | 'differs' | 'nearest' | 'labeler' | 'environment', unknown>;
  if (typeof fields.key !== 'string' || !Array.isArray(fields.differs)) return undefined;
  const environment = fields.environment as { node?: unknown; icu?: unknown } | undefined;
  return {
    key: fields.key,
    differs: fields.differs.filter((field): field is string => typeof field === 'string'),
    ...(typeof fields.nearest === 'string' ? { nearest: fields.nearest } : {}),
    ...(typeof fields.labeler === 'string' ? { labeler: fields.labeler } : {}),
    ...(typeof environment?.node === 'string' && typeof environment.icu === 'string'
      ? { environment: { node: environment.node, icu: environment.icu } }
      : {}),
  };
}

/** A diagnostic of the port from a record of the reader: the class is the `code`, the record's code the `reason`. */
function diagnosticOf(code: string, record: RDiag): Diagnostic {
  const { code: reason, ...fields } = record;
  return { code, reason, ...fields };
}

/** The diagnostics of one list: the records of the reader when it gives them, else its texts alone. */
function diagnosticsOf(
  code: string,
  texts: readonly string[],
  records: readonly RDiag[] | undefined,
): Diagnostic[] {
  return records
    ? records.map((record) => diagnosticOf(code, record))
    : texts.map((detail) => ({ code, detail }));
}

/** The code of a thrown error of the reader, from its properties and never from its message. */
function failureOfThrown(cause: unknown): ScanFailure | undefined {
  // The errors of the reader that carry a stable `code` (and a `set`); a system error carries a code too.
  const own =
    cause instanceof Error &&
    (cause.name === 'LabelerConfigError' || cause.name === 'LabelerError' || cause.name === 'CassetteMiss');
  if (!own) return undefined;
  const fields = cause as Error & Record<'code' | 'set', unknown>;
  if (typeof fields.code !== 'string') return undefined;
  return { code: fields.code, ...(typeof fields.set === 'string' ? { set: fields.set } : {}) };
}

/** The structured cause of a refused label file, or nothing for a reader that gives none. */
function failureOfLabels(refused: RLabelFailure): ScanFailure | undefined {
  if (typeof refused.code !== 'string') return undefined;
  return {
    code: refused.code,
    ...(refused.reason !== undefined ? { reason: refused.reason } : {}),
    ...(refused.set !== undefined ? { set: refused.set } : {}),
    ...(refused.label !== undefined ? { label: refused.label } : {}),
    ...(refused.kind !== undefined ? { kind: refused.kind } : {}),
    ...(refused.parent !== undefined ? { parent: refused.parent } : {}),
    ...(refused.path !== undefined ? { path: refused.path } : {}),
  };
}

async function scan(reader: ReaderExports, request: ScanRequest): Promise<ScanResult> {
  const fail = (error: string, failure?: ScanFailure): ScanResult => ({
    ok: false,
    error,
    ...(failure ? { failure } : {}),
    atoms: [],
    diagnostics: [],
  });
  if (request.check && !reader.checkLedger)
    throw new ReaderNotReachable('check mode requires the reader checkLedger export');
  const labelsText = request.labelsYaml ?? reader.AGENT_RULES_SET;
  const parsed = (reader.parseLabelSetsDetailed ?? reader.parseLabelSets)(labelsText);
  if (!parsed.ok) return fail(parsed.message, failureOfLabels(parsed));
  let previous: RLedger | undefined;
  if (request.previousLedger !== undefined) {
    previous = reader.parseLedger(request.previousLedger);
    if (!previous) return fail('the previous ledger cannot be read');
  }
  const cuts = new Map<string, RCut>();
  for (const file of request.files) cuts.set(file.path, reader.cut(file.text));
  const listed: ListedCandidates[] = [];
  const recorder = new SentRecorder({ rows: listed, seen: new Set<string>() });
  const mode = request.cassette?.mode ?? 'record';
  const cassette = reader.Cassette.parse(request.cassette?.text ?? '');
  let labelling: RLabelling;
  if (request.model) {
    const specs = specsOf(request.model);
    if (typeof specs === 'string') return fail(specs);
    const marginCut = request.model.stack?.marginCut;
    try {
      const built = await (reader.buildLabellingDetailed ?? reader.buildLabelling)(specs, {
        record: mode === 'record',
        cwd: '.',
        env: envOf(request.model.onKeyRead),
        fetch: fetchOf(request.model.transport, recorder),
        ...(request.model.threshold !== undefined ? { threshold: request.model.threshold } : {}),
        ...(marginCut !== undefined ? { marginCut } : {}),
      });
      if (!built.ok)
        return fail(
          built.message,
          built.code !== undefined
            ? { code: built.code, ...(built.set !== undefined ? { set: built.set } : {}) }
            : undefined,
        );
      labelling = built.labelling;
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : String(cause), failureOfThrown(cause));
    }
  } else {
    labelling = reader.singleLabelling(plantedLabeler(reader, request, cuts));
  }
  labelling = {
    ...labelling,
    members: labelling.members.map((member) => recordingMember(member, recorder)),
  };
  let result: RResult;
  try {
    result = await reader.pointerScan({
      files: request.files,
      sets: parsed.sets,
      labelling,
      cassette,
      mode,
      ...(previous ? { previous } : {}),
      ...(request.estateKey !== undefined ? { estateKey: request.estateKey } : {}),
      ...(request.atoms ? { atoms: request.atoms } : {}),
    });
  } catch (cause) {
    const miss = missOf(cause);
    return {
      ...fail(cause instanceof Error ? cause.message : String(cause), failureOfThrown(cause)),
      ...(miss ? { miss } : {}),
    };
  }
  const view = viewOf(reader, result.ledger, result.cuts);
  if (request.check && reader.checkLedger) {
    const checked = reader.checkLedger(request.previousLedger, result.ledger);
    if (!checked.ok)
      return {
        ...fail(
          checked.error ?? 'the reader rejected check mode',
          typeof checked.code === 'string'
            ? { code: checked.code, ...(checked.files ? { files: [...checked.files] } : {}) }
            : undefined,
        ),
        ledger: view,
        ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
      };
  }

  const texts = new Map(request.files.map((f: SourceFile) => [f.path, f.text]));
  let atoms: Atom[] = [];
  const diagnostics: Diagnostic[] = [
    ...diagnosticsOf('refusal', result.refusals, result.refusalRecords),
    ...diagnosticsOf('failed-window', result.failed, result.failedRecords),
    ...(result.droppedRecords ?? []).map((record) => diagnosticOf('dropped', record)),
  ];
  try {
    const builder = new reader.AtomBuilder(new Map());
    const made = reader.pointerAtoms(result.labelled, texts, builder, labelling.describe);
    atoms = made.accepted.map(atomOf);
    diagnostics.push(
      ...diagnosticsOf('atom-refusal', made.refusals, made.refusalRecords),
      ...diagnosticsOf('duplicate', made.duplicates, made.duplicateRecords),
    );
  } catch (cause) {
    diagnostics.push({
      code: 'atoms-failed',
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return {
    ok: true,
    ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
    ledger: view,
    atoms,
    diagnostics,
    cassette: cassette.render(),
    ...(result.eventsById !== undefined ? { events: result.eventsById } : {}),
    eventCounts: result.events,
    windows: result.windows,
    calls: result.calls,
    listed,
    ...(result.fellBack !== undefined ? { fellBack: result.fellBack } : {}),
  };
}

function atomOf(atom: RAtom): Atom {
  const fields = atom.fields ?? {};
  const polarity = typeof fields.polarity === 'string' ? fields.polarity : undefined;
  return {
    kind: atom.kind,
    ...(polarity ? { polarity } : {}),
    ...(typeof atom.title === 'string' ? { title: atom.title } : {}),
    ...(typeof atom.situation === 'string' && atom.situation !== '' ? { situation: atom.situation } : {}),
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
      ...(Array.isArray(fields.condition) ? { condition: fields.condition.map(String) } : {}),
    },
    evidence: atom.evidence.map((e) => {
      // The reader keeps the settings of a custom check under `options`; the binding passes them on whole.
      const options =
        typeof e.options === 'object' && e.options !== null
          ? (e.options as Record<string, unknown>)
          : undefined;
      const reviewRequired =
        typeof e.reviewRequired === 'boolean' ? e.reviewRequired : options?.reviewRequired;
      return {
        type: String(e.type),
        name: String(e.name ?? ''),
        ...(typeof reviewRequired === 'boolean' ? { reviewRequired } : {}),
        ...(options ? { options } : {}),
      };
    }),
  };
}

/** The settings reader of the reader: the text is parsed as YAML here, every decision about it is the reader's. */
function settingsOf(reader: ReaderExports): SettingsApi {
  const keys = { labeler: 'labeler', passAt: 'pass_at', failAt: 'fail_at', marginCut: 'margin_cut' } as const;
  return {
    parse(text) {
      if (!reader.parsePointerSettings)
        throw new ReaderNotReachable('the reader does not export parsePointerSettings');
      let value: unknown;
      try {
        value = parseYaml(text);
      } catch (cause) {
        return {
          ok: false,
          errors: [cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)],
        };
      }
      const out = (reader.parsePointerSettingsDetailed ?? reader.parsePointerSettings)(value);
      if (!out.ok) return { ok: false, errors: out.errors, ...(out.issues ? { issues: out.issues } : {}) };
      const thresholds: Record<string, number> = {};
      for (const [name, key] of Object.entries(keys)) {
        const given = out.settings.threshold?.[name as keyof typeof keys];
        if (given !== undefined) thresholds[key] = given;
      }
      return { ok: true, thresholds };
    },
  };
}

/** The rerun rule of the reader's ledger, mapped onto the port without any decision of the adapter's own. */
function rerunOf(reader: ReaderExports): RerunApi {
  const parse = (view: LedgerView): RLedger => {
    const ledger = reader.parseLedger(view.raw);
    if (!ledger) throw new ReaderNotReachable('the reader cannot read the ledger it wrote');
    return ledger;
  };
  const changes = (previous: LedgerView, current: LedgerView): { before: RLedger; list: RChange[] } => {
    if (!reader.ledgerChanges || !reader.rerunOf)
      throw new ReaderNotReachable('the reader does not export ledgerChanges and rerunOf');
    const before = parse(previous);
    return { before, list: reader.ledgerChanges(before, parse(current)) };
  };
  return {
    classify(previous, current) {
      return changes(previous, current).list.map((change) => ({
        id: change.id,
        class: change.class as EditClass,
      }));
    },
    rerun(previous, current) {
      const { before, list } = changes(previous, current);
      const out = (reader.rerunOf as NonNullable<ReaderExports['rerunOf']>)(list, before);
      return {
        units: [...out.units.keys()].sort(),
        advisory: [...out.advisory.keys()].sort(),
        whole: out.whole,
      };
    },
    manifest(previous, current, atoms) {
      if (!reader.atomsByUnit || !reader.ledgerChangeManifest)
        throw new ReaderNotReachable('the reader does not export atomsByUnit and ledgerChangeManifest');
      const { before, list } = changes(previous, current);
      const rerun = (reader.rerunOf as NonNullable<ReaderExports['rerunOf']>)(list, before);
      const byUnit = reader.atomsByUnit(atoms.map(fieldsOf));
      const out = reader.ledgerChangeManifest(rerun, { from: 'before', to: 'after', atomsByUnit: byUnit });
      return out.changes.map(changeOf);
    },
  };
}

/** A manifest atom as the reader keeps it: the unit and the condition units in its fields. */
const fieldsOf = (atom: ManifestAtom) => ({
  id: atom.id,
  fields: { unit: atom.unit, ...(atom.condition ? { condition: [...atom.condition] } : {}) },
});

/** A change of the reader's manifest, its kind, id and global flag passed on unchanged. */
const changeOf = (change: { kind: string; id?: string; global?: boolean }): ManifestChange => ({
  kind: change.kind,
  ...(change.id !== undefined ? { id: change.id } : {}),
  ...(change.global !== undefined ? { global: change.global } : {}),
});

/** The real reader as a PointerSut. Layer C is not built in the reader, so `links` is absent. */
export function realReader(): PointerSut {
  return {
    name: 'pointer-reader',
    isolate: true,
    ready: async () => {
      await load();
    },
    async cut(file: SourceFile): Promise<CutResult> {
      const reader = await load();
      const out = reader.cut(file.text);
      return { units: out.units.map(toUnit), cutDigest: out.digest };
    },
    scan: async (request) => scan(await load(), request),
    rerun: {
      classify: async (previous, current) => rerunOf(await load()).classify(previous, current),
      rerun: async (previous, current) => rerunOf(await load()).rerun(previous, current),
      manifest: async (previous, current, atoms) => {
        const api = rerunOf(await load());
        return (api.manifest as NonNullable<RerunApi['manifest']>)(previous, current, atoms);
      },
    },
    settings: { parse: async (text) => settingsOf(await load()).parse(text) },
    stack: {
      margin: async (probabilities) => stackOf(await load()).margin(probabilities),
      decide: async (request) => stackOf(await load()).decide(request),
    },
  };
}

/** Binds an already loaded reader for seam verification; it does not replace reader behavior. */
export function readerAdapter(reader: ReaderExports): PointerSut {
  return {
    name: 'pointer-reader',
    async cut(file) {
      const out = reader.cut(file.text);
      return { units: out.units.map(toUnit), cutDigest: out.digest };
    },
    scan: (request) => scan(reader, request),
    rerun: rerunOf(reader),
    settings: settingsOf(reader),
    stack: stackOf(reader),
  };
}

function stackOf(reader: ReaderExports): StackApi {
  return {
    margin(probabilities) {
      if (!reader.margin) throw new ReaderNotReachable('the reader does not expose margin');
      return reader.margin(probabilities);
    },
    decide(request) {
      if (!reader.stackDecision)
        throw new ReaderNotReachable('the reader does not expose the independent-vote stackDecision seam');
      return reader.stackDecision(request);
    },
  };
}
