// Hand-written inputs, independent of the validator bank. Neutral filenames exercise structure.
const historical = 'After a compaction, read `lost-policy.md` before editing a page.';
export const documents: Record<string, string> = {
  '.claude/skills/editor/references/revisions.md': `# Changelog\n\n## 2025-02-01\n${historical}\n\n## 2025-01-01\nRead \`old-policy.md\`.\n`,
  '.claude/skills/editor/references/events.md': `# History\n\nAppend-only log.\n\n- 2025-01-01: ${historical}\n- 2025-01-02: Read \`old-policy.md\`.\n`,
  '.claude/skills/editor/references/skeleton.md': `# Template\n\nName: <slug>\nDocument: {{document}}\n${historical}\n`,
  '.claude/skills/editor/references/demo.md': `# Example\n\n${historical}\n`,
  '.claude/skills/editor/references/diary.md': `# Journal\n\n## 2025-01-01\n${historical}\n\n## 2025-01-02\nRead \`old-policy.md\`.\n`,
  '.claude/skills/editor/fixtures/input.md': `# Rules\n${historical}\n`,
  '.claude/skills/editor/archive/old.md': `# Rules\n${historical}\n`,
};

/** The roles the estate declares for those documents: a role is never read from a word of a name or heading. */
export const DECLARED_ROLES: Record<string, string> = {
  '.claude/skills/editor/references/revisions.md': 'changelog',
  '.claude/skills/editor/references/events.md': 'history',
  '.claude/skills/editor/references/skeleton.md': 'template',
  '.claude/skills/editor/references/demo.md': 'example',
  '.claude/skills/editor/references/diary.md': 'journal',
  '.claude/skills/editor/fixtures/input.md': 'fixture',
  '.claude/skills/editor/archive/old.md': 'archive',
};

/** The estate configuration that declares them. */
export const DECLARED_CONFIG = `documents:\n${Object.entries(DECLARED_ROLES)
  .map(([path, role]) => `  '${path}': ${role}`)
  .join('\n')}\n`;

export function roleEstateFiles(): Record<string, string> {
  return {
    'CLAUDE.md': '# Rules\n\nRead `.claude/skills/editor/SKILL.md`.\n',
    '.claude/skills/editor/SKILL.md': [
      '---',
      'name: editor',
      'description: Edit pages.',
      '---',
      '',
      '# Page editing',
      'After a compaction, read `references/current.md` before editing a page.',
      'Read `references/missing.md`.',
      'Read `unlocated.md`.',
      'Read `references/<slug>/guide.md`.',
      'Read `references/{{document}}.md`.',
      'Read `tests/fixtures/absent.md`.',
      'For example, read `illustration.md` before editing a page.',
      'e.g. Read `sample.md` before editing a page.',
      '',
      '## Example',
      'After a compaction, read `example-policy.md` before editing a page.',
      '',
      '## Operational rule',
      'Read `references/current.md` before editing a page.',
      ...Object.keys(documents).map((path) => `Read \`${path}\`.`),
    ].join('\n'),
    '.claude/skills/editor/references/current.md':
      '# Current rules\n\nRead `missing-live/guide.md` before editing a page.\n',
    ...documents,
    'driftbench.estate.yaml': DECLARED_CONFIG,
  };
}
