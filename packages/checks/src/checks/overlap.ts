import { type Check, machineVerdict } from '@agent-nexus/driftbench-core';
import { porterStem } from '../support/porter';
import { visibleText } from '../support/text';

/**
 * Two overlap scores between the visible reply and a reference text.
 *
 * Two profiles. The default, `driftbench`, works on words (letters and digits, lower-case, punctuation dropped,
 * no stemming) and gives BLEU no smoothing: a reply with no match at some n-gram size scores 0. The `ragas`
 * profile reproduces the common reference implementation of ROUGE-L (ASCII tokens, Porter stems of words longer
 * than three letters) and of BLEU (13a tokenisation, exponential smoothing). Both profiles are always computed;
 * a check reads the one its `profile` names and quotes both in its evidence.
 *
 * - ROUGE-L: the F measure of the longest common subsequence of tokens.
 * - BLEU: clipped n-gram precision for n from 1 to 4, geometric mean, times a brevity penalty.
 *
 * `expect.rouge_l` and `expect.bleu` each hold one reference and a minimum score, from 0 to 1.
 */

export type OverlapProfile = 'driftbench' | 'ragas';

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The tokens the reference ROUGE implementation reads: ASCII letters and digits, stemmed when longer than three. */
export function rougeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => (token.length > 3 ? porterStem(token) : token))
    .filter((token) => /^[a-z0-9]+$/.test(token));
}

/** The 13a tokenisation of the reference BLEU implementation. */
export function tokenize13a(text: string): string[] {
  let line = text.replace('<skipped>', '').replace('-\n', '').replace(/\n/g, ' ');
  if (line.includes('&')) {
    line = line
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  line = ` ${line} `;
  line = line.replace(/([{-~[-` -&(-+:-@/])/g, ' $1 ');
  line = line.replace(/([^0-9])([.,])/g, '$1 $2 ');
  line = line.replace(/([.,])([^0-9])/g, ' $1 $2');
  line = line.replace(/([0-9])(-)/g, '$1 $2 ');
  return line.split(/\s+/).filter((token) => token !== '');
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const width = b.length + 1;
  const table = new Array<number>((a.length + 1) * width).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const diagonal = table[(i - 1) * width + (j - 1)] ?? 0;
      const up = table[(i - 1) * width + j] ?? 0;
      const left = table[i * width + (j - 1)] ?? 0;
      table[i * width + j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(up, left);
    }
  }
  return table[a.length * width + b.length] ?? 0;
}

function rougeFromTokens(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const lcs = lcsLength(a, b);
  if (lcs === 0) return 0;
  const precision = lcs / a.length;
  const recall = lcs / b.length;
  return (2 * precision * recall) / (precision + recall);
}

/** ROUGE-L F measure of a reply against a reference. 0 when either side has no token. */
export function rougeLScore(
  reply: string,
  reference: string,
  profile: OverlapProfile = 'driftbench',
): number {
  if (profile === 'ragas') return rougeFromTokens(rougeTokens(reply), rougeTokens(reference));
  return rougeFromTokens(words(reply), words(reference));
}

function grams(tokens: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

function clippedMatches(
  hypothesis: readonly string[],
  target: readonly string[],
  n: number,
): { matched: number; total: number } {
  const candidates = grams(hypothesis, n);
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
  return { matched, total: candidates.length };
}

/** BLEU of a reply against a reference, n-grams 1 to 4, with the brevity penalty. */
export function bleuScore(reply: string, reference: string, profile: OverlapProfile = 'driftbench'): number {
  if (profile === 'ragas') return bleuFromTokens(tokenize13a(reply), tokenize13a(reference), 'exp');
  return bleuFromTokens(words(reply), words(reference), 'none');
}

function bleuFromTokens(
  hypothesis: readonly string[],
  target: readonly string[],
  smoothing: 'none' | 'exp',
): number {
  if (hypothesis.length === 0 || target.length === 0) return 0;
  const penalty = hypothesis.length > target.length ? 1 : Math.exp(1 - target.length / hypothesis.length);
  const counts = [1, 2, 3, 4].map((n) => clippedMatches(hypothesis, target, n));
  // Exponential smoothing applies only when some n-gram matches; with no match at any order the score is 0.
  if (smoothing === 'exp' && counts.every((count) => count.matched === 0)) return 0;
  const precisions: number[] = [];
  let smoothDenominator = 1;
  for (const { matched, total } of counts) {
    if (total === 0) return 0;
    if (matched === 0) {
      if (smoothing === 'none') return 0;
      smoothDenominator *= 2;
      precisions.push(1 / (smoothDenominator * total));
    } else {
      precisions.push(matched / total);
    }
  }
  return penalty * Math.exp(precisions.reduce((sum, p) => sum + Math.log(p), 0) / 4);
}

function scored(
  name: 'rouge_l' | 'bleu',
  label: string,
  score: number,
  min: number,
): ReturnType<typeof machineVerdict> {
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
    const reply = visibleText(ctx.observed);
    const profile = entry.profile ?? 'driftbench';
    const verdict = scored('rouge_l', 'ROUGE-L', rougeLScore(reply, entry.reference, profile), entry.min);
    const other = profile === 'ragas' ? 'driftbench' : 'ragas';
    const both = `${verdict.evidence} (${profile}; ${other} ${rougeLScore(reply, entry.reference, other).toFixed(3)})`;
    return [{ ...verdict, evidence: both }];
  },
};

export const bleu: Check = {
  name: 'bleu',
  applies: (ctx) => ctx.expect.bleu !== undefined,
  evaluate(ctx) {
    const entry = ctx.expect.bleu;
    if (entry === undefined) return [];
    const reply = visibleText(ctx.observed);
    const profile = entry.profile ?? 'driftbench';
    const verdict = scored('bleu', 'BLEU', bleuScore(reply, entry.reference, profile), entry.min);
    const other = profile === 'ragas' ? 'driftbench' : 'ragas';
    const both = `${verdict.evidence} (${profile}; ${other} ${bleuScore(reply, entry.reference, other).toFixed(3)})`;
    return [{ ...verdict, evidence: both }];
  },
};
