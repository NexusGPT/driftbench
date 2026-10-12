import { DEVIATION_SENTENCES, Draw, type HiddenArg, type HiddenSpec, LANGUAGES, mixSeed } from './spec';

/**
 * The renderer: the hidden specification as the three artefacts a real agent has. The prompt is prose, from
 * templates with varied wording and section order, with decoy sentences that specify nothing. The inventory
 * and the tool schemas are YAML. The renderer records the span of every atom it writes, so the validator
 * knows where each quote must come from. The metamorphic transforms are render options: a permuted section
 * order, every rule split into two sentences, a synonym table, more decoys. Nothing here reads the extractor.
 */

export const PROMPT_PATH = 'prompt.md';
export const INVENTORY_PATH = 'inventory.yaml';
export const TOOLS_PATH = 'tools.yaml';

export type Span = { start: number; end: number };

export type RenderOptions = {
  /** The seed of the wording: which template variant each sentence takes, and the base section order. */
  wording: number;
  /** The section order. Absent: the base order the wording seed draws. */
  order?: readonly string[];
  /** Every rule written as two sentences instead of one. */
  split?: boolean;
  /** The synonym table applied to the template words. Ids and quoted user messages never change. */
  synonyms?: boolean;
  /** Decoy sentences added on top of the base ones. */
  extraDecoys?: number;
};

export type Rendered = {
  prompt: string;
  inventory: string;
  tools: string;
  /** The span in the prompt of each atom, by hidden id. Constraints of one sentence share its span. */
  spans: Map<string, Span>;
  decoys: Array<{ id: string; span: Span }>;
  /** The section keys in the order written. */
  order: string[];
  /** Hidden ids written as two sentences. */
  split: Set<string>;
};

/** The synonym table of the metamorphic transform: whole words of the templates, never ids or messages. */
export const SYNONYMS: ReadonlyArray<readonly [string, string]> = [
  ['customers', 'clients'],
  ['customer', 'client'],
  ['conversations', 'chats'],
  ['conversation', 'chat'],
  ['Always', 'At all times'],
  ['always', 'at all times'],
  ['Never', 'At no time'],
  ['never', 'at no time'],
  ['Before', 'Prior to'],
  ['before', 'prior to'],
  ['assistant', 'agent'],
  ['Assistant', 'Agent'],
  ['answer', 'reply'],
  ['Answer', 'Reply'],
];

/** Sentences that specify nothing. A map that turns one into an entry has invented it. */
export const DECOYS: readonly string[] = [
  'This guide was tidied up by the support team last spring.',
  'Thank you for reading this page with care.',
  'The team meets on Tuesdays to talk about the guide.',
  'Earlier versions of this page were longer.',
  'Coffee in the break room is free for everyone.',
  'The office plants are watered on Fridays.',
  'This page has no table of contents on purpose.',
  'Many people helped write this guide.',
  'The guide is printed in blue ink for the notice board.',
  'Feedback on the wording is welcome at any time.',
];

const PROTECT_OPEN = '\u0001';
const PROTECT_CLOSE = '\u0002';

/** Marks text the synonym table must leave alone: ids and user messages. */
function keep(text: string): string {
  return `${PROTECT_OPEN}${text}${PROTECT_CLOSE}`;
}

function lexify(text: string, synonyms: boolean): string {
  const parts = text.split(new RegExp(`(${PROTECT_OPEN}[^${PROTECT_CLOSE}]*${PROTECT_CLOSE})`));
  return parts
    .map((part) => {
      if (part.startsWith(PROTECT_OPEN)) return part.slice(1, -1);
      if (!synonyms) return part;
      let out = part;
      for (const [word, synonym] of SYNONYMS) {
        out = out.replace(new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, 'g'), synonym);
      }
      return out;
    })
    .join('');
}

/** Appends text and records spans in the final string. */
class Writer {
  text = '';

  constructor(private readonly synonyms: boolean) {}

