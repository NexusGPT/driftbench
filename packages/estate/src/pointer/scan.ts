import { ModelError } from '@agent-nexus/driftbench-generate';
import { namedPaths } from '../scan/code';
import { AGENT_RULES_TIE_BREAK } from './agent-rules';
import { type Cassette, CassetteMiss, type Recorded, readableOf, requestKey } from './cassette';
import { type Cut, cut, type Unit } from './cut';
import {
  isTooLarge,
  type Labeler,
  type LabelerClass,
  LabelerConfigError,
  LabelerError,
  type Opinion,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from './labeler';
import {
  type DisplayLine,
  type Label,
  type LabelContext,
  type LabelSet,
  type LinkAnswer,
  type SpanAnswer,
  setHash,
  type Window,
} from './labels';
import {
  type Event,
  type LabelFlip,
  type Ledger,
  type LedgerEntry,
  nextLedger,
  recordLabel,
  unitKey,
} from './ledger';
import type { Labelling } from './stack';

/**
 * The pointer scan: cut each prose file into units, follow the units through the ledger, send the windows
 * that are not yet labelled to the labelers (or read the cassette), and write the labels into the ledger.
 * The labelers return opinions by unit number; code owns every byte of text and decides each label.
 */

export type PointerInput = {
  /** The prose files: path and text. */
  files: ReadonlyArray<{ path: string; text: string }>;
  sets: readonly LabelSet[];
  labelling: Labelling;
  cassette: Cassette;
  /** `replay`: a miss is an error. `record`: a miss calls the labeler and records the answer. */
  mode: 'replay' | 'record';
  estateKey?: string;
  previous?: Ledger;
  /** The most units in one window before the labeler's own cap. Default 60. */
  windowUnits?: number;
  /** Requests in flight at once. Default 1. The labels, the ledger and the cassette bytes do not depend on it. */
  jobs?: number;
  /** Spans of each file the code already reads (a skill's description): those units are shown as read, not asked about. */
  read?: ReadonlyMap<string, ReadonlyArray<{ start: number; end: number }>>;
  /** The atoms of the estate so far: a link kind of a set lists those of its kinds in the request. */
  atoms?: ReadonlyArray<{ id: string; kind: string; title: string }>;
  /** Called once with the plan, before the first request, so a caller can say what a run sends. */
  onPlan?: (plan: PointerPlan) => void;
};

/** The units a request holds when the labeler sets no cap of its own: a file fits one window up to `WINDOW_CHARS`. */
export const DEFAULT_WINDOW_UNITS = Number.POSITIVE_INFINITY;

/** What one labeler of the run is asked: its windows, how many the cassette already answers, what is left to send. */
export type MemberPlan = {
  id: string;
  cls: LabelerClass;
  model: string;
  /** Requests the run needs from this labeler. */
  windows: number;
  /** Of those, the requests the cassette already answers. */
  cached: number;
  /** Characters of the request bodies still to send. */
  characters: number;
};

export type PointerPlan = {
  files: number;
  /** Units a label can point at (a fence or a comment is opaque), summed over the label sets. */
  units: number;
  /** Of those, the units that already hold a label of the current sets and labelers. */
  carried: number;
  members: MemberPlan[];
};

/** A unit that carries a label of a set, ready for the atom builder. */
export type LabelledUnit = {
  path: string;
  index: number;
  unit: Unit;
  id: string;
  set: LabelSet;
  label: string;
  target?: { path: string; index: number; unit: Unit; id: string };
  spans?: SpanAnswer[];
  links?: LinkAnswer[];
  source: string;
  by?: LabelerClass;
};

export type LabelerUsage = {
  id: string;
  cls: LabelerClass;
  model: string;
  /** Requests sent to the service. */
  calls: number;
  /** Answers added to the cassette. */
  recorded: number;
  input: number;
  output: number;
  /** Answers taken from the cassette instead of the service. */
  replayed: number;
  /** The input tokens the replayed answers cost when they were recorded. */
  replayedInput: number;
  /** The output tokens the replayed answers cost when they were recorded. */
  replayedOutput: number;
};

export type PointerResult = {
  ledger: Ledger;
  events: Record<Event, number>;
  /** What the ladder decided for each id of this scan. */
  eventsById: Record<string, Event>;
  cuts: Map<string, Cut>;
  labelled: LabelledUnit[];
  plan: PointerPlan;
  /** Requests answered, by the cassette or by a service. */
  windows: number;
  /** Units that kept the label of the ledger. */
  carried: number;
  /** Units labelled by this run. */
  decided: number;
  /** Of those, how many each class decided. */
  decidedBy: Record<LabelerClass, number>;
  /** Of those, the units one labeler of a stack decided alone because the other gave no opinion. */
  fellBack: number;
  calls: number;
  /** Units no accepted answer named. */
  unlabeled: number;
  /** The same units, by ledger id and set. */
  unlabeledUnits: Array<{ unit: string; set: string }>;
  /** Units that had a label other than none and no longer have one. */
  flips: LabelFlip[];
  /** Units on which the runs of one labeler disagreed: that labeler gave no opinion for them. */
  split: number;
  /** Units whose runs agreed on the label but drew the spans or links differently: the first run's stand. */
  spanSplit: number;
  /** Units a member decided by a majority of its runs instead of all of them. */
  voted: number;
  refusals: string[];
  /** Spans and links of accepted answers that failed a check and were dropped: the label stood without them. */
  dropped: string[];
  /** Runs left out of the vote of a window because they were out of step with its units (`outOfStep`). */
  outOfStep: string[];
  /** Slipped runs whose window was asked again and answered in step, with the run that took their place. */
  reasked: string[];
  /** Windows that could not be labelled, with the reason. */
  failed: string[];
  /** Notes that do not stop a run: a returned model that differs from the one recorded. */
  warnings: string[];
  /** The same windows, by window, set and labeler. */
  failedWindows: FailedWindow[];
  usage: LabelerUsage[];
  /** Answers added to the cassette. */
  recorded: number;
};

/** The sections a window sits in: the headings above its first unit and, when it starts at a heading, that heading. */
function pathOf(first: Unit | undefined): string[] {
  if (!first) return [];
  if (first.container !== 'heading') return first.path;
  const title = (first.text.split(/\r\n|\r|\n/, 1)[0] ?? '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
  return title === '' ? first.path : [...first.path, title];
}

/**
 * The characters of units one window holds before a file is split. About 100,000 tokens at four characters a token:
 * a file under it is one window, whatever its headings.
 */
export const WINDOW_CHARS = 400_000;

/**
 * The windows of a file. A file that fits `budget` characters of unit text is one window; a longer one is split,
 * and only at a heading (the last heading of the run when the next unit would overflow it, else at the unit). A
 * member that takes fewer units per request (`size`) closes a window at that count. With the source text, a cut
 * never falls inside a table row: a label that points from one cell to the next needs both in the window.
 * A fence or comment is a line the labeler reads and cannot label: it keeps its place in the numbering, in the
 * window it stands in or, after a window's last unit, the window before it. A run with no unit to label is no
 * window.
 */
export function windowsOf(
  path: string,
  units: readonly Unit[],
  size: number,
  source?: string,
  budget: number = WINDOW_CHARS,
): Window[] {
  // 1. The groups of labelable units, by index into `units`.
  const groups: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  let lastHeading = -1;
  const close = (keep: number[] = []) => {
    if (current.length > 0) groups.push(current);
    current = keep;
    chars = keep.reduce((sum, at) => sum + (units[at]?.text.length ?? 0), 0);
    lastHeading = -1;
  };
  for (const [index, unit] of units.entries()) {
    if (unit.container === 'opaque') continue;
    const last = current.at(-1);
    const previous = last === undefined ? undefined : units[last];
    const sameRow =
      source !== undefined &&
      previous?.container === 'table_cell' &&
      unit.container === 'table_cell' &&
      !source.slice(previous.end, unit.start).includes('\n');
    if (current.length >= size && !sameRow) close();
    else if (chars + unit.text.length > budget && current.length > 0 && !sameRow) {
      // Over the budget: the run since its last heading moves to the next window.
      if (lastHeading > 0) close(current.splice(lastHeading));
      else close();
    }
    if (unit.container === 'heading' && current.length > 0) lastHeading = current.length;
    current.push(index);
    chars += unit.text.length;
  }
  close();
  // 2. Each group is a window; a fence or comment goes to the window its place falls in.
  const windows: Window[] = [];
  for (const [at, group] of groups.entries()) {
    const from = at === 0 ? 0 : (group[0] as number);
    const next = groups[at + 1]?.[0];
    const to = next === undefined ? units.length : next;
    const inGroup = new Set(group);
    const listed: Array<{ index: number; opaque: boolean }> = [];
    for (let index = from; index < to; index++) {
      const unit = units[index] as Unit;
      if (unit.container === 'opaque') listed.push({ index, opaque: true });
      else if (inGroup.has(index)) listed.push({ index, opaque: false });
    }
    const members: Window['units'] = [];
    const display: DisplayLine[] = [];
    for (const [place, entry] of listed.entries()) {
      const unit = units[entry.index] as Unit;
      const n = place + 1;
      if (!entry.opaque) members.push({ n, text: unit.text, index: entry.index });
      else {
        const kind = /^\s*(```|~~~)/.test(unit.text) ? 'fence' : 'comment';
        // Only the first line, whatever the line endings of the file (LF, CRLF or a lone CR).
        display.push({
          n,
          mode: 'opaque',
          text: `${kind}: ${unit.text.split(/\r\n|\r|\n/, 1)[0] ?? ''}`,
          index: entry.index,
        });
      }
    }
    windows.push({
      id: `${path}#${at + 1}`,
      path,
      headingPath: pathOf(units[group[0] as number]),
      units: members,
      ...(display.length > 0 ? { display } : {}),
    });
  }
  return windows;
}

/**
 * The window as one labeler is asked about it: the units that need a label stay units; the others keep their number
 * and are shown as context, so a rescan sends the units it needs and the lines around them.
 */
function askedAbout(window: Window, want: ReadonlySet<number>, read: ReadonlySet<number>): Window {
  const context: DisplayLine[] = window.units
    .filter((unit) => !want.has(unit.index))
    .map((unit) => ({
      n: unit.n,
      mode: read.has(unit.index) ? ('read' as const) : ('context' as const),
      text: unit.text,
      index: unit.index,
    }));
  if (context.length === 0) return window;
  return {
    ...window,
    units: window.units.filter((unit) => want.has(unit.index)),
    display: [...(window.display ?? []), ...context].sort((a, b) => a.n - b.n),
  };
}

/**
 * A run of a window is out of step when more than a quarter of the clauses it quotes (and at least four) are not in
 * the unit it puts them on: its unit numbers have slipped, so its labels belong to neighbouring units. Such a run is
 * no voice in the vote of that window. On the Northwind fixture the slipped run quotes 22 clauses and misses 7; the
 * runs in step miss 2 of 20 and 2 of 11 (clauses reworded, not misplaced).
 */
export const OUT_OF_STEP_SHARE = 0.25;
export const OUT_OF_STEP_MIN = 4;

/**
 * The spans and links a label's atom needs, read from its mapping the way the atom builder fills it: the title, the
 * situation (unless marked optional), the fields and the evidence, each `$span.<kind>` and `$link.<kind>` they name,
 * braced or not. A placeholder marked optional (`<placeholder>?`), one under an optional key (`"key?"`), one inside a
 * `firstFilled` or an `each` (which fill when they can), the reply act and the further atoms of `also` need nothing.
 */
export function atomNeeds(label: Label | undefined): { spans: string[]; links: string[] } {
  const spans = new Set<string>();
  const links = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.endsWith('?')) return;
      for (const match of value.matchAll(/\$\{?(span|link)\.([a-z][a-z0-9-]*)/g))
        (match[1] === 'span' ? spans : links).add(match[2] as string);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      if ('firstFilled' in value || 'each' in value) return;
      for (const [key, inner] of Object.entries(value)) if (!key.endsWith('?')) walk(inner);
    }
  };
  const atom = label?.atom;
  if (atom) for (const part of [atom.title, atom.situation, atom.fields, atom.evidence]) walk(part);
  return { spans: [...spans], links: [...links] };
}

/** The spans and links an opinion lacks that its label's atom needs (`span:<kind>`, `link:<kind>`). */
export function missingForAtom(set: LabelSet, opinion: Opinion): string[] {
  const label = set.labels.find((candidate) => candidate.name === opinion.label);
  if (!label?.atom) return [];
  const needs = atomNeeds(label);
  const given = new Set([
    ...(opinion.spans ?? []).map((span) => `span:${span.kind}`),
    ...(opinion.links ?? []).map((link) => `link:${link.kind}`),
  ]);
  return [...needs.spans.map((kind) => `span:${kind}`), ...needs.links.map((kind) => `link:${kind}`)].filter(
    (need) => !given.has(need),
  );
}

/** How many times a window is asked again after its runs slip: at most three runs beyond the runs asked. */
export const REASK_LIMIT = 3;

/** How many more runs a window gets when the two most given labels of one of its units tie. */
export const SPLIT_REASK_RUNS = 2;

/** The most extra voices a window gets while one of its units still ties. */
export const SPLIT_REASK_MAX = 4;

/** The most asks a window gets for a split, those that slip included. */
export const SPLIT_REASK_ATTEMPTS = 6;

/** The quoted and unlocated clause counts of an out-of-step answer, or undefined when the run is in step. */
export function outOfStep(answer: unknown): { quoted: number; unlocated: number } | undefined {
  const labels = (answer as { labels?: unknown })?.labels;
  if (!Array.isArray(labels)) return undefined;
  let quoted = 0;
  let unlocated = 0;
  for (const entry of labels) {
    const spans = (entry as { spans?: unknown })?.spans;
    if (!Array.isArray(spans)) continue;
    for (const span of spans) {
      quoted++;
      if (typeof (span as { unlocated?: unknown })?.unlocated === 'string') unlocated++;
    }
  }
  return unlocated >= OUT_OF_STEP_MIN && unlocated > quoted * OUT_OF_STEP_SHARE
    ? { quoted, unlocated }
    : undefined;
}

// A refused answer (a refusal, a stop at max_tokens) is retried once like an unreadable one, then fails.
const RETRYABLE = (cause: unknown): boolean =>
  cause instanceof LabelerError || (cause instanceof ModelError && cause.code !== 'config');

/** A failure that stops the run: nothing the next window does can fix it. */
const FATAL = (cause: unknown): boolean =>
  cause instanceof CassetteMiss || cause instanceof LabelerConfigError;

/** Runs the tasks `jobs` at a time, results in task order. After a fatal failure no new task starts. */
async function runPool<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  jobs: number,
): Promise<Array<{ ok: true; value: T } | { ok: false; error: unknown } | undefined>> {
  const results: Array<{ ok: true; value: T } | { ok: false; error: unknown } | undefined> = new Array(
    tasks.length,
  ).fill(undefined);
  let next = 0;
  let stop = false;
  const worker = async () => {
    for (;;) {
      const at = next++;
      const task = tasks[at];
      if (!task || stop) return;
      try {
        results[at] = { ok: true, value: await task() };
      } catch (error) {
        results[at] = { ok: false, error };
        if (FATAL(error)) stop = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, tasks.length)) }, worker));
  return results;
}

