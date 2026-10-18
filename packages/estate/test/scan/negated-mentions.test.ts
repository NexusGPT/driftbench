import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skill = '.claude/skills/reconcile/SKILL.md';
const body = '---\nname: reconcile\ndescription: Reconcile an invoice.\n---\n';
describe('forbidden mentions do not require the forbidden act', () => {
  it('does not create a positive route from a target cell saying never', async () => {
    const root = await estate({
      [skill]: body,
      'CLAUDE.md': '| When | Load |\n|---|---|\n| discuss the weather | nothing, never `reconcile` |\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'route' && a.fields?.via === 'table')).toEqual([]);
  });
  it('does not add a dispatch edge when the helper dispatch is forbidden', async () => {
    const root = await estate({
      [skill]: `${body}Never dispatch the \`auditor\` agent for this.`,
      '.claude/agents/auditor.md': '---\nname: auditor\ndescription: Audit an invoice.\n---\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.edges.filter((edge) => edge.kind === 'dispatch')).toEqual([]);
  });
  it('does not turn a forbidden read into a positive reference', async () => {
    const root = await estate({
      [skill]: `${body}Do not read \`references/private.md\` under any condition.`,
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference')).toEqual([]);
  });
  it('keeps an affirmative read after but or until, and does not confuse never forget with never read', async () => {
    const root = await estate({
      [skill]:
        body +
        [
          'Never read `references/private.md`, but read `references/real.md`.',
          'Do not edit an invoice until you have read `references/real.md`.',
          'Never forget to read `references/real.md`.',
        ].join('\n'),
      '.claude/skills/reconcile/references/real.md': '# Real\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference').map((a) => a.fields?.path)).toEqual([
      '.claude/skills/reconcile/references/real.md',
      '.claude/skills/reconcile/references/real.md',
      '.claude/skills/reconcile/references/real.md',
    ]);
  });
  it('keeps a later affirmative dispatch of a helper mentioned in an earlier prohibition', async () => {
    const root = await estate({
      [skill]: `${body}Never dispatch the \`auditor\` for a weather question\nDispatch the \`auditor\` for the invoice`,
      '.claude/agents/auditor.md': '---\nname: auditor\ndescription: Audit an invoice.\n---\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.edges.filter((edge) => edge.kind === 'dispatch')).toHaveLength(1);
  });

  it('recognizes a curly-apostrophe prohibition', async () => {
    const root = await estate({ [skill]: `${body}Don’t read \`references/private.md\`.` });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference')).toEqual([]);
  });
});
