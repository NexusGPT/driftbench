import { z } from 'zod';

/**
 * The answer contract every judge returns, and the request every judge reads.
 *
 * A judge answers one criterion on one transcript slice: pass, fail or inconclusive. An answer that does
 * not parse is inconclusive, never a pass. An inconclusive answer is never counted as a pass or a fail.
 */

export const JudgeOutcome = z.enum(['pass', 'fail', 'inconclusive']);
export type JudgeOutcome = z.infer<typeof JudgeOutcome>;

/**
 * The strict answer contract. `score` is the judge's probability that the criterion passes, from 0 to 1.
 * `evidence` quotes the part of the data the verdict rests on. Any other key makes the answer invalid.
 */
export const JudgeAnswer = z.strictObject({
  outcome: JudgeOutcome,
  score: z.number().min(0).max(1).optional(),
  reasoning: z.string(),
  evidence: z.string().optional(),
});
export type JudgeAnswer = z.infer<typeof JudgeAnswer>;

/** The two judge classes: a fixed binary question (system 1), or a chat model with reasoning (system 2). */
export const JudgeClass = z.enum(['system1', 'system2']);
export type JudgeClass = z.infer<typeof JudgeClass>;

/** How much room a judge gets. A re-judge after an unparseable answer runs with the large budget. */
export type Budget = 'normal' | 'large';

/** The token budgets behind the two budget names, for clients that take a token limit. */
export const MAX_TOKENS: Readonly<Record<Budget, number>> = { normal: 1024, large: 4096 };

/** One line of a transcript slice. Tool entries carry the tool name. */
export const TranscriptEntry = z.strictObject({
  role: z.enum(['user', 'agent', 'tool_call', 'tool_result', 'card', 'context']),
  text: z.string(),
  tool: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;

/** The criterion as a judge reads it: the question, and what passing and failing look like. */
export const CriterionText = z.strictObject({
  name: z.string().min(1),
  rubric: z.string().min(1),
  pass: z.string().optional(),
  fail: z.string().optional(),
  scope: z.enum(['block', 'conversation']).optional(),
});
export type CriterionText = z.infer<typeof CriterionText>;

/** Everything one judge call reads. */
export type JudgeRequest = {
  readonly criterion: CriterionText;
  /** The system prompt of this request. Absent: the criterion prompt of the prompt kit. */
  readonly system?: string;
  /** The observed slice: what the user sent, what the agent did and said. */
  readonly transcript: readonly TranscriptEntry[];
  /** The text of a produced file, as an artifact reader extracted it. */
  readonly artifact?: string;
  /** The workspace inputs the criterion names (`inputs`), each with its path: what the output is compared against. */
  readonly inputs?: readonly { readonly path: string; readonly text: string }[];
  /** A summary of the block's Given: the stage expected and the ledger. */
  readonly given?: { readonly stage?: string; readonly ledger?: Readonly<Record<string, unknown>> };
  readonly budget?: Budget;
};

/** What a client returns: the answer, the raw text it came from, and whether that text parsed. */
export type JudgeResult = {
  readonly answer: JudgeAnswer;
  /** The provider's answer as received: the model text, or the JSON body of a system 1 answer. */
  readonly raw: string;
  /** True when the raw answer did not satisfy the contract. The answer is then inconclusive. */
  readonly unparsed?: boolean;
  /** What the call cost in US dollars, when the provider reports it (the claude command does). */
  readonly costUsd?: number;
  /** True when the answer parsed only after the strict repair of unescaped quotes in its string values. */
  readonly repaired?: boolean;
};

/** An inconclusive answer that names why. */
export function inconclusive(reasoning: string): JudgeAnswer {
  return { outcome: 'inconclusive', reasoning };
}

/**
 * Reads a model's text as the answer contract. Accepts the JSON object alone, inside a fenced block, or
 * surrounded by prose. Anything else, an extra key included, is an unparsed inconclusive answer.
 */
export function parseAnswerText(raw: string): JudgeResult {
  const candidate = extractObject(raw);
  if (candidate === undefined) {
    return { answer: inconclusive('unparseable answer: no JSON object found'), raw, unparsed: true };
  }
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (cause) {
    // One strict repair: escape the double quotes inside string values, then read it again. A repaired
    // answer still meets the whole contract or stays unparsed.
    try {
      const repaired = parseAnswerValue(JSON.parse(repairAnswerText(candidate)), raw);
      if (!repaired.unparsed) return { ...repaired, repaired: true };
    } catch {
      // Not JSON after the repair either: the first error explains it.
    }
    const why = cause instanceof Error ? cause.message : String(cause);
    return { answer: inconclusive(`unparseable answer: ${why}`), raw, unparsed: true };
  }
  return parseAnswerValue(value, raw);
}

/**
 * The strict repair of a model's JSON: inside a string, a double quote that is not followed (after spaces)
 * by `,`, `}`, `]`, `:` or the end of the text cannot close the string, so it is escaped. Nothing else
 * changes: no key is added, removed or renamed, and no value outside a string is touched.
 */
export function repairAnswerText(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      const next = text.slice(i + 1).match(/^\s*(.)/)?.[1];
      if (next === undefined || ',}]:'.includes(next)) {
        inString = false;
        out += ch;
      } else out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Validates an already decoded answer against the contract. */
export function parseAnswerValue(value: unknown, raw: string = JSON.stringify(value)): JudgeResult {
  const parsed = JudgeAnswer.safeParse(value);
  if (parsed.success) return { answer: parsed.data, raw };
  const issue = parsed.error.issues[0];
  const where = issue?.path.join('.') || '(root)';
  return {
    answer: inconclusive(`answer breaks the contract: ${where} ${issue?.message ?? ''}`.trim()),
    raw,
    unparsed: true,
  };
}

/**
 * The final answer: the last top-level JSON object of the text. An object the model quoted in its reasoning comes
 * earlier, so it never becomes the verdict. A final object still open at the end of the text (a cut answer) yields
 * nothing, so the verdict is inconclusive rather than the last complete object before it.
 */
function extractObject(raw: string): string | undefined {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let last: string | undefined;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (depth === 0) {
      if (ch === '{') {
        depth = 1;
        start = i;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) last = raw.slice(start, i + 1);
    }
  }
  return depth === 0 ? last : undefined;
}

/**
 * Maps a system 1 probability that the criterion passes to an outcome. Between the two bounds the answer
 * is inconclusive: a coin toss is never a verdict.
 */
export function outcomeFromProbability(
  probability: number,
  bounds: { passAt?: number; failAt?: number } = {},
): JudgeOutcome {
  const passAt = bounds.passAt ?? 0.6;
  const failAt = bounds.failAt ?? 0.4;
  if (probability >= passAt) return 'pass';
  if (probability <= failAt) return 'fail';
  return 'inconclusive';
}
