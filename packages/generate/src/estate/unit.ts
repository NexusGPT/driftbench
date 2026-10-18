import { z } from 'zod';
import type { EstateAtom, EstatePlanRow } from './inputs';

/**
 * A unit test of the estate: a guard or a script run directly, with no model in the loop, by
 * `driftbench estate unit` on an estate root (the original or a mutant copy). The generator writes one per
 * guard and test type (guard_positive, guard_negative, guard_hostile, guard_speed) and one per script row
 * (script_fixture), as JSON in `unit/<test type>/<id>.json`.
 *
 * A guard test holds hook payloads in the runtime's input shape, built by code from the map: the event and
 * the matcher of the guard, and the material of the rules it enforces (the commands, paths and phrases their
 * quotes hold). The generator knows no verdict: `estate unit --record` runs every case on the original estate
 * and writes what the guard decided into the test (the oracle), and a run on a mutant compares with it.
 *
 * - guard_positive: payloads the rules forbid. Recorded allowed with nothing printed, a case is inert (it
 *   cannot show the guard at work) and is reported, never asserted.
 * - guard_negative: neutral payloads. The guard lets them through on the original.
 * - guard_hostile: the forbidden material in forms that slip past a naive match (spacing, case, quoting,
 *   a chained command). Recorded allowed, a case is a weakness of the guard, reported.
 * - guard_speed: a spread of at most five positive payloads, timed against the guard's declared timeout (60 s by default).
 * - script_fixture: the fixtures the estate declares for the script, run as declared; with none declared,
 *   minimal fixtures from how the estate says to run the script (no argument, then its documented command
 *   lines), their outcomes recorded like a guard's.
 */

export const UNIT_DIR = 'unit';
export const UNIT_TEST_TYPES: ReadonlySet<string> = new Set([
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'guard_speed',
  'script_fixture',
]);

/** What a run of a guard decided, as the runtime reads it. */
export const UnitDecision = z.enum(['allow', 'deny', 'ask', 'error']);
export type UnitDecision = z.infer<typeof UnitDecision>;

/** The recorded outcome of a case on the original estate: the oracle a mutant run compares with. */
export const UnitOutcome = z.strictObject({
  decision: UnitDecision,
  exitCode: z.number().int(),
  /** The message the runtime would show (stderr on exit 2, the reason of a JSON decision), when stable. */
  message: z.string().optional(),
  /** What the guard printed on stdout (context it adds, a JSON decision), when stable. */
  output: z.string().optional(),
});
export type UnitOutcome = z.infer<typeof UnitOutcome>;

export const GuardCase = z.strictObject({
  id: z.string().min(1),
  /** The hook payload, in the runtime's input shape, without the session fields the runner adds. */
  payload: z.record(z.string(), z.unknown()),
  /** The material the case carries, for the report. */
  material: z.string(),
  expected: UnitOutcome.optional(),
  /** Set by --record: the case cannot show the guard at work (positive) or slips past it (hostile). */
  inert: z.boolean().optional(),
  /** Recorded with an outcome that varied across the record runs: reported, never compared. */
  flaky: z.boolean().optional(),
});
export type GuardCase = z.infer<typeof GuardCase>;

export const UnitTest = z.strictObject({
  id: z.string().min(1),
  planRow: z.string().min(1),
  testType: z.enum(['guard_positive', 'guard_negative', 'guard_hostile', 'guard_speed', 'script_fixture']),
  atom: z.string().min(1),
  title: z.string().min(1),
  mapHash: z.string().min(1),
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('guard'),
      name: z.string().min(1),
      event: z.string().min(1),
      matcher: z.string().optional(),
      command: z.string().min(1),
      /** The guard's declared timeout, in seconds. */
      timeout: z.number().positive().optional(),
      /** A catalogue check this hook runs: the test sends the check's trigger, and looks for its id. */
      check: z.string().optional(),
    }),
    z.strictObject({ kind: z.literal('script'), path: z.string().min(1), skill: z.string().optional() }),
  ]),
  cases: z.array(GuardCase).default([]),
  /** The map hash of the estate --record ran on; absent until then. */
  recordedOn: z.string().optional(),
  /** guard_speed: the most a run may take, in milliseconds. */
  budgetMs: z.number().int().positive().optional(),
});
export type UnitTest = z.infer<typeof UnitTest>;