type Task = {
  order: number;
  file: string;
  set: LabelSet;
  member: Labeler;
  memberAt: number;
  window: Window;
  digest: string;
  /** What the request lists for the links of the set. */
  context: LabelContext;
  /** Which run of the same request, from 1. */
  run: number;
};

type Leaf = { window: Window; answer: Recorded; key: string };
/** A window no accepted answer came back for: where, for which set and labeler, and why. */
export type FailedWindow = { window: string; set: string; labeler: string; reason: string };
const describeFailure = (failure: FailedWindow): string =>
  `${failure.window} (${failure.set}, ${failure.labeler}): ${failure.reason}`;

export type { LabelFlip } from './ledger';

type TaskResult = { leaves: Leaf[]; failures: FailedWindow[] };

function readableFor(task: Task, window: Window) {
  return readableOf(task.member.render(task.set, window, task.context), {
    path: window.path,
    window: window.id,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    set: task.set.set,
    setHash: setHash(task.set),
    model: task.member.model,
    cutDigest: task.digest,
    cls: task.member.cls,
    run: String(task.run),
  });
}

export async function pointerScan(input: PointerInput): Promise<PointerResult> {
  const { labelling, cassette } = input;
  const estateKey = input.estateKey ?? 'estate';
  const size = input.windowUnits ?? DEFAULT_WINDOW_UNITS;
  const files = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  const cuts = new Map(files.map((file) => [file.path, cut(file.text)]));
  // The units the code already reads (a skill's description): no label is asked of them; the labeler sees them as read.
  const readUnits = new Map<string, Set<number>>();
  for (const file of files) {
    const spans = input.read?.get(file.path) ?? [];
    if (spans.length === 0) continue;
    const inside = new Set<number>();
    for (const [index, unit] of (cuts.get(file.path) as Cut).units.entries())
      if (spans.some((span) => unit.start >= span.start && unit.end <= span.end)) inside.add(index);
    readUnits.set(file.path, inside);
  }
  const next = nextLedger(
    files.map((file) => ({ path: file.path, cut: cuts.get(file.path) as Cut, text: file.text })),
    input.previous,
    estateKey,
  );
  const entries = new Map<string, LedgerEntry>(next.ledger.entries.map((entry) => [entry.id, entry]));
  const unitId = (path: string, index: number): string => next.ids.get(unitKey(path, index)) as string;

  // 1. The units that need a label: none yet, or one made by other sets or other labelers.
  const hashes = new Map(input.sets.map((set) => [set.set, setHash(set)]));
  const needed = new Map<string, Set<number>>();
  let units = 0;
  let carried = 0;
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const set of input.sets) {
      const want = new Set<number>();
      for (const [index, unit] of fileCut.units.entries()) {
        if (unit.container === 'opaque' || readUnits.get(file.path)?.has(index)) continue;
        units++;
        const found = entries.get(unitId(file.path, index))?.labels[set.set];
        if (found && found.setHash === hashes.get(set.set) && found.labeler === labelling.hash) carried++;
        else want.add(index);
      }
      needed.set(`${file.path}\0${set.set}`, want);
    }
  }

  // What each set lists in its requests for its links: the atoms of the kinds a link kind may name.
  const contexts = new Map<string, LabelContext>(
    input.sets.map((set) => [
      set.set,
      {
        candidates: Object.fromEntries(
          (set.links ?? []).map((kind) => [
            kind.name,
            kind.values
              ? kind.values.map((value) => ({ id: value, label: value }))
              : (input.atoms ?? [])
                  .filter((atom) => kind.to?.includes(atom.kind))
                  .map((atom) => ({ id: atom.id, label: atom.title }))
                  .sort((a, b) => a.id.localeCompare(b.id)),
          ]),
        ),
      },
    ]),
  );

  // 2. The requests: for each member, the windows that hold a unit that needs a label.
  const tasks: Task[] = [];
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const set of input.sets) {
      const want = needed.get(`${file.path}\0${set.set}`) as Set<number>;
      if (want.size === 0) continue;
      for (const [memberAt, member] of labelling.members.entries()) {
        for (const whole of windowsOf(file.path, fileCut.units, member.maxUnits(set, size), file.text)) {
          if (!whole.units.some((unit) => want.has(unit.index))) continue;
          const window = askedAbout(whole, want, readUnits.get(file.path) ?? new Set());
          for (let run = 1; run <= (member.runs ?? 1); run++) {
            tasks.push({
              order: tasks.length,
              file: file.path,
              set,
              member,
              memberAt,
              window,
              digest: fileCut.digest,
              context: contexts.get(set.set) as LabelContext,
              run,
            });
          }
        }
      }
    }
  }

  const plan: PointerPlan = {
    files: files.length,
    units,
    carried,
    members: labelling.members.map((member) => ({
      id: member.id,
      cls: member.cls,
      model: member.model,
      windows: 0,
      cached: 0,
      characters: 0,
    })),
  };
  for (const task of tasks) {
    const wire = task.member.render(task.set, task.window, task.context);
    const entry = plan.members[task.memberAt] as MemberPlan;
    entry.windows++;
    if (cassette.entries.has(requestKey(wire, readableFor(task, task.window)))) entry.cached++;
    else entry.characters += JSON.stringify(wire.body).length;
  }
  input.onPlan?.(plan);
  // A recording run that has requests to send asks its labelers whether they can send, before the first one leaves.
  if (input.mode === 'record') {
    for (const [at, entry] of plan.members.entries())
      if (entry.windows - entry.cached > 0) labelling.members[at]?.ready?.();
  }

  // 3. The answers, `jobs` at a time. A window the service refuses as too large is halved.
  const tally = labelling.members.map(() => ({
    calls: 0,
    recorded: 0,
    input: 0,
    output: 0,
    replayed: 0,
    replayedInput: 0,
    replayedOutput: 0,
  }));

  const warnings: string[] = [];

  async function answerOf(task: Task, window: Window): Promise<{ answer: Recorded; key: string }> {
    const { member } = task;
    const wire = member.render(task.set, window, task.context);
    const readable = readableFor(task, window);
    const counts = tally[task.memberAt] as (typeof tally)[number];
    try {
      const hit = cassette.get(wire, readable);
      counts.replayed++;
      counts.replayedInput += hit.answer.usage.input;
      counts.replayedOutput += hit.answer.usage.output;
      return { answer: hit.answer, key: hit.key };
    } catch (cause) {
      if (!(cause instanceof CassetteMiss) || input.mode === 'replay' || !member.call) throw cause;
    }
    // One retry after an answer that cannot be read; nothing is recorded for a window that fails twice.
    let failure: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        counts.calls++;
        const answer = await member.call(wire, task.set, window, attempt);
        counts.input += answer.usage.input;
        counts.output += answer.usage.output;
        // An answer that names a label outside the set, a unit outside the window, a unit twice or a wrong
        // target is refused as a whole, like one that cannot be read: it is asked again once. A clause that
        // cannot be located is no such refusal: the run is out of step, and the vote handles it.
        const refused = member.opinions(answer, task.set, window, task.context).invalid ?? [];
        if (refused.length > 0) throw new LabelerError(refused.join('; '));
        // A model that returns another model id than the one recorded for the same labeler and request model is
        // named, so a re-record that mixes two models of one name is seen.
        for (const entry of cassette.entries.values()) {
          const earlier = entry.answer.returnedModel;
          if (
            entry.readable.labeler === readable.labeler &&
            entry.readable.model === readable.model &&
            earlier !== answer.returnedModel &&
            !entry.answer.refused
          ) {
            const note = `${readable.labeler} ${readable.model}: the returned model ${answer.returnedModel} differs from ${earlier} recorded before`;
            if (!warnings.includes(note)) warnings.push(note);
            break;
          }
        }
        cassette.put(wire, readable, answer);
        counts.recorded++;
        return { answer, key: requestKey(wire, readable) };
      } catch (cause) {
        failure = cause;
        if (isTooLarge(cause)) {
          // The refusal is recorded, so a replay halves the window the same way without a call.
          const refused: Recorded = {
            returnedModel: member.model,
            stopReason: 'too_large',
            refused: 'too_large',
            usage: { input: 0, output: 0 },
          };
          cassette.put(wire, readable, refused);
          counts.recorded++;
          return { answer: refused, key: requestKey(wire, readable) };
        }
        if (!RETRYABLE(cause)) break;
      }
    }
    // An answer that cannot be read twice is the model's, not the network's: it is recorded, so the failure
    // replays with no call. Any other failure (a refusal twice, a transport error) is not recorded.
    if (failure instanceof LabelerError) {
      const unreadable: Recorded = {
        returnedModel: member.model,
        stopReason: 'unreadable',
        refused: 'unreadable',
        error: failure.message,
        usage: { input: 0, output: 0 },
      };
      cassette.put(wire, readable, unreadable);
      counts.recorded++;
      return { answer: unreadable, key: requestKey(wire, readable) };
    }
    throw failure;
  }

  const failure = (task: Task, window: Window, reason: string): FailedWindow => ({
    window: window.id,
    set: task.set.set,
    labeler: task.member.id,
    reason,
  });

  async function resolve(task: Task, window: Window): Promise<TaskResult> {
    let result: { answer: Recorded; key: string };
    try {
      result = await answerOf(task, window);
    } catch (cause) {
      if (FATAL(cause)) throw cause;
      return {
        leaves: [],
        failures: [failure(task, window, cause instanceof Error ? cause.message : String(cause))],
      };
    }
    if (result.answer.refused === 'unreadable') {
      return {
        leaves: [],
        failures: [failure(task, window, result.answer.error ?? 'the answer cannot be read')],
      };
    }
    if (result.answer.refused !== 'too_large') {
      return { leaves: [{ window, answer: result.answer, key: result.key }], failures: [] };
    }
    if (window.units.length === 1) {
      return {
        leaves: [],
        failures: [failure(task, window, 'the endpoint refused a window of one unit as too large')],
      };
    }
    // Halved by the units asked about; the lines between them follow, and the numbers start again from one.
    const lines = [
      ...window.units.map((unit) => ({ n: unit.n, unit })),
      ...(window.display ?? []).map((line) => ({ n: line.n, line })),
    ].sort((a, b) => a.n - b.n);
    const half = Math.ceil(window.units.length / 2);
    const cutAt = lines.findIndex(
      (entry, at) => 'unit' in entry && lines.slice(0, at).filter((other) => 'unit' in other).length === half,
    );
    const part = (list: typeof lines, id: string): Window => {
      const units: Window['units'] = [];
      const display: DisplayLine[] = [];
      for (const [at, entry] of list.entries()) {
        if ('unit' in entry) units.push({ ...entry.unit, n: at + 1 });
        else display.push({ ...entry.line, n: at + 1 });
      }
      return {
        id,
        path: window.path,
        headingPath: window.headingPath,
        units,
        ...(display.length > 0 ? { display } : {}),
      };
    };
    const first = await resolve(task, part(lines.slice(0, cutAt), `${window.id}a`));
    const second = await resolve(task, part(lines.slice(cutAt), `${window.id}b`));
    return { leaves: [...first.leaves, ...second.leaves], failures: [...first.failures, ...second.failures] };
  }

  const settled = await runPool(
    tasks.map((task) => () => resolve(task, task.window)),
    input.jobs ?? 1,
  );
  for (const outcome of settled) if (outcome && !outcome.ok) throw outcome.error;

  // 4. The opinions of each member, by unit, then one decision per unit that needed a label.
  const refusals: string[] = [];
  const dropped: string[] = [];
  const failedWindows: FailedWindow[] = [];
  const outOfStepRuns: string[] = [];
  const slippedLeaves: Array<{ task: Task; window: Window }> = [];
  // The units of each run that was left out of a window's vote: that run is not heard on them, so it does not count.
  const unheard = new WeakMap<Map<number, Opinion>, Set<number>>();
  // A run asked for one window only (a re-ask on a split) is heard on that window's units alone.
  const heardOnly = new WeakMap<Map<number, Opinion>, Set<number>>();
  let windows = 0;
  // The opinions by file and set, then by member, then by run.
  const opinions = new Map<string, Array<Array<Map<number, Opinion>>>>();
  const opinionsOf = (file: string, set: LabelSet): Array<Array<Map<number, Opinion>>> => {
    const key = `${file}\0${set.set}`;
    let found = opinions.get(key);
    if (!found) {
      found = labelling.members.map((member) =>
        Array.from({ length: member.runs ?? 1 }, () => new Map<number, Opinion>()),
      );
      opinions.set(key, found);
    }
    return found;
  };
  /** The opinions of one run of a member on a file and set. */
  const runOf = (task: Task, run: number): Map<number, Opinion> =>
    (opinionsOf(task.file, task.set)[task.memberAt] as Array<Map<number, Opinion>>)[run - 1] as Map<
      number,
      Opinion
    >;
  /** Reads an answer in step and puts its opinions in the place of run `run`. */
  const hear = (task: Task, run: number, leaf: Leaf) => {
    const read = task.member.opinions(leaf.answer, task.set, leaf.window, task.context);
    refusals.push(...read.refusals);
    dropped.push(...(read.dropped ?? []));
    const target = runOf(task, run);
    for (const [index, opinion] of read.byUnit)
      target.set(index, { ...opinion, source: leaf.key.slice(0, 12) });
  };
  for (const [at, task] of tasks.entries()) {
    const outcome = settled[at];
    if (!outcome?.ok) continue;
    failedWindows.push(...outcome.value.failures);
    for (const leaf of outcome.value.leaves) {
      windows++;
      // Only a member with several runs votes, so only its runs can be left out.
      const slipped = (task.member.runs ?? 1) > 1 ? outOfStep(leaf.answer) : undefined;
      if (slipped) {
        outOfStepRuns.push(
          `${leaf.window.id} run ${task.run} of ${task.member.id}: ${slipped.unlocated} of ${slipped.quoted} quoted clauses are not in their unit; the run is left out of the vote`,
        );
        const run = runOf(task, task.run);
        const off = unheard.get(run) ?? new Set<number>();
        for (const unit of leaf.window.units) off.add(unit.index);
        unheard.set(run, off);
        slippedLeaves.push({ task, window: leaf.window });
        continue;
      }
      hear(task, task.run, leaf);
    }
  }

  // A window that lost a run to a slip is asked again, as runs after the last (6, 7 and 8 of five), until the runs heard
  // are as many as the runs asked or REASK_LIMIT re-asks are spent. A re-ask in step takes the place of the slipped
  // run. A re-ask is keyed by its own run number, so a replay reads the same answers; a replay whose cassette holds no
  // re-ask leaves the slipped run unheard.
  const reasked: string[] = [];
  const spent = new Map<string, number>();
  for (const { task, window } of slippedLeaves) {
    const where = `${task.file}\0${task.set.set}\0${task.memberAt}\0${window.id}`;
    while ((spent.get(where) ?? 0) < REASK_LIMIT) {
      const extra = (spent.get(where) ?? 0) + 1;
      spent.set(where, extra);
      const again: Task = { ...task, window, run: (task.member.runs ?? 1) + extra };
      if (input.mode === 'replay') {
        const wire = again.member.render(again.set, window, again.context);
        if (!cassette.entries.has(requestKey(wire, readableFor(again, window)))) break;
      }
      const answered = await resolve(again, window);
      failedWindows.push(...answered.failures);
      const leaf = answered.leaves.length === 1 ? answered.leaves[0] : undefined;
      if (!leaf) break;
      windows++;
      const slipped = outOfStep(leaf.answer);
      if (slipped) {
        outOfStepRuns.push(
          `${window.id} run ${again.run} of ${task.member.id} (asked again for run ${task.run}): ${slipped.unlocated} of ${slipped.quoted} quoted clauses are not in their unit; the run is left out of the vote`,
        );
        continue;
      }
      // The re-ask takes the slipped run's place on the units of this window.
      const run = runOf(task, task.run);
      for (const unit of window.units) unheard.get(run)?.delete(unit.index);
      hear(again, task.run, leaf);
      reasked.push(
        `${window.id} run ${task.run} of ${task.member.id}: asked again as run ${again.run}, in step`,
      );
      break;
    }
  }

  /**
   * The opinion of a member for a unit. With several runs, the label (and the same target) that more than half of
   * the runs heard gave: three of five by default. A run out of step in the unit's window is not heard: it counts
   * neither for a label nor in the count, and with fewer than two runs heard the member has no opinion. A run that left
   * the unit out counts for no label. Unanimity dropped units that a
   * model reads two ways run after run (a prohibition or a plain rule, a read before an edit or a plain rule),
   * and a label held by two runs out of three is the one a reader would take. Where no label has a majority the
   * member has no opinion (a split when runs differ). Spans and links are those of the first run that gave the
   * label with any; a difference between runs is counted.
   */
  let split = 0;
  let spanSplit = 0;
  let voted = 0;
  /**
   * The specific side of an even split between the generic label and one specific label, two runs at least on each
   * side; undefined for any other tally (three labels, two specific ones, a single run on a side).
   */
  const tieBroken = (tally: ReadonlyMap<string, Opinion[]>, set: LabelSet): Opinion[] | undefined => {
    const rule = tieBreaks.get(set.set);
    const groups = [...tally.values()];
    if (!rule || groups.length !== 2) return undefined;
    const [one, two] = groups as [Opinion[], Opinion[]];
    if (one.length !== two.length || one.length < 2) return undefined;
    const generic = (group: Opinion[]) => group[0]?.label === rule.generic;
    const specific = (group: Opinion[]) => rule.specific.includes(group[0]?.label ?? '');
    if (generic(one) && specific(two)) return two;
    if (generic(two) && specific(one)) return one;
    return undefined;
  };
  /** The tie breaks by set name: the shipped set's (`AGENT_RULES_TIE_BREAK`); a user set has none. */
  const tieBreaks = new Map<string, typeof AGENT_RULES_TIE_BREAK>([['agent-rules', AGENT_RULES_TIE_BREAK]]);
  /**
   * With no label in the majority, the labels that build the same atom kind vote together, and the labels that build
   * no atom (none, a description, an example) are one group; a label that points at another unit (a condition) is a
   * group of its own for each target it names. When a group holds more than half of the runs heard, the label most of its runs gave wins. A tie
   * inside a group that builds an atom stays a split (an obligation against a prohibition builds two different
   * atoms); inside the group that builds none, the earliest run's label stands. A split between atom kinds (a reply rule
   * against a rule) stays a split: no group holds the majority, and the unit stays unlabeled.
   */
  const sameKind = (present: Opinion[], heard: number, set: LabelSet): Opinion[] | undefined =>
    sameKindVote(present, heard, set).winners;
  /** The group vote, and whether it ended on a tie inside a kind that builds an atom (a split more runs can settle). */
  const sameKindVote = (
    present: Opinion[],
    heard: number,
    set: LabelSet,
  ): { winners?: Opinion[]; tiedInKind: boolean } => {
    // A set whose labels build no atom (the document roles) has no kinds to vote by: its splits stay splits.
    if (!set.labels.some((label) => label.atom)) return { tiedInKind: false };
    // A label that points at another unit (a condition) acts through its target: each label and target is a group of
    // its own, so runs that name different targets never vote together.
    const kindOf = (label: string, target?: number) => {
      const declared = set.labels.find((candidate) => candidate.name === label);
      if (declared?.target) return `(label ${label} ${target ?? ''})`;
      return declared?.atom?.kind ?? '(no atom)';
    };
    const byKind = new Map<string, Opinion[]>();
    for (const opinion of present) {
      const kind = kindOf(opinion.label, opinion.target);
      byKind.set(kind, [...(byKind.get(kind) ?? []), opinion]);
    }
    const group = [...byKind.values()].find((members) => members.length * 2 > heard);
    if (!group) return { tiedInKind: false };
    const key = (opinion: Opinion) => `${opinion.label}\0${opinion.target ?? ''}`;
    const counts = new Map<string, number>();
    for (const opinion of group) counts.set(key(opinion), (counts.get(key(opinion)) ?? 0) + 1);
    const top = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, count]) => count === top);
    // Two labels that build the same atom kind can still build different atoms (an obligation or a prohibition): a
    // tie between them stays a split. Labels that build no atom give nothing either way: the earliest run's stands.
    if (leaders.length > 1 && kindOf(group[0]?.label ?? '') !== '(no atom)') return { tiedInKind: true };
    const pick = group.find((opinion) => counts.get(key(opinion)) === top) as Opinion;
    return { winners: group.filter((opinion) => key(opinion) === key(pick)), tiedInKind: false };
  };
  /** The opinions of the runs heard on a unit: none when fewer than two of several runs are heard. */
  const heardOn = (runs: ReadonlyArray<Map<number, Opinion>>, index: number) => {
    const heard = runs.filter(
      (run) => !unheard.get(run)?.has(index) && (heardOnly.get(run)?.has(index) ?? true),
    );
    return runs.length > 1 && heard.length < 2 ? undefined : heard.map((run) => run.get(index));
  };
  /**
   * Whether the runs heard on a unit are split with no label, tie break or group to decide it, and its two most given
   * labels tie: inside one atom kind (two runs of rule, two of prohibition) or across kinds (two of reply-rule, two
   * of rule).
   */
  /**
   * The vote on a unit that names a file (a code span or link the path reader takes as a file): a condition reading
   * of it counts toward one group with the readings of a label whose atom is a reference or a gate, since a unit that
   * names a file to read is no condition alone. When that group holds more than half of the runs heard, the label is
   * chosen inside it by the readings that are not conditions and can build their atom (none of a span or link it
   * needs missing); with none that can build, by the readings that are not conditions. The most given label wins; a
   * tie at the top is a split (`tied`); a group of conditions alone decides nothing and is a split too: the window is
   * asked again, and the unit stays unlabeled while no other reading comes.
   * Undefined when the unit holds no condition reading or the group holds no majority: the vote then goes on as for any
   * unit.
   */
  const fileVote = (
    present: Opinion[],
    heard: number,
    set: LabelSet,
  ): { winners?: Opinion[]; tied: boolean } | undefined => {
    const declared = (label: string) => set.labels.find((candidate) => candidate.name === label);
    const isCondition = (opinion: Opinion) => declared(opinion.label)?.condition === true;
    if (!present.some(isCondition)) return undefined;
    const fileKind = (opinion: Opinion) => {
      const kind = declared(opinion.label)?.atom?.kind;
      return kind === 'reference' || kind === 'gate';
    };
    const group = present.filter((opinion) => isCondition(opinion) || fileKind(opinion));
    if (group.length * 2 <= heard) return undefined;
    const others = group.filter((opinion) => !isCondition(opinion));
    // Conditions alone do not decide a unit that names a file: it is a split, asked again like a tie, and it stays
    // unlabeled while no other reading comes.
    if (others.length === 0) return { tied: true };
    const buildable = others.filter((opinion) => missingForAtom(set, opinion).length === 0);
    const voters = buildable.length > 0 ? buildable : others;
    const key = (opinion: Opinion) => `${opinion.label}\0${opinion.target ?? ''}`;
    const counts = new Map<string, number>();
    for (const opinion of voters) counts.set(key(opinion), (counts.get(key(opinion)) ?? 0) + 1);
    const top = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, count]) => count === top);
    if (leaders.length > 1) return { tied: true };
    const pick = voters.find((opinion) => counts.get(key(opinion)) === top) as Opinion;
    return { winners: voters.filter((opinion) => key(opinion) === key(pick)), tied: false };
  };
  const tiedSplit = (
    runs: ReadonlyArray<Map<number, Opinion>>,
    index: number,
    set: LabelSet,
    mentionsFile = false,
  ): boolean => {
    const given = heardOn(runs, index);
    if (!given || given.length < 2) return false;
    const present = given.filter((opinion): opinion is Opinion => opinion !== undefined);
    const filed = mentionsFile ? fileVote(present, given.length, set) : undefined;
    if (filed) return filed.tied;
    const key = (opinion: Opinion) => `${opinion.label}\0${opinion.target ?? ''}`;
    const tally = new Map<string, Opinion[]>();
    for (const opinion of present) tally.set(key(opinion), [...(tally.get(key(opinion)) ?? []), opinion]);
    if ([...tally.values()].some((group) => group.length * 2 > given.length) || tieBroken(tally, set))
      return false;
    const grouped = sameKindVote(present, given.length, set);
    if (grouped.winners) return false;
    if (grouped.tiedInKind) return true;
    const counts = [...tally.values()].map((group) => group.length).sort((a, b) => b - a);
    return counts.length >= 2 && counts[0] === counts[1];
  };
  const opinionOf = (
    runs: ReadonlyArray<Map<number, Opinion>>,
    index: number,
    set: LabelSet,
    mentionsFile = false,
  ): Opinion | undefined => {
    // The runs heard on the unit: a run left out of its window's vote counts neither for a label nor in the count.
    const given = heardOn(runs, index);
    if (!given) return undefined;
    const first = given[0];
    if (given.length === 1) return first;
    const present = given.filter((opinion): opinion is Opinion => opinion !== undefined);
    const key = (opinion: Opinion) => `${opinion.label}\0${opinion.target ?? ''}`;
    const tally = new Map<string, Opinion[]>();
    for (const opinion of present) tally.set(key(opinion), [...(tally.get(key(opinion)) ?? []), opinion]);
    const unanimous = present.length === given.length && tally.size === 1;
    const filed = mentionsFile ? fileVote(present, given.length, set) : undefined;
    const majority = filed
      ? filed.winners
      : ([...tally.values()].find((group) => group.length * 2 > given.length) ??
        tieBroken(tally, set) ??
        sameKind(present, given.length, set));
    const winners = unanimous && !filed ? present : majority;
    if (!winners?.[0]) {
      if (present.length === given.length) split++;
      return undefined;
    }
    if (!unanimous) voted++;
    // Spans and links are descriptions of where the clauses sit, not part of the label: runs that gave the label
    // often draw a clause a word apart. The first run that gave any is kept, and the disagreement is counted.
    const extras = (opinion: Opinion | undefined) => JSON.stringify([opinion?.spans, opinion?.links]);
    if (!winners.every((opinion) => extras(opinion) === extras(winners[0]))) spanSplit++;
    const { spans, links, ...rest } = winners[0];
    const spanned = winners.find((opinion) => opinion.spans);
    const linked = winners.find((opinion) => opinion.links);
    return {
      ...rest,
      ...(spanned?.spans ? { spans: spanned.spans } : {}),
      ...(linked?.links ? { links: linked.links } : {}),
      source: winners.map((opinion) => opinion.source ?? '').join('+'),
    };
  };

  // A window with a unit whose two most given labels tie, inside one atom kind (two runs of rule, two of prohibition)
  // or across kinds (two of reply-rule, two of rule), with nothing else to decide it, is asked
  // SPLIT_REASK_RUNS more times, as the runs after those the window already used; each answer in step is one more
  // voice on the units of that window. Keyed by run number like every run, so a replay reads the same answers; a
  // replay whose cassette holds none leaves the tie as it is.
  const asked = new Set<string>();
  for (const task of tasks) {
    if ((task.member.runs ?? 1) < 2) continue;
    const where = `${task.file}\0${task.set.set}\0${task.memberAt}\0${task.window.id}`;
    if (asked.has(where)) continue;
    asked.add(where);
    const runs = opinionsOf(task.file, task.set)[task.memberAt] as Array<Map<number, Opinion>>;
    const tied = task.window.units.filter((unit) =>
      tiedSplit(runs, unit.index, task.set, namedPaths(unit.text).length > 0),
    );
    if (tied.length === 0) continue;
    // Two voices in step at least; while a unit of the window still ties, two more, up to SPLIT_REASK_MAX; a re-ask
    // that slips is asked again, within SPLIT_REASK_ATTEMPTS asks in all.
    let voices = 0;
    for (let attempt = 1; attempt <= SPLIT_REASK_ATTEMPTS; attempt++) {
      const stillTied = task.window.units.some((unit) =>
        tiedSplit(runs, unit.index, task.set, namedPaths(unit.text).length > 0),
      );
      // Voices come in pairs, so one extra voice never breaks a tie on its own.
      if (voices >= SPLIT_REASK_RUNS && voices % 2 === 0 && (!stillTied || voices >= SPLIT_REASK_MAX)) break;
      const extra = (spent.get(where) ?? 0) + 1;
      spent.set(where, extra);
      const again: Task = { ...task, run: (task.member.runs ?? 1) + extra };
      if (input.mode === 'replay') {
        const wire = again.member.render(again.set, task.window, again.context);
        if (!cassette.entries.has(requestKey(wire, readableFor(again, task.window)))) break;
      }
      const answered = await resolve(again, task.window);
      failedWindows.push(...answered.failures);
      const leaf = answered.leaves.length === 1 ? answered.leaves[0] : undefined;
      if (!leaf) break;
      windows++;
      const slipped = outOfStep(leaf.answer);
      if (slipped) {
        outOfStepRuns.push(
          `${task.window.id} run ${again.run} of ${task.member.id} (asked again for a split): ${slipped.unlocated} of ${slipped.quoted} quoted clauses are not in their unit; the run is left out of the vote`,
        );
        continue;
      }
      const voice = new Map<number, Opinion>();
      runs.push(voice);
      heardOnly.set(voice, new Set(task.window.units.map((unit) => unit.index)));
      hear(again, runs.length, leaf);
      voices++;
      reasked.push(
        `${task.window.id} of ${task.member.id}: asked again as run ${again.run} for ${tied.length} split units`,
      );
    }
  }

  let unlabeled = 0;
  const unlabeledUnits: Array<{ unit: string; set: string }> = [];
  const flips: LabelFlip[] = [];
  let decided = 0;
  const decidedBy: Record<LabelerClass, number> = { system1: 0, system2: 0 };
  let fellBack = 0;
  for (const file of files) {
    for (const set of input.sets) {
      const want = needed.get(`${file.path}\0${set.set}`) as Set<number>;
      if (want.size === 0) continue;
      const byMember = opinionsOf(file.path, set);
      for (const index of [...want].sort((a, b) => a - b)) {
        const entry = entries.get(unitId(file.path, index));
        if (!entry) continue;
        const decision = labelling.decide(
          byMember.map((runs) =>
            opinionOf(runs, index, set, namedPaths(cuts.get(file.path)?.units[index]?.text ?? '').length > 0),
          ),
          set,
        );
        // A unit the labelling stops selecting keeps its place; the change of its label is reported.
        if (!decision) {
          unlabeled++;
          unlabeledUnits.push({ unit: entry.id, set: set.set });
          const flip = recordLabel(entry, set.set, undefined);
          if (flip) flips.push(flip);
          continue;
        }
        decided++;
        decidedBy[decision.by]++;
        if (decision.fallback) fellBack++;
        const targetId = decision.target === undefined ? undefined : unitId(file.path, decision.target);
        const flip = recordLabel(entry, set.set, {
          label: decision.label,
          setHash: hashes.get(set.set) as string,
          labeler: labelling.hash,
          source: decision.sources.length === 0 ? 'none' : `cassette:${decision.sources.join('+')}`,
          by: decision.by,
          ...(targetId ? { target: targetId } : {}),
          ...(decision.spans ? { spans: decision.spans } : {}),
          ...(decision.links ? { links: decision.links } : {}),
        });
        if (flip) flips.push(flip);
      }
    }
  }

  // 5. The labelled units, in file order, for the atom builder.
  const labelled: LabelledUnit[] = [];
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const [index, unit] of fileCut.units.entries()) {
      const id = unitId(file.path, index);
      const entry = entries.get(id);
      if (!entry) continue;
      for (const set of input.sets) {
        const found = entry.labels[set.set];
        if (
          !found ||
          found.label === 'none' ||
          found.setHash !== hashes.get(set.set) ||
          found.labeler !== labelling.hash
        ) {
          continue;
        }
        const targetIndex = found.target
          ? fileCut.units.findIndex((_, at) => unitId(file.path, at) === found.target)
          : -1;
        const targetUnit = targetIndex >= 0 ? fileCut.units[targetIndex] : undefined;
        labelled.push({
          path: file.path,
          index,
          unit,
          id,
          set,
          label: found.label,
          ...(targetUnit && found.target
            ? { target: { path: file.path, index: targetIndex, unit: targetUnit, id: found.target } }
            : {}),
          ...(found.spans ? { spans: found.spans } : {}),
          ...(found.links ? { links: found.links } : {}),
          source: found.source,
          ...(found.by ? { by: found.by } : {}),
        });
      }
    }
  }

  const usage = labelling.members.map((member, at) => ({
    id: member.id,
    cls: member.cls,
    model: member.model,
    ...(tally[at] as (typeof tally)[number]),
  }));
  return {
    ledger: next.ledger,
    events: next.events,
    eventsById: next.eventsById,
    cuts,
    labelled,
    plan,
    windows,
    carried,
    decided,
    decidedBy,
    fellBack,
    calls: usage.reduce((sum, entry) => sum + entry.calls, 0),
    unlabeled,
    unlabeledUnits,
    flips,
    split,
    spanSplit,
    voted,
    refusals,
    dropped,
    outOfStep: outOfStepRuns,
    reasked,
    failed: failedWindows.map(describeFailure),
    warnings,
    failedWindows,
    usage,
    recorded: usage.reduce((sum, entry) => sum + entry.recorded, 0),
  };
}
