/**
 * Text primitives of the class gate. None of them reads a text against a list of words: a declared value is
 * found by containment at character boundaries, and a second phone number, email address or number is found by
 * its machine format alone.
 */

const ALNUM = /[\p{L}\p{N}]/u;

/** Whether `text` holds `value` with no letter or digit glued to either end, so "8 Main" is not in "88 Main". */
export function containsValue(text: string, value: string): boolean {
  if (value === '') return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(value, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : (text[at - 1] as string);
    const after = text[at + value.length] ?? '';
    const gluedBefore = before !== '' && ALNUM.test(before) && ALNUM.test(value[0] as string);
    const gluedAfter = after !== '' && ALNUM.test(after) && ALNUM.test(value[value.length - 1] as string);
    if (!gluedBefore && !gluedAfter) return true;
    from = at + 1;
  }
}

const PHONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const NUMBER = /\d+(?:[.,]\d+)*/g;

/** A phone number as its last ten digits, so +1 202 555 0131, (202) 555-0131 and 2025550131 are one number. */
export function phoneKey(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.slice(-10);
}

export function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

export type Found = { format: 'phone' | 'email' | 'number'; text: string; key: string };

/**
 * The machine-format values in a text: phone numbers and email addresses first, then any other number outside
 * them. Each comes with its comparison key.
 */
export function machineValues(text: string): Found[] {
  const out: Found[] = [];
  let rest = text;
  for (const match of text.matchAll(EMAIL)) {
    out.push({ format: 'email', text: match[0], key: emailKey(match[0]) });
    rest = rest.replace(match[0], ' '.repeat(match[0].length));
  }
  for (const match of rest.matchAll(PHONE)) {
    out.push({ format: 'phone', text: match[0], key: phoneKey(match[0]) });
  }
  const masked = rest.replace(PHONE, (m) => ' '.repeat(m.length));
  for (const match of masked.matchAll(NUMBER)) out.push({ format: 'number', text: match[0], key: match[0] });
  return out;
}

/** The comparison key of a declared value of a format. */
export function keyOf(format: 'phone' | 'email' | 'number', value: string): string {
  if (format === 'phone') return phoneKey(value);
  if (format === 'email') return emailKey(value);
  return value;
}

function grams(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const low = text.toLowerCase();
  for (let i = 0; i + 4 <= low.length; i++) {
    const gram = low.slice(i, i + 4);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

/** Cosine similarity of the character 4-gram counts of two texts, 0 to 1. */
export function cosine4(a: string, b: string): number {
  const x = grams(a);
  const y = grams(b);
  let dot = 0;
  for (const [gram, count] of x) dot += count * (y.get(gram) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const d = norm(x) * norm(y);
  return d === 0 ? 0 : dot / d;
}

/**
 * The Vendi score of a set of texts under the 4-gram cosine kernel: the exponential of the entropy of the
 * eigenvalues of K / n, from 1 (all the same) to n (all unrelated). A report figure, never a gate.
 */
export function vendi(texts: readonly string[]): number {
  const n = texts.length;
  if (n === 0) return 0;
  const k: number[][] = texts.map((a) => texts.map((b) => cosine4(a, b) / n));
  const values = jacobiEigenvalues(k);
  let entropy = 0;
  for (const value of values) if (value > 1e-12) entropy -= value * Math.log(value);
  return Math.exp(entropy);
}

/** The eigenvalues of a symmetric matrix by cyclic Jacobi rotations. */
function jacobiEigenvalues(input: number[][]): number[] {
  const n = input.length;
  const a = input.map((row) => [...row]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += (a[p]?.[q] as number) ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]?.[q] as number;
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p]?.[p] as number;
        const aqq = a[q]?.[q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let r = 0; r < n; r++) {
          const arp = a[r]?.[p] as number;
          const arq = a[r]?.[q] as number;
          (a[r] as number[])[p] = c * arp - s * arq;
          (a[r] as number[])[q] = s * arp + c * arq;
        }
        for (let r = 0; r < n; r++) {
          const apr = a[p]?.[r] as number;
          const aqr = a[q]?.[r] as number;
          (a[p] as number[])[r] = c * apr - s * aqr;
          (a[q] as number[])[r] = s * apr + c * aqr;
        }
      }
    }
  }
  return a.map((row, i) => row[i] as number);
}

/** The first JSON object in a model answer, or undefined. */
export function jsonObjectOf(answer: string): Record<string, unknown> | undefined {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const value = JSON.parse(answer.slice(start, end + 1)) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