/** Events whose payload names a tool. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);
const NEUTRAL: Record<string, string> = {
  Bash: 'ls',
  Read: 'README.md',
  Edit: 'notes.md',
  Write: 'notes.md',
  MultiEdit: 'notes.md',
  WebFetch: 'https://example.invalid/',
  Grep: 'TODO',
  Glob: '*.md',
};

/** The tools a matcher names: `Edit|Write` gives two; an empty or `*` matcher gives Bash. */
export function matcherTools(matcher: string | undefined): string[] {
  if (matcher === undefined || matcher.trim() === '' || matcher.trim() === '*') return ['Bash'];
  const tools = matcher
    .split('|')
    .map((part) => part.replace(/[()^$\\]/g, '').trim())
    .filter((part) => /^[A-Za-z][\w.:-]*$/.test(part));
  return tools.length > 0 ? tools : ['Bash'];
}

/** Words and marks that make a clause forbid what it names. */
const FORBIDS =
  /\b(never|no|not|don't|do not|must not|mustn't|forbid|forbidden|banned|refuse[sd]?|block(?:s|ed)?|den(?:y|ies|ied)|avoid|stop)\b|✗|\bWRONG\b/i;

/**
 * The material of a rule quote: the backticked spans and quoted phrases of the clauses that forbid them
 * ("Never use `sed -i`", "✗ `2>/dev/null`"), never a name or path the rule only mentions. A quote with no
 * span at all is its own material.
 */
