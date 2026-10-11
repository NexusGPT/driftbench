import type { Inventory } from '@driftbench/core';
import { type Proposal, type ProposalDimension, renderProposal } from '@driftbench/generate';
import { NONE, type SpaceMap } from '@driftbench/space';
import type { HiddenProperty, HiddenSpec } from './hidden';
import { DEVIATION_RULES } from './hidden';

/**
 * The hidden specification rendered as the artefacts a real agent has, and as the approved map the
 * generator reads. The extractor is not under test here, so the map is written from the specification by
 * code: every value quotes the line of the rendered prompt, inventory or tools file that states it, so the
 * generator's loader accepts it as it accepts an extracted and approved map.
 */

/** The file names of a rendered map, in one folder. */
export const MAP_FILES = {
  map: 'approved.yaml',
  prompt: 'prompt.md',
  inventory: 'inventory.yaml',
  tools: 'tools.yaml',
} as const;

/** The fixed date every rendered map records, so a seed renders the same bytes on any day. */
export const RENDERED_AT = '2026-10-11T00:00:00.000Z';

export type RenderedMap = Record<keyof typeof MAP_FILES, string>;

function title(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** The prompt: stages, moves, users and rules, one sentence per entry the map quotes. */
export function renderPrompt(spec: HiddenSpec): string {
  const lines = [
    `# The ${spec.agent} assistant`,
    '',
    `A fictional agent the generator validator drew from seed ${spec.seed}. Every name and value is made up.`,
    '',
    '## Stages',
    '',
    ...spec.stages.map((stage) => `- ${stage.id}: ${title(stage.title)} It asks: "${stage.question}"`),
    '',
    '## Moves',
    '',
    ...spec.transitions.map((edge) => `- ${edge.rule}`),
    '',
    '## Tools',
    '',
    ...spec.tools.map(
      (tool) =>
        `- ${tool.name}: ${title(tool.title)}${tool.stage ? ` It runs when the conversation reaches ${tool.stage}.` : ''}${tool.sideEffect ? ' It changes the world, so it runs only after CONFIRM and is never retried.' : ' It only reads.'}`,
    ),
    '',
    '## Users',
    '',
    ...spec.personas.map((persona) => `- ${persona.id}: ${title(persona.title)}`),
    '',
    '## Rules',
    '',
    ...spec.deviations.map((cls) => `- ${DEVIATION_RULES[cls]}`),
    ...spec.constraints
      .filter((constraint) => constraint.source === 'prompt')
      .map((constraint) => `- ${constraint.quote}`),
    '',
  ];
  return lines.join('\n');
}

/** The behaviour inventory: channels, behaviours with the channels they apply on, flows with their deviations. */
export function renderInventory(spec: HiddenSpec): string {
  const lines = [
    `# The ${spec.agent} behaviour inventory, drawn by the generator validator. Fictional.`,
    `channels: [${spec.channels.join(', ')}]`,
    '',
    'behaviours:',
  ];
  for (const behaviour of spec.behaviours) {
    lines.push(`  - id: ${behaviour.id}`, `    title: ${behaviour.title}`);
    if (behaviour.channels) lines.push(`    channels: [${behaviour.channels.join(', ')}]`);
  }
  lines.push('', 'flows:');
  for (const flow of spec.flows) {
    lines.push(
      `  - id: ${flow.id}`,
      `    title: ${flow.title}`,
      `    behaviours: [${flow.behaviours.join(', ')}]`,
    );
    if (flow.deviations.length > 0) lines.push(`    deviations: [${flow.deviations.join(', ')}]`);
  }
  lines.push('');
  return lines.join('\n');
}

function propertyLine(property: HiddenProperty): string {
  if (property.type === 'enum')
    return `${property.name}: { type: string, enum: [${property.members.join(', ')}] }`;
  if (property.type === 'boolean') return `${property.name}: { type: boolean }`;
  return `${property.name}: { type: integer, minimum: ${property.minimum}, maximum: ${property.maximum} }`;
}

/** The tool schemas, in the `tools` list form the extractor and the generator read. */
export function renderTools(spec: HiddenSpec): string {
  const lines = [`# The ${spec.agent} tools, drawn by the generator validator. Fictional.`, 'tools:'];
  for (const tool of spec.tools) {
    lines.push(`  - name: ${tool.name}`, `    description: ${tool.title}`);
    for (const [key, properties] of [
      ['input_schema', tool.input],
      ['output_schema', tool.output],
    ] as const) {
      lines.push(
        `    ${key}:`,
        '      type: object',
        `      required: [${properties.map((property) => property.name).join(', ')}]`,
        '      properties:',
        ...properties.map((property) => `        ${propertyLine(property)}`),
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** The approved map: every dimension, constraint and phrase of the hidden specification, approved. */
export function hiddenProposal(spec: HiddenSpec): Proposal {
  const inventory = `./${MAP_FILES.inventory}`;
  const prompt = `./${MAP_FILES.prompt}`;
  const tools = `./${MAP_FILES.tools}`;
  const dimension = (
    id: string,
    titleText: string,
    kind: ProposalDimension['kind'],
    role: ProposalDimension['role'],
    values: ProposalDimension['values'],
  ): ProposalDimension => ({ id, title: titleText, kind, role, produced_by: 'code', approved: true, values });
  const dimensions: ProposalDimension[] = [
    dimension(
      'behaviour',
      'The behaviours the inventory lists',
      'behaviour',
      'axis',
      spec.behaviours.map((behaviour) => ({
        id: behaviour.id,
        title: behaviour.title,
        evidence: { source: inventory, quote: `id: ${behaviour.id}\n    title: ${behaviour.title}` },
        produced_by: 'code',
      })),
    ),
    dimension(
      'flow',
      'The flows the inventory lists',
      'behaviour',
      'detail',
      spec.flows.map((flow) => ({
        id: flow.id,
        title: flow.title,
        evidence: { source: inventory, quote: `id: ${flow.id}\n    title: ${flow.title}` },
        produced_by: 'code',
      })),
    ),
    dimension(
      'deviation',
      'The deviation classes the flows must be perturbed with',
      'deviation',
      'axis',
      spec.deviations.map((cls) => {
        const flow = spec.flows.find((candidate) => candidate.deviations.includes(cls));
        return {
          id: cls,
          title: DEVIATION_RULES[cls],
          evidence: { source: inventory, quote: `deviations: [${flow?.deviations.join(', ')}]` },
          produced_by: 'code',
        };
      }),
    ),
    dimension(
      'channel',
      'The channels the inventory names',
      'channel',
      'axis',
      spec.channels.map((channel) => ({
        id: channel,
        title: `On ${channel}`,
        evidence: { source: inventory, quote: `channels: [${spec.channels.join(', ')}]` },
        produced_by: 'code',
      })),
    ),
  ];
  const byDimension = new Map<string, typeof spec.data>();
  for (const value of spec.data)
    byDimension.set(value.dimension, [...(byDimension.get(value.dimension) ?? []), value]);
  for (const [id, values] of byDimension) {
    const first = values[0];
    dimensions.push(
      dimension(
        id,
        `${first?.tool} ${first?.direction === 'in' ? 'input' : 'output'} ${first?.field}`,
        'data',
        'detail',
        values.map((value) => ({
          id: value.id,
          title: value.title,
          evidence: { source: tools, quote: value.quote },
          produced_by: 'code',
        })),
      ),
    );
  }
  dimensions.push(
    dimension(
      'stage',
      'The flow stage a turn ends in',
      'stage',
      'axis',
      spec.stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        evidence: { source: prompt, quote: `${stage.id}: ${title(stage.title)}` },
        produced_by: 'code',
      })),
    ),
    dimension(
      'stage_transition',
      'A move from one stage to the next',
      'behaviour',
      'detail',
      spec.transitions.map((edge) => ({
        id: edge.id,
        title: edge.title,
        evidence: { source: prompt, quote: edge.rule },
        produced_by: 'code',
      })),
    ),
    dimension(
      'user_type',
      'Who is talking to the agent',
      'persona',
      'axis',
      spec.personas.map((persona) => ({
        id: persona.id,
        title: persona.title,
        evidence: { source: prompt, quote: `${persona.id}: ${title(persona.title)}` },
        produced_by: 'code',
      })),
    ),
  );
  return {
    version: 1,
    agent: spec.agent,
    produced_by: {
      family: 'code',
      model: 'driftbench validate generator, the hidden specification',
      at: RENDERED_AT,
    },
    sources: [
      { kind: 'prompt', path: prompt },
      { kind: 'inventory', path: inventory },
      { kind: 'tools', path: tools },
    ],
    dimensions,
    constraints: spec.constraints.map((constraint) => ({
      forbid: { ...constraint.forbid },
      reason: constraint.reason,
      evidence: { source: constraint.source === 'inventory' ? inventory : prompt, quote: constraint.quote },
      produced_by: 'code',
      approved: true,
    })),
    phrases: spec.phrases.map((phrase) => ({
      dimension: phrase.dimension,
      value: phrase.value,
      text: phrase.text,
      lang: phrase.lang,
      produced_by: 'model',
      approved: true,
    })),
  };
}

/** Every file of the rendered map, by name. Pure: the same specification gives the same text. */
export function renderMap(spec: HiddenSpec): RenderedMap {
  return {
    map: renderProposal(hiddenProposal(spec)),
    prompt: renderPrompt(spec),
    inventory: renderInventory(spec),
    tools: renderTools(spec),
  };
}

/** The inventory of the hidden specification, as the core reads one. */
export function hiddenInventory(spec: HiddenSpec): Inventory {
  return {
    channels: [...spec.channels],
    behaviours: spec.behaviours.map((behaviour) => ({
      id: behaviour.id,
      title: behaviour.title,
      kind: 'conversation' as const,
      ...(behaviour.channels ? { channels: [...behaviour.channels] } : {}),
    })),
    flows: spec.flows.map((flow) => ({
      id: flow.id,
      title: flow.title,
      behaviours: [...flow.behaviours],
      deviations: [...flow.deviations],
    })),
  };
}

/**
 * The hidden cells: the space map built from the specification itself, never from the rendered map, so
 * a map that lost a dimension or a value is caught by the coverage level.
 */
export function hiddenSpaceMap(spec: HiddenSpec): SpaceMap {
  return {
    version: '1',
    agent: spec.agent,
    dimensions: [
      {
        id: 'behaviour',
        title: 'Behaviours',
        kind: 'behaviour',
        values: spec.behaviours.map((behaviour) => ({ id: behaviour.id, title: behaviour.title })),
      },
      {
        id: 'deviation',
        title: 'Deviations',
        kind: 'deviation',
        values: [
          { id: NONE, title: 'No deviation' },
          ...spec.deviations.map((cls) => ({ id: cls, title: DEVIATION_RULES[cls] })),
        ],
      },
      {
        id: 'channel',
        title: 'Channels',
        kind: 'channel',
        values: spec.channels.map((channel) => ({ id: channel, title: channel })),
      },
      {
        id: 'stage',
        title: 'Stages',
        kind: 'stage',
        values: spec.stages.map((stage) => ({ id: stage.id, title: stage.title })),
      },
      {
        id: 'user_type',
        title: 'Users',
        kind: 'persona',
        values: spec.personas.map((persona) => ({ id: persona.id, title: persona.title })),
      },
    ],
    constraints: spec.constraints.map((constraint) => ({
      forbid: { ...constraint.forbid },
      reason: constraint.reason,
    })),
    prior: { kind: 'declared' },
  };
}
