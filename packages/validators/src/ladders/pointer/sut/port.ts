/**
 * The port of the pointer bank: the one surface the items call. It is written from docs/estate-pointer-reader.md
 * alone. A binding (adapter.ts) maps the real reader onto it; the tests map a reference reader onto it.
 *
 * Offsets are UTF-16 code units into the text the reader was given, byte-order mark included.
 */

export type SourceFile = { path: string; text: string };

/** The container names the bank uses. The design names `heading`, `sentence` and `list_item`; the rest are the bank's. */
export type Container =
  | 'heading'
  | 'sentence'
  | 'list_item'
  | 'table_cell'
  | 'block_quote'
  | 'front_matter'
  | 'fence'
  | 'comment';

export type CutUnit = {
  container: string;
  start: number;
  end: number;
  /** `source.slice(start, end)`. */
  text: string;
  fp: string;
  /** The heading path above the unit (ancestors only). */
  path: string[];
  /** For a front matter value: its YAML path. */
  yamlPath?: string[];
  /** True for a fence or a comment: shown to a labeller as a kind and a first line only. */
  opaque: boolean;
};

export type CutResult = { units: CutUnit[]; cutDigest: string };

/* ----- label sets (design section 1) ----- */

export type AtomMapping = { kind: string; polarity?: string };

export type LabelDef = {
  name: string;
  description: string;
  examples?: string[];
  target?: 'required';
  /** The unit states when its target applies; it builds no atom (docs, section 6). */
  condition?: true;
  atom?: AtomMapping;
};

export type LabelSetDef = { set: string; description: string; labels: LabelDef[] };

/* ----- the labeller port (design section 3) ----- */

/** `label` is selectable; `context` belongs to a neighbouring window; `opaque` is a fence or comment; `read` is already an atom made by code. */
export type WindowMode = 'label' | 'context' | 'opaque' | 'read';

export type WindowUnit = {
  n: number;
  /** The text the labeller is shown (an opaque unit shows its kind and first line only). */
  text: string;
  container: string;
  /** The heading path above the unit. */
  path: string[];
  mode: WindowMode;
};

export type LabelRequest = {
  set: string;
  setHash: string;
  labels: LabelDef[];
  window: { id: string; file: string; path: string[]; units: WindowUnit[] };
};

export type LabelEntry = { units: string | number; label: string; target?: number };
export type LabelAnswer = { labels: LabelEntry[]; meta?: Record<string, unknown> } | { raw: string };
export type Labeler = (request: LabelRequest) => LabelAnswer | Promise<LabelAnswer>;

/* ----- model transports (the single recording seam, design section 5) ----- */

export type FetchRequest = { url: string; headers: Record<string, string>; body: string };
export type FetchResponse = { status: number; body: string };
export type Transport = (request: FetchRequest) => FetchResponse | Promise<FetchResponse>;

export type ModelArm = 'haiku' | 'jev' | 'jev-unit';
/**
 * The arms a scan can record on: the three of the fixtures; `openai-decisions`, the system 1 client that asks
 * yes or no questions and takes a label at a threshold (the choice arms `jev` and `jev-unit` have none); and
 * `user-yes-no`, a user labeler of the system 1 class behind an HTTP endpoint (design section 3, a client
 * `http:<url>`): `{ set, window, state, questions }` in, `{ probabilities }` out, a label at a threshold.
 */
export type ScanArm = ModelArm | 'openai-decisions' | 'user-yes-no';

/* ----- scan ----- */

export type CassetteIo = { mode: 'record' | 'replay'; text?: string };

export type ScanRequest = {
  files: SourceFile[];
  /**
   * Where the estate lives, as a parent folder name and a folder name under a temporary folder of the binding.
   * Ids and ledgers must not depend on it. Absent: the binding picks one.
   */
  location?: { parent: string; name: string };
  /** The raw text of the previous ledger. */
  previousLedger?: string;
  /** The label sets as the user writes them (YAML). Absent: the shipped default set. */
  labelsYaml?: string;
  /** A planted labeller called in process. */
  labeler?: Labeler;
  /** Or a model port over a fake transport; with a cassette. */
  model?: { arm: ScanArm; transport: Transport; threshold?: number };
  cassette?: CassetteIo;
  /** Check mode: fail when the ledger is stale instead of writing a new one. */
  check?: boolean;
};

export type LedgerEntry = {
  id: string;
  path: string;
  sectionPath: string[];
  container: string;
  fp: string;
  ctxFp: string;
  quote: string;
  prefix: string;
  suffix: string;
  hint?: { start: number; end: number };
  status: string;
  labels: Record<string, { label: string; source: string; setHash: string }>;
  /** Absent when the reader does not expose lineage; never synthesised by an adapter. */
  lineage?: Array<{ scan: number; event: string }>;
  /** Absent when unavailable; null is an observed absence of a twin. */
  twinOf?: string | null;
};

export type LedgerView = { raw: string; entries: LedgerEntry[] };

export type Atom = {
  kind: string;
  polarity?: string;
  file: string;
  startLine: number;
  endLine: number;
  quote: string;
  producedBy: string;
  approved: boolean;
  /** The conditions of the unit it was built from, joined in file order; absent when it has none. */
  situation?: string;
  fields: { extraction: string; unit: string; labelSet: string; cassette?: string; condition?: string[] };
  /** `options` is the nested settings object of a custom check, as the reader wrote it. */
  evidence: Array<{
    type: string;
    name: string;
    reviewRequired?: boolean;
    options?: Record<string, unknown>;
  }>;
};

