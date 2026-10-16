import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// What a read-before sentence must name to become a gate, and what kind of sentence it must be: an
// instruction to the agent that names a file, a skill or a document of the estate. Hand-written wordings.
async function gates(lines: string[]) {
  const root = await estate({
    'CLAUDE.md': `${lines.join('\n')}\n`,
    'policy.md': '# Policy\n',
    'notes/style guide.md': '# Style\n',
    '.claude/skills/editor/SKILL.md': '---\nname: editor\ndescription: Edit an index\n---\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate').map((atom) => atom.provenance.quote);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const ACTS = ['editing the index', 'you run a migration', 'each deploy'];
const frames: Array<(target: string, act: string) => string> = [
  (t, a) => `Before ${a}, read ${t}.`,
  (t, a) => `Before ${a}: read ${t}.`,
  (t, a) => `Before ${a} read ${t}`,
  (t, a) => `Prior to ${a}, read ${t}.`,
  (t, a) => `Read ${t} before ${a}.`,
  (t, a) => `Read ${t} first, then edit the index and ${a}.`,
  (t, a) => `Never ${a.replace(/^you /, '')} until you have read ${t}.`,
];

describe('a read target must be a reference', () => {
  const vague = [
    'it',
    'them',
    'this',
    'this carefully',
    'that',
    'everything',
    'all of it',
    'anything relevant',
    'whatever applies',
    'carefully',
    'more',
    'the rest',
    'both',
    'the file',
    'the files',
    'the docs',
    'the code',
    'the relevant files',
    'what the user asked',
    'the surrounding context',
    'the error',
    'up',
    'up on the policy',
    'up on policy',
    'about the policy',
    'on the policy',
  ];
  it('gives no gate for a pronoun, a vague word or a phrasal verb', async () => {
    const lines = vague.flatMap((target) => ACTS.flatMap((act) => frames.map((frame) => frame(target, act))));
    const found = await gates(lines);
    expect(found).toEqual([]);
  });

  const urls = [
    'https://example.com/policy.md',
    'http://example.com/docs/policy.md',
    '<https://example.com/policy.md>',
    '`https://example.com/policy.md`',
    '[the policy](https://example.com/policy.md)',
    'www.example.com/policy.md',
    'ftp://example.com/policy.md',
  ];
  it('gives no gate for a web address', async () => {
    const lines = urls.flatMap((target) => ACTS.flatMap((act) => frames.map((frame) => frame(target, act))));
    expect(await gates(lines)).toEqual([]);
  });

  it('keeps the gate for a file, a path, a skill and a named document', async () => {
    const wanted = [
      'Before editing the index, read policy.md.',
      'Before editing the index, read `policy.md`.',
      'Before editing the index, read `notes/style guide.md`.',
      'Before editing the index, read notes/style guide.md.',
      'Before editing the index, read the policy.',
      'Before editing the index, read the policy document.',
      'Before editing the index, read the style guide.',
      'Before editing the index, read the editor skill.',
      'Before editing the index, read [the policy](policy.md).',
      'Read `policy.md` before you run a migration.',
    ];
    expect(await gates(wanted)).toEqual(wanted);
  });
});

describe('a gate is an instruction to the agent', () => {
  const habits = [
    'We read policy.md before deploying every release at the weekly meeting.',
    'We usually read policy.md before editing the index.',
    'We always read policy.md before editing the index.',
    'Our editors read policy.md before editing the index.',
    'Reviewers read policy.md before editing the index.',
    'The team lead reads policy.md before editing the index.',
    'I read policy.md before editing the index.',
    'They read policy.md before editing the index.',
    'Most contributors read policy.md before editing the index.',
    'Before editing the index, we read policy.md.',
    'Before each deploy, our editors read policy.md.',
    'Maintainers typically read policy.md before editing the index.',
    'Nobody needs to read policy.md before editing the index.',
    'No one reads policy.md before editing the index.',
  ];
  it('gives no gate for a description of habit', async () => {
    expect(await gates(habits)).toEqual([]);
  });

  const optional = [
    'It is fine to read policy.md before editing the index, but not required.',
    'You may read policy.md before editing the index, but it is not required.',
    'You may read policy.md before editing the index.',
    'You can read policy.md before editing the index.',
    'You might read policy.md before editing the index.',
    'Feel free to read policy.md before editing the index.',
    'It is fine to read policy.md before editing the index.',
    'It is okay to read policy.md before editing the index.',
    'It is good practice to read policy.md before editing the index.',
    'It helps to read policy.md before editing the index.',
    'Consider reading policy.md before editing the index.',
    'Reading policy.md before editing the index is optional.',
    'Optionally, read policy.md before editing the index.',
    'Read policy.md before editing the index if you like.',
    'Read policy.md before editing the index if you want to.',
    'Read policy.md before editing the index; this is not required.',
    'Read policy.md before editing the index (not mandatory).',
    'Before editing the index, read policy.md, but this is not necessary.',
    'Before editing the index, it is fine to read policy.md.',
    'Before editing the index, you may read policy.md.',
  ];
  it('gives no gate for an optional or merely allowed read', async () => {
    expect(await gates(optional)).toEqual([]);
  });

  it('keeps the gate for an instruction in any voice', async () => {
    const wanted = [
      'Read policy.md before editing the index.',
      'Always read policy.md before editing the index.',
      'You must read policy.md before editing the index.',
      'You should read policy.md before editing the index.',
      'The assistant must read policy.md before editing the index.',
      'We need to read policy.md before editing the index.',
      'Make sure you read policy.md before editing the index.',
      'Be sure to read policy.md before editing the index.',
      'Remember to read policy.md before editing the index.',
      'It is essential to read policy.md before editing the index.',
      'For every draft read policy.md before editing the index.',
      'In this repository, always read policy.md before editing the index.',
      'Editors: read policy.md before editing the index.',
    ];
    expect(await gates(wanted)).toEqual(wanted);
  });
});
