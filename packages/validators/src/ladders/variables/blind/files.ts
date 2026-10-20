import type { ItemContext } from '../bank/item';
import { clone } from '../bank/util';
import type {
  FileConstraint,
  FileIssue,
  FileStore,
  FileValue,
  FileVariable,
  ValidateResult,
} from '../interface';
import { callValidate, must, names, show } from './kit';

/**
 * Fictional store files for the items that call `validate` and `quotes`. One valid base store, and the helpers
 * that apply exactly one defect to a copy and read the answer.
 */

export const DEVIATION_CLASSES = [
  'D1_off_topic',
  'D2_goal_shift',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D8_tool_failure',
  'D9_out_of_scope',
  'D10_return',
  'D11_pii_leak',
  'D12_prompt_extraction',
] as const;

export const SET_HASH = 'a3f1c0de5b7a49e8d2c6f4b1a0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a39281';

export type Base = {
  store: FileStore;
  /** The id of each variable, by role. */
  v: { channel: string; stage: string; delay: string; persona: string; deviation: string };
};

/** A valid store of five variables: three axes of kinds stage, channel and persona, one deviation axis, one detail. */
export function baseFile(ctx: ItemContext): Base {
  const [a, b, c, d, e] = names(ctx.rng, 5, 'k_') as [string, string, string, string, string];
  const val = (id: string, title = `The ${id} case`): FileValue => ({ id, title });
  const store: FileStore = {
    format: 1,
    agent: 'northgate_desk',
    version: '1',
    prior: { kind: 'declared' },
    variables: [
      {
        id: a,
        title: 'Where the customer writes',
        kind: 'channel',
        role: 'axis',
        approved: true,
        values: [val('web'), val('email'), val('phone')],
      },
      {
        id: b,
        title: 'Where the case stands',
        kind: 'stage',
        role: 'axis',
        approved: true,
        values: [val('intake'), val('lookup'), val('resolve')],
      },
      {
        id: c,
        title: 'How many days late the parcel is',
        kind: 'data',
        role: 'detail',
        approved: true,
        values: [val('under_two_days'), val('exactly_two_days'), val('more_than_two_days')],
        boundaries: [
          {
            holds: 'more_than_two_days',
            fails: 'under_two_days',
            edge: 'exactly_two_days',
            limit: 2,
            comparison: 'gt',
            unit: 'days',
          },
        ],
      },
      {
        id: d,
        title: 'Who writes',
        kind: 'persona',
        role: 'axis',
        approved: true,
        values: [val('first_time'), val('returning')],
      },
      {
        id: e,
        title: 'How the customer strays',
        kind: 'deviation',
        role: 'axis',
        approved: true,
        values: [val('none'), val('D1_off_topic'), val('D3_contradiction')],
      },
    ],
    constraints: [
      {
        forbid: { [a]: 'phone', [b]: 'lookup' },
        reason: 'Lookups are not offered on the phone line.',
        approved: true,
      },
    ],
  };
  return { store, v: { channel: a, stage: b, delay: c, persona: d, deviation: e } };
}

export function copy<T>(value: T): T {
  return clone(value);
}

/** The base store with one defect applied to a copy. */
export function defect(ctx: ItemContext, apply: (base: Base) => void): Base {
  const base = baseFile(ctx);
  apply(base);
  return base;
}

export function validateOk(ctx: ItemContext, value: unknown, label = 'the store'): ValidateResult {
  const r = callValidate(ctx, value);
  must(
    r.ok,
    () =>
      `${label} is valid by the page and was refused: ${show((r as { errors?: FileIssue[] }).errors, 240)}`,
  );
  return r;
}

export function errorsOf(r: ValidateResult): FileIssue[] {
  return r.ok ? [] : r.errors;
}

/** The store is refused, with an issue of this code (and this path, when given). */
export function validateIssue(ctx: ItemContext, value: unknown, code: string, path?: string): FileIssue[] {
  const r = callValidate(ctx, value);
  must(
    !r.ok,
    () =>
      `a store with the defect was accepted; the page refuses it with ${code}${path ? ` at ${path}` : ''}`,
  );
  const errors = errorsOf(r);
  const hit = errors.find((e) => e.code === code && (path === undefined || e.path === path));
  must(!!hit, () => `no ${code}${path ? ` at ${path}` : ''} among ${show(errors, 300)}`);
  return errors;
}

/** The store is refused and some issue is reported at this path or below it, whatever its code. */
export function validateIssueAt(ctx: ItemContext, value: unknown, path: string): FileIssue[] {
  const r = callValidate(ctx, value);
  must(!r.ok, () => `a store with the defect was accepted; the page refuses it at ${path}`);
  const errors = errorsOf(r);
  must(
    errors.some((e) => e.path === path || e.path.startsWith(`${path}.`)),
    () => `no issue at ${path} among ${show(errors, 300)}`,
  );
  return errors;
}

/** The store is refused and every issue code starts with SCHEMA_ (a schema error stops the load before references). */
export function isSchemaCode(code: string): boolean {
  return code.startsWith('SCHEMA_');
}

export function variableOf(store: FileStore, index: number): FileVariable {
  return store.variables[index] as FileVariable;
}

export function constraintOf(store: FileStore, index: number): FileConstraint {
  return (store.constraints as FileConstraint[])[index] as FileConstraint;
}
