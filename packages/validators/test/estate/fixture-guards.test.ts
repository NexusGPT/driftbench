import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cli, REPO } from '../../src/ladders/estate/bank/bench';

const ESTATES = join(REPO, 'examples/estates');
const folders: string[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop() as string, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fixture-guards-'));
  folders.push(dir);
  return dir;
}

/**
 * What the estate unit runner records for a guard of an estate given one reply. The runner sends a Stop guard
 * the reply the way the runtime does, as `last_assistant_message`, so the decision is what the guard would give
 * on a real Stop event.
 */
async function decide(estate: string, script: string, reply: string): Promise<string> {
  const dir = await scratch();
  const file = join(dir, 'test.json');
  await writeFile(
    file,
    JSON.stringify({
      id: 'unit.guard_positive.stop',
      planRow: 'guard_positive.stop',
      mapHash: 'none',
      testType: 'guard_positive',
      atom: 'guard.stop',
      title: 'Stop guard',
      target: {
        kind: 'guard',
        name: script,
        event: 'Stop',
        command: `python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/${script}`,
      },
      cases: [{ id: 'case-01', payload: { stop_hook_active: false, last_reply: reply }, material: reply }],
    }),
  );
  const run = cli(['estate', 'unit', file, '--estate', estate, '--record', '--json']);
  expect(run.code, run.out).toBeLessThanOrEqual(1);
  const recorded = JSON.parse(await readFile(file, 'utf8')) as {
    cases: Array<{ expected?: { decision: string } }>;
  };
  return recorded.cases[0]?.expected?.decision ?? 'unrecorded';
}

describe('the Stop guards of the example estates read the reply the runtime sends', {
  timeout: 120_000,
}, () => {
  it('blocks a reply past its limit and lets a short one through, in each estate', async () => {
    const long = `${'word '.repeat(300)}done.`;
    expect(await decide(join(ESTATES, 'fixture'), 'reply-length.py', long)).toBe('deny');
    expect(await decide(join(ESTATES, 'fixture'), 'reply-length.py', 'Done.')).toBe('allow');
    expect(await decide(join(ESTATES, 'fixture-v2'), 'reply-length.py', long)).toBe('deny');
    expect(await decide(join(ESTATES, 'fixture-v2'), 'reply-length.py', 'Done.')).toBe('allow');
    const refund = 'Your refund will arrive on 5 May, we promise.';
    expect(await decide(join(ESTATES, 'reader-cases'), 'claim-window.py', refund)).toBe('deny');
    expect(await decide(join(ESTATES, 'reader-cases'), 'claim-window.py', 'Done.')).toBe('allow');
  });

  it('would let the long reply through if the guard read the field the runtime does not send', async () => {
    const copy = join(await scratch(), 'fixture');
    await cp(join(ESTATES, 'fixture'), copy, { recursive: true });
    const script = join(copy, '.claude/guards/reply-length.py');
    const source = await readFile(script, 'utf8');
    await writeFile(script, source.replace('last_assistant_message', 'last_reply'));
    expect(await decide(copy, 'reply-length.py', `${'word '.repeat(300)}done.`)).toBe('allow');
  });

  it('has no guard in any example estate that reads a reply from a field the runtime never sends', async () => {
    for (const name of await readdir(ESTATES)) {
      const dir = join(ESTATES, name, '.claude/guards');
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const file of files.filter((entry) => entry.endsWith('.py'))) {
        const source = await readFile(join(dir, file), 'utf8');
        expect(source, `${name}/${file}`).not.toMatch(/["']last_reply["']/);
      }
    }
  });
});
