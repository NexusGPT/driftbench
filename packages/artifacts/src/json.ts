import { invalid, isRecord, mapping, requiredString } from './args';
import {
  describeAssertion,
  type Found,
  holds,
  jsonEqual,
  listed,
  parseAssertion,
  showValue,
  subsetDiff,
} from './assertion';
import {
  type CheckTable,
  describeFailure,
  type KindReader,
  outcome,
  ReaderDocument,
  type StructureCheck,
} from './document';
import { decodeText, TEXT_CHECKS } from './text';

/**
 * The json reader. `subset` asks the root for at least some keys, with the semantics of the spec's
 * `subset` assertion; `value` reads one value by path and asserts it with any assertion form.
 */

export type JsonData = { readonly root: unknown };

type Step = string | number;

/** Reads a path such as `plans[0].id`, `plans.0.id`, `$.totals["home plans"]`; empty or `$` is the root. */
export function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  let i = path.startsWith('$') ? 1 : 0;
  while (i < path.length) {
    const char = path[i];
    if (char === '.') {
      i++;
      continue;
    }
    if (char === '[') {
      const close = path.indexOf(']', i);
      if (close === -1) invalid(`has an unclosed [ in the path ${JSON.stringify(path)}`);
      const inside = path.slice(i + 1, close).trim();
      if (/^\d+$/.test(inside)) steps.push(Number(inside));
      else if (/^(["']).*\1$/.test(inside)) steps.push(inside.slice(1, -1));
      else invalid(`has [${inside}] in the path ${JSON.stringify(path)}; write [0] or ["key"]`);
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') end++;
    steps.push(path.slice(i, end));
    i = end;
  }
  return steps;
}

function showStep(step: Step): string {
  return typeof step === 'number'
    ? `[${step}]`
    : /^[A-Za-z_][A-Za-z0-9_-]*$/.test(step)
      ? `.${step}`
      : `[${JSON.stringify(step)}]`;
}

function shape(value: unknown): string {
  if (Array.isArray(value)) return `a list of ${value.length} items`;
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length === 0 ? 'an empty mapping' : `a mapping with ${listed(keys, 8)}`;
  }
  return showValue(value);
}

/** Follows a path from the root. On a miss, says where it stopped and what was there. */
export function resolvePath(root: unknown, steps: readonly Step[]): Found & { stop?: string } {
  let current = root;
  let walked = '';
  for (const step of steps) {
    let next: { ok: true; value: unknown } | undefined;
    if (Array.isArray(current)) {
      const index = typeof step === 'number' ? step : /^\d+$/.test(step) ? Number(step) : undefined;
      if (index !== undefined && index < current.length) next = { ok: true, value: current[index] };
    } else if (isRecord(current) && Object.hasOwn(current, String(step))) {
      next = { ok: true, value: current[String(step)] };
    }
    if (!next)
      return {
        present: false,
        value: undefined,
        stop: `${walked === '' ? 'the root' : walked} is ${shape(current)}`,
      };
    current = next.value;
    walked += showStep(step);
    if (walked.startsWith('.')) walked = walked.slice(1);
  }
  return { present: true, value: current };
}

const subset: StructureCheck<JsonData> = {
  reads: 'structure',
  usage: 'subset: { plans: [...], currency: USD }; nested mappings are subsets, lists match item by item',
  run(arg, data) {
    if (!isRecord(arg) || Object.keys(arg).length === 0)
      invalid('takes a mapping of the keys the root must hold');
    const problems = subsetDiff(arg, data.root);
    return outcome(`the root is ${shape(data.root)}`, problems);
  },
};

const value: StructureCheck<JsonData> = {
  reads: 'structure',
  usage: 'value: { path: "plans[0].id", equals: "mobile-s" }; equals takes any assertion form',
  run(arg, data) {
    const map = mapping(arg, ['path', 'equals']);
    const path = typeof map.path === 'string' ? map.path : requiredString(map, 'path');
    if (!Object.hasOwn(map, 'equals')) invalid('needs equals');
    const want = parseAssertion(map.equals, 'equals');
    const found = resolvePath(data.root, parsePath(path));
    const ok = holds(want, found, jsonEqual);
    const where = parsePath(path).length === 0 ? 'the root' : path;
    const seen = found.present
      ? `${where} = ${showValue(found.value)}`
      : `nothing at ${where}: ${found.stop}`;
    return { ok, evidence: ok ? seen : `${seen}, expected ${describeAssertion(want)}` };
  },
};

export const JSON_CHECKS: CheckTable<JsonData> = { subset, value, ...TEXT_CHECKS };

export const jsonReader: KindReader = {
  kind: 'json',
  checkNames: Object.keys(JSON_CHECKS),
  async open(bytes, path) {
    const text = decodeText(bytes);
    try {
      const root: unknown = JSON.parse(text);
      return new ReaderDocument<JsonData>('json', path, JSON.stringify(root, null, 2), JSON_CHECKS, { root });
    } catch (cause) {
      const why = `${path} could not be read as json: ${describeFailure(cause)}`;
      return new ReaderDocument<JsonData>('json', path, text, JSON_CHECKS, undefined, { structure: why });
    }
  },
};
