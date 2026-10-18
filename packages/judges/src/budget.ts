import type { JudgeRequest } from './contract';
import { buildPrompt } from './prompt';

/**
 * Fits a long conversation to a judge's prompt budget, measured on the rendered user prompt in characters.
 * The fewest oldest entries are dropped and replaced by one context entry, "[k earlier entries omitted]". The last
 * block (from the last user entry on), the artifact and the Given are never dropped, and a tool result never stays
 * without its call: a cut that would start on a tool result moves on to the next entry. A request that fits comes
 * back as it is. A budget that is not a whole number above 0, or one the last block alone overflows, is refused with
 * a RangeError.
 */
export function fitPrompt(request: JudgeRequest, maxChars: number): JudgeRequest {
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError(`the budget must be a whole number of characters above 0, got ${maxChars}`);
  }
  const size = (candidate: JudgeRequest) => buildPrompt(candidate).user.length;
  if (size(request) <= maxChars) return request;
  const { transcript } = request;
  let lastUser = -1;
  transcript.forEach((entry, i) => {
    if (entry.role === 'user') lastUser = i;
  });
  const candidate = (drop: number): JudgeRequest => {
    let start = drop;
    while (transcript[start]?.role === 'tool_result' && start < lastUser) start += 1;
    const marker = `[${start} earlier ${start === 1 ? 'entry' : 'entries'} omitted]`;
    return { ...request, transcript: [{ role: 'context', text: marker }, ...transcript.slice(start)] };
  };
  const fits = (drop: number) => size(candidate(drop)) <= maxChars;
  if (lastUser < 1 || !fits(lastUser)) {
    throw new RangeError(`the last block alone is over the budget of ${maxChars} characters`);
  }
  // Dropping more never lengthens the prompt, so the fewest drops that fit are found by bisection.
  let low = 1;
  let high = lastUser;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid + 1;
  }
  return candidate(low);
}
