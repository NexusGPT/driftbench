import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Section, SourceText } from '../../src/extract';

/** The Acme example folder. */
export const ACME = fileURLToPath(new URL('../../../../examples/acme/', import.meta.url));

/** The Acme sources with the paths the committed proposal records (relative to examples/acme/map). */
export async function acmeSources(): Promise<SourceText[]> {
  const read = (path: string) => readFile(`${ACME}${path}`, 'utf8');
  return [
    { kind: 'prompt', path: '../src/policy.ts', text: await read('src/policy.ts') },
    { kind: 'prompt', path: '../README.md', text: await read('README.md') },
    { kind: 'inventory', path: '../inventory.yaml', text: await read('inventory.yaml') },
    { kind: 'tools', path: 'tools.yaml', text: await read('map/tools.yaml') },
  ];
}

/** A small fictional agent for contract tests: a bank assistant with three stages and two rules. */
export const PROMPT = `You are the Zed Bank assistant.
Stages, in order: greet, verify, help.
Always verify the customer with the last four digits of their card before any balance.
Never give investment advice.
If the customer writes in another language, answer in English.
Example: "What is my balance?"
`;

export const INVENTORY = `channels: [chat, email]
behaviours:
  - id: B-001
    title: Verify the customer before any balance
  - id: B-002
    title: Refuse investment advice
    channels: [chat]
flows:
  - id: balance
    title: A customer asks for their balance
    behaviours: [B-001]
    deviations: [D1_off_topic, D8_tool_failure]
`;

export const SOURCES: SourceText[] = [
  { kind: 'prompt', path: 'prompt.md', text: PROMPT },
  { kind: 'inventory', path: 'inventory.yaml', text: INVENTORY },
];

/** One answer in the contract's JSON, for a section. */
export function answer(
  section: Section,
  body: { dimensions?: unknown[]; constraints?: unknown[]; phrases?: unknown[] } = {},
) {
  return JSON.stringify({
    section,
    dimensions: body.dimensions ?? [],
    constraints: body.constraints ?? [],
    phrases: body.phrases ?? [],
  });
}

/** A value quoted from the prompt. */
export function fromPrompt(id: string, quote: string, title = id) {
  return { id, title, source: 'prompt.md', quote };
}

export const STAGES = answer('stages', {
  dimensions: [
    {
      id: 'stage',
      title: 'The stage a turn ends in',
      kind: 'stage',
      values: [
        fromPrompt('greet', 'Stages, in order: greet, verify, help.'),
        fromPrompt('verify', 'Always verify the customer with the last four digits of their card'),
        fromPrompt('help', 'Stages, in order: greet, verify, help.'),
      ],
    },
  ],
});

export const RULES = answer('rules', {
  dimensions: [
    {
      id: 'rule',
      title: 'Rules',
      kind: 'behaviour',
      values: [fromPrompt('no-investment-advice', 'Never give investment advice.')],
    },
  ],
});

export const PERSONAS = answer('personas', {
  dimensions: [
    {
      id: 'language',
      title: 'The language the customer writes in',
      kind: 'persona',
      values: [
        fromPrompt('english', 'answer in English.'),
        fromPrompt('other', 'If the customer writes in another language'),
      ],
    },
  ],
  constraints: [
    {
      forbid: { language: 'other', channel: 'email' },
      reason: 'invented for the test',
      source: 'prompt.md',
      quote: 'If the customer writes in another language',
    },
  ],
});

export const DATA = answer('data');

export const PHRASES = answer('phrases', {
  phrases: [
    {
      dimension: 'flow',
      value: 'balance',
      text: 'What is my balance?',
      lang: 'en',
      source: 'prompt.md',
      quote: '"What is my balance?"',
    },
    { dimension: 'language', value: 'other', text: 'Quel est mon solde ?', lang: 'fr' },
  ],
});

export const GOOD_ANSWERS = [STAGES, RULES, PERSONAS, DATA, PHRASES];
