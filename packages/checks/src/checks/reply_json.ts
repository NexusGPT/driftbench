import { type Check, machineVerdict, type Verdict } from '@driftbench/core';
import { checkAssertion, message } from '../support/assert';
import { validateStrict } from '../support/schema';
import { visibleText } from '../support/text';
import { show } from '../support/values';

/**
 * `expect.json`: the customer-visible text of the block is JSON. One verdict for validity, then one for an
 * optional JSON Schema (strict: a key the schema does not declare is an issue), then one per path, each
 * with an assertion from the spec's own vocabulary: a bare value or `exact` for equality, `contains` for a
 * text, `regex`, `one_of`, `nonempty`, `absent`, `subset`. A reply that is one Markdown code fence of JSON
 * is read as that JSON. A path is dotted, and a number in it indexes an array. An unreadable reply fails
 * every verdict after validity, with the reason, so a path is never passed on nothing.
 */
type Paths = { path: string; assert: Parameters<typeof checkAssertion>[1] }[];

const FENCE = /^```(?:json)?[ \t]*\n([\s\S]*?)\n```$/i;

function parseReply(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  const fenced = FENCE.exec(trimmed);
  try {
    return { ok: true, value: JSON.parse(fenced?.[1] ?? trimmed) };
  } catch (cause) {
    return { ok: false, reason: message(cause) };
  }
}

function readPath(value: unknown, path: string): { found: true; value: unknown } | { found: false } {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false };
      current = current[index];
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

export const replyJson: Check = {
  name: 'json',
  applies: (ctx) => ctx.expect.json !== undefined,
  evaluate(ctx) {
    const declared = ctx.expect.json;
    if (!declared) return [];
    const parsed = parseReply(visibleText(ctx.observed));
    const verdicts: Verdict[] = [];
    verdicts.push(
      parsed.ok
        ? machineVerdict('json', 'valid', 'pass', 'the reply is valid JSON')
        : machineVerdict('json', 'valid', 'fail', `the reply is not valid JSON: ${parsed.reason}`),
    );
    if (declared.schema !== undefined) {
      if (!parsed.ok) {
        verdicts.push(machineVerdict('json', 'schema', 'fail', 'no JSON to validate'));
      } else {
        const issues = validateStrict(parsed.value, declared.schema);
        verdicts.push(
          issues.length === 0
            ? machineVerdict('json', 'schema', 'pass', 'the reply matches its JSON Schema')
            : machineVerdict(
                'json',
                'schema',
                'fail',
                issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
              ),
        );
      }
    }
    ((declared.paths ?? []) as Paths).forEach((entry, index) => {
      const id = `path.${index}`;
      if (!parsed.ok) {
        verdicts.push(machineVerdict('json', id, 'fail', `${entry.path}: no JSON to read`));
        return;
      }
      const found = readPath(parsed.value, entry.path);
      if (!found.found) {
        const pass =
          checkAssertion(undefined, { absent: true } as never).ok && 'absent' in (entry.assert as object);
        verdicts.push(
          machineVerdict(
            'json',
            id,
            pass ? 'pass' : 'fail',
            `${entry.path} is absent; expected ${checkAssertion(undefined, entry.assert).expected}`,
          ),
        );
        return;
      }
      const result = checkAssertion(found.value, entry.assert);
      const detail = result.problem ?? `${entry.path} is ${show(found.value)}, expected ${result.expected}`;
      verdicts.push(
        machineVerdict(
          'json',
          id,
          result.ok ? 'pass' : 'fail',
          result.ok ? `${entry.path} is ${show(found.value)}` : detail,
        ),
      );
    });
    return verdicts;
  },
};
