import { z } from 'zod';
import type { TargetRef } from '../schema/common';
import type { Cost, Observed } from '../schema/run';

/** User-supplied USD per million tokens. No vendor prices are bundled. */
export const TokenPrices = z.strictObject({
  as_of: z.iso.date(),
  models: z.record(
    z.string().min(1),
    z.strictObject({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cached_input: z.number().nonnegative(),
    }),
  ),
});
export type TokenPrices = z.infer<typeof TokenPrices>;

/** Fatal for a budgeted campaign: continuing would treat unknown spend as zero. */
export class TokenPriceError extends Error {
  override name = 'TokenPriceError';
}

/** Check the whole campaign before opening a session or asking its driver for a turn. */
export function preflightTargetPrices(targets: readonly TargetRef[], prices: TokenPrices | undefined): void {
  const missing = [
    ...new Set(
      targets.flatMap((target) => {
        const model = target.options?.model;
        return typeof model === 'string' && (!prices || !Object.hasOwn(prices.models, model)) ? [model] : [];
      }),
    ),
  ].sort();
  if (missing.length > 0) {
    throw new TokenPriceError(
      `Budget cannot price declared models ${missing.map((model) => JSON.stringify(model)).join(', ')}: supply dated prices in driftbench.yaml or --prices <file> before starting.`,
    );
  }
}

function hasTokens(cost: Cost): boolean {
  return (
    cost.inputTokens !== undefined || cost.outputTokens !== undefined || cost.cachedInputTokens !== undefined
  );
}

function dollars(
  cost: Cost,
  target: TargetRef,
  prices: TokenPrices | undefined,
  required: boolean,
): number | undefined {
  if (cost.usd !== undefined) return cost.usd;
  if (!hasTokens(cost)) return undefined;
  const model = cost.model ?? (typeof target.options?.model === 'string' ? target.options.model : undefined);
  const price =
    model !== undefined && prices && Object.hasOwn(prices.models, model) ? prices.models[model] : undefined;
  if (!price) {
    if (required)
      throw new TokenPriceError(
        `Budget cannot price model "${model ?? '(unspecified)'}": supply dated prices in driftbench.yaml or --prices <file>; identify the model with cost.model or target.options.model.`,
      );
    return undefined;
  }
  const cached = cost.cachedInputTokens ?? 0;
  const input = cost.inputTokens ?? 0;
  if (cached > input)
    throw new TokenPriceError(`Model "${model}" reports cachedInputTokens greater than inputTokens.`);
  const usd =
    ((input - cached) * price.input + cached * price.cached_input + (cost.outputTokens ?? 0) * price.output) /
    1_000_000;
  if (!Number.isFinite(usd)) throw new TokenPriceError(`Model "${model}" token cost is not finite.`);
  return usd;
}

/** The model that prices the agent's own tokens: the block's, else the one model its segments name, else the target's. */
function agentModelOf(observed: Observed, target: TargetRef): string | undefined {
  const named = [
    ...new Set(observed.segments.flatMap((segment) => (segment.cost?.model ? [segment.cost.model] : []))),
  ];
  return (
    observed.cost.model ??
    (named.length === 1 ? named[0] : undefined) ??
    (typeof target.options?.model === 'string' ? target.options.model : undefined)
  );
}

/** The dollars for the helper tokens, with the helper model's price (the agent's model when the records name none). */
function helperDollars(
  cost: Cost,
  agentModel: string | undefined,
  target: TargetRef,
  prices: TokenPrices | undefined,
  required: boolean,
): number | undefined {
  if (cost.helperInputTokens === undefined && cost.helperOutputTokens === undefined) return undefined;
  const model = cost.helperModel ?? agentModel;
  return dollars(
    {
      ...(model === undefined ? {} : { model }),
      ...(cost.helperInputTokens === undefined ? {} : { inputTokens: cost.helperInputTokens }),
      ...(cost.helperOutputTokens === undefined ? {} : { outputTokens: cost.helperOutputTokens }),
    },
    { ...target, options: { ...target.options, ...(model === undefined ? {} : { model }) } },
    prices,
    required,
  );
}

/**
 * The priced block, with the helper dollars added: `cost.helperUsd` is the helpers' share and `cost.usd` the total.
 * A block with no helper tokens is returned as `priceAgent` made it.
 */
export function priceObserved(
  observed: Observed,
  target: TargetRef,
  prices: TokenPrices | undefined,
  required: boolean,
): Observed {
  if (observed.cost.usd !== undefined || (!prices && !required)) return observed;
  const agent = priceAgent(observed, target, prices, required);
  const helper = helperDollars(observed.cost, agentModelOf(observed, target), target, prices, required);
  if (helper === undefined) return agent;
  return { ...agent, cost: { ...agent.cost, helperUsd: helper, usd: (agent.cost.usd ?? 0) + helper } };
}

/** Prefer the adapter's dollars. Price totals once, or each segment when dollars/models are segment-specific. */
function priceAgent(
  observed: Observed,
  target: TargetRef,
  prices: TokenPrices | undefined,
  required: boolean,
): Observed {
  if (observed.cost.usd !== undefined || (!prices && !required)) return observed;
  const segments = observed.segments.flatMap((segment) => (segment.cost ? [segment.cost] : []));
  const segmentModels = [
    ...new Set(segments.flatMap((cost) => (cost.model === undefined ? [] : [cost.model]))),
  ];
  // Model-only metadata identifies the aggregate tokens; it is not a separate billable usage record.
  const usage = segments.filter((cost) => cost.usd !== undefined || hasTokens(cost));
  const segmented = usage.some((cost) => cost.usd !== undefined || cost.model !== undefined);
  const model = observed.cost.model ?? (segmentModels.length === 1 ? segmentModels[0] : undefined);
  const segmentTarget = model === undefined ? target : { ...target, options: { ...target.options, model } };
  if (
    !segmented &&
    hasTokens(observed.cost) &&
    observed.cost.model === undefined &&
    segmentModels.length > 1
  ) {
    if (required)
      throw new TokenPriceError(
        `Budget cannot assign aggregate tokens to models ${segmentModels.join(', ')}: report cost.model or token usage per segment.`,
      );
    return observed;
  }
  if (segmented && hasTokens(observed.cost) && usage.some((cost) => cost.usd === undefined)) {
    // Reported dollars are authoritative; a partial token breakdown must not erase aggregate usage.
    for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) {
      const total = observed.cost[key];
      if (total !== undefined && total !== usage.reduce((sum, cost) => sum + (cost[key] ?? 0), 0)) {
        if (required)
          throw new TokenPriceError(
            `Budget cannot price incomplete segment ${key} for model "${model ?? target.options?.model ?? '(unspecified)'}": report all segment usage or aggregate cost.usd.`,
          );
        return observed;
      }
    }
  }
  const usd =
    !segmented && hasTokens(observed.cost)
      ? dollars(observed.cost, segmentTarget, prices, required)
      : usage.reduce((sum, cost) => sum + (dollars(cost, segmentTarget, prices, required) ?? 0), 0);
  return usd === undefined ? observed : { ...observed, cost: { ...observed.cost, usd } };
}
