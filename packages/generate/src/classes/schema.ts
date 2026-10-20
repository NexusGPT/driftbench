import { readFile } from 'node:fs/promises';
import { contentHash } from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { containsValue } from './text';

/**
 * An utterance class: one user request written as a class of messages, not one string. The file names the
 * seed (the message the block sends when run as written), the slots the request carries with every spelling
 * (surface form) that stands for the same value, the near values that change the request (minimal pairs), the
 * optional style axes the planner varies, and the invariants every realisation keeps. A surface form is a
 * semantic decision, so it carries an `approved` flag: only approved forms reach the planner and the gate.
 */

export const SLOT_FORMATS = ['phone', 'email', 'number', 'text'] as const;
export type SlotFormat = (typeof SLOT_FORMATS)[number];

/** The name of the axis the planner always varies: which approved spelling each slot value takes. */
export const SLOT_SURFACE = 'slot_surface';

const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lower case letters, digits, dots, dashes and underscores');
const AxisValue = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'lower case letters, digits, dashes and underscores');

export const SurfaceForm = z
  .strictObject({
    form: z.string().min(1).describe('The spelling, character for character.'),
    approved: z
      .boolean()
      .describe('Signed off as the same value. Only approved forms are planned and accepted by the gate.'),
  })
  .describe('One spelling of a slot value.');
export type SurfaceForm = z.infer<typeof SurfaceForm>;

export const ClassSlot = z
  .strictObject({
    name: Id.describe('The slot name, unique in the class.'),
    format: z
      .enum(SLOT_FORMATS)
      .default('text')
      .describe(
        'phone, email or number: the gate also refuses a realisation that carries a second value of this format. text: no format check.',
      ),
    surface_forms: z
      .array(SurfaceForm)
      .min(1)
      .describe('Every spelling of the value. The first approved one is the canonical form.'),
    minimal: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Near values that change the request (one digit, one letter). A realisation holding one is refused.',
      ),
  })
  .describe('A value the request carries.');
export type ClassSlot = z.infer<typeof ClassSlot>;

export const ClassInvariants = z
  .strictObject({
    max_chars: z.number().int().min(1).optional().describe('The longest realisation, in characters.'),
    keep: z
      .array(z.string().min(1))
      .default([])
      .describe('Literal strings of the seed every realisation keeps, such as a product name.'),
    exclusive: z
      .boolean()
      .default(true)
      .describe(
        'Refuse a phone number, an email address or (when a number slot exists) a number that is not a declared value. Default true.',
      ),
  })
  .describe('What every realisation keeps.');
export type ClassInvariants = z.infer<typeof ClassInvariants>;

export const UtteranceClass = z
  .strictObject({
    id: Id.describe('The class id, as `when.class.id` names it.'),
    intent: z
      .string()
      .min(1)
      .describe('What the user asks, in one sentence. The realiser and the judge read it.'),
    seed: z
      .string()
      .min(1)
      .describe('The message the block sends when run as written. It holds every slot value.'),
    context: z
      .strictObject({
        last_reply: z
          .string()
          .default('')
          .describe("The agent's reply before the message; empty for a first turn."),
      })
      .default({ last_reply: '' })
      .describe('Where the message is sent.'),
    slots: z.array(ClassSlot).default([]).describe('The values the request carries.'),
    axes: z
      .record(AxisValue, z.record(AxisValue, z.string().min(1)))
      .default({})
      .describe(
        'Optional style axes: per axis, each value with the instruction the realiser follows. slot_surface is implicit.',
      ),
    exclude: z
      .array(z.record(AxisValue, AxisValue))
      .default([])
      .describe('Value combinations the planner never writes, such as {length: terse, distractor: aside}.'),
    invariants: ClassInvariants.default({ keep: [], exclusive: true }),
    minimal_pairs: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Whole messages that look like the request but change it. A realisation close to one is refused.',
      ),
    strength: z
      .number()
      .int()
      .min(1)
      .max(3)
      .default(2)
      .describe('Strength of the covering array. Default 2.'),
  })
  .describe('An utterance class file.');
export type UtteranceClass = z.infer<typeof UtteranceClass>;

export type ClassIssue = { path: string; message: string };

export type ClassLoad =
  | { ok: true; class: UtteranceClass; hash: string; warnings: ClassIssue[] }
  | { ok: false; errors: ClassIssue[] };

/** The approved spellings of a slot, in file order. */
export function approvedForms(slot: ClassSlot): string[] {
  return slot.surface_forms.filter((f) => f.approved).map((f) => f.form);
}

