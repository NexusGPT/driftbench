import { helperFile, skillFile } from '../layout';
import { namesFor, order, rule, writeSettings } from './common';
import { type Family, type ItemSpec, itemsOf, type Tier } from './frame';
import { atomOfHid, type Check, PlantedEstate } from './planted';

/**
 * scan.frontmatter: a skill or a helper whose definition uses one frontmatter form. The oracle: the unit atom
 * on its name line (the first line when the name is absent, the folder giving the name), the route atom on
 * the description's key line whose situation is the description's value, the unit's description and tools
 * as written, and the body's first rule found on its line. Values are YAML's where the block is valid YAML;
 * where it is not (a colon followed by a space inside a plain value, the commonest error found on a real
 * estate), the value is the text after the key, as an author means it.
 */

const COMPONENT = 'packages/estate/src/scan/claude-code.ts';

type Line = { text: string; unit?: boolean; route?: boolean };
type Form = {
  key: string;
  tier: Tier;
  title: string;
  unit: 'skill' | 'agent';
  /** The frontmatter lines, `---` included, for a unit name and a sentence. */
  lines(name: string, sentence: string): Line[];
  /** The description a reader must give. */
  description(sentence: string): string;
  tools: string[];
  /** The name the unit takes, when it is not the planted name. */
  named?: (name: string) => string;
  eol?: string;
  prefix?: string;
};

const TOOLS = ['Read', 'Edit', 'Bash'];

function plain(unit: 'skill' | 'agent', extra: Line[] = [], toolsLine?: string): Form['lines'] {
  const key = unit === 'skill' ? 'allowed-tools' : 'tools';
  return (name, sentence) => [
    { text: '---' },
    { text: `name: ${name}`, unit: true },
    { text: `description: ${sentence}`, route: true },
    { text: toolsLine ?? `${key}: ${TOOLS.join(', ')}` },
    ...extra,
    { text: '---' },
  ];
}

