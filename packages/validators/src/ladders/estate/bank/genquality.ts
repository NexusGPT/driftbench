import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { FIXTURE, type FixtureSuite, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * Generation quality on the Northwind fixture's generated suite (seed-free, judged once):
 *
 * gen.task: every first ask of a complete spec holds a task: an imperative clause (its head is a verb, not
 * negated, not a function word) followed by its object, or a question about something. A rule restated as an ask ("Please do this: never guess a status") or a bare condition ("Please
 * handle this for me: the invoice is not in EUR") holds none. One item per test type.
 *
 * gen.reads: no complete spec expects a Read of a file the estate lacks. One item per test type.
 *
 * gen.coverage: at least one complete spec names every atom of a kind (one item per atom kind); every domain
 * rule of a skill has a judged criterion in a complete spec (one item per skill and the standing rules); no
 * spec carries the gap markers the bench run left (one item per marker).
 */

const GENERATE = 'packages/generate/src/estate/generate.ts';
const THEN = 'packages/generate/src/estate/then.ts';

const TEST_TYPES = [
  'obligation',
  'outside_trigger',
  'twin',
  'ordered_pair',
  'skip_pressure',
  'route_positive',
  'route_near_miss',
  'misroute',
  'read_when',
  'script_fixture',
  'dispatch',
  'contract_alone',
  'stop_resume',
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'tool_boundary',
  'tool_denied',
  'stage_order',
  'stage_skip',
  'register_sample',
  'hazard_recovery',
  'journey',
] as const;

/**
 * Words that open a request without being its verb: politeness, sequencing and manner adverbs. They are skipped
 * before the clause's head is read; the frames "can you", "I need you to" and "please" make the clause a request.
 */
const OPENERS = new Set(
  `please kindly just now then and also so ok okay first next again still even simply finally immediately quickly carefully once`
    .split(/\s+/)
    .filter(Boolean),
);
const FRAMES = [
  /^(can|could|would|will)\s+you\s+/i,
  /^(i|we)\s+(need|want)\s+you\s+to\s+/i,
  /^(i|we)\s*(?:'d|would)\s+like\s+you\s+to\s+/i,
  /^go\s+ahead\s+and\s+/i,
  /^let'?s\s+/i,
  /^right\s+now[,\s]+/i,
];
/**
 * Closed classes that cannot head an imperative: articles and determiners, pronouns, auxiliaries and modals,
 * conjunctions and prepositions, quantifiers, wh-words, focus and frequency adverbs (a rule: "always read ...")
 * and greetings. A clause opening with one is a statement, a condition or a fragment, not a request.
 */
const NOT_A_HEAD = new Set(
  `a an the this that these those my our your his her its their i we you he she it they there here is are was were
  be been being am does did has have had will would shall should must may might can could if when unless while
  because since although whenever whether before after until as of for to in on at by from with without about into
  over under but or nor yet every each all any some none who whom whose which what where why how only even also
  always usually often sometimes generally typically normally todo tbd hello hi hey thanks thank yes sorry welcome`
    .split(/\s+/)
    .filter(Boolean),
);
const NEGATIONS = new Set([
  'never',
  'not',
  'no',
  "don't",
  'dont',
  'cannot',
  "can't",
  "won't",
  "shouldn't",
  "mustn't",
]);
/** A clause that is only a command to the session itself ("stop") needs no object. */
const SESSION_CONTROL = new Set(
  'stop wait pause resume continue cancel undo retry abort halt quit'.split(' '),
);
/** Particles and articles that follow a verb without being its object ("fill in", "go through"). */
const SKIP = new Set(
  'a an the this that my our me us it up out in through on off over down back for against about with to at'.split(
    ' ',
  ),
);
/** What a request may refer to without saying it: the task is then whatever follows the colon. */
const DEFERS = new Set(
  `this that it these those the following rule rules instruction instructions policy me us for against just once
  now`
    .split(/\s+/)
    .filter(Boolean),
);
const QUESTION = /^(where|what|which|when|who|how|why|is|are|does|do|can|could|has)\b.*\?/i;

/**
 * What a bare verb is followed by. A word that takes a determiner, a pronoun or a verb particle right after it
 * is a verb: "escalate the order", "pick it up", "go through inbox/". A noun that opens a statement is followed
 * by another noun or a finite verb ("supplier orders arrive late"), never by these.
 */
const COMPLEMENT = new Set(
  `a an the this that these those my our your its their his her all each every any some both another other me us
  you it them him up out off down back through into onto about against around along across`
    .split(/\s+/)
    .filter(Boolean),
);
/** A path, a file name or a reference code (INV-1004) right after the head: its object. A bare number is not. */
const OBJECT_SHAPE = /^(?:[a-z0-9._-]+\/|[a-z0-9_-]+\.[a-z0-9]{1,5}$|[a-z]{2,}-\d+$)/i;
/**
 * Base-form verbs of work that take a bare noun as object ("send invoices", "dispatch ledger-auditor"). A verb
 * followed by a determiner needs no entry here; this list serves only the undetermined object, and an unknown
 * verb with one is refused rather than guessed.
 */
const BASE_VERBS = new Set(
  `add answer approve archive ask carry force assign attach audit book build call cancel change chase check clean close commit
  compare compile confirm convert copy correct count create deliver delete describe dispatch download draft edit
  email enter escalate explain export extract file fill find fix flag forward generate get give go handle help
  import insert invite join list load log look make mark match merge move note notify open order pack pay
  paste pick plan post prepare price print process publish pull push put read rebuild recalculate recompute
  reconcile record recover refund refresh register reject release remind remove rename reopen reorder repeat reply
  report request reschedule reset resolve restore retry review rotate route run save say schedule scan search
  select send separate set share ship show sign sort split start submit summarise summarize swap sync tag tell
  track transfer translate trigger triage try unlock update upload use validate verify view watch write`
    .split(/\s+/)
    .filter(Boolean),
);
/** A marker left where a value was not filled in, or a note that stands for an ask. */
const PLACEHOLDER =
  /<[^>]*>|\{\{[^}]*\}\}|\b(?:task|ask|request|text) (?:goes|omitted|here)\b|\b(?:tbd|todo|lorem)\b/i;
/** A standing condition restated: "... when none is given", "... if the invoice is not in EUR". */
const CONDITIONAL_RESTATEMENT =
  /\b(?:when|whenever|if|unless)\s+(?:none|no|any|there|it|they|the|a|an|you)\b[^.;:!?]*\b(?:is|are|was|were|has|have|isn't|aren't|given|missing)\b/i;
const QUOTE_TOKEN = 'quotedrule';

type Segment = { text: string; delimiter: string };

/** Clauses with the mark that ended each: a colon after a request that names no task defers to what follows. */
function segments(text: string): Segment[] {
  return [...text.matchAll(/((?:[^.;:!?,\n]|\.(?!\s|$))+)(\.(?=\s|$)|[;:!?,\n]|$)/g)].map((match) => ({
    text: (match[1] ?? '').trim(),
    delimiter: match[2] ?? '',
  }));
}

/** The clause's words after its openers and frames, lower-cased, and whether a frame made it a request. */
function wordsOf(clause: string): { words: string[]; requested: boolean } {
  let rest = clause.trim();
  let requested = false;
  for (let changed = true; changed; ) {
    changed = false;
    for (const frame of FRAMES) {
      const next = rest.replace(frame, '');
      if (next !== rest) {
        rest = next;
        requested = true;
        changed = true;
      }
    }
    const [first = '', ...others] = rest.split(/\s+/);
    const word = first.toLowerCase();
    if (OPENERS.has(word)) {
      if (word === 'please' || word === 'kindly') requested = true;
      rest = others.join(' ');
      changed = true;
    }
  }
  const words = rest
    .toLowerCase()
    .replace(/[^a-z0-9\s'/.-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return { words, requested };
}

const FINITE = new Set(
  `is are was were must should shall will await arrive remain require appear stay exist contain include`.split(
    ' ',
  ),
);
/** Words that open a subordinate clause: a finite verb after one belongs to it, not to the clause's head. */
const SUBORDINATORS = new Set(
  `that which who whom whose if when where what how why unless while because since until whether so as then and or but
  to`
    .split(/\s+/)
    .filter(Boolean),
);

/** Whether the words after a head carry a finite verb of their own before any subordinate clause: a statement. */
function isStatement(rest: string[]): boolean {
  for (const word of rest) {
    if (SUBORDINATORS.has(word)) return false;
    if (FINITE.has(word)) return true;
  }
  return false;
}

/** Whether the head is a verb in an imperative: a known base verb, or a word that takes an object's first word. */
function isImperativeHead(head: string, rest: string[]): boolean {
  if (BASE_VERBS.has(head)) return true;
  const next = rest[0];
  return next !== undefined && (COMPLEMENT.has(next) || OBJECT_SHAPE.test(next));
}

/** A short noun phrase before a colon labels a field ("invoice status:"); a longer clause introduces its content. */
function isLabel(rest: string[]): boolean {
  return rest.length <= 2;
}

/** Prepositions that may open a clause whose verb comes later: "in invoices/INV-1.json set the note field". */
const FRONTED = new Set('in on at for with within during under over by from'.split(' '));

/** The verb of a clause opened by a preposition: a base verb within the first few words, with an object. */
function frontedTask(words: string[]): boolean {
  for (let at = 1; at < Math.min(5, words.length); at += 1) {
    const verb = words[at] as string;
    if (BASE_VERBS.has(verb) && words.slice(at + 1).some((word) => !SKIP.has(word) && word.length > 1))
      return true;
  }
  return false;
}

/** Whether a clause is an imperative with a task; 'defer' when it asks for a task it does not name. */
function judgeClause(clause: string, delimiter: string): boolean | 'defer' {
  const { words, requested } = wordsOf(clause);
  const [head, ...rest] = words;
  if (head !== undefined && FRONTED.has(head) && !requested) return frontedTask(words);
  if (head === undefined || NEGATIONS.has(head) || NOT_A_HEAD.has(head)) return false;
  if (head === 'do' && NEGATIONS.has(rest[0] ?? '')) return false;
  if (!requested && isStatement(rest)) return false;
  if (!requested && !SESSION_CONTROL.has(head) && !isImperativeHead(head, rest)) return false;
  const object = rest.filter((word) => !SKIP.has(word));
  if (delimiter === ':' && rest.length > 0) {
    // A colon after a request that names no task defers to what follows; after a short noun phrase it labels a
    // field ("invoice status:"); after a longer clause it introduces the clause's content.
    if (object.every((word) => DEFERS.has(word))) return 'defer';
    if (isLabel(rest)) return false;
  }
  if (object.length === 0) return rest.length === 0 && SESSION_CONTROL.has(head);
  return !object.every((word) => DEFERS.has(word)) && object.some((word) => word.length > 1);
}

/**
 * Whether an ask holds a task: a question about something, or an imperative request with an object. An
 * imperative is a clause that opens with a request frame ("please", "could you", "I need you to") or with a verb
 * (a known base verb, or a word followed by a determiner, pronoun, particle or path: a noun opening a statement
 * is followed by another noun or a finite verb). A clause that states a fact, a rule, a standing condition or a
 * status, a fragment, a placeholder and a note do not hold one. A request that only points at its task ("do
 * this:", "go against this rule:") is judged by the text after the colon; a quoted rule after it is the object
 * of the request and holds the task, while a sentence that is only the rule does not.
 */
export function holdsTask(ask: string): boolean {
  const raw = ask.trim();
  if (PLACEHOLDER.test(raw) || /^\[[\s\S]*\]$/.test(raw)) return false;
  const text = raw.replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, ` ${QUOTE_TOKEN} `);
  if (QUESTION.test(text)) return true;
  const parts = segments(text);
  for (const [index, part] of parts.entries()) {
    // A clause that is only the rule's standing condition restated holds no task.
    if (part.text === QUOTE_TOKEN || CONDITIONAL_RESTATEMENT.test(part.text)) continue;
    const verdict = judgeClause(part.text, part.delimiter);
    if (verdict === 'defer') {
      const after = parts
        .slice(index + 1)
        .map((next) => `${next.text}${next.delimiter}`)
        .join(' ')
        .trim();
      return after.replace(/[.!?]+$/, '').trim() === QUOTE_TOKEN || holdsTask(after);
    }
    if (verdict) return true;
  }
  return false;
}

function firstAsk(spec: FixtureSuite['specs'][number]): string | undefined {
  const block = (spec.spec.blocks ?? [])[0] as { when?: { user?: string } } | undefined;
  return block?.when?.user;
}

function readsOf(spec: FixtureSuite['specs'][number]): string[] {
  const out: string[] = [];
  for (const block of (spec.spec.blocks ?? []) as Array<{ expect?: { tools?: unknown[] } }>) {
    for (const tool of (block.expect?.tools ?? []) as Array<{
      label?: string;
      input?: Record<string, unknown>;
    }>) {
      if (tool.label !== 'Read') continue;
      const path = tool.input?.file_path as { contains?: string; equals?: string } | string | undefined;
      const value = typeof path === 'string' ? path : (path?.contains ?? path?.equals);
      if (typeof value === 'string' && value !== '') out.push(value);
    }
  }
  return out;
}

let fixtureFiles: string[] | undefined;
function filesOfFixture(): string[] {
  fixtureFiles ??= (
    readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as Array<{
      isFile(): boolean;
      parentPath: string;
      name: string;
    }>
  )
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  return fixtureFiles;
}

function seedFreeFamily(
  id: string,
  level: number,
  component: string,
  specs: Array<{
    key: string;
    tier: Tier;
    title: string;
    cause: string;
    component?: string;
    judge(suite: FixtureSuite): Promise<ItemResult> | ItemResult;
  }>,
): Family {
  const items = itemsOf(
    id,
    level,
    component,
    specs.map(({ key, tier, title, cause, component: own }) => ({
      key,
      tier,
      title,
      cause,
      ...(own ? { component: own } : {}),
    })),
  );
  return {
    id,
    level,
    component,
    items,
    seedFree: true,
    async evaluate() {
      const suite = await fixtureSuite();
      const out = new Map<string, ItemResult>();
      for (const spec of specs) {
        try {
          out.set(`${id}.${spec.key}`, await spec.judge(suite));
        } catch (cause) {
          out.set(`${id}.${spec.key}`, {
            pass: false,
            detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      return out;
    },
  };
}

const ofType = (suite: FixtureSuite, type: string) =>
  suite.specs.filter((spec) => spec.complete && spec.testType === type);

export function taskFamily(): Family {
  return seedFreeFamily(
    'gen.task',
    4,
    GENERATE,
    TEST_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `every first ask of a complete ${type} spec holds a task: a verb and its object`,
      cause: 'write every ask as a task, never as a restated rule or a bare condition',
      async judge(suite) {
        const specs = ofType(suite, type);
        if (specs.length === 0) return { pass: false, detail: `no complete ${type} spec` };
        // A guard that watches the user's prompt is set off by its own trigger (a stop word): that ask is legitimate.
        const map = await loadEstateMap(suite.map);
        const promptGuards = new Set(
          map.ok
            ? map.map.atoms
                .filter((atom) => atom.kind === 'guard' && atom.fields?.event === 'UserPromptSubmit')
                .map((atom) => atom.id)
            : [],
        );
        const bad = specs.filter(
          (spec) =>
            !(type.startsWith('guard_') && spec.atoms.some((atom) => promptGuards.has(atom))) &&
            !holdsTask(firstAsk(spec) ?? ''),
        );
        return bad.length === 0
          ? { pass: true, detail: `holds (${specs.length})` }
          : {
              pass: false,
              detail: `${bad.length} of ${specs.length} asks hold no task, such as "${firstAsk(bad[0] as FixtureSuite['specs'][number])}"`,
            };
      },
    })),
  );
}

export function readsFamily(): Family {
  return seedFreeFamily(
    'gen.reads',
    4,
    THEN,
    TEST_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `no complete ${type} spec expects a Read of a file the estate lacks`,
      cause: 'expect a Read only of a file the estate holds',
      judge(suite) {
        const files = filesOfFixture();
        const specs = ofType(suite, type);
        if (specs.length === 0) return { pass: false, detail: `no complete ${type} spec` };
        for (const spec of specs) {
          for (const read of readsOf(spec)) {
            const clean = read.replace(/^\.\//, '');
            if (!existsSync(join(FIXTURE, clean)) && !files.some((file) => file.endsWith(clean)))
              return { pass: false, detail: `${spec.id} expects a Read of ${read}, which the estate lacks` };
          }
        }
        return { pass: true, detail: `holds (${specs.length})` };
      },
    })),
  );
}

const FOCUS_KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 3],
  ['route', 1],
  ['skill', 2],
  ['script', 3],
  ['subagent', 3],
  ['guard', 3],
  ['tool', 3],
  ['register', 3],
  ['stage', 3],
  ['hazard', 4],
  ['setting', 4],
  ['invariant', 4],
];
/** docs/estate.md section 5 (--focus): the report names the atoms with no complete spec. */
const AT_LEAST = 1;
const SKILLS = ['invoice-reconcile', 'shipment-tracker', 'supplier-email', 'weekly-report', 'standing'];
/** The gap markers and their fix; a fix the generated estates' items already name keeps that cause. */
const MARKERS: Array<[string, string]> = [
  ['needs-ordered-anchor', 'anchor an ordered pair whose ends are no tool label, skill or stage'],
  ['needs-stage-reach-check', 'write a stage reach check'],
  ['needs-guard-timing', 'write a guard timing check'],
  ['needs-guard-message-check', 'write a guard message check'],
  ['needs-recorded-session', 'replay a row from a recorded session the generator finds by itself'],
  ['needs-negation', 'write the inverse of a predicate for a negative control'],
];