  add(raw: string): Span {
    const piece = lexify(raw, this.synonyms);
    const start = this.text.length;
    this.text += piece;
    return { start, end: this.text.length };
  }
}

/** The section keys of a specification, in the base order before any shuffle. */
export function sectionKeys(spec: HiddenSpec): string[] {
  return [
    'stages',
    'rules',
    ...spec.personas.map((dimension) => `persona:${dimension.id}`),
    ...spec.data.map((dimension) => `data:${dimension.id}`),
    ...(spec.phrases.length > 0 ? ['examples'] : []),
    'about',
  ];
}

/** The base section order of a wording seed. */
export function baseOrder(spec: HiddenSpec, wording: number): string[] {
  return new Draw(mixSeed(wording, 0x6f72)).shuffle(sectionKeys(spec));
}

/** A small stable hash of a section key, to seed its wording. */
function keyHash(key: string): number {
  let hash = 0x811c9dc5;
  for (const char of key) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return hash;
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const low = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Renders the three artefacts of a specification. */
export function render(spec: HiddenSpec, options: RenderOptions): Rendered {
  return {
    ...renderPrompt(spec, options),
    inventory: renderInventory(spec),
    tools: renderTools(spec),
  };
}

export function renderPrompt(
  spec: HiddenSpec,
  options: RenderOptions,
): Pick<Rendered, 'prompt' | 'spans' | 'decoys' | 'order' | 'split'> {
  // Each section draws its wording from its own generator, so a permuted order keeps every sentence's words.
  let draw = new Draw(0);
  const order = [...(options.order ?? baseOrder(spec, options.wording))];
  const keys = new Set(sectionKeys(spec));
  if (order.length !== keys.size || order.some((key) => !keys.has(key))) {
    throw new RangeError(`the section order must hold each of ${[...keys].join(', ')} once`);
  }
  const out = new Writer(options.synonyms ?? false);
  const spans = new Map<string, Span>();
  const split = new Set<string>();

  // Decoys: the base ones from the wording seed, then the extra ones, each at the end of a section.
  const decoyDraw = new Draw(mixSeed(options.wording, 0x6463));
  const base = decoyDraw.int(2, 3);
  const pool = decoyDraw.shuffle(DECOYS.map((text, index) => ({ id: `decoy-${index + 1}`, text })));
  const chosen = pool.slice(0, Math.min(pool.length, base + (options.extraDecoys ?? 0)));
  const placed = new Map<string, Array<{ id: string; text: string }>>();
  chosen.forEach((decoy, index) => {
    const key = index === 0 ? 'about' : (decoyDraw.pick([...keys]) as string);
    placed.set(key, [...(placed.get(key) ?? []), decoy]);
  });
  const decoys: Rendered['decoys'] = [];

  out.add(`# Assistant guide for ${keep(spec.agent)}\n\n`);
  for (const key of order) {
    draw = new Draw(mixSeed(options.wording, keyHash(key)));
    writeSection(key);
    for (const decoy of placed.get(key) ?? []) {
      decoys.push({ id: decoy.id, span: out.add(decoy.text) });
      out.add('\n\n');
    }
  }

  function heading(variants: readonly string[]): void {
    out.add(`## ${draw.pick(variants)}\n\n`);
  }

  function bullet(id: string, body: string, prefix = '- '): void {
    out.add(prefix);
    spans.set(id, out.add(body));
    out.add('\n');
  }

  function writeSection(key: string): void {
    if (key === 'stages') {
      heading(['Stages', 'How a conversation runs', 'The order of a conversation']);
      out.add(
        `${draw.pick([
          'The conversation moves through these stages, in this order:',
          'Every conversation follows these stages, one after the other:',
        ])}\n\n`,
      );
      spec.stages.forEach((stage, index) => {
        bullet(`stage/${stage.id}`, `${keep(stage.id)}: ${stage.title}.`, `${index + 1}. `);
      });
      out.add('\n');
      const groups = new Map<string, string[]>();
      for (const constraint of spec.stageConstraints) {
        if (constraint.anchor.kind !== 'stage-only') continue;
        const group = `${constraint.anchor.stage}@${constraint.anchor.channel}`;
        groups.set(group, [...(groups.get(group) ?? []), constraint.id]);
      }
      for (const [group, ids] of groups) {
        const [stage, channel] = group.split('@') as [string, string];
        const sentence = draw.pick([
          `The ${keep(stage)} stage happens only on ${keep(channel)}.`,
          `Only on ${keep(channel)} does the conversation reach the ${keep(stage)} stage.`,
        ]);
        const span = out.add(sentence);
        for (const id of ids) spans.set(`constraint/${id}`, span);
        out.add('\n\n');
      }
      return;
    }
    if (key === 'rules') {
      heading(['Rules', 'What the assistant must do', 'House rules']);
      for (const rule of spec.rules) {
        const leadFirst = draw.chance(0.5);
        const body = options.split
          ? `${rule.main}. This holds ${rule.condition}.`
          : leadFirst
            ? `${rule.main} ${rule.condition}.`
            : `${cap(rule.condition)}, ${low(rule.main)}.`;
        if (options.split) split.add(`rule/${rule.id}`);
        bullet(`rule/${rule.id}`, body);
      }
      if (spec.proseDeviation) {
        out.add('\n');
        spans.set(
          `deviation/${spec.proseDeviation}`,
          out.add(`${DEVIATION_SENTENCES[spec.proseDeviation]}.`),
        );
        out.add('\n');
      }
      out.add('\n');
      return;
    }
    if (key.startsWith('persona:') || key.startsWith('data:')) {
      const id = key.slice(key.indexOf(':') + 1);
      const dimension = [...spec.personas, ...spec.data].find((candidate) => candidate.id === id);
      if (!dimension) throw new RangeError(`no dimension ${id}`);
      out.add(`## ${dimension.heading}\n\n`);
      const intro =
        dimension.kind === 'persona'
          ? draw.pick([
              'The assistant treats each of these in its own way:',
              'These are handled differently:',
            ])
          : draw.pick([
              'The next step depends on which of these comes back:',
              'What happens next depends on this:',
            ]);
      out.add(`${dimension.title}. ${intro}\n\n`);
      for (const value of dimension.values)
        bullet(`${dimension.id}/${value.id}`, `${keep(value.id)}: ${value.title}.`);
      out.add('\n');
      out.add(
        dimension.role === 'axis'
          ? `Each of these makes a different kind of conversation.\n\n`
          : `Any of these can show up inside any conversation.\n\n`,
      );
      if (dimension.id === 'customer_type') {
        for (const constraint of spec.personaConstraints) {
          if (constraint.anchor.kind !== 'type-never') continue;
          const { type, channel } = constraint.anchor;
          const sentence = draw.pick([
            `A ${keep(type)} customer never reaches us on ${keep(channel)}.`,
            `On ${keep(channel)} there is never a ${keep(type)} customer.`,
          ]);
          spans.set(`constraint/${constraint.id}`, out.add(sentence));
          out.add('\n\n');
        }
      }
      return;
    }
    if (key === 'examples') {
      heading(['Examples', 'Example messages', 'How customers start']);
      for (const phrase of spec.phrases) {
        if (phrase.dimension === 'flow') {
          out.add(`- In the ${keep(phrase.value)} flow a customer may write: "`);
        } else {
          const title = LANGUAGES.find((language) => language.id === phrase.value)?.title ?? phrase.value;
          out.add(`- A customer writing in ${keep(title)} may write: "`);
        }
        spans.set(`phrase/${phrase.id}`, out.add(keep(phrase.text)));
        out.add('"\n');
      }
      out.add('\n');
      return;
    }
    if (key === 'about') {
      heading(['About this guide', 'A note on this page']);
      return;
    }
    throw new RangeError(`unknown section ${key}`);
  }

  return { prompt: `${out.text.trimEnd()}\n`, spans, decoys, order, split };
}

/** A YAML scalar: plain when safe, else double quoted. */
function scalar(text: string): string {
  return /^[A-Za-z0-9][^:#\n"]*$/.test(text) && !/\s$/.test(text) ? text : JSON.stringify(text);
}

export function renderInventory(spec: HiddenSpec): string {
  const lines = [
    `# Behaviour inventory of ${spec.agent}. Every name in it is fictional.`,
    `channels: [${spec.channels.join(', ')}]`,
    '',
    'behaviours:',
  ];
  for (const behaviour of spec.behaviours) {
    lines.push(`  - id: ${behaviour.id}`, `    title: ${scalar(behaviour.title)}`);
    if (behaviour.channels) lines.push(`    channels: [${behaviour.channels.join(', ')}]`);
  }
  lines.push('', 'flows:');
  for (const flow of spec.flows) {
    lines.push(
      `  - id: ${flow.id}`,
      `    title: ${scalar(flow.title)}`,
      `    behaviours: [${flow.behaviours.join(', ')}]`,
    );
    if (flow.deviations.length > 0) lines.push(`    deviations: [${flow.deviations.join(', ')}]`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderTools(spec: HiddenSpec): string {
  const lines = [`# The tools of ${spec.agent} as JSON Schema. Every name in it is fictional.`, 'tools:'];
  for (const tool of spec.tools) {
    lines.push(`  - name: ${tool.name}`, `    description: ${scalar(tool.description)}`);
    lines.push('    input_schema:', ...objectSchema(tool.input, 6, false));
    lines.push('    output_schema:', ...objectSchema(tool.output, 6, false));
  }
  return `${lines.join('\n')}\n`;
}

function objectSchema(args: readonly HiddenArg[], indent: number, closed: boolean): string[] {
  const pad = ' '.repeat(indent);
  const lines = [`${pad}type: object`];
  if (closed) lines.push(`${pad}additionalProperties: false`);
  lines.push(
    `${pad}required: [${args
      .filter((arg) => arg.required)
      .map((arg) => arg.name)
      .join(', ')}]`,
  );
  lines.push(`${pad}properties:`);
  for (const arg of args) lines.push(...property(arg, indent + 2));
  return lines;
}

function property(arg: HiddenArg, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const schema = arg.schema;
  switch (schema.type) {
    case 'enum':
      return [`${pad}${arg.name}: { type: string, enum: [${schema.members.join(', ')}] }`];
    case 'boolean':
      return [`${pad}${arg.name}: { type: boolean }`];
    case 'integer': {
      const bounds = [
        ...(schema.minimum === undefined ? [] : [`minimum: ${schema.minimum}`]),
        ...(schema.maximum === undefined ? [] : [`maximum: ${schema.maximum}`]),
      ];
      return [`${pad}${arg.name}: { ${['type: integer', ...bounds].join(', ')} }`];
    }
    case 'string': {
      const keys = [
        'type: string',
        ...(schema.minLength === undefined ? [] : [`minLength: ${schema.minLength}`]),
        ...(schema.maxLength === undefined ? [] : [`maxLength: ${schema.maxLength}`]),
        ...(schema.format === undefined ? [] : [`format: ${schema.format}`]),
      ];
      return [`${pad}${arg.name}: { ${keys.join(', ')} }`];
    }
    case 'open':
      return [`${pad}${arg.name}: { type: string }`];
    case 'array': {
      const keys = ['type: array', 'items: { type: string }'];
      if (schema.maxItems !== undefined) keys.push(`maxItems: ${schema.maxItems}`);
      return [`${pad}${arg.name}: { ${keys.join(', ')} }`];
    }
    case 'object': {
      const lines = [`${pad}${arg.name}:`];
      const body = objectSchema(schema.children, indent + 2, false);
      if (schema.nullable) body[0] = `${' '.repeat(indent + 2)}type: [object, 'null']`;
      return [...lines, ...body];
    }
  }
}
