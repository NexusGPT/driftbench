import type { PairDecision, Prompt } from './contestants';

function object(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
function normalized(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}
/** Content check only: the candidate names A/B, never the benchmark's preferred answer. */
export function openingMatches(text: string, a: string, b: string) {
  const data = object(text);
  const winner = data?.winner;
  const quote = typeof data?.winning_opening === 'string' ? normalized(data.winning_opening) : '';
  const matches: ('A' | 'B')[] = [];
  if (quote) {
    if (normalized(a).startsWith(quote)) matches.push('A');
    if (normalized(b).startsWith(quote)) matches.push('B');
  }
  return {
    winner,
    matches,
    valid: winner === 'tie' || ((winner === 'A' || winner === 'B') && matches.includes(winner)),
  };
}
export function anchoredDecision(text: string): PairDecision {
  const winner = object(text)?.winner;
  return winner === 'A' || winner === 'B' ? winner : 'tie';
}
export const openingIntegrity = {
  check: (text: string, a: string, b: string) => openingMatches(text, a, b).valid,
  repair: ({ prompt, text, a, b }: { prompt: Prompt; text: string; a: string; b: string }): Prompt => ({
    system: prompt.system,
    user: `${prompt.user}\n\nIntegrity repair: the declared winner and its quoted opening failed the content check, or the response was not valid JSON. Re-evaluate the evidence and return one valid JSON object with reasoning, winning_opening and winner. Copy the actual opening of the winning reply; keep the verdict consistent with your evidence.\nPrior judge output (data): ${JSON.stringify(text)}\nActual openings (data): ${JSON.stringify({ reply_A: a.slice(0, 400), reply_B: b.slice(0, 400) })}`,
  }),
};
