import type { LedgerChoice, LedgerVerdict } from './pair-ledger';
import { readerRiskFlags } from './reader-first';
import { type ReaderFeatures, readerFeatures } from './reader-first-features';

/** Caller-declared pairwise preferences. None is applied unless the caller names it. */
export const PAIR_PREFERENCES = ['long-structured'] as const;
export type PairPreference = (typeof PAIR_PREFERENCES)[number];

export type PreferenceResult = {
  readonly name: PairPreference;
  readonly choice: LedgerChoice;
  readonly ruleId: 'preference.hard-row' | 'preference.long-structured' | 'preference.ledger';
  readonly lengths: { readonly first: number; readonly second: number };
  readonly structured: { readonly first: boolean; readonly second: boolean };
};

/** Same thresholds as the reader-first structure and repetition flags. */
export function isStructured(f: ReaderFeatures): boolean {
  return !readerRiskFlags(f).structure && f.repeatedSentenceRatio <= 0.08 && f.ngramRedundancy <= 0.15;
}

/**
 * The longer reply wins when it is structured (paragraphs, headings or lists, no heavy repetition),
 * or when the shorter one is not structured either. An explicit request row (a hard ledger gate) decides
 * first, so a stated word limit or form still binds. Otherwise the ledger verdict stands.
 */
export function applyLongStructured(
  first: string,
  second: string,
  verdict: LedgerVerdict | undefined,
  language?: 'en' | 'zh',
): PreferenceResult {
  const lang = language ?? readerFeatures(`${first}\n${second}`).language;
  const a = readerFeatures(first, lang),
    b = readerFeatures(second, lang);
  const base = {
    name: 'long-structured' as const,
    lengths: { first: a.length, second: b.length },
    structured: { first: isStructured(a), second: isStructured(b) },
  };
  const hard = (verdict?.readings ?? [])
    .filter((r) => r.ruleId === 'ledger.hard-gate')
    .reduce((sum, r) => sum + r.sign, 0);
  if (hard !== 0) return { ...base, choice: hard > 0 ? 'first' : 'second', ruleId: 'preference.hard-row' };
  const ledger = verdict?.choice ?? 'tie';
  if (a.length === b.length) return { ...base, choice: ledger, ruleId: 'preference.ledger' };
  const longer = a.length > b.length ? 'first' : 'second';
  const shorter = longer === 'first' ? 'second' : 'first';
  if (base.structured[longer] || !base.structured[shorter])
    return { ...base, choice: longer, ruleId: 'preference.long-structured' };
  return { ...base, choice: ledger, ruleId: 'preference.ledger' };
}
