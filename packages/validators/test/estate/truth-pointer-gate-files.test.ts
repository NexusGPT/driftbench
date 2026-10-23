import { rm } from 'node:fs/promises';
import { ClaudeCodeReader, scanEstate } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { writeEstate } from '../../src/ladders/estate/pipeline';
import { truthPointer } from '../../src/ladders/estate/truth-pointer';

const LINE =
  'Before editing a crate: read `references/rules.md`; before sending one: read `references/send.md`.';
const FILES = {
  'CLAUDE.md': `# Gates\n\n${LINE}\n`,
  'references/rules.md': '# R\n',
  'references/send.md': '# S\n',
};

async function gates(reads: [string | undefined, string | undefined]) {
  const root = await writeEstate(FILES);
  try {
    const truth = truthPointer({
      files: FILES,
      atoms: [],
      answers: new Map(),
      gates: [
        {
          file: 'CLAUDE.md',
          line: 3,
          act: 'editing a crate',
          tool: 'Edit',
          ...(reads[0] ? { reads: reads[0] } : {}),
        },
        {
          file: 'CLAUDE.md',
          line: 3,
          act: 'sending one',
          tool: 'Edit',
          ...(reads[1] ? { reads: reads[1] } : {}),
        },
      ],
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), pointer: truth });
    return map.atoms
      .filter((atom) => atom.kind === 'gate')
      .map((atom) => [atom.fields?.first, atom.fields?.trigger]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('the planted gate-each answer lists the act span and the file span of each gate', () => {
  it('gives one gate for each planted gate, each with its own file', async () => {
    expect(await gates(['references/rules.md', 'references/send.md'])).toEqual([
      ['references/rules.md', 'editing a crate'],
      ['references/send.md', 'sending one'],
    ]);
  });

  it('builds no gate from a line of several gates when a planted gate names no file', async () => {
    expect(await gates(['references/rules.md', undefined])).toEqual([]);
  });
});