export type Diagnostic = { code: string; unit?: string; window?: string; detail: string };

export type ScanResult = {
  ok: boolean;
  /** The failure message when `ok` is false. */
  error?: string;
  /** Absent when the reader does not expose warnings. */
  warnings?: string[];
  ledger?: LedgerView;
  atoms: Atom[];
  diagnostics: Diagnostic[];
  /** The cassette text after a record run. */
  cassette?: string;
  /** What the ladder decided for each id in this scan (`unchanged`, `moved`, `changed`, `split`, `merged`, `ambiguous`, `deleted`, `new`). */
  events?: Record<string, string>;
  /** How many ids got each event in this scan. */
  eventCounts?: Record<string, number>;
  /** Windows sent to the labeller or the model port in this scan, and how many calls reached it. */
  windows?: number;
  calls?: number;
};

/* ----- layer C ----- */

export type LinkState = 'ok' | 'suspect' | 'advisory' | 'ambiguous';

export type Link = {
  /** The test or block that holds the link. */
  owner: string;
  span: string;
  fp: string;
  relation: string;
  createdBy: string;
  accepted: boolean | string;
  /** Set by clearing. */
  reason?: string;
};

export type ClearReason = 'cosmetic' | 'semantic-still-covered' | 'test-updated';

export interface LinksApi {
  /** A link to a span of the ledger, with the span's fingerprint at this moment. */
  create(ledger: LedgerView, owner: string, span: string, relation: string, createdBy?: string): Link;
  /** The state of each link against the current ledger, given the previous one. */
  classify(previous: LedgerView | null, current: LedgerView, links: Link[]): LinkState[];
  /** Clears a suspect link: refused without one of the three reasons. */
  clear(
    link: Link,
    reason: string,
    current: LedgerView,
  ): { ok: true; link: Link } | { ok: false; error: string };
  /** Marks a link verified when the mutation flipped its test. */
  verify(link: Link, evidence: { mutation: 'delete' | 'negate'; flipped: boolean }): Link;
  /** Spans whose label has an atom mapping and that no verified link covers. */
  coverage(
    current: LedgerView,
    mappedLabels: readonly string[],
    links: Link[],
  ): { uncovered: string[]; covered: number };
  /** The tests to rerun after the edit from `previous` to `current`, and the advisory tests. */
  blast(
    previous: LedgerView | null,
    current: LedgerView,
    links: Link[],
  ): { rerun: string[]; advisory: string[] };
}

/* ----- the settings of an estate (docs/estate-pointer-reader.md, section 1) ----- */

export type SettingsResult =
  | { ok: true; thresholds: Record<string, number> }
  | { ok: false; errors: string[] };

export interface SettingsApi {
  /** Reads the YAML text of the settings file. */
  parse(text: string): SettingsResult | Promise<SettingsResult>;
}

/* ----- the rerun rule (docs/estate-pointer-reader.md, "Rerun after an edit") ----- */

export type EditClass = 'unchanged' | 'context' | 'moved' | 'changed' | 'deleted' | 'new';

export interface RerunApi {
  /** The class of every unit between two ledgers: live units of the current ledger, then the units that are gone. */
  classify(
    previous: LedgerView,
    current: LedgerView,
  ): Array<{ id: string; class: EditClass }> | Promise<Array<{ id: string; class: EditClass }>>;
  /**
   * The old units whose links rerun (`units`), those whose links are only reported (`advisory`), and the reason
   * the whole suite reruns when it does (`whole`, null otherwise).
   */
  rerun(
    previous: LedgerView,
    current: LedgerView,
  ):
    | { units: string[]; advisory: string[]; whole: string | null }
    | Promise<{ units: string[]; advisory: string[]; whole: string | null }>;
}

/** A validator-facing observation seam for the product stack (no voting in the adapter). */
export type StackRequest = {
  probabilities: Record<string, number>;
  system1Label?: string;
  system2Votes: Array<string | null>;
  marginCut: number;
  requireAgreement?: boolean;
};
export type StackDecision = { label: string; by: 'system1' | 'system2' } | undefined;
export interface StackApi {
  margin(
    probabilities: Record<string, number>,
  ): { label: string; margin: number } | Promise<{ label: string; margin: number }>;
  decide(request: StackRequest): StackDecision | Promise<StackDecision>;
}

/** The system under test. */
export interface PointerSut {
  readonly name: string;
  /**
   * True when a call of this SUT may never return (the real reader): the runner then serves the items from a child
   * process that it stops when an item overruns, and fails that one item.
   */
  readonly isolate?: boolean;
  /** Loads what the SUT needs, outside any item clock: a load that is slow on a busy machine must not decide an item. */
  ready?(): Promise<void>;
  cut(file: SourceFile): Promise<CutResult>;
  scan(request: ScanRequest): Promise<ScanResult>;
  links?: LinksApi;
  /** The rerun rule of the ledger; absent when the reader does not export it. */
  rerun?: RerunApi;
  /** The reader of the settings file; absent when the reader does not export it. */
  settings?: SettingsApi;
  stack?: StackApi;
}

/** Thrown by the unreachable binding: the reader cannot be called from this checkout. */
export class ReaderNotReachable extends Error {
  constructor(reason: string) {
    super(`the pointer reader is not reachable: ${reason}`);
    this.name = 'ReaderNotReachable';
  }
}
