import { createHash } from 'node:crypto';
import { cp, lstat, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AgentFailure } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCodeLiveAdapter } from '../../../src/claude-code/live';
import { ASK_INVOICE, ESTATE, FAKE, FAKE_RECORDINGS, givenOf, MAP_HASH, scratch, turnOf } from './support';

/**
 * The live runner on an estate whose CLAUDE.md and .claude/skills are symbolic links to a real folder: the
 * copy in the sandbox holds real files, so nothing the runner or the agent writes there reaches the real
 * folder; a write the runner makes into the copy checks it stays inside.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        out[relative(dir, full)] = createHash('sha256')
          .update(await readFile(full))
          .digest('hex');
    }
  };
  await walk(dir);
  return out;
}

async function links(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if ((await lstat(full)).isSymbolicLink()) out.push(relative(dir, full));
      else if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return out;
}

describe('a symlinked estate in the live runner', () => {
  it('copies real files, and a planted file over CLAUDE.md and a skill never reaches the real folder', async () => {
    const work = await scratch();
    cleanups.push(work.done);
    const real = join(work.dir, 'real');
    const estate = join(work.dir, 'estate');
    await cp(join(ESTATE, 'CLAUDE.md'), join(real, 'CLAUDE.md'));
    await cp(join(ESTATE, '.claude', 'skills'), join(real, 'skills'), { recursive: true });
    await cp(join(ESTATE, '.claude'), join(estate, '.claude'), { recursive: true });
    await rm(join(estate, '.claude', 'skills'), { recursive: true });
    await symlink(join(real, 'skills'), join(estate, '.claude', 'skills'));
    await symlink(join(real, 'CLAUDE.md'), join(estate, 'CLAUDE.md'));
    const before = await tree(real);
    const adapter = claudeCodeLiveAdapter({
      command: FAKE,
      estateRoot: estate,
      provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
      keep: true,
      stateDir: join(work.dir, 'state'),
      env: { ...FAKE_RECORDINGS, FAKE_CALLS: work.calls },
      retries: { max: 1, backoffMs: 0 },
      pins: [MAP_HASH],
      config: 'isolated',
      ops: (turn) =>
        turn.index === 0
          ? [
              { op: 'plant', path: 'CLAUDE.md', content: '# Another estate\n' },
              { op: 'plant', path: '.claude/skills/weekly-report/SKILL.md', content: 'planted\n' },
            ]
          : [],
    });
    const given = givenOf();
    const session = await adapter.open(given);
    const [folder] = await readdir(join(work.dir, 'sandboxes'));
    const copy = join(work.dir, 'sandboxes', folder ?? '');
    expect(await links(copy)).toEqual([]);
    await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    await adapter.close(session);
    expect(await readFile(join(copy, 'CLAUDE.md'), 'utf8')).toBe('# Another estate\n');
    expect(await tree(real)).toEqual(before);
  });

  it('refuses a planted file whose path leaves the copy through a link', async () => {
    const work = await scratch();
    cleanups.push(work.done);
    const outside = join(work.dir, 'outside');
    await cp(join(ESTATE, 'CLAUDE.md'), join(outside, 'CLAUDE.md'));
    const before = await tree(outside);
    const adapter = claudeCodeLiveAdapter({
      command: FAKE,
      estateRoot: ESTATE,
      provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
      stateDir: join(work.dir, 'state'),
      env: { ...FAKE_RECORDINGS, FAKE_CALLS: work.calls },
      pins: [MAP_HASH],
      config: 'isolated',
      ops: () => [{ op: 'plant', path: 'escape/CLAUDE.md', content: 'x\n' }],
    });
    const given = givenOf();
    const session = await adapter.open(given);
    cleanups.push(() => adapter.close(session));
    const [folder] = await readdir(join(work.dir, 'sandboxes'));
    await symlink(outside, join(work.dir, 'sandboxes', folder ?? '', 'escape'));
    await expect(adapter.send(session, turnOf(0, ASK_INVOICE, given))).rejects.toBeInstanceOf(AgentFailure);
    expect(await tree(outside)).toEqual(before);
  });
});
