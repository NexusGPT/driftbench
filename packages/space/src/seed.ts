import {
  channelUniverse,
  DeviationClass,
  type Inventory,
  type LoadedSpec,
  type LoadResult,
} from '@agent-nexus/driftbench-core';
import { Document, isMap, isSeq } from 'yaml';
import { NONE, type SpaceConstraint, type SpaceDimension, type SpaceMap } from './schema';

/** Plain titles of the twelve deviation classes, for a seeded map. The owner may rewrite them. */
export const DEVIATION_TITLES: Record<DeviationClass, string> = {
  D1_off_topic: 'An off-topic question in the middle of the flow',
  D2_goal_shift: 'The user changes the goal after a step is done',
  D3_contradiction: 'The user contradicts a fact given earlier',
  D4_loose_confirmation: 'A loose yes where an explicit confirmation is needed',
  D5_language_switch: 'A message in another language',
  D6_instruction_in_data: 'An instruction hidden in data',
  D7_silence_or_burst: 'An empty message, or several at once',
  D8_tool_failure: 'A tool or a command fails',
  D9_out_of_scope: 'A request the agent does not handle',
  D10_return: 'A return to the flow after a detour',
  D11_pii_leak: "A request for another person's personal data",
  D12_prompt_extraction: 'A request to reveal the instructions or tools',
};

export type SeedOptions = {
  /** The agent the map describes. Default `agent`. */
  agent?: string;
  /** Default `1`. */
  version?: string;
  /** The inventory as a path relative to where the map will be written. */
  inventory?: string;
};

/**
 * A first map from the Phase 0 inventory and the specs, for an owner to edit rather than start blank:
 *
 * - stage: every stage of the specs' `stages` catalogues, in the order first met;
 * - behaviour: the inventory's behaviours, with their titles;
 * - deviation: `none` (a block with no deviation) and every class a flow requires, in class order;
 * - channel: the channel universe of the Phase 0 coverage (`channelUniverse`);
 * - constraints: a behaviour the inventory limits to some channels is forbidden on the others;
 * - prior: declared, with no weight (every value of a dimension weighs the same).
 *
 * A dimension with no value to list is left out. Persona, data and task dimensions cannot be read from the
 * inventory: the owner adds them. Invalid specs are ignored.
 */
export function fromInventory(
  inventory: Inventory,
  specs: readonly LoadResult[],
  options: SeedOptions = {},
): SpaceMap {
  const valid = specs.filter((result): result is LoadedSpec => result.ok).map((result) => result.spec);
  const dimensions: SpaceDimension[] = [];

  const stages: string[] = [];
  for (const spec of valid) {
    for (const stage of spec.stages ?? []) if (!stages.includes(stage)) stages.push(stage);
  }
  if (stages.length > 0) {
    dimensions.push({
      id: 'stage',
      title: 'The stage the conversation has reached',
      kind: 'stage',
      values: stages.map((stage) => ({ id: stage, title: stage.replace(/_/g, ' ') })),
    });
  }

  if (inventory.behaviours.length > 0) {
    dimensions.push({
      id: 'behaviour',
      title: 'The behaviour of the inventory the conversation exercises',
      kind: 'behaviour',
      values: inventory.behaviours.map((behaviour) => ({ id: behaviour.id, title: behaviour.title })),
    });
  }

  const required = new Set(inventory.flows.flatMap((flow) => flow.deviations ?? []));
  dimensions.push({
    id: 'deviation',
    title: 'The deviation the user brings, if any',
    kind: 'deviation',
    values: [
      { id: NONE, title: 'No deviation' },
      ...DeviationClass.options
        .filter((deviation) => required.has(deviation))
        .map((deviation) => ({ id: deviation, title: DEVIATION_TITLES[deviation] })),
    ],
  });

  const channels = channelUniverse(specs, inventory);
  dimensions.push({
    id: 'channel',
    title: 'The channel the conversation runs on',
    kind: 'channel',
    values: channels.map((channel) => ({ id: channel, title: channel })),
  });

  const constraints: SpaceConstraint[] = [];
  if (inventory.behaviours.length > 0) {
    for (const behaviour of inventory.behaviours) {
      const allowed = behaviour.channels;
      if (!allowed) continue;
      for (const channel of channels) {
        if (allowed.includes(channel)) continue;
        constraints.push({
          forbid: { behaviour: behaviour.id, channel },
          reason: `The inventory lists ${behaviour.id} on ${allowed.join(', ')} only.`,
        });
      }
    }
  }

  return {
    version: options.version ?? '1',
    agent: options.agent ?? 'agent',
    ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
    dimensions,
    constraints,
    prior: { kind: 'declared' },
  };
}

/**
 * A map as YAML text, under comment lines, ready for an owner to edit: one line per value and per forbidden
 * combination, as the hand-written maps are laid out.
 */
export function formatSpaceMap(map: SpaceMap, header: readonly string[] = []): string {
  const document = new Document(map);
  const flow = (node: unknown, key: string): void => {
    if (!isSeq(node)) return;
    for (const item of node.items) {
      if (!isMap(item)) continue;
      const inner = key === '' ? item : item.get(key, true);
      if (isMap(inner)) inner.flow = true;
    }
  };
  const dimensions = document.get('dimensions', true);
  if (isSeq(dimensions)) {
    for (const dimension of dimensions.items) if (isMap(dimension)) flow(dimension.get('values', true), '');
  }
  flow(document.get('constraints', true), 'forbid');
  const comments = header.map((line) => `# ${line}\n`).join('');
  return `${comments}${document.toString({ lineWidth: 0, singleQuote: true })}`;
}
