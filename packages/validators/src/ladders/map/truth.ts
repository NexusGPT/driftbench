import type { Section } from '@agent-nexus/driftbench-generate';
import type { Span } from './render';
import { type ArgSchema, type HiddenArg, type HiddenSpec, MAP_DEVIATIONS, type Role } from './spec';

/**
 * What the map must hold, written from the hidden specification alone, by the rules of docs/validators.md
 * section 2 and the documented contract of the tool pre-pass. It never runs the extractor: the planted truth
 * and the extractor's answer are two independent computations of one map.
 */

export type Kind = 'stage' | 'behaviour' | 'deviation' | 'persona' | 'channel' | 'data' | 'task';

/** A value code must read from the inventory or the tool schemas. */
export type StructuralEntry = {
  dimension: string;
  kind: Kind;
  value: string;
  from: 'inventory' | 'tools';
};

/** A value or phrase a model must read from the prose, at its rendered span. */
export type ProseAtom = {
  id: string;
  section: Section;
  /** `value`: a value of a dimension; `phrase`: a phrase of the phrase bank. */
  type: 'value' | 'phrase';
  dimension: string;
  kind: Kind;
  value: string;
  lang?: string;
  text?: string;
};

export type PlantedConstraint = {
  id: string;
  forbid: Record<string, string>;
  from: 'inventory' | 'prose';
  section?: Section;
};

export type Truth = {
  structural: StructuralEntry[];
  prose: ProseAtom[];
  constraints: PlantedConstraint[];
  /** The role each dimension is declared with. */
  roles: Array<{ dimension: string; role: Role }>;
};

/** The truth of a specification. */
export function truthOf(spec: HiddenSpec): Truth {
  const structural: StructuralEntry[] = [];
  const add = (dimension: string, kind: Kind, value: string, from: StructuralEntry['from']) =>
    structural.push({ dimension, kind, value, from });
  for (const behaviour of spec.behaviours) add('behaviour', 'behaviour', behaviour.id, 'inventory');
  for (const flow of spec.flows) add('flow', 'behaviour', flow.id, 'inventory');
  const required = new Set(spec.flows.flatMap((flow) => flow.deviations));
  for (const deviation of MAP_DEVIATIONS) {
    if (required.has(deviation)) add('deviation', 'deviation', deviation, 'inventory');
  }
  for (const channel of spec.channels) add('channel', 'channel', channel, 'inventory');
  const toolDimensions: string[] = [];
  for (const tool of spec.tools) {
    for (const [direction, args] of [
      ['in', tool.input],
      ['out', tool.output],
    ] as const) {
      for (const { dimension, values } of toolPartitions(tool.name, direction, args)) {
        toolDimensions.push(dimension);
        for (const value of values) add(dimension, 'data', value, 'tools');
      }
    }
  }

  const prose: ProseAtom[] = [];
  for (const stage of spec.stages) {
    prose.push({
      id: `stage/${stage.id}`,
      section: 'stages',
      type: 'value',
      dimension: 'stage',
      kind: 'stage',
      value: stage.id,
    });
  }
  for (const rule of spec.rules) {
    prose.push({
      id: `rule/${rule.id}`,
      section: 'rules',
      type: 'value',
      dimension: 'rule',
      kind: 'behaviour',
      value: rule.id,
    });
  }
  if (spec.proseDeviation) {
    prose.push({
      id: `deviation/${spec.proseDeviation}`,
      section: 'rules',
      type: 'value',
      dimension: 'deviation',
      kind: 'deviation',
      value: spec.proseDeviation,
    });
  }
  for (const dimension of [...spec.personas, ...spec.data]) {
    for (const value of dimension.values) {
      prose.push({
        id: `${dimension.id}/${value.id}`,
        section: dimension.kind === 'persona' ? 'personas' : 'data',
        type: 'value',
        dimension: dimension.id,
        kind: dimension.kind,
        value: value.id,
      });
    }
  }
  for (const phrase of spec.phrases) {
    prose.push({
      id: `phrase/${phrase.id}`,
      section: 'phrases',
      type: 'phrase',
      dimension: phrase.dimension,
      kind: phrase.dimension === 'flow' ? 'behaviour' : 'persona',
      value: phrase.value,
      lang: phrase.lang,
      text: phrase.text,
    });
  }

  const constraints: PlantedConstraint[] = [];
  for (const behaviour of spec.behaviours) {
    if (!behaviour.channels) continue;
    for (const channel of spec.channels) {
      if (behaviour.channels.includes(channel)) continue;
      constraints.push({
        id: `behaviour=${behaviour.id},channel=${channel}`,
        forbid: { behaviour: behaviour.id, channel },
        from: 'inventory',
      });
    }
  }
  // A behaviour a flow lists belongs to that flow: the pre-pass forbids it in every flow that does not list it.
  for (const behaviour of spec.behaviours) {
    if (!spec.flows.some((flow) => flow.behaviours.includes(behaviour.id))) continue;
    for (const flow of spec.flows) {
      if (flow.behaviours.includes(behaviour.id)) continue;
      constraints.push({
        id: `behaviour=${behaviour.id},flow=${flow.id}`,
        forbid: { behaviour: behaviour.id, flow: flow.id },
        from: 'inventory',
      });
    }
  }
  for (const constraint of spec.stageConstraints) {
    constraints.push({
      id: constraint.id,
      forbid: { ...constraint.forbid },
      from: 'prose',
      section: 'stages',
    });
  }
  for (const constraint of spec.personaConstraints) {
    constraints.push({
      id: constraint.id,
      forbid: { ...constraint.forbid },
      from: 'prose',
      section: 'personas',
    });
  }

  const roles: Truth['roles'] = [
    { dimension: 'behaviour', role: 'axis' },
    { dimension: 'flow', role: 'detail' },
    ...(required.size > 0 || spec.proseDeviation ? [{ dimension: 'deviation', role: 'axis' as Role }] : []),
    { dimension: 'channel', role: 'axis' },
    ...toolDimensions.map((dimension) => ({ dimension, role: 'detail' as Role })),
    { dimension: 'stage', role: 'axis' },
    { dimension: 'rule', role: 'detail' },
    ...[...spec.personas, ...spec.data].map((dimension) => ({
      dimension: dimension.id,
      role: dimension.role,
    })),
  ];
  return { structural, prose, constraints, roles };
}

