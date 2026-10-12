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

/** The material of a rule quote: its backticked spans and quoted phrases, else the quote itself. */
export function materialOf(quote: string): string[] {
  const found = [
    ...[...quote.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''),
    ...[...quote.matchAll(/"([^"]{3,})"/g)].map((match) => match[1] ?? ''),
  ].filter((item) => item.trim() !== '');
  return found.length > 0 ? [...new Set(found)] : [quote.trim()];
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
  // A catalogue check is run by a dispatcher hook; its name is no command a shell can run.
  if (fields.scope === 'catalogue') {
    return `${atom.id} is a check that a dispatcher hook runs, not a command of its own; the unit tests of that hook cover it`;
  }
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
  const enforced = Array.isArray(fields.enforces)
    ? (fields.enforces as Array<{ atom?: unknown }>).flatMap((entry) =>
        typeof entry.atom === 'string' ? [entry.atom] : [],
      )
    : [];
  const material = [
    ...new Set(
      enforced.flatMap((ruleId) => {
        const rule = atoms.get(ruleId);
        return rule?.provenance?.quote ? materialOf(rule.provenance.quote) : [];
      }),
    ),
  ];
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
