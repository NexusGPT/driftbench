import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { expect, it } from 'vitest';
import { claudeCodeLiveAdapter } from '../../../src/claude-code/live';
import { ASK_INVOICE, FAKE, givenOf, scratch, turnOf } from './support';

it('fails the cell loudly when the stand-in cannot resolve a skill obligation', async () => {
  const work = await scratch();
  const estateRoot = join(work.dir, 'estate');
  const skill = join(estateRoot, '.claude/skills/invoice-audit');
  await mkdir(skill, { recursive: true });
  await writeFile(join(estateRoot, 'CLAUDE.md'), '# Fictional invoice assistant\n');
  await writeFile(join(skill, 'SKILL.md'), [
    '---',
    'name: invoice-audit',
    'description: Match supplier invoice amounts with order amounts.',
    '---',
    'Before publishing the package, read `references/policy.md`.',
  ].join('\n'));
  const adapter = claudeCodeLiveAdapter({
    command: FAKE,
    estateRoot,
    provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
    config: 'isolated',
  });
  const given = givenOf();
  const session = await adapter.open(given);
  try {
    await expect(adapter.send(session, turnOf(0, ASK_INVOICE, given))).rejects.toThrow('ordering obligation');
  } finally {
    await adapter.close(session);
    await work.done();
  }
});