/**
 * The partitions a tool schema states, by the pre-pass contract: an enum gives its members, a boolean true
 * and false, a numeric bound three values around it, a length bound its edges, a format well-formed and
 * malformed, an array empty, one and several items, a nullable object present and null, an optional property
 * absent (and present when nothing else is stated). An open property states nothing. Objects are followed one
 * level down.
 */
export function toolPartitions(
  tool: string,
  direction: 'in' | 'out',
  args: readonly HiddenArg[],
  prefix: readonly string[] = [],
): Array<{ dimension: string; values: string[] }> {
  const out: Array<{ dimension: string; values: string[] }> = [];
  for (const arg of args) {
    const path = [...prefix, arg.name];
    const dimension = [tool, direction, ...path].join('.');
    const partitions = schemaPartitions(arg.schema);
    if (!arg.required) {
      if (partitions.length === 0) partitions.push('present');
      partitions.push('absent');
    }
    if (partitions.length > 0)
      out.push({ dimension, values: partitions.map((partition) => `${dimension}.${partition}`) });
    if (arg.schema.type === 'object' && prefix.length === 0) {
      out.push(...toolPartitions(tool, direction, arg.schema.children, path));
    }
  }
  return out;
}

function schemaPartitions(schema: ArgSchema): string[] {
  switch (schema.type) {
    case 'enum':
      return [...schema.members];
    case 'boolean':
      return ['true', 'false'];
    case 'integer':
      return [
        ...(schema.minimum === undefined ? [] : ['below-minimum', 'at-minimum', 'above-minimum']),
        ...(schema.maximum === undefined ? [] : ['below-maximum', 'at-maximum', 'above-maximum']),
      ];
    case 'string':
      return [
        ...(schema.minLength === undefined
          ? []
          : [...(schema.minLength > 0 ? ['below-min-length'] : []), 'at-min-length']),
        ...(schema.maxLength === undefined ? [] : ['at-max-length', 'above-max-length']),
        ...(schema.format === undefined ? [] : ['well-formed', 'malformed']),
      ];
    case 'open':
      return [];
    case 'array':
      return [
        'empty',
        'one-item',
        'several-items',
        ...(schema.maxItems === undefined ? [] : ['at-max-items', 'above-max-items']),
      ];
    case 'object':
      return schema.nullable ? ['present', 'null'] : [];
  }
}

/** The key of a combination, whatever the order of its dimensions. */
export function forbidKey(forbid: Record<string, string>): string {
  return JSON.stringify(Object.entries(forbid).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Whether a quote, folded, lies inside the folded text of a span. */
export function quoteInSpan(prompt: string, span: Span | undefined, quote: string): boolean {
  if (!span) return false;
  const needle = fold(quote);
  return needle !== '' && fold(prompt.slice(span.start, span.end)).includes(needle);
}

/** White space and typographic quote marks folded, as the quote check folds them. */
export function fold(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
