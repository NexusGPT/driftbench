// Frozen raw parser from 1d13e28ccf148047daa4aa9508868a91dd36e803.
// Current parsing repairs more malformed JSON and changes historical votes.
import { inconclusive, JudgeAnswer, type JudgeResult } from '@agent-nexus/driftbench-judges';

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
