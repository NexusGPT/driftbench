import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { cellKey, parseApproval } from './reference';
import { type GramVector, gramCosine, gramTfidf, wordsOf } from './text';

/**
 * Fidelity of generated user turns to the reference set: is the simulated user close to the users the
 * owner described or the logs showed? Five numbers, each printed with the sample sizes: the total
 * variation distance between the two distributions over cells; the two-sample Kolmogorov-Smirnov
 * statistic on message length and on asking a question; the vocabulary overlap; and the nearest-neighbour
 * duplicate rate (a candidate turn that copies a reference turn measures memory, not fidelity). Similarity
 * is character n-gram TF-IDF cosine, in code, with no embedding service.
 */

export type FidelityTurn = { id?: string; text: string; cell: Record<string, string> };

const TurnLine = z.object({
  id: z.string().optional(),
  text: z.string(),
  cell: z.record(z.string(), z.string()).optional(),
});

export type LoadedTurns =
  | {
      ok: true;
      turns: FidelityTurn[];
      kind: 'reference-set' | 'turns';
      /** Turns of a reference set left out because a person has not approved them. */
      unapproved: number;
    }
  | { ok: false; message: string };

/**
 * Reads turns from a reference set (`reference.yaml`, with `approval.yaml` beside it: only approved
 * turns count, unless `includeUnapproved`), a folder holding one, a folder holding `reference-turns.jsonl`
 * from `intake logs`, a JSON Lines file of `{text, cell}`, or a YAML or JSON list of them.
 */
export async function loadTurns(
  path: string,
  options: { includeUnapproved?: boolean } = {},
): Promise<LoadedTurns> {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, message: `cannot find ${path}` };
  if (info.isDirectory()) {
    for (const name of ['reference.yaml', 'reference-turns.jsonl']) {
      if (await stat(join(path, name)).catch(() => undefined)) return loadTurns(join(path, name), options);
    }
    return { ok: false, message: `${path} holds neither reference.yaml nor reference-turns.jsonl` };
  }
  const text = await readFile(path, 'utf8');
  if (path.endsWith('.jsonl')) return turnsFromJsonl(text);
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const isSet = typeof raw === 'object' && raw !== null && 'produced_by' in raw && 'turns' in raw;
  if (isSet)
    return turnsFromSet(raw as { turns: unknown }, dirname(path), options.includeUnapproved ?? false);
  const list = Array.isArray(raw) ? raw : (raw as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(list))
    return { ok: false, message: 'expected a list of turns, or an object with turns' };
  const turns: FidelityTurn[] = [];
  for (const [index, entry] of list.entries()) {
    const parsed = TurnLine.safeParse(entry);
    if (!parsed.success) return { ok: false, message: `turn ${index}: ${parsed.error.issues[0]?.message}` };
    turns.push(toTurn(parsed.data));
  }
  return { ok: true, turns, kind: 'turns', unapproved: 0 };
}

function turnsFromJsonl(text: string): LoadedTurns {
  const turns: FidelityTurn[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { ok: false, message: `line ${index + 1}: not a JSON object` };
    }
    const parsed = TurnLine.safeParse(raw);
    if (!parsed.success)
      return { ok: false, message: `line ${index + 1}: ${parsed.error.issues[0]?.message}` };
    turns.push(toTurn(parsed.data));
  }
  return { ok: true, turns, kind: 'turns', unapproved: 0 };
}

