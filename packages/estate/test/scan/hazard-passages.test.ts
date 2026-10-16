import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const positives = [
  "After the assistant's context is compacted, reload the observation notebook.",
  'Compaction recovery requires reloading the observation notebook.',
  'Restart handling requires restoring the observation queue.',
  'Treat “context compacted” as a signal to reload the collection record.',
  'When your context is compacted, restore the herbarium catalogue.',
  'After compaction of the context of the assistant, reload the collection record.',
  'When the conversation of the agent is summarized, inspect the unfinished accession.',
  'The preservation guide describes old compactions; when your context is compacted, reload the catalogue.',
  'Compaction ratio is a metric; after your process restarts, restore the collection record.',
  '| When your context is compacted | Read the catalogue | 3 |',
  'If the endpoint answers “too many requests”, retain the accession cursor.',
  'When your process restarted last night, inspect the saved accession.',
  'The helper notification count appears in a graph. When a helper notification arrives, read its result.',
];
const negatives = [
  "The visitor's context is compacted before the catalogue is printed.",
  'Compaction recovery ratio appears in the monitoring export.',
  'Database runs see compactions in their storage layer.',
  'The accession conversation is summarized for the visitor.',
  'The specimen context is summarized on its label.',
  'The publishing service compacted the catalogue archive.',
  'Compaction frequency appears on the graph.',
  'Process restart density is a plotted quantity.',
  'Helper notification amplitude is a reported measurement.',
  'The commentary describes how the assistant restarts.',
  'The appendix records that the assistant receives a helper notification.',
  'For example, your process restarts during the demonstration.',
  '> When your context is compacted, read the catalogue.',
  '“When your context is compacted, read the catalogue.”',
];

describe('hazard passage grammar in a herbarium policy', () => {
  it.each([
    ...positives.map((text) => [text, true] as const),
    ...negatives.map((text) => [text, false] as const),
  ])('%s (runtime event = %s)', async (text, expected) => {
    const root = await estate({ 'CLAUDE.md': `# Collection policy\n${text}` });
    try {
      const scan = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      expect(scan.map.atoms.some((atom) => atom.kind === 'hazard')).toBe(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not interpret frontmatter comments as body headings', async () => {
    const root = await estate({
      '.claude/skills/collect/SKILL.md':
        '---\nname: collect\n# Examples\ndescription: Catalog a specimen.\n---\nWhen your context is compacted, read the collection notebook.',
    });
    try {
      const scan = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      expect(scan.map.atoms.filter((atom) => atom.kind === 'hazard')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps nested example scope across chunks and ends it at the next peer heading', async () => {
    const text = [
      '# Collection policy',
      '## Worked example',
      ...Array.from({ length: 80 }, () => 'The example displays a simulated collection label.'),
      '### Simulated recovery',
      'When your context is compacted, restore the imaginary accession.',
      '## Current recovery',
      'When your context is compacted, read the real collection notebook.',
      '```markdown',
      '## Revision history',
      '```',
      'When your process restarts, inspect the pending accession.',
    ].join('\n');
    const root = await estate({ 'CLAUDE.md': text });
    try {
      const scan = await scanEstate({
        root,
        reader: new ClaudeCodeReader({ chunkCharacters: 500 }),
        now: NOW,
      });
      expect(scan.raw.prose.length).toBeGreaterThan(2);
      expect(
        scan.map.atoms.filter((atom) => atom.kind === 'hazard').map((atom) => atom.provenance.quote),
      ).toEqual([
        'When your context is compacted, read the real collection notebook.',
        'When your process restarts, inspect the pending accession.',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
