import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The public judge benchmarks, loaded from their published sources and normalised to two item shapes:
 * a pair (two responses to one question, the label says which is right or preferred) and a point (one
 * response, the label says whether it is correct). Downloads are cached on disk; nothing is committed.
 */

export type BenchmarkId = 'judgebench' | 'mmeval' | 'longjudge-wp' | 'longjudge-verify' | 'rubricbench';

export type PairItem = {
  readonly kind: 'pair';
  readonly id: string;
  readonly question: string;
  readonly a: string;
  readonly b: string;
  /** The response the label prefers. */
  readonly label: 'A' | 'B';
  /** Where the item sits for stratified sampling and per-group scores, such as source or subset. */
  readonly group: string;
  readonly language?: string;
  /** A criterion for this item alone, such as its human rubrics, in place of the benchmark's. */
  readonly criterion?: string;
};

export type PointItem = {
  readonly kind: 'point';
  readonly id: string;
  readonly question: string;
  readonly response: string;
  readonly correct: boolean;
  readonly group: string;
  readonly language?: string;
  readonly criterion?: string;
};

export type Item = PairItem | PointItem;

export type Benchmark = {
  readonly id: BenchmarkId;
  readonly title: string;
  /** The criterion every contestant that takes one is given, the same text for all. */
  readonly criterion: string;
  readonly items: readonly Item[];
};

export const SOURCES = {
  judgebench:
    'https://huggingface.co/datasets/ScalerLab/JudgeBench/resolve/main/data/gpt-00000-of-00001.jsonl',
  mmeval:
    'https://datasets-server.huggingface.co/rows?dataset=prometheus-eval/MM-Eval&config=default&split=test',
  longjudgeWp:
    'https://raw.githubusercontent.com/cjj826/LongJudgeBench/main/data_standardized/wp_bench.jsonl',
  longjudgeVerify:
    'https://raw.githubusercontent.com/cjj826/LongJudgeBench/main/data_standardized/verify_bench_hard.jsonl',
  rubricbench:
    'https://datasets-server.huggingface.co/rows?dataset=DonJoey/rubricbench&config=default&split=train',
} as const;

export const CRITERIA: Readonly<Record<BenchmarkId, string>> = {
  judgebench:
    'The response gives the correct answer to the question. Only objective correctness counts: a correct answer beats a fluent wrong one.',
  mmeval:
    "The response is the better reply to the user's request: correct, helpful and safe, and in the language the user wrote in.",
  'longjudge-wp':
    'The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.',
  'longjudge-verify': 'The final answer the response gives to the question is correct.',
  rubricbench: 'The response satisfies the rubrics below better.',
};

/**
 * The fixed dev and test split: 30 percent of each benchmark's items, chosen by a hash of the benchmark and
 * the item id, are dev; the rest are test. Our judge is tuned on dev only; every chart shows test only.
 */
export function splitOf(bench: BenchmarkId, id: string): 'dev' | 'test' {
  return createHash('sha256').update(`split:${bench}:${id}`).digest()[0]! < 77 ? 'dev' : 'test';
}

export function cacheDir(): string {
  return process.env.DRIFTBENCH_BENCH_CACHE ?? join(tmpdir(), 'driftbench-judge-benchmarks');
}

async function fetchCached(url: string): Promise<string> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, createHash('sha256').update(url).digest('hex').slice(0, 16));
  try {
    return await readFile(file, 'utf8');
  } catch {
    // Not cached yet: download it below.
  }
  // A network failure, or a burst of pages the Hugging Face rows service rate-limits (429), is tried again
  // with a growing wait, up to six times.
  let response: Response | undefined;
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    try {
      response = await fetch(url);
      if (response.status !== 429) break;
    } catch (cause) {
      if (attempt === 7) throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** (attempt - 1)));
  }
  if (!response) throw new Error(`${url} gave no response`);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const text = await response.text();
  await writeFile(file, text, 'utf8');
  return text;
}