async function turnsFromSet(
  raw: { turns: unknown },
  dir: string,
  includeUnapproved: boolean,
): Promise<LoadedTurns> {
  const SetTurn = z.object({ id: z.string(), text: z.string(), cell: z.record(z.string(), z.string()) });
  const parsed = z.array(SetTurn).safeParse(raw.turns);
  if (!parsed.success) return { ok: false, message: `turns: ${parsed.error.issues[0]?.message}` };
  if (includeUnapproved) return { ok: true, turns: parsed.data, kind: 'reference-set', unapproved: 0 };
  let approvalText: string;
  try {
    approvalText = await readFile(join(dir, 'approval.yaml'), 'utf8');
  } catch {
    return { ok: false, message: 'approval.yaml is missing beside the reference set; no turn is approved' };
  }
  const approval = parseApproval(approvalText);
  if (!approval.ok) return { ok: false, message: `approval.yaml: ${approval.message}` };
  const byId = new Map(approval.approval.turns.map((turn) => [turn.id, turn]));
  const turns: FidelityTurn[] = [];
  let unapproved = 0;
  for (const turn of parsed.data) {
    const entry = byId.get(turn.id);
    if (!entry) return { ok: false, message: `turn ${turn.id} is not in approval.yaml` };
    if (entry.text !== turn.text || entry.cell !== cellKey(turn.cell)) {
      return { ok: false, message: `turn ${turn.id} differs between reference.yaml and approval.yaml` };
    }
    if (entry.approved) turns.push(turn);
    else unapproved += 1;
  }
  return { ok: true, turns, kind: 'reference-set', unapproved };
}

function toTurn(entry: z.infer<typeof TurnLine>): FidelityTurn {
  return { ...(entry.id ? { id: entry.id } : {}), text: entry.text, cell: entry.cell ?? {} };
}

/** Total variation distance, half the L1 distance between two distributions given as counts. */
export function totalVariation(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  const totalA = [...a.values()].reduce((sum, n) => sum + n, 0);
  const totalB = [...b.values()].reduce((sum, n) => sum + n, 0);
  if (totalA === 0 || totalB === 0) throw new RangeError('total variation needs two non-empty samples');
  let distance = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    distance += Math.abs((a.get(key) ?? 0) / totalA - (b.get(key) ?? 0) / totalB);
  }
  return distance / 2;
}

/**
 * The two-sample Kolmogorov-Smirnov statistic: the largest gap between the two empirical distribution
 * functions, evaluated after every distinct value (ties advance both samples together).
 */
