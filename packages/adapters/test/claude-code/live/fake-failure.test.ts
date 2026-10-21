import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TurnNotRun } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { expect, it } from 'vitest';
import { claudeCodeLiveAdapter } from '../../../src/claude-code/live';
import { ASK_INVOICE, FAKE, givenOf, scratch, turnOf } from './support';

it('runs no turn, with the reason, when the stand-in cannot resolve a skill obligation: never an error', async () => {
  const work = await scratch();
  const estateRoot = join(work.dir, 'estate');
  const skill = join(estateRoot, '.claude/skills/invoice-audit');
  await mkdir(skill, { recursive: true });
  await writeFile(join(estateRoot, 'CLAUDE.md'), '# Fictional invoice assistant\n');
  await writeFile(
    join(skill, 'SKILL.md'),
    [
      '---',
      'name: invoice-audit',
      'description: Match supplier invoice amounts with order amounts.',
      '---',
      'Before publishing the package, read `references/policy.md`.',
    ].join('\n'),
  );
  // The stand-in is handed the map of its estate: one route atom that declares the ask and names the skill, with
  // the span and hash the map records for the description line.
  const quote = 'description: Match supplier invoice amounts with order amounts.';
  const file = '.claude/skills/invoice-audit/SKILL.md';
  const map = join(work.dir, 'fake-map.json');
  await writeFile(
    map,
    JSON.stringify({
      atoms: [
        {
          id: 'route.invoice-audit',
          kind: 'route',
          provenance: {
            file,
            quote,
            startLine: 3,
            endLine: 3,
            hash: createHash('sha256').update(`${file}\n3-3\n${quote}`).digest('hex'),
          },
          fields: { target: 'invoice-audit', targetKind: 'skill', ask: { text: ASK_INVOICE } },
        },
      ],
    }),
  );
  const adapter = claudeCodeLiveAdapter({
    command: FAKE,
    env: { FAKE_MAP: map },
    estateRoot,
    provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
    config: 'isolated',
  });
  const given = givenOf();
  const session = await adapter.open(given);
  try {
    const sent = adapter.send(session, turnOf(0, ASK_INVOICE, given));
    await expect(sent).rejects.toBeInstanceOf(TurnNotRun);
    await sent.catch((error: TurnNotRun) => {
      expect(error.notRun).toMatchObject({
        kind: 'unsupported',
        layer: 'runtime',
        check: 'skill obligation',
      });
      expect(error.notRun.got).toContain('ordering obligation');
    });
  } finally {
    await adapter.close(session);
    await work.done();
  }
});
