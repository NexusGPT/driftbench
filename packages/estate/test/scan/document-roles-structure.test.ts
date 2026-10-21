// A document's role comes from what the estate declares, from a recorded label, or from structure; never from a
// word of its folder name, its headings or a line (row cd26c1f1). These tests hold the structure-only reading.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyDocument, RUNTIME_INSTRUCTIONS } from '../../src/scan/document-roles';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'scan', 'document-roles.ts');

describe('the role of a document, with no word read', () => {
  it('gives three paraphrased folders and headings with no word in common the same role: normative', () => {
    const paraphrases = [
      ['examples/sample.md', '# Example usage\n\nRun the report every Monday.\n'],
      ['attic/old-notes.md', '# Change log\n\nSend the invoices on Friday.\n'],
      ['templates/form.md', '# Template\n\nAsk before deleting a file.\n'],
    ] as const;
    for (const [path, text] of paraphrases)
      expect(classifyDocument({ path, text }).role, path).toBe('normative');
  });

  it('never sends a file the runtime loads as instructions to the label pass, and reads its structure', () => {
    // The standing file, memory, a skill body and a helper body are what the runtime gives the agent: the reason
    // marks them so no label is asked; their role is still their structure.
    const plain = '# Rules\n\nAsk before deleting a file.\n';
    const slots = '# Form\n\nClient: {{client}}\nOwner: <owner>\n';
    for (const kind of ['standing', 'memory', 'skill', 'subagent'] as const) {
      expect(classifyDocument({ path: `x/${kind}.md`, text: plain, kind }), kind).toMatchObject({
        role: 'normative',
        reasons: expect.arrayContaining([RUNTIME_INSTRUCTIONS]),
      });
      expect(classifyDocument({ path: `x/${kind}.md`, text: slots, kind }), kind).toMatchObject({
        role: 'template',
        reasons: expect.arrayContaining([RUNTIME_INSTRUCTIONS]),
      });
    }
    // A file beside a skill is read only when told to: it goes to the label pass, so it carries no such reason.
    expect(classifyDocument({ path: 'x/notes.md', text: slots, kind: 'skill_file' }).reasons).not.toContain(
      RUNTIME_INSTRUCTIONS,
    );
    // A declaration still comes first.
    expect(
      classifyDocument({ path: 'CLAUDE.md', text: slots, kind: 'standing' }, undefined, 'example'),
    ).toEqual({
      path: 'CLAUDE.md',
      role: 'example',
      reasons: ['declared in driftbench.estate.yaml'],
    });
  });

  it('gives each of them the role the estate declares, whatever its words', () => {
    for (const [path, role] of [
      ['examples/sample.md', 'example'],
      ['attic/old-notes.md', 'archive'],
      ['notes/anything.md', 'template'],
    ] as const)
      expect(classifyDocument({ path, text: '# Notes\n\nOne line.\n' }, undefined, role)).toMatchObject({
        role,
        reasons: ['declared in driftbench.estate.yaml'],
      });
  });

  it('reads structure: value slots make a template, dated entries a history, a lone cross a counter-example', () => {
    expect(
      classifyDocument({ path: 'a.md', text: '# Report\n\nweek: {{week}}\nowner: {{owner}}\n' }).role,
    ).toBe('template');
    expect(
      classifyDocument({ path: 'b.md', text: '# Decisions\n\n- 2026-10-01 one\n- 2026-10-02 two\n' }).role,
    ).toBe('history');
    const marked = classifyDocument({ path: 'c.md', text: '# Rules\n\nDo this.\n\n✗\n\nDo that instead.\n' });
    expect(marked.role).toBe('normative');
    expect(marked.sections).toEqual([{ startLine: 5, endLine: 7, role: 'example' }]);
  });

  it('holds no word list: no regex of the source alternates English words', () => {
    const source = readFileSync(SOURCE, 'utf8');
    const literals = [...source.matchAll(/\/((?:\\.|[^/\n])+)\/[a-z]*/g)].map((match) => match[1] ?? '');
    // File extensions are machine format, not words: `\.(?:md|markdown|txt)$`.
    const wordy = literals
      .filter((literal) => !literal.startsWith('\\.(?:'))
      .filter((literal) => /(?:^|[(|:])[a-z]{3,}(?:\|[a-z?-]{3,})+/i.test(literal));
    expect(wordy).toEqual([]);
    expect(source).not.toMatch(/\b(?:wrong|incorrect|changelog|journal|archive)s?\b[^\n]*\|/i);
  });
});
