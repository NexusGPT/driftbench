import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { answer, estate, NOW } from '../support';

/**
 * Lines that look like what code reads and are not: a hazard word in a quoted sample, a script's name in
 * passing, a file named in a change note, a form number that reads like a rule label, a
 * guard message that quotes only a rule's condition. Each decoy sits beside the real form it imitates, which
 * must still be read.
 */

const skill = (name: string, body: string[]) =>
  `---\nname: ${name}\ndescription: Handles ${name} work for the team.\n---\n\n${body.join('\n')}\n`;

async function scan(files: Record<string, string>, port?: FakeModelPort) {
  const root = await estate(files);
  return (await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW, ...(port ? { port } : {}) }))
    .map;
}

const SETTINGS = (scripts: string[]) =>
  JSON.stringify({
    hooks: {
      Stop: scripts.map((script) => ({
        hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR"/.claude/guards/${script}` }],
      })),
    },
  });

/** The rules of a CLAUDE.md written as `- **Rn.** text`, each split by a fake model with its own words. */
function rulesPort(rules: string[]): FakeModelPort {
  return new FakeModelPort([
    answer(
      'CLAUDE.md',
      rules.map((quote, index) => ({
        kind: 'instruction',
        title: `Rule ${index + 1}`,
        quote,
        evidence: [{ type: 'custom', name: `r${index + 1}` }],
      })),
    ),
  ]);
}
const standing = (rules: string[]) =>
  `# Rules\n\n${rules.map((rule, index) => `- **R${index + 1}.** ${rule}`).join('\n')}\n`;

describe('a hazard word inside a quoted sample', () => {
  it('names no hazard when the quotation shows how some text reads', async () => {
    const map = await scan({
      'CLAUDE.md': [
        '# Formats',
        'An error reads like "rate limit exceeded for order 42"; quote it as it is.',
        'A typical log line looks like `worker restarted at 02:00`.',
        'For example, "context compacted" may appear in the export; copy it into the ticket.',
        'Status lines are written like “restart pending (3)” in the console.',
      ].join('\n'),
    });
    expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toEqual([]);
  });
});

describe("a script's name in passing", () => {
  const scripts = async (body: string[]) => {
    const map = await scan({
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/weekly/SKILL.md': skill('weekly', body),
      '.claude/skills/weekly/scripts/report.py': '#!/usr/bin/env python3\n',
      '.claude/skills/weekly/scripts/export.sh': '#!/bin/sh\n',
    });
    return Object.fromEntries(
      map.atoms
        .filter((atom) => atom.kind === 'script')
        .map((atom) => [String(atom.fields?.path).split('/').pop(), atom.provenance.startLine]),
    );
  };

  it('keeps a bare mention as the anchor when no line names the script to run', async () => {
    const lines = await scripts(['Use report.py for the weekly numbers.', 'Call export.sh for a CSV.']);
    expect(lines).toEqual({ 'report.py': 6, 'export.sh': 7 });
  });
});

describe('a file named in a change note', () => {
  it('is no reference when the note reports it removed, deleted, dropped or renamed away', async () => {
    const map = await scan({
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/pricing/SKILL.md': skill('pricing', [
        'Quote prices from the price list.',
        '',
        '## Changelog',
        '',
        '- v3 removed `references/old-pricing.md`.',
        '- `references/draft.txt` was deleted in March.',
        '- Dropped `notes/scratch.md` (merged into the main list).',
        '- `references/v1.md` was renamed to `references/current.md`.',
      ]),
      '.claude/skills/pricing/references/current.md': '# Current\n',
    });
    const paths = map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path);
    expect(paths).toEqual([]);
    expect(map.documents?.find((document) => document.path.endsWith('pricing/SKILL.md'))?.sections).toEqual([
      { startLine: 8, endLine: 14, role: 'changelog' },
    ]);
  });
});
