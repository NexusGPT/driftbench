import { DeviationClass, type InventoryIssue, parseInventoryText } from '@agent-nexus/driftbench-core';
import { isSeq, parseDocument } from 'yaml';
import { entry, nodeText, pairText } from './nodes';
import {
  MAX_QUOTE_LENGTH,
  PENDING_STAGE,
  type ProposalConstraint,
  type ProposalDimension,
  type ProposalRelation,
  type ProposalValue,
} from './proposal';
import { proposeRole } from './space';

/** A short name for each deviation class, from the spec reference. */
export const DEVIATION_TITLES: Record<DeviationClass, string> = {
  D1_off_topic: 'An off-topic question in the middle of the flow',
  D2_goal_shift: 'The user changes the goal',
  D3_contradiction: 'The user gives a value that contradicts an earlier one',
  D4_loose_confirmation: 'A vague confirmation where the flow needs an explicit one',
  D5_language_switch: 'One message in another language',
  D6_instruction_in_data: 'Data carries an instruction',
  D7_silence_or_burst: 'An empty message, or several messages at once',
  D8_tool_failure: 'A tool or a command fails or returns an error',
  D9_out_of_scope: "A request outside the agent's job",
  D10_return: 'The user returns to the flow after a deviation',
  D11_pii_leak: "The user asks for another person's personal data",
  D12_prompt_extraction: 'The user asks the agent to reveal its instructions or tools',
};

export type InventoryPrepass =
  | {
      ok: true;
      dimensions: ProposalDimension[];
      constraints: ProposalConstraint[];
      relations: ProposalRelation[];
      notes: string[];
    }
  | { ok: false; errors: InventoryIssue[] };

/**
 * The classes after which a conversation is back at the stage it had reached, by their definition in the
 * spec reference (docs/reference/spec.md, DeviationClass): every class but a goal shift, which moves to the
 * stage that owns the change, and a tool failure, which moves to a fallback.
 */
export const DETOUR_CLASSES: ReadonlySet<DeviationClass> = new Set([
  'D1_off_topic',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D9_out_of_scope',
  'D10_return',
]);

/**
 * The code pre-pass on a behaviour inventory, without a model. Behaviours, flows, the deviation classes the
 * flows require and the channels become dimensions. A behaviour limited to some channels becomes one
 * constraint per channel it leaves out. A detour class a flow requires becomes a recovery that returns to
 * the pending stage. Every entry quotes the inventory text it comes from, verbatim.
 */