export function coverageFamily(): Family {
  return seedFreeFamily('gen.coverage', 4, GENERATE, [
    ...FOCUS_KINDS.map(([kind, tier]) => ({
      key: `one-per-${kind}`,
      tier,
      title: `every ${kind} atom is named by at least ${AT_LEAST} complete spec`,
      cause: `generate a complete spec for every ${kind} atom`,
      async judge(suite: FixtureSuite): Promise<ItemResult> {
        const map = await loadEstateMap(suite.map);
        if (!map.ok) return { pass: false, detail: 'the map does not load' };
        const atoms = map.map.atoms.filter((atom) => atom.kind === kind);
        if (atoms.length === 0) return { pass: false, detail: `the fixture holds no ${kind} atom` };
        const short = atoms
          .map(
            (atom) =>
              [
                atom.id,
                suite.specs.filter((spec) => spec.complete && spec.atoms.includes(atom.id)).length,
              ] as const,
          )
          .filter(([, count]) => count < AT_LEAST);
        return short.length === 0
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `${short.length} of ${atoms.length} ${kind} atoms have fewer than ${AT_LEAST} complete specs, such as ${short[0]?.[0]} with ${short[0]?.[1]}`,
            };
      },
    })),
    ...SKILLS.map((skill) => ({
      key: `judged-${skill}`,
      tier: 3 as Tier,
      title: `every domain rule of ${skill} has a judged criterion in a complete spec`,
      cause: 'judge every domain rule no code checks with a criterion from its own words',
      component: THEN,
      async judge(suite: FixtureSuite): Promise<ItemResult> {
        const map = await loadEstateMap(suite.map);
        if (!map.ok) return { pass: false, detail: 'the map does not load' };
        const rules = map.map.atoms.filter(
          (atom) =>
            atom.kind === 'instruction' &&
            atom.id.startsWith(`instruction.${skill}.`) &&
            atom.evidence.some((item) => item.type === 'custom'),
        );
        if (rules.length === 0) return { pass: true, detail: 'no domain rule here' };
        const unjudged = rules.filter(
          (rule) =>
            !suite.specs.some(
              (spec) =>
                spec.complete &&
                ((spec.spec.blocks ?? []) as Array<{ expect?: { criteria?: unknown[] } }>).some((block) =>
                  (block.expect?.criteria ?? []).some((criterion) =>
                    JSON.stringify(criterion).includes(rule.id),
                  ),
                ),
            ),
        );
        return unjudged.length === 0
          ? { pass: true, detail: `holds (${rules.length})` }
          : {
              pass: false,
              detail: `${unjudged.length} of ${rules.length} domain rules have no judged criterion, such as ${unjudged[0]?.id}`,
            };
      },
    })),
    ...MARKERS.map(([marker, cause]) => ({
      key: marker,
      tier: 4 as Tier,
      title: `no generated spec of the fixture is incomplete for ${marker}`,
      cause,
      component: THEN,
      judge(suite: FixtureSuite): ItemResult {
        const gap = (suite.report.gaps ?? []).find((entry) => entry.marker === marker);
        return !gap || gap.specs === 0
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `${gap.specs} specs are incomplete for ${marker}, such as on ${gap.atoms[0]}`,
            };
      },
    })),
  ]);
}
