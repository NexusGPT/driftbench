import { type Check, machineVerdict } from '@driftbench/core';
import { visibleText } from '../support/text';

/**
 * Two overlap scores between the visible reply and a reference text, both over words: letters and digits,
 * lower-cased, punctuation dropped.
 *
 * - ROUGE-L: the longest common subsequence of words, as an F measure (the harmonic mean of precision and
 *   recall over the two word counts).
 * - BLEU: clipped n-gram precision for n from 1 to 4, geometric mean, times a brevity penalty for a reply
 *   shorter than the reference. No smoothing: a reply with no match at some n scores 0.
 *
 * `expect.rouge_l` and `expect.bleu` each hold one reference and a minimum score, from 0 to 1.
 */

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** ROUGE-L F measure of a reply against a reference. 0 when either side has no word. */
export function rougeLScore(reply: string, reference: string): number {
  const a = words(reply);
  const b = words(reference);
  if (a.length === 0 || b.length === 0) return 0;
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i]![j] =
        a[i - 1] === b[j - 1] ? table[i - 1]![j - 1]! + 1 : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
    }
  }
  const lcs = table[a.length]![b.length]!;
  if (lcs === 0) return 0;
  const precision = lcs / a.length;
  const recall = lcs / b.length;
  return (2 * precision * recall) / (precision + recall);
}

/** BLEU of a reply against a reference, n-grams 1 to 4, with the brevity penalty. 0 when a size has no match. */
export function bleuScore(reply: string, reference: string): number {
  const hypothesis = words(reply);
  const target = words(reference);
  if (hypothesis.length === 0 || target.length === 0) return 0;
  let logSum = 0;
  for (let n = 1; n <= 4; n += 1) {
    const candidates = grams(hypothesis, n);
    if (candidates.length === 0) return 0;
    const available = new Map<string, number>();
    for (const gram of grams(target, n)) available.set(gram, (available.get(gram) ?? 0) + 1);
    let matched = 0;
    for (const gram of candidates) {
      const left = available.get(gram) ?? 0;
      if (left > 0) {
        matched += 1;
        available.set(gram, left - 1);
      }
    }
    if (matched === 0) return 0;
    logSum += Math.log(matched / candidates.length);
  }
  const penalty = hypothesis.length > target.length ? 1 : Math.exp(1 - target.length / hypothesis.length);
  return penalty * Math.exp(logSum / 4);
}

function grams(tokens: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

function scored(name: 'rouge_l' | 'bleu', label: string, score: number, min: number): ReturnType<typeof machineVerdict> {
  const shown = score.toFixed(3);
  return score >= min
    ? machineVerdict(name, '0', 'pass', `${label} ${shown} is at least ${min}`)
    : machineVerdict(name, '0', 'fail', `${label} ${shown} is under ${min}`);
}

export const rougeL: Check = {
  name: 'rouge_l',
  applies: (ctx) => ctx.expect.rouge_l !== undefined,
  evaluate(ctx) {
    const entry = ctx.expect.rouge_l;
    if (entry === undefined) return [];
    return [scored('rouge_l', 'ROUGE-L', rougeLScore(visibleText(ctx.observed), entry.reference), entry.min)];
  },
};

export const bleu: Check = {
  name: 'bleu',
  applies: (ctx) => ctx.expect.bleu !== undefined,
  evaluate(ctx) {
    const entry = ctx.expect.bleu;
    if (entry === undefined) return [];
    return [scored('bleu', 'BLEU', bleuScore(visibleText(ctx.observed), entry.reference), entry.min)];
  },
};
