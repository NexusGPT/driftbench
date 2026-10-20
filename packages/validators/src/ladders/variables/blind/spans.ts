/**
 * What the bank means by each condition span it writes.
 *
 * A condition span is English text, and the page asks the reader to turn it into a variable (R3). The bank writes
 * every span itself, from a template, so it knows what the span says. It declares that meaning here, keyed by
 * the exact text it wrote. The bank's own items never read a span back, and a product never sees this table: only
 * the test reference looks a span up by its text, so no word list reads English anywhere in the validators path.
 */

export type Cmp = 'lt' | 'le' | 'gt' | 'ge';

export type SpanMeaning =
  | { kind: 'numeric'; subject: string; limit: number; cmp?: Cmp; flavour: 'cmp' | 'equal' | 'unequal' }
  | { kind: 'range'; subject: string; lo: number; hi: number }
  | { kind: 'member'; subject: string; list: string[] }
  | { kind: 'boolean'; subject: string; word: string };

const declared = new Map<string, SpanMeaning>();

/** Declares what a span says and returns the span. */
export function declareSpan(text: string, meaning: SpanMeaning): string {
  declared.set(text, meaning);
  return text;
}

/** A numeric span: a quantity compared with a limit. */
export function numeric(text: string, subject: string, limit: number, cmp: Cmp): string {
  return declareSpan(text, { kind: 'numeric', subject, limit, cmp, flavour: 'cmp' });
}

/** The meaning declared for a span, by its exact text. */
export function meaningOf(text: string): SpanMeaning | undefined {
  return declared.get(text);
}