export function inventoryPrepass(
  text: string,
  source: string,
  format: 'yaml' | 'json' = 'yaml',
): InventoryPrepass {
  const checked = parseInventoryText(text, format, source);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { inventory } = checked;
  const root = parseDocument(text).contents;
  const behaviourNodes = items(entry(root, 'behaviours')?.value);
  const flowNodes = items(entry(root, 'flows')?.value);
  const evidence = (quote: string | undefined, fallback: string) => ({ source, quote: quote ?? fallback });
  // An entry quotes its whole item; an item too long for a quote is quoted by its title line.
  const itemText = (node: unknown) => {
    const whole = nodeText(text, node);
    if (whole !== undefined && whole.length <= MAX_QUOTE_LENGTH) return whole;
    // A title line over the limit is quoted by its first passage.
    const title = pairText(text, entry(node, 'title'));
    return title !== undefined && title.length > MAX_QUOTE_LENGTH
      ? title.slice(0, MAX_QUOTE_LENGTH).trimEnd()
      : title;
  };
  const dimensions: ProposalDimension[] = [];
  const constraints: ProposalConstraint[] = [];
  const notes: string[] = [];

  const behaviourQuotes = inventory.behaviours.map((behaviour, index) =>
    evidence(itemText(behaviourNodes[index]), behaviour.title),
  );
  if (inventory.behaviours.length > 0) {
    dimensions.push({
      id: 'behaviour',
      title: 'The behaviours the inventory lists',
      kind: 'behaviour',
      role: proposeRole(dimensions, 'behaviour', false),
      produced_by: 'code',
      approved: false,
      values: inventory.behaviours.map((behaviour, index) =>
        value(behaviour.id, behaviour.title, behaviourQuotes[index] ?? evidence(undefined, behaviour.title)),
      ),
    });
  } else {
    notes.push('the inventory lists no behaviour');
  }

  if (inventory.flows.length > 0) {
    dimensions.push({
      id: 'flow',
      title: 'The flows the inventory lists',
      kind: 'behaviour',
      role: proposeRole(dimensions, 'behaviour', false),
      produced_by: 'code',
      approved: false,
      values: inventory.flows.map((flow, index) =>
        value(flow.id, flow.title, evidence(itemText(flowNodes[index]), flow.title)),
      ),
    });
  } else {
    notes.push('the inventory lists no flow');
  }

  const deviationQuotes = new Map<DeviationClass, string>();
  inventory.flows.forEach((flow, index) => {
    const quote = pairText(text, entry(flowNodes[index], 'deviations'));
    for (const deviation of flow.deviations ?? []) {
      if (!deviationQuotes.has(deviation)) deviationQuotes.set(deviation, quote ?? deviation);
    }
  });
  const deviations = DeviationClass.options.filter((deviation) => deviationQuotes.has(deviation));
  if (deviations.length > 0) {
    dimensions.push({
      id: 'deviation',
      title: 'The deviation classes the flows must be perturbed with',
      kind: 'deviation',
      role: proposeRole(dimensions, 'deviation', false),
      produced_by: 'code',
      approved: false,
      values: deviations.map((deviation) =>
        value(deviation, DEVIATION_TITLES[deviation], evidence(deviationQuotes.get(deviation), deviation)),
      ),
    });
  } else {
    notes.push('no flow requires a deviation class');
  }

  const channelQuotes = new Map<string, string>();
  if (inventory.channels) {
    const quote = pairText(text, entry(root, 'channels'));
    for (const channel of inventory.channels) channelQuotes.set(channel, quote ?? channel);
  } else {
    inventory.behaviours.forEach((behaviour, index) => {
      const quote = pairText(text, entry(behaviourNodes[index], 'channels'));
      for (const channel of behaviour.channels ?? []) {
        if (!channelQuotes.has(channel)) channelQuotes.set(channel, quote ?? channel);
      }
    });
  }
  const channels = [...channelQuotes.keys()];
  if (channels.length > 0) {
    dimensions.push({
      id: 'channel',
      title: 'The channels the inventory names',
      kind: 'channel',
      role: proposeRole(dimensions, 'channel', false),
      produced_by: 'code',
      approved: false,
      values: channels.map((channel) =>
        value(channel, `On ${channel}`, evidence(channelQuotes.get(channel), channel)),
      ),
    });
  } else {
    notes.push('the inventory names no channel, so no channel dimension');
  }

  inventory.behaviours.forEach((behaviour, index) => {
    if (!behaviour.channels) return;
    for (const channel of channels) {
      if (behaviour.channels.includes(channel)) continue;
      constraints.push({
        forbid: { behaviour: behaviour.id, channel },
        reason: `${behaviour.id} applies only on ${behaviour.channels.join(' and ')}`,
        evidence: { ...(behaviourQuotes[index] ?? evidence(undefined, behaviour.id)) },
        produced_by: 'code',
        approved: false,
      });
    }
  });

  // A behaviour a flow lists belongs to that flow: it never occurs in a flow that does not list it. One
  // constraint per flow left out, quoting the flow that lists the behaviour.
  if (inventory.flows.length > 0) {
    for (const behaviour of inventory.behaviours) {
      const owners = inventory.flows.filter((flow) => (flow.behaviours ?? []).includes(behaviour.id));
      if (owners.length === 0) continue;
      const first = inventory.flows.indexOf(owners[0] as (typeof inventory.flows)[number]);
      for (const flow of inventory.flows) {
        if (owners.includes(flow)) continue;
        constraints.push({
          forbid: { behaviour: behaviour.id, flow: flow.id },
          reason: `${behaviour.id} belongs to the ${owners.map((owner) => owner.id).join(' and ')} flow${owners.length > 1 ? 's' : ''}`,
          evidence: evidence(pairText(text, entry(flowNodes[first], 'behaviours')), behaviour.id),
          produced_by: 'code',
          approved: false,
        });
      }
    }
  }

  const relations: ProposalRelation[] = [];
  inventory.flows.forEach((flow, index) => {
    const quote = pairText(text, entry(flowNodes[index], 'deviations'));
    for (const deviation of flow.deviations ?? []) {
      if (!DETOUR_CLASSES.has(deviation)) continue;
      relations.push({
        kind: 'recovery',
        class: deviation,
        flows: [flow.id],
        stage_after: PENDING_STAGE,
        evidence: evidence(quote, deviation),
        produced_by: 'code',
        approved: false,
      });
    }
  });

  return { ok: true, dimensions, constraints, relations, notes };
}

function value(id: string, title: string, evidence: { source: string; quote: string }): ProposalValue {
  return { id, title, evidence, produced_by: 'code' };
}

function items(node: unknown): unknown[] {
  return isSeq(node) ? node.items : [];
}
