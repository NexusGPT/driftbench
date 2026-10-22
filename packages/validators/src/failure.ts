/**
 * The failure of a bank item, in fields (docs/validators.md section 12, "What a failure message says").
 *
 * A message names the item, the rule or cause id, the input and the product's own output. It never names the
 * expected value: the builder learns what is wrong and where, and has to work out the answer from the documented
 * page. The expected value is kept in a field of its own that the rendered message does not read, so a test can check
 * on fields, not on prose, that nothing of it reached the message.
 *
 * Every ladder can use this: throw an `ItemFailure` (or call `check`) from an item, and run `leakReport` over the
 * failures that a set of wrong products provoke.
 */

export type FailureFields = {
  /** The item that failed, when the caller knows it. */
  item?: string;
  /** The rule or cause the item checks, in words that do not give the wanted value. */
  rule: string;
  /** What the item gave to the product. */
  input?: unknown;
  /** What the product returned or did. For a count item, the product's number. */
  got?: unknown;
  /** The wanted value. Never rendered. */
  expected?: unknown;
};

/** A value as a message prints it: short, with non-finite numbers and bigint named. */
export function showValue(value: unknown, limit = 200): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? `${v}n` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
    );
  } catch {
    text = undefined;
  }
  const out = text === undefined ? String(value) : text;
  return out.length > limit ? `${out.slice(0, limit - 3)}...` : out;
}

/** The message of a failure: a function of item, rule, input and got, and of nothing else. */
export function renderFailure(fields: Pick<FailureFields, 'item' | 'rule' | 'input' | 'got'>): string {
  const parts = [fields.rule];
  if ('input' in fields && fields.input !== undefined) parts.push(`input ${showValue(fields.input)}`);
  if ('got' in fields && fields.got !== undefined) parts.push(`got ${showValue(fields.got)}`);
  return parts.join('; ');
}

export class ItemFailure extends Error {
  readonly fields: FailureFields;
  constructor(fields: FailureFields) {
    super(renderFailure(fields));
    this.name = 'ItemFailure';
    this.fields = fields;
  }
}

/** Fails the item with these fields unless the condition holds. */
export function check(condition: unknown, fields: FailureFields | (() => FailureFields)): asserts condition {
  if (!condition) throw new ItemFailure(typeof fields === 'function' ? fields() : fields);
}

/** The strings and numbers of a value, as the tokens a message could repeat. */
function atomsOf(value: unknown, into = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || value === undefined || value === null) return into;
  if (typeof value === 'string') {
    into.add(value);
    // A string with white space is a sentence, not a value: only a string without any is split into tokens.
    if (!/\s/.test(value)) for (const token of value.match(/[A-Za-z0-9_.\-/]{3,}/g) ?? []) into.add(token);
  } else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    into.add(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) atomsOf(item, into, depth + 1);
  } else if (typeof value === 'object') {
    // The keys of an object are labels of the item, not values: only the leaves count.
    for (const v of Object.values(value as Record<string, unknown>)) atomsOf(v, into, depth + 1);
  }
  return into;
}

const TOKEN = /[A-Za-z0-9_.\-/]+/g;

/**
 * What of the expected value a message repeats. Two checks, both on fields:
 * - the message must be exactly the rendering of item, rule, input and got, so nothing was added to it by hand;
 * - no token of the expected value that is at least three characters long, and not in the input, the got or the item id,
 *   may appear as a token of the message.
 */
export function leaksOf(failure: ItemFailure): string[] {
  const { fields } = failure;
  const out: string[] = [];
  if (failure.message !== renderFailure(fields)) out.push('(the message is not the rendering of its fields)');
  if (fields.expected === undefined) return out;
  // The rule is not allowed text: a rule that names the wanted value is a leak. The item id is allowed, it names
  // the item and not the answer.
  const allowed = new Set<string>([
    ...atomsOf(fields.input),
    ...atomsOf(fields.got),
    ...atomsOf(fields.item),
  ]);
  // Whatever the input and the output of the product print, in the words a message would read them, is theirs.
  for (const text of [showValue(fields.input, 4000), showValue(fields.got, 4000), fields.item ?? ''])
    for (const token of text.match(TOKEN) ?? []) allowed.add(token);
  const words = new Set<string>(failure.message.match(TOKEN) ?? []);
  for (const atom of atomsOf(fields.expected)) {
    if (atom.length < 3 || allowed.has(atom)) continue;
    if (words.has(atom)) out.push(atom);
  }
  return out;
}

export type LeakReport = {
  /** Failures that were ItemFailures. */
  structured: number;
  /** Failures that were anything else: the message cannot be checked on fields. */
  unstructured: number;
  /** The structured failures whose message repeats the expected value. */
  leaking: Array<{ item: string; rule: string; atoms: string[] }>;
};

/** Checks the failures that wrong products provoke. `items` names each failure when it does not name itself. */
export function leakReport(failures: ReadonlyArray<{ item: string; error: unknown }>): LeakReport {
  const report: LeakReport = { structured: 0, unstructured: 0, leaking: [] };
  for (const { item, error } of failures) {
    if (!(error instanceof ItemFailure)) {
      report.unstructured += 1;
      continue;
    }
    report.structured += 1;
    const atoms = leaksOf(error);
    if (atoms.length > 0)
      report.leaking.push({ item: error.fields.item ?? item, rule: error.fields.rule, atoms });
  }
  return report;
}