/** The hash of a class as parsed: any change to the file's meaning (a new approved form included) changes it. */
export function classHash(cls: UtteranceClass): string {
  return contentHash(cls);
}

/** Validates a parsed class file: the schema, then the rules that tie its parts together. */
export function validateClass(raw: unknown): ClassLoad {
  const parsed = UtteranceClass.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  }
  const cls = parsed.data;
  const errors: ClassIssue[] = [];
  const warnings: ClassIssue[] = [];
  const names = new Set<string>();
  cls.slots.forEach((slot, i) => {
    const at = `slots.${i}`;
    if (names.has(slot.name))
      errors.push({ path: `${at}.name`, message: `slot "${slot.name}" is declared twice` });
    names.add(slot.name);
    const forms = slot.surface_forms.map((f) => f.form);
    const seen = new Set<string>();
    forms.forEach((form, j) => {
      if (seen.has(form))
        errors.push({ path: `${at}.surface_forms.${j}`, message: `the form "${form}" is listed twice` });
      seen.add(form);
    });
    const approved = approvedForms(slot);
    if (approved.length === 0) {
      errors.push({
        path: `${at}.surface_forms`,
        message: `slot "${slot.name}" has no approved surface form`,
      });
    }
    const pending = forms.length - approved.length;
    if (pending > 0) {
      warnings.push({
        path: `${at}.surface_forms`,
        message: `slot "${slot.name}": ${pending} surface form(s) wait for sign-off and are not planned`,
      });
    }
    slot.minimal.forEach((value, j) => {
      const clash = forms.find(
        (form) => form === value || containsValue(form, value) || containsValue(value, form),
      );
      if (clash !== undefined) {
        errors.push({
          path: `${at}.minimal.${j}`,
          message: `the minimal value "${value}" is not distinct from the surface form "${clash}"`,
        });
      }
    });
    if (approved.length > 0 && !approved.some((form) => containsValue(cls.seed, form))) {
      errors.push({ path: 'seed', message: `the seed holds no approved form of slot "${slot.name}"` });
    }
  });
  if (SLOT_SURFACE in cls.axes) {
    errors.push({
      path: `axes.${SLOT_SURFACE}`,
      message: `${SLOT_SURFACE} is implicit: it comes from the slots`,
    });
  }
  cls.exclude.forEach((combination, i) => {
    const entries = Object.entries(combination);
    if (entries.length < 2)
      errors.push({ path: `exclude.${i}`, message: 'an exclusion names at least two axes' });
    for (const [axis, value] of entries) {
      const values = axis === SLOT_SURFACE ? surfaceValues(cls) : Object.keys(cls.axes[axis] ?? {});
      if (!values.includes(value)) {
        errors.push({ path: `exclude.${i}.${axis}`, message: `unknown axis value ${axis}=${value}` });
      }
    }
  });
  cls.invariants.keep.forEach((text, i) => {
    if (!cls.seed.includes(text))
      errors.push({ path: `invariants.keep.${i}`, message: `the seed does not hold "${text}"` });
  });
  if (cls.invariants.max_chars !== undefined && cls.seed.length > cls.invariants.max_chars) {
    errors.push({
      path: 'invariants.max_chars',
      message: `the seed is longer than ${cls.invariants.max_chars} characters`,
    });
  }
  cls.minimal_pairs.forEach((pair, i) => {
    if (pair === cls.seed)
      errors.push({ path: `minimal_pairs.${i}`, message: 'a minimal pair equals the seed' });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, class: cls, hash: classHash(cls), warnings };
}

/** The values of the slot_surface axis: `s0` is every slot's first approved form, `s1` the second, and so on. */
export function surfaceValues(cls: UtteranceClass): string[] {
  const most = Math.max(1, ...cls.slots.map((slot) => approvedForms(slot).length));
  return Array.from({ length: most }, (_, i) => `s${i}`);
}

/** The spelling slot `slot` takes in surface cell `value` (`s<k>`): its k-th approved form, wrapping around. */
export function formAt(slot: ClassSlot, value: string): string {
  const forms = approvedForms(slot);
  const k = Number(value.slice(1));
  return forms[k % forms.length] as string;
}

/** Reads and validates a class file (YAML or JSON). */
export async function loadClassFile(path: string): Promise<ClassLoad> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return { ok: false, errors: [{ path: '', message: `cannot read ${path}: ${(cause as Error).message}` }] };
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    return { ok: false, errors: [{ path: '', message: `not YAML: ${(cause as Error).message}` }] };
  }
  return validateClass(raw);
}
