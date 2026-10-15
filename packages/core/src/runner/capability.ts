import type { AdapterCapabilities } from '../contracts/adapter';
import type { WorldState } from '../schema/common';
import type { NotRun } from '../schema/run';

/** The Given layers in effect at a block that need a capability of the adapter to reach the agent. */
export type GivenLayers = {
  /** A prefix the spec writes, at this block or an earlier one: the session holds it from there on. */
  prefix: boolean;
  /** The world of the block, spec and block overrides and an injected world merged. */
  world: WorldState;
};

/**
 * The always-on `capability` check: a layer the Given carries that the adapter cannot apply is a
 * `not_run: unsupported`, never a silently dropped layer. A prefix needs `seedPrefix`, and a forced tool
 * result or error needs `toolStubs`. Returns the first gap, or undefined.
 */
export function capabilityGap(
  adapter: string,
  capabilities: AdapterCapabilities,
  layers: GivenLayers,
): NotRun | undefined {
  const gap = (layer: string, what: string, capability: keyof AdapterCapabilities): NotRun => ({
    kind: 'unsupported',
    layer,
    check: 'capability',
    expected: `the adapter applies ${what} (${capability})`,
    got: `${adapter} declares ${capability} false: the agent would never see it`,
  });
  if (layers.prefix && !capabilities.seedPrefix) return gap('1 history', 'a prefix', 'seedPrefix');
  const tools = Object.keys(layers.world.tools ?? {});
  if (tools.length > 0 && !capabilities.toolStubs)
    return gap('5 world', `forced tool results (${tools.join(', ')})`, 'toolStubs');
  return undefined;
}
