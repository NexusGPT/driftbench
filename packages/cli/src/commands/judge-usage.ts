import type { TokenPrices } from '@agent-nexus/driftbench-core';
import type { JudgeClient } from '@agent-nexus/driftbench-judges';

/** What the calls of one judge used. */
export type JudgeUsage = { calls: number; input: number; output: number; reported: number };

/** A judge that counts, for each call, the tokens its result reports. A result with none counts as a call only. */
export function meterJudge(client: JudgeClient): { client: JudgeClient; usage: JudgeUsage } {
  const usage: JudgeUsage = { calls: 0, input: 0, output: 0, reported: 0 };
  const metered: JudgeClient = {
    ...client,
    async judge(request) {
      const result = await client.judge(request);
      usage.calls++;
      if (result.usage !== undefined) {
        usage.reported++;
        usage.input += result.usage.input ?? 0;
        usage.output += result.usage.output ?? 0;
      }
      return result;
    },
  };
  return { client: metered, usage };
}

const dollars = (usd: number): string => `${usd.toFixed(4)} USD`;

/**
 * The lines about what a judge used: its tokens, and its cost in USD when the table prices its model. A call
 * that reported no tokens is said so, never counted as free. A `cached_input` price is named, not used, because
 * the judge reports no cached tokens.
 */
export function usageLines(
  client: JudgeClient,
  usage: JudgeUsage,
  prices: TokenPrices | undefined,
  replayed: boolean,
): string[] {
  if (usage.calls === 0) return [];
  const who = `judge ${client.id}${client.model ? ` ${client.model}` : ''}`;
  if (usage.reported === 0)
    return [
      `Tokens, ${who}: not reported${replayed ? ': the cassette holds no token counts' : ''}, so no cost is known.`,
    ];
  const lines = [
    `${replayed ? 'Tokens replayed from the cassette' : 'Tokens'}, ${who}: ${usage.input} in, ${usage.output} out, ${usage.calls} calls.`,
  ];
  if (usage.reported < usage.calls)
    lines.push(`${usage.calls - usage.reported} of the ${usage.calls} calls reported no tokens, so the cost is partial.`);
  if (!prices) return [...lines, 'No prices given: pass --prices <file> to see the cost in USD.'];
  const price = client.model !== undefined && Object.hasOwn(prices.models, client.model) ? prices.models[client.model] : undefined;
  if (!price)
    return [...lines, `No cost is known: the price table has no price for ${client.model ?? client.id}.`];
  const usd = (usage.input * price.input + usage.output * price.output) / 1_000_000;
  lines.push(`${replayed ? 'Cost when recorded' : 'Cost'}: ${dollars(usd)}.`);
  if (price.cached_input > 0)
    lines.push(
      `Note: the price table gives cached_input for ${client.model}. It is not used: the judge reports no cached tokens.`,
    );
  return lines;
}
