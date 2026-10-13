import { chmod, cp, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const SPECS = join(FIXTURE, 'generated/specs/unit');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function specsOf(type: string, name: string): Promise<string[]> {
  return (await readdir(join(SPECS, type)))
    .filter((file) => file.includes(name))
    .map((file) => join(SPECS, type, file));
}

/** A copy of the fixture estate with one file replaced. */
async function variant(path: string, text: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'estate-unit-specs-'));
  for (const name of ['CLAUDE.md', '.claude'])
    await cp(join(FIXTURE, name), join(root, name), { recursive: true });
  await writeFile(join(root, path), text);
  await chmod(join(root, path), 0o755);
  return root;
}

const PUSH = '.claude/guards/block-force-push.sh';
const guardSpecs = async (name: string) =>
  (
    await Promise.all(
      ['guard_negative', 'guard_hostile', 'guard_register', 'guard_speed'].map((type) => specsOf(type, name)),
    )
  ).flat();

describe('driftbench estate unit on the generated unit specs', () => {
  it('judges every unit spec of the Northwind suite on the fixture, with no recorded outcome', async () => {
    const all = (
      await Promise.all((await readdir(SPECS)).map(async (type) => specsOf(type, '.yaml')))
    ).flat();
    const result = await run(['estate', 'unit', ...all, '--estate', FIXTURE, '--json']);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const contract = JSON.parse(result.out);
    expect(Object.keys(contract)).toEqual(['runs', 'guards', 'scripts']);
    expect(contract.runs).toHaveLength(29);
    expect(contract.runs.every((entry: { pass: boolean }) => entry.pass)).toBe(true);
    expect(contract.runs[0].spec).toMatch(/^estate\.contract_alone\./);
    const messages = contract.guards.map(
      (entry: { guard: string; message?: string }) => `${entry.guard}: ${entry.message ?? ''}`,
    );
    expect(messages).toContain('block-force-push.sh: Never run git push --force on any branch.');
    expect(
      messages.some((text: string) =>
        text.startsWith('reply-length.py: Keep every reply under 1,200 characters'),
      ),
    ).toBe(true);
    expect(
      messages.some((text: string) => text.startsWith('ledger-guard.py: never delete a file under ledger/')),
    ).toBe(true);
    expect(
      contract.guards.every((entry: { ms: number }) => Number.isInteger(entry.ms) && entry.ms >= 0),
    ).toBe(true);
    expect(contract.scripts.length).toBeGreaterThan(0);
  }, 240_000);

  it('turns a spec red when the guard allows everything, and when it blocks everything', async () => {
    const specs = await guardSpecs('block-force-push');
    const open = await variant(PUSH, '#!/bin/sh\ncat > /dev/null\nexit 0\n');
    const allowed = await run(['estate', 'unit', ...specs, '--estate', open, '--json']);
    expect(allowed.code).toBe(1);
    const failing = (out: string) =>
      (JSON.parse(out).runs as Array<{ spec: string; pass: boolean; failing: string[] }>)
        .filter((entry) => !entry.pass)
        .map((entry) => entry.spec.split('.')[1]);
    expect(failing(allowed.out)).toEqual(['guard_hostile', 'guard_register', 'guard_speed']);
    const shut = await variant(
      PUSH,
      '#!/bin/sh\ncat > /dev/null\necho "blocked by a broken guard" >&2\nexit 2\n',
    );
    const blocked = await run(['estate', 'unit', ...specs, '--estate', shut, '--json']);
    expect(blocked.code).toBe(1);
    expect(failing(blocked.out)).toEqual(['guard_negative']);
  }, 240_000);

  it('turns the speed spec red when the guard runs past its declared timeout', async () => {
    const specs = await specsOf('guard_speed', 'read-before');
    const slow = await variant(
      '.claude/guards/read-before-edit.py',
      'import sys, time\nsys.stdin.read()\ntime.sleep(7)\nsys.exit(0)\n',
    );
    const result = await run(['estate', 'unit', ...specs, '--estate', slow, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).runs[0].failing.join(' ')).toMatch(
      /custom\.guard_finished: a run was cut at the timeout of 5000 ms/,
    );
  }, 240_000);

  it('turns a script spec red when the script fails, and a helper spec when its file loses its body', async () => {
    const script = await specsOf('script_fixture', 'track-sh');
    const broken = await variant(
      '.claude/skills/shipment-tracker/scripts/track.sh',
      '#!/bin/sh\necho "the script broke" >&2\nexit 1\n',
    );
    expect((await run(['estate', 'unit', ...script, '--estate', broken, '--json'])).code).toBe(1);
    const helper = await specsOf('contract_alone', 'inbox-triager');
    const bare = await variant(
      '.claude/agents/inbox-triager.md',
      '---\nname: inbox-triager\ndescription: A helper.\n---\n',
    );
    const result = await run(['estate', 'unit', ...helper, '--estate', bare]);
    expect(result.code).toBe(1);
    expect(result.out).toContain('holds no body to run as its system prompt');
  }, 240_000);

  it('exits 2 on a spec that is no unit spec, on specs mixed with test files, and on --record', async () => {
    const live = join(FIXTURE, 'generated/specs/live');
    const type = (await readdir(live))[0] as string;
    const spec = join(live, type, (await readdir(join(live, type)))[0] as string);
    const wrong = await run(['estate', 'unit', spec, '--estate', FIXTURE]);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('not a unit-mode spec');
    const unit = (await specsOf('guard_negative', 'block-force-push'))[0] as string;
    const mixed = await run(['estate', 'unit', unit, join(FIXTURE, 'generated/unit'), '--estate', FIXTURE]);
    expect(mixed.code).toBe(2);
    expect((await run(['estate', 'unit', unit, '--estate', FIXTURE, '--record'])).code).toBe(2);
  }, 120_000);
});