export function materialOf(quote: string): string[] {
  const spans: string[] = [];
  const masked = quote.replace(
    /`([^`]+)`|"([^"]{3,})"/g,
    (_, code: string | undefined, phrase: string | undefined) => {
      spans.push(code ?? phrase ?? '');
      return `\uE000${spans.length - 1}\uE000`;
    },
  );
  if (spans.length === 0) return [quote.trim()];
  const found: string[] = [];
  for (const clause of masked.split(/(?<=[.!?])\s+|\n|;|·|(?=✓)/)) {
    if (!FORBIDS.test(clause.replace(/\uE000\d+\uE000/g, ' '))) continue;
    for (const match of clause.matchAll(/\uE000(\d+)\uE000/g)) {
      const span = spans[Number(match[1])] ?? '';
      if (span.trim() !== '') found.push(span);
    }
  }
  return [...new Set(found)];
}

/** The tool input a tool takes, carrying one piece of material. */
export function toolInput(tool: string, material: string): Record<string, unknown> {
  const looksLikePath = /^[\w./~-]+\.[A-Za-z0-9]+$/.test(material) || material.includes('/');
  switch (tool) {
    case 'Bash':
      return { command: material, description: 'unit test' };
    case 'Read':
      return { file_path: material };
    case 'Edit':
    case 'MultiEdit':
      return looksLikePath
        ? { file_path: material, old_string: 'a', new_string: 'b' }
        : { file_path: 'notes.md', old_string: 'a', new_string: material };
    case 'Write':
      return looksLikePath
        ? { file_path: material, content: 'x' }
        : { file_path: 'notes.md', content: material };
    case 'WebFetch':
      return { url: /^https?:/.test(material) ? material : 'https://example.invalid/', prompt: material };
    default:
      return { input: material };
  }
}

/** A hook payload for an event, a tool and a piece of material (the session fields come from the runner). */
export function payloadOf(
  event: string,
  tool: string | undefined,
  material: string,
): Record<string, unknown> {
  if (TOOL_EVENTS.has(event) && tool !== undefined) {
    const payload: Record<string, unknown> = { tool_name: tool, tool_input: toolInput(tool, material) };
    if (event === 'PostToolUse') payload.tool_response = { stdout: '', stderr: '', interrupted: false };
    return payload;
  }
  if (event === 'UserPromptSubmit') return { prompt: material };
  // Stop and the other events: the material is the last reply, which the runner writes into the transcript.
  return { stop_hook_active: false, last_reply: material };
}

/** A speed test times this many positive payloads: latency needs a spread, not every payload. */
export const SPEED_CASES = 5;

/** At most `count` cases, evenly spread from the first to the last, numbered again from case-01. */
function spreadOf(cases: GuardCase[], count: number): GuardCase[] {
  if (cases.length <= count) return cases;
  const picked = Array.from(
    { length: count },
    (_, index) => cases[Math.round((index * (cases.length - 1)) / (count - 1))] as GuardCase,
  );
  return picked.map((entry, index) => ({ ...entry, id: `case-${String(index + 1).padStart(2, '0')}` }));
}

/** Hostile forms of forbidden material: spacing, case, quoting and a chained command. */
export function hostileForms(material: string): string[] {
  const forms = [
    material.replace(/ /g, '  '),
    material.toUpperCase() === material ? material.toLowerCase() : material.toUpperCase(),
    material.includes(' ') ? material.replace(/ /, " '' ") : `${material} `,
    `echo ok && ${material}`,
  ];
  return [...new Set(forms)].filter((form) => form !== material);
}

/** The unit test of a row, or the reason it has none. */
export function unitTestOf(
  row: EstatePlanRow,
  atom: EstateAtom,
  atoms: ReadonlyMap<string, EstateAtom>,
  mapHash: string,
  id: string,
): UnitTest | string {
  const testType = row.testType as UnitTest['testType'];
  const base = { id, planRow: row.id, testType, atom: atom.id, title: atom.title, mapHash };
  if (testType === 'script_fixture') {
    const path = atom.fields?.path;
    if (typeof path !== 'string' || path === '') return `${atom.id} names no script path`;
    const skill = atom.fields?.skill;
    return {
      ...base,
      target: { kind: 'script', path, ...(typeof skill === 'string' ? { skill } : {}) },
      cases: scriptCases(atom.provenance?.quote ?? '', path),
    };
  }
  const fields = atom.fields ?? {};
  // A catalogue check is run by a hook, not by a command of its own: it is tested by sending its trigger to
  // that hook. Without a trigger or a host hook it is a counted gap, not a test.
  if (fields.scope === 'catalogue') return checkTestOf(row, atom, atoms, base);
  const name = fields.name;
  const event = fields.event;
  const command = fields.command;
  if (typeof name !== 'string' || typeof event !== 'string' || typeof command !== 'string') {
    return `${atom.id} is no guard with a name, an event and a command`;
  }
  const matcher = typeof fields.matcher === 'string' ? fields.matcher : undefined;
  const timeout = typeof fields.timeout === 'number' ? fields.timeout : undefined;
  const target = {
    kind: 'guard' as const,
    name,
    event,
    command,
    ...(matcher !== undefined ? { matcher } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
  const tools = TOOL_EVENTS.has(event) ? matcherTools(matcher) : [undefined];
  // A rule linked by a registry row or an id the guard cites is what the guard checks; a rule linked only
  // because the guard's source repeats some of its words is a weaker link, used when there is no other.
  const links = Array.isArray(fields.enforces)
    ? (fields.enforces as Array<{ atom?: unknown; by?: unknown }>).flatMap((entry) =>
        typeof entry.atom === 'string' ? [{ atom: entry.atom, by: entry.by }] : [],
      )
    : [];
  const strong = links.filter((link) => link.by === 'registry' || link.by === 'id');
  const enforced = (strong.length > 0 ? strong : links).map((link) => link.atom);
  // A rule the guard cites (registry or id) gives every concrete span of its source lines; a rule linked by
  // a repeated quote gives only the spans its words forbid. A rule with no span gives its sentence, which
  // only a text event (a prompt, a reply) can carry: a tool never gets a sentence as its input.
  const cites = strong.length > 0;
  const textEvent = !TOOL_EVENTS.has(event);
  const material = [
    ...new Set(
      enforced.flatMap((ruleId) => {
        const rule = atoms.get(ruleId);
        const quote = rule?.provenance?.quote ?? '';
        const lineSpans = Array.isArray(rule?.fields?.spans)
          ? (rule.fields.spans as unknown[]).filter((item): item is string => typeof item === 'string')
          : [];
        const quoteSpans = [...quote.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
        const spans = cites
          ? [...lineSpans, ...quoteSpans]
          : materialOf(quote).filter((item) => item !== quote.trim());
        if (spans.length > 0) return spans;
        return textEvent && quote.trim() !== '' ? materialOf(quote) : [];
      }),
    ),
  ].filter((item) => item.trim() !== '');
  const cases: GuardCase[] = [];
  const add = (tool: string | undefined, text: string) => {
    cases.push({
      id: `case-${String(cases.length + 1).padStart(2, '0')}`,
      payload: payloadOf(event, tool, text),
      material: text,
    });
  };
  if (testType === 'guard_negative') {
    for (const tool of tools) add(tool, tool === undefined ? 'Done.' : (NEUTRAL[tool] ?? 'hello'));
  } else {
    if (material.length === 0) return `${atom.id} enforces no rule whose quote gives material for a payload`;
    for (const tool of tools) {
      for (const text of material) {
        if (testType === 'guard_hostile') for (const form of hostileForms(text)) add(tool, form);
        else add(tool, text);
      }
    }
  }
  return {
    ...base,
    target,
    cases: testType === 'guard_speed' ? spreadOf(cases, SPEED_CASES) : cases,
    ...(testType === 'guard_speed' ? { budgetMs: Math.round((timeout ?? 60) * 1000) } : {}),
  };
}

/** Reasons a catalogue check gets no unit test; the report counts them as gaps. */
export const CHECK_GAP = {
  trigger: 'needs a trigger: the map holds no material that sets the check off',
  host: 'needs a host: no configured hook on its event names the check',
} as const;

/** The events and tools a check's event names: `PreToolUse (Bash)`, `Stop, PostToolUse`, `PreToolUse (Task/Agent)`. */
export function checkEvents(text: string): Array<{ event: string; tools: string[] }> {
  return text.split(',').flatMap((part) => {
    const match = /^\s*(\w+)\s*(?:\(([^)]*)\))?/.exec(part);
    if (!match?.[1]) return [];
    const tools = (match[2] ?? '')
      .split('/')
      .map((tool) => tool.trim())
      .filter((tool) => tool !== '');
    return [{ event: match[1], tools }];
  });
}

function checkTestOf(
  row: { testType: string },
  atom: EstateAtom,
  atoms: ReadonlyMap<string, EstateAtom>,
  base: Omit<UnitTest, 'target' | 'cases'>,
): UnitTest | string {
  const fields = atom.fields ?? {};
  if (row.testType !== 'guard_positive') {
    return `${atom.id} is a check its host hook runs; the host hook tests cover this test type`;
  }
  const trigger = Array.isArray(fields.trigger)
    ? (fields.trigger as unknown[]).filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
  if (trigger.length === 0) return `${atom.id} ${CHECK_GAP.trigger}`;
  const host = fields.host;
  const check = typeof fields.check === 'string' ? fields.check : String(fields.name ?? atom.id);
  const wanted = checkEvents(String(fields.event ?? ''));
  for (const parent of atoms.values()) {
    const own = parent.fields ?? {};
    if (
      parent.kind !== 'guard' ||
      own.scope === 'catalogue' ||
      own.script !== host ||
      typeof host !== 'string'
    )
      continue;
    const name = own.name;
    const event = own.event;
    const command = own.command;
    if (typeof name !== 'string' || typeof event !== 'string' || typeof command !== 'string') continue;
    const matcher = typeof own.matcher === 'string' ? own.matcher : undefined;
    const hostTools: string[] = TOOL_EVENTS.has(event) ? matcherTools(matcher) : [];
    const fit = wanted.find((entry) => entry.event === event);
    if (!fit) continue;
    const tools: Array<string | undefined> = TOOL_EVENTS.has(event)
      ? fit.tools.length > 0
        ? fit.tools.filter((tool) => hostTools.includes(tool))
        : hostTools.slice(0, 1)
      : [undefined];
    if (tools.length === 0) continue;
    const tool = tools[0];
    const cases: GuardCase[] = trigger.map((text, index) => ({
      id: `case-${String(index + 1).padStart(2, '0')}`,
      payload: payloadOf(event, tool, text),
      material: text,
    }));
    const timeout = typeof own.timeout === 'number' ? own.timeout : undefined;
    return {
      ...base,
      target: {
        kind: 'guard' as const,
        name,
        event,
        command,
        ...(matcher !== undefined ? { matcher } : {}),
        ...(timeout !== undefined ? { timeout } : {}),
        check,
      },
      cases,
    };
  }
  return `${atom.id} ${CHECK_GAP.host}`;
}

/**
 * The minimal fixtures of a script with none declared, from how the estate says to run it: the script with
 * no argument (its usage path), then each command line the atom's quote writes for it, a `<placeholder>`
 * argument becoming an empty file of that name in the working folder. The outcomes are recorded on the
 * original by `estate unit --record`, like a guard's.
 */
export function scriptCases(quote: string, path: string): GuardCase[] {
  const name = path.split('/').pop() ?? path;
  const cases: GuardCase[] = [{ id: 'case-01', payload: { args: [] }, material: 'no argument' }];
  const seen = new Set<string>(['']);
  for (const match of quote.matchAll(/`([^`]+)`/g)) {
    const tokens = (match[1] ?? '').trim().split(/\s+/);
    const at = tokens.findIndex((token) => token.endsWith(name));
    if (at < 0) continue;
    const files: Record<string, string> = {};
    const args = tokens.slice(at + 1).map((token) => {
      const placeholder = /^<([^>]+)>$/.exec(token)?.[1];
      if (placeholder === undefined) return token;
      const file = placeholder.replace(/[^\w.-]+/g, '-');
      files[file] = '';
      return file;
    });
    const key = args.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({
      id: `case-${String(cases.length + 1).padStart(2, '0')}`,
      payload: { args, ...(Object.keys(files).length > 0 ? { files } : {}) },
      material: key,
    });
  }
  return cases;
}