function jsonl(text: string): unknown[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

type Rec = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** JudgeBench, the GPT-4o split: 350 pairs, label A>B or B>A by objective correctness. */
export function parseJudgeBench(text: string): PairItem[] {
  return jsonl(text).map((row) => {
    const r = row as Rec;
    const label = str(r.label);
    if (label !== 'A>B' && label !== 'B>A')
      throw new Error(`JudgeBench pair ${str(r.pair_id)} has label ${label}`);
    const source = str(r.source);
    return {
      kind: 'pair',
      id: str(r.pair_id),
      question: str(r.question),
      a: str(r.response_A),
      b: str(r.response_B),
      label: label === 'A>B' ? 'A' : 'B',
      group: source.split('-')[0] ?? source,
    };
  });
}

/**
 * MM-Eval rows hold a chosen and a rejected response. Which one is shown as A is fixed by a hash of the
 * row id, so both positions carry the right answer about half the time and a rerun shows the same order.
 */
export function parseMmEval(rows: readonly { row: Rec; row_idx: number }[]): PairItem[] {
  return rows.map(({ row: r, row_idx }) => {
    // The dataset's own id repeats across subsets; the row index is unique.
    const id = String(row_idx);
    const chosenFirst = createHash('sha256').update(`mmeval:${id}`).digest()[0]! % 2 === 0;
    return {
      kind: 'pair',
      id,
      question: str(r.prompt),
      a: chosenFirst ? str(r.chosen) : str(r.rejected),
      b: chosenFirst ? str(r.rejected) : str(r.chosen),
      label: chosenFirst ? 'A' : 'B',
      group: str(r.subset),
      language: str(r.language),
    };
  });
}

async function loadRows(base: string): Promise<{ row: Rec; row_idx: number }[]> {
  const rows: { row: Rec; row_idx: number }[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = JSON.parse(await fetchCached(`${base}&offset=${offset}&length=100`)) as {
      rows: { row: Rec; row_idx: number }[];
      num_rows_total: number;
    };
    rows.push(...page.rows);
    if (offset + 100 >= page.num_rows_total) break;
  }
  return rows;
}

/**
 * RubricBench: two responses, a human label and the expert-written atomic rubrics of the instruction. The
 * label is 0 when response A is preferred and 1 when B is: in the published rows the response that meets
 * the rubrics is A where the label is 0 (row 0, the reply that asks for the missing code) and B where it is
 * 1. The rubrics become the item's criterion.
 */
export function parseRubricBench(rows: readonly { row: Rec; row_idx: number }[]): PairItem[] {
  return rows.map(({ row: r }) => {
    const label = r.label === 0 ? 'A' : r.label === 1 ? 'B' : undefined;
    if (!label) throw new Error(`RubricBench ${str(r.case_id)} has label ${String(r.label)}`);
    return {
      kind: 'pair',
      id: str(r.case_id),
      question: str(r.instruction),
      a: str(r.response_a),
      b: str(r.response_b),
      label,
      group: str(r.domain),
      criterion: `${CRITERIA.rubricbench}\n${str(r.rubrics)}`,
    };
  });
}

/** LongJudgeBench wp_bench: 263 pairs of long writing, the chosen response by human preference. */
export function parseLongJudgeWp(text: string): PairItem[] {
  return jsonl(text).map((row) => {
    const r = row as Rec;
    const responses = (r.responses as { model: string; content: string }[]) ?? [];
    const truth = r.ground_truth as { chosen: { model: string } };
    const [first, second] = responses;
    if (!first || !second) throw new Error(`wp_bench ${str(r.id)} has fewer than two responses`);
    const meta = (r.meta as Rec) ?? {};
    return {
      kind: 'pair',
      id: str(r.id),
      question: str(r.instruction),
      a: first.content,
      b: second.content,
      label: first.model === truth.chosen.model ? 'A' : 'B',
      group: str(meta.language) || 'all',
      language: str(meta.language),
    };
  });
}

/** LongJudgeBench verify_bench_hard: 316 math answers, each labelled correct or not by hand. */
export function parseLongJudgeVerify(text: string): PointItem[] {
  return jsonl(text).map((row) => {
    const r = row as Rec;
    const responses = (r.responses as { content: string }[]) ?? [];
    const truth = r.ground_truth as { gold_correct: boolean; answer_type?: string };
    return {
      kind: 'point',
      id: str(r.id),
      question: str(r.instruction),
      response: responses[0]?.content ?? '',
      correct: truth.gold_correct === true,
      group: truth.gold_correct ? 'correct' : 'incorrect',
    };
  });
}

export async function loadBenchmark(id: BenchmarkId): Promise<Benchmark> {
  const base = { id, criterion: CRITERIA[id] };
  if (id === 'judgebench') {
    return {
      ...base,
      title: 'JudgeBench (GPT-4o pairs)',
      items: parseJudgeBench(await fetchCached(SOURCES.judgebench)),
    };
  }
  if (id === 'mmeval') {
    // The five core subsets of the paper (language hallucination is named "language mixing" in the data);
    // the language-resource subset (lang_res) is left out, as in the paper's Total.
    const core = new Set(['chat', 'reasoning', 'safety', 'linguistics', 'language mixing']);
    const items = parseMmEval(await loadRows(SOURCES.mmeval)).filter((item) => core.has(item.group));
    return { ...base, title: 'MM-Eval (core subsets)', items };
  }
  if (id === 'rubricbench') {
    return {
      ...base,
      title: 'RubricBench (human rubrics)',
      items: parseRubricBench(await loadRows(SOURCES.rubricbench)),
    };
  }
  if (id === 'longjudge-wp') {
    return {
      ...base,
      title: 'LongJudgeBench wp_bench',
      items: parseLongJudgeWp(await fetchCached(SOURCES.longjudgeWp)),
    };
  }
  return {
    ...base,
    title: 'LongJudgeBench verify_bench_hard',
    items: parseLongJudgeVerify(await fetchCached(SOURCES.longjudgeVerify)),
  };
}

/**
 * A stratified sample: items spread over their groups in proportion, chosen by a seeded hash of the item
 * id, so the same seed always picks the same items. Returns every item when n is at least their number.
 */
export function stratifiedSample<T extends Item>(items: readonly T[], n: number, seed = 'driftbench'): T[] {
  if (n >= items.length) return [...items];
  const rank = (item: T) => createHash('sha256').update(`${seed}:${item.id}`).digest('hex');
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const picked: T[] = [];
  const quotas = [...groups.entries()].map(([group, members]) => ({
    group,
    members: [...members].sort((x, y) => rank(x).localeCompare(rank(y))),
    exact: (members.length * n) / items.length,
  }));
  let left = n;
  for (const q of quotas) {
    const take = Math.floor(q.exact);
    picked.push(...q.members.slice(0, take));
    left -= take;
  }
  // The remaining places go to the groups with the largest fractional quota.
  for (const q of [...quotas].sort(
    (x, y) => (y.exact % 1) - (x.exact % 1) || x.group.localeCompare(y.group),
  )) {
    if (left === 0) break;
    const next = q.members[Math.floor(q.exact)];
    if (next) {
      picked.push(next);
      left -= 1;
    }
  }
  return picked.sort((x, y) => x.id.localeCompare(y.id));
}
