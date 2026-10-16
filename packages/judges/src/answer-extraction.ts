import type { JudgeClient } from './client';
import type { JudgeRequest } from './contract';

export type ExtractedAnswer = {
  readonly text: string;
  /** Exact source span, with UTF-16 offsets into the original response. */
  readonly quote: string;
  readonly start: number;
  readonly end: number;
};

/** Last explicitly marked final answer. A missing or incomplete marker leaves the response intact. */
export function extractFinalAnswer(response: string): ExtractedAnswer | undefined {
  const candidates: ExtractedAnswer[] = [];
  const pattern =
    /\\boxed\{|(?:final\s+answer\s*(?:is\b\s*)?(?:\*\*)?\s*[:=]|the\s+answer\s+is\b\s*[:=]?)\s*/gi;
  for (const match of response.matchAll(pattern)) {
    const start = match.index;
    const from = start + match[0].length;
    if (match[0].startsWith('\\')) {
      let depth = 1;
      let end = from;
      while (end < response.length && depth > 0) {
        const ch = response[end++];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
      }
      if (depth !== 0) continue;
      const text = response.slice(from, end - 1).trim();
      if (text) candidates.push({ text, quote: response.slice(start, end), start, end });
    } else {
      const rest = response.slice(from).split(/\r?\n/)[0] ?? '';
      const text = rest.trim();
      if (text && text.length <= 1000) {
        const end = from + rest.length;
        candidates.push({ text, quote: response.slice(start, end), start, end });
      }
    }
  }
  return candidates.at(-1);
}

/** Optional extraction annotation. Original transcript data is preserved for ambiguous and multi-part answers. */
export function withFinalAnswer(client: JudgeClient): JudgeClient {
  const prepare = (request: JudgeRequest): JudgeRequest => {
    const response = [...request.transcript].reverse().find((entry) => entry.role === 'agent')?.text;
    const extracted = response === undefined ? undefined : extractFinalAnswer(response);
    return extracted === undefined
      ? request
      : {
          ...request,
          transcript: [
            ...request.transcript,
            { role: 'tool_result', tool: 'judge.final_answer', text: JSON.stringify(extracted) },
          ],
        };
  };
  const compare = client.judgeComparison?.bind(client);
  return {
    ...client,
    judge: (request) => client.judge(prepare(request)),
    ...(compare
      ? {
          judgeComparison: (ordered: JudgeRequest, swapped: JudgeRequest) =>
            compare(prepare(ordered), prepare(swapped)),
        }
      : {}),
  };
}

/**
 * Agreement is over ALL solve attempts, failures included. No plurality-only or decimal-dropping reference.
 * A custom equivalence normalizer is allowed, but the default preserves signs, punctuation and case.
 */
export function referenceConsensus(
  answers: readonly (string | undefined)[],
  options: { minAgreement?: number; normalize?: (answer: string) => string } = {},
): { reference?: string; agreement: number; attempts: number } {
  const minimum = options.minAgreement ?? 0.8;
  if (!Number.isFinite(minimum) || minimum <= 0.5 || minimum > 1)
    throw new RangeError('reference agreement must be above one half and at most one');
  const normalize =
    options.normalize ?? ((answer: string) => answer.normalize('NFKC').trim().replace(/\s+/g, ' '));
  const groups = new Map<string, { answer: string; count: number }>();
  for (const answer of answers) {
    if (answer === undefined || !answer.trim()) continue;
    const key = normalize(answer);
    if (!key.trim()) continue;
    const group = groups.get(key) ?? { answer, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const best = [...groups.values()].sort((a, b) => b.count - a.count)[0];
  const agreement = answers.length === 0 ? 0 : (best?.count ?? 0) / answers.length;
  return {
    attempts: answers.length,
    agreement,
    ...(answers.length >= 2 && best && agreement >= minimum ? { reference: best.answer } : {}),
  };
}
