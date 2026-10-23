import { type FileCase, classOf } from '../../src/ladders/variables/bank/files';
import { stableStringify } from '../../src/ladders/variables/bank/util';
import type { VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * Implementations that know the class of every answer of a file-format item and are given the right payload for it, and
 * that choose the class by something other than reading the store. Shared by the tests that play such cheats against the
 * file-format items.
 */

const wrongPath = 'x.y';

export function replyOf(c: FileCase, klass: string): unknown {
  const right = classOf(c) === klass;
  if (c.op === 'validate') {
    if (klass === 'accept') return { ok: true, store: c.store, warnings: [] };
    const code = klass.slice('reject:'.length);
    const path = c.want.kind === 'reject' ? (c.want.paths[0] as string) : wrongPath;
    return {
      ok: false,
      errors: [
        {
          code: right && c.want.kind === 'reject' && c.want.codeFamily ? 'SCHEMA_INVALID_TYPE' : code,
          path: right ? path : wrongPath,
        },
      ],
    };
  }
  if (klass === 'found') return { errors: [] };
  if (right && c.want.kind === 'issues') return { errors: c.want.issues };
  const codes = klass.slice('issues:'.length).split('+');
  return { errors: codes.map((code) => ({ code, path: wrongPath })) };
}

export const keyOf = (op: string, ...args: unknown[]) => stableStringify([op, ...args]);

/** A cheat that is right whenever its class guess is right: it picks the class with `pick(callIndex, request)`. */
export function cheat(
  sequence: readonly FileCase[],
  pick: (index: number, c: FileCase) => string,
): Partial<VariablesImpl> {
  const byRequest = new Map<string, FileCase>();
  for (const c of sequence)
    byRequest.set(c.op === 'validate' ? keyOf('validate', c.store) : keyOf('quotes', c.store, c.files), c);
  let calls = 0;
  const lookup = (key: string): FileCase => {
    const found = byRequest.get(key);
    if (!found) throw new Error('the cheat was asked something outside the item');
    return found;
  };
  return {
    validate(value) {
      const c = lookup(keyOf('validate', value));
      return replyOf(c, pick(calls++, c)) as ReturnType<VariablesImpl['validate']>;
    },
    quotes(store, files) {
      const c = lookup(keyOf('quotes', store, files));
      return replyOf(c, pick(calls++, c)) as ReturnType<VariablesImpl['quotes']>;
    },
  };
}