const FORMS: Form[] = [
  {
    key: 'plain',
    tier: 1,
    title: 'a plain block',
    unit: 'skill',
    lines: plain('skill'),
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'single-quoted',
    tier: 1,
    title: 'a single-quoted description',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: '${s}'`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'double-quoted-escape',
    tier: 2,
    title: 'a double-quoted description with an escaped quote',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: "${s} Say \\"rush\\" for urgent ones."`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s} Say "rush" for urgent ones.`,
    tools: TOOLS,
  },
  {
    key: 'colon-in-value',
    tier: 3,
    title: 'a plain description holding a colon and a space (not valid YAML)',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: Use when: ${s}`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `Use when: ${s}`,
    tools: TOOLS,
  },
  {
    key: 'colon-twice',
    tier: 4,
    title: 'a description with two colon-space pairs (not valid YAML)',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: Triggers: ${s} Not for: drafts.`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `Triggers: ${s} Not for: drafts.`,
    tools: TOOLS,
  },
  {
    key: 'colon-in-other-key',
    tier: 4,
    title: 'a colon-space pair in another key breaks the block (not valid YAML)',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${s}`, route: true },
      { text: 'argument-hint: file: the record to change' },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'block-literal',
    tier: 2,
    title: 'a literal block description',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: 'description: |', route: true },
      { text: `  ${s}` },
      { text: '  Never for drafts.' },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s}\nNever for drafts.\n`,
    tools: TOOLS,
  },
  {
    key: 'block-folded',
    tier: 2,
    title: 'a folded block description',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: 'description: >', route: true },
      { text: `  ${s}` },
      { text: '  Never for drafts.' },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s} Never for drafts.\n`,
    tools: TOOLS,
  },
  {
    key: 'block-folded-strip',
    tier: 2,
    title: 'a folded block description with the final newline stripped',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: 'description: >-', route: true },
      { text: `  ${s}` },
      { text: '  Never for drafts.' },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s} Never for drafts.`,
    tools: TOOLS,
  },
  {
    key: 'multi-line-plain',
    tier: 2,
    title: 'a plain description continued on the next line',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${s}`, route: true },
      { text: '  Never for drafts.' },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s} Never for drafts.`,
    tools: TOOLS,
  },
  {
    key: 'tools-flow-list',
    tier: 2,
    title: 'tools as a flow list',
    unit: 'skill',
    lines: plain('skill', [], 'allowed-tools: [Read, Grep]'),
    description: (s) => s,
    tools: ['Read', 'Grep'],
  },
  {
    key: 'tools-block-list',
    tier: 2,
    title: 'tools as a block list',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${s}`, route: true },
      { text: 'allowed-tools:' },
      { text: '  - Read' },
      { text: '  - Glob' },
      { text: '---' },
    ],
    description: (s) => s,
    tools: ['Read', 'Glob'],
  },
  {
    key: 'tools-patterns',
    tier: 2,
    title: 'tools with argument patterns holding colons',
    unit: 'skill',
    lines: plain('skill', [], 'allowed-tools: Read, Bash(git log:*), Edit'),
    description: (s) => s,
    tools: ['Read', 'Bash(git log:*)', 'Edit'],
  },
  {
    key: 'crlf',
    tier: 3,
    title: 'a file with carriage-return line endings',
    unit: 'skill',
    lines: plain('skill'),
    description: (s) => s,
    tools: TOOLS,
    eol: '\r\n',
  },
  {
    key: 'byte-order-mark',
    tier: 3,
    title: 'a file that starts with a byte order mark',
    unit: 'skill',
    lines: plain('skill'),
    description: (s) => s,
    tools: TOOLS,
    prefix: '﻿',
  },
  {
    key: 'comments',
    tier: 2,
    title: 'comment lines inside the block',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: '# owner: operations' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${s} # keep short`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'no-name',
    tier: 3,
    title: 'no name key: the folder names the skill',
    unit: 'skill',
    lines: (_name, s) => [
      { text: '---', unit: true },
      { text: `description: ${s}`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'name-not-folder',
    tier: 2,
    title: 'a name other than the folder: the name wins',
    unit: 'skill',
    lines: plain('skill'),
    description: (s) => s,
    tools: TOOLS,
    named: (name) => name,
  },
  {
    key: 'description-first',
    tier: 1,
    title: 'the description before the name',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `description: ${s}`, route: true },
      { text: `name: ${name}`, unit: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'unicode',
    tier: 2,
    title: 'a description with accents and other scripts',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${s} Gère aussi les reçus, 受領書 compris.`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s} Gère aussi les reçus, 受領書 compris.`,
    tools: TOOLS,
  },
  {
    key: 'long-description',
    tier: 3,
    title: 'a description of 1500 characters',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${longer(s)}`, route: true },
      { text: `allowed-tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => longer(s),
    tools: TOOLS,
  },
  {
    key: 'nested-metadata',
    tier: 2,
    title: 'an extra key holding a nested mapping',
    unit: 'skill',
    lines: plain('skill', [
      { text: 'metadata:' },
      { text: '  owner: operations' },
      { text: '  since: 2026' },
    ]),
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'space-before-colon',
    tier: 3,
    title: 'a space before the colon of each key',
    unit: 'skill',
    lines: (name, s) => [
      { text: '---' },
      { text: `name : ${name}`, unit: true },
      { text: `description : ${s}`, route: true },
      { text: `allowed-tools : ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'agent-plain',
    tier: 1,
    title: 'a helper in a plain block with model, effort and skills',
    unit: 'agent',
    lines: plain('agent', [{ text: 'model: sonnet' }, { text: 'effort: low' }]),
    description: (s) => s,
    tools: TOOLS,
  },
  {
    key: 'agent-colon-in-value',
    tier: 3,
    title: 'a helper whose description holds a colon and a space (not valid YAML)',
    unit: 'agent',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: Dispatch it when: ${s}`, route: true },
      { text: `tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `Dispatch it when: ${s}`,
    tools: TOOLS,
  },
  {
    key: 'agent-block-literal',
    tier: 3,
    title: 'a helper whose description is a literal block with examples',
    unit: 'agent',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: 'description: |', route: true },
      { text: `  ${s}` },
      { text: '  Example: the user asks for a count.' },
      { text: `tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `${s}\nExample: the user asks for a count.\n`,
    tools: TOOLS,
  },
  {
    key: 'agent-tools-list',
    tier: 2,
    title: 'a helper whose tools are a block list',
    unit: 'agent',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: ${s}`, route: true },
      { text: 'tools:' },
      { text: '  - Read' },
      { text: '  - Grep' },
      { text: '---' },
    ],
    description: (s) => s,
    tools: ['Read', 'Grep'],
  },
  {
    key: 'agent-quoted-colon',
    tier: 1,
    title: 'a helper whose quoted description holds a colon',
    unit: 'agent',
    lines: (name, s) => [
      { text: '---' },
      { text: `name: ${name}`, unit: true },
      { text: `description: "Dispatch it when: ${s}"`, route: true },
      { text: `tools: ${TOOLS.join(', ')}` },
      { text: '---' },
    ],
    description: (s) => `Dispatch it when: ${s}`,
    tools: TOOLS,
  },
];

function longer(sentence: string): string {
  const filler = ' Each record keeps its own history and its own owner in the team.';
  let text = sentence;
  while (text.length < 1500) text += filler;
  return text.slice(0, 1500).replace(/\s+\S*$/, '.');
}

export const FRONTMATTER_FORMS = FORMS;

function specs(): ItemSpec[] {
  return FORMS.map((form) => ({ key: form.key, tier: form.tier, title: `the reader reads ${form.title}` }));
}

const FAMILY = 'scan.frontmatter';

export function frontmatterFamily(): Family {
  const items = itemsOf(FAMILY, 1, COMPONENT, specs());
  return {
    id: FAMILY,
    level: 1,
    component: COMPONENT,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      writeSettings(estate);
      for (const form of order(seed, FAMILY, FORMS)) plantForm(estate, seed, form, `${FAMILY}.${form.key}`);
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}

/** Plants one unit in a frontmatter form; returns the hidden ids of its unit and route atoms. */
export function plantForm(
  estate: PlantedEstate,
  seed: number,
  form: Form,
  owner: string,
): { unit: string; route: string } {
  const names = namesFor(seed, owner);
  const sentence = `${capital(names.title)} when the user asks to ${names.verb} one.`;
  const folder = form.key === 'name-not-folder' ? `${names.skill}-folder` : names.skill;
  const name = form.key === 'no-name' ? folder : names.skill;
  const path = form.unit === 'skill' ? skillFile(folder, 'SKILL.md') : helperFile(name);
  const writer = estate.file(path, owner);
  if (form.eol) writer.eol = form.eol;
  if (form.prefix) writer.prefix = form.prefix;
  const unit = `${owner}:unit`;
  const route = `${owner}:route`;
  for (const line of form.lines(name, sentence)) {
    writer.line(line.text, [
      ...(line.unit
        ? [{ hid: unit, kind: form.unit === 'skill' ? ('skill' as const) : ('subagent' as const), key: name }]
        : []),
      ...(line.route ? [{ hid: route, kind: 'route' as const, key: name }] : []),
    ]);
  }
  writer.line('');
  const body = rule(`${owner}:rule`, `Always name the ${names.noun} in the first line of the reply.`);
  writer.line(body.text, body.atoms ?? [], body.prose);
  estate.edge(owner, route, unit, 'route');
  const description = form.description(sentence);
  estate.check(owner, situationIs(route, description));
  estate.check(owner, unitField(unit, 'description', description));
  estate.check(owner, unitField(unit, 'tools', form.tools));
  return { unit, route };
}

function situationIs(hid: string, expected: string): Check {
  return (scan) => {
    const atom = atomOfHid(scan, hid);
    if (!atom) return undefined;
    return atom.situation === expected
      ? undefined
      : `the route's situation is ${JSON.stringify(atom.situation)}, expected ${JSON.stringify(expected)}`;
  };
}

function unitField(hid: string, field: string, expected: unknown): Check {
  return (scan) => {
    const atom = atomOfHid(scan, hid);
    if (!atom) return undefined;
    const actual = atom.fields?.[field];
    return JSON.stringify(actual) === JSON.stringify(expected)
      ? undefined
      : `the unit's ${field} is ${JSON.stringify(actual)?.slice(0, 80)}, expected ${JSON.stringify(expected).slice(0, 80)}`;
  };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