export function ksStatistic(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) throw new RangeError('the KS statistic needs two non-empty samples');
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length || j < y.length) {
    const value = Math.min(x[i] ?? Number.POSITIVE_INFINITY, y[j] ?? Number.POSITIVE_INFINITY);
    while (i < x.length && x[i] === value) i += 1;
    while (j < y.length && y[j] === value) j += 1;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

/**
 * The asymptotic critical value of the two-sample KS statistic at the 5 percent level:
 * 1.358 x sqrt((n + m) / (n m)). A statistic above it says the two samples differ at that level.
 */
export function ksCritical(n: number, m: number): number {
  return 1.358 * Math.sqrt((n + m) / (n * m));
}

export type Fidelity = {
  n: { reference: number; candidate: number };
  dimensions: string[];
  cells: {
    tv: number;
    reference: number;
    candidate: number;
    /** Cells of the candidate the reference never shows. */
    unseen: number;
    worst: Array<{ key: string; reference: number; candidate: number }>;
  };
  length: { ks: number; critical: number; medianReference: number; medianCandidate: number };
  questions: { ks: number; critical: number; rateReference: number; rateCandidate: number };
  vocabulary: { jaccard: number; candidateCovered: number; reference: number; candidate: number };
  duplicates: {
    threshold: number;
    /** Share of candidate turns whose nearest reference turn is at least the threshold. */
    copyRate: number;
    /** Share of candidate turns with a near-duplicate among the other candidate turns. */
    candidateRate: number;
    /** The same within the reference set: the baseline the candidate rate is read against. */
    referenceRate: number;
  };
};

/**
 * Compares candidate turns with reference turns. `dimensions` are the cell dimensions to compare on;
 * default, the ones every turn of both sets carries.
 */
export function fidelity(
  reference: readonly FidelityTurn[],
  candidate: readonly FidelityTurn[],
  options: { dimensions?: string[]; threshold?: number } = {},
): Fidelity {
  if (reference.length === 0 || candidate.length === 0) {
    throw new RangeError('fidelity needs at least one reference turn and one candidate turn');
  }
  const threshold = options.threshold ?? 0.9;
  const all = [...reference, ...candidate];
  const dimensions =
    options.dimensions ??
    Object.keys(all[0]?.cell ?? {}).filter((dimension) => all.every((turn) => dimension in turn.cell));
  const key = (turn: FidelityTurn) =>
    dimensions.length === 0 ? '(all)' : dimensions.map((d) => `${d}=${turn.cell[d] ?? '(none)'}`).join(' ');
  const count = (turns: readonly FidelityTurn[]) => {
    const counts = new Map<string, number>();
    for (const turn of turns) counts.set(key(turn), (counts.get(key(turn)) ?? 0) + 1);
    return counts;
  };
  const refCells = count(reference);
  const candCells = count(candidate);
  const worst = [...new Set([...refCells.keys(), ...candCells.keys()])]
    .map((cell) => ({
      key: cell,
      reference: (refCells.get(cell) ?? 0) / reference.length,
      candidate: (candCells.get(cell) ?? 0) / candidate.length,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.candidate - b.reference) - Math.abs(a.candidate - a.reference) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, 5);

  const lengths = (turns: readonly FidelityTurn[]) => turns.map((turn) => wordsOf(turn.text).length);
  const asks = (turns: readonly FidelityTurn[]) => turns.map((turn) => (turn.text.includes('?') ? 1 : 0));
  const refLengths = lengths(reference);
  const candLengths = lengths(candidate);
  const refAsks = asks(reference);
  const candAsks = asks(candidate);
  const critical = ksCritical(reference.length, candidate.length);

  const vocab = (turns: readonly FidelityTurn[]) => turns.flatMap((turn) => wordsOf(turn.text));
  const refWords = vocab(reference);
  const candWords = vocab(candidate);
  const refTypes = new Set(refWords);
  const candTypes = new Set(candWords);
  const shared = [...candTypes].filter((word) => refTypes.has(word)).length;
  const union = new Set([...refTypes, ...candTypes]).size;

  const vectors = gramTfidf(all.map((turn) => turn.text));
  const refVectors = vectors.slice(0, reference.length);
  const candVectors = vectors.slice(reference.length);
  const copies = candVectors.filter((vector) => maxCosine(vector, refVectors) >= threshold).length;
  const internal = (list: GramVector[]) =>
    list.length < 2
      ? 0
      : list.filter((vector, index) => maxCosine(vector, list, index) >= threshold).length / list.length;

  return {
    n: { reference: reference.length, candidate: candidate.length },
    dimensions,
    cells: {
      tv: totalVariation(refCells, candCells),
      reference: refCells.size,
      candidate: candCells.size,
      unseen: [...candCells.keys()].filter((cell) => !refCells.has(cell)).length,
      worst,
    },
    length: {
      ks: ksStatistic(refLengths, candLengths),
      critical,
      medianReference: median(refLengths),
      medianCandidate: median(candLengths),
    },
    questions: {
      ks: ksStatistic(refAsks, candAsks),
      critical,
      rateReference: mean(refAsks),
      rateCandidate: mean(candAsks),
    },
    vocabulary: {
      jaccard: union === 0 ? 0 : shared / union,
      candidateCovered:
        candWords.length === 0 ? 0 : candWords.filter((word) => refTypes.has(word)).length / candWords.length,
      reference: refTypes.size,
      candidate: candTypes.size,
    },
    duplicates: {
      threshold,
      copyRate: copies / candidate.length,
      candidateRate: internal(candVectors),
      referenceRate: internal(refVectors),
    },
  };
}

function maxCosine(vector: GramVector, pool: readonly GramVector[], skip = -1): number {
  let best = 0;
  pool.forEach((other, index) => {
    if (index !== skip) best = Math.max(best, gramCosine(vector, other));
  });
  return best;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
