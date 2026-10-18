import type { Expect } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { references } from '../src/checks/references';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const task = acme('acme-price-sheet');
const built = 'I added the Summary sheet to out/acme-price-sheet.xlsx.';
const read = (...paths: string[]) => ({ runtime: { references: paths.map((path) => ({ path })) } });
const wants: Expect = {
  references: [
    { path: '.claude/skills/xlsx/SKILL.md', count: 1 },
    { path: '.claude/skills/xlsx/reference/*.md' },
  ],
};

describe('references', () => {
  it('passes when the skill file and one of its references were read', async () => {
    const ctx = context(
      task,
      1,
      observed(built, [], read('.claude/skills/xlsx/SKILL.md', '.claude/skills/xlsx/reference/formulas.md')),
      {
        expect: wants,
      },
    );
    const verdicts = await run(references, ctx);
    expect(outcomes(verdicts)).toEqual({
      'references..claude/skills/xlsx/SKILL.md': 'pass',
      'references..claude/skills/xlsx/reference/*.md': 'pass',
    });
    expect(verdict(verdicts, 'references..claude/skills/xlsx/reference/*.md').evidence).toBe(
      '.claude/skills/xlsx/reference/*.md read 1 time, expected at least 1; files read in this block: .claude/skills/xlsx/SKILL.md, .claude/skills/xlsx/reference/formulas.md',
    );
  });

  it('mutation: the reference was never read; the verdict fails and names the missing file', async () => {
    const ctx = context(task, 1, observed(built, [], read('.claude/skills/xlsx/SKILL.md')), {
      expect: wants,
    });
    const failed = verdict(await run(references, ctx), 'references..claude/skills/xlsx/reference/*.md');
    expect(failed).toMatchObject({
      outcome: 'fail',
      evidence:
        '.claude/skills/xlsx/reference/*.md read 0 times, expected at least 1; files read in this block: .claude/skills/xlsx/SKILL.md',
    });
  });

  it('applies Count semantics and globs: ** crosses folders, * stays in one', async () => {
    const twice = context(
      task,
      1,
      observed(built, [], read('.claude/skills/xlsx/SKILL.md', '.claude/skills/xlsx/SKILL.md')),
      {
        expect: { references: [{ path: '.claude/skills/xlsx/SKILL.md', count: 1 }] },
      },
    );
    expect((await run(references, twice))[0]?.outcome).toBe('fail');
    const deep = context(task, 1, observed(built, [], read('docs/a/b/c.md')), {
      expect: { references: [{ path: 'docs/**/*.md' }, { path: 'docs/*.md', count: 0 }] },
    });
    expect((await run(references, deep)).map((item) => item.outcome)).toEqual(['pass', 'pass']);
  });

  it('checks nothing when the adapter reports no references list', () => {
    expect(
      references.applies(context(task, 1, observed(built, [], { runtime: {} }), { expect: wants })),
    ).toBe(false);
    expect(references.applies(context(task, 1, observed(built), { expect: wants }))).toBe(false);
  });
});
