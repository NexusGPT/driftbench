import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ASK_INVOICE, ESTATE, FAKE, scratch } from './support';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function estate(folder: string, body: string) {
  const work = await scratch();
  cleanups.push(work.done);
  const unit = join(work.dir, '.claude/skills', folder);
  await mkdir(join(unit, 'references'), { recursive: true });
  await mkdir(join(unit, 'scripts'), { recursive: true });
  await writeFile(
    join(unit, 'SKILL.md'),
    `---\nname: ${folder}\ndescription: Match supplier invoice amounts with order amounts.\n---\n${body}\n`,
  );
  await writeFile(join(unit, 'references/policy.md'), 'Read from this estate.\n');
  await writeFile(join(unit, 'scripts/check.mjs'), 'console.log("checked this estate");\n');
  return { ...work, dir: await realpath(work.dir) };
}

function play(cwd: string, manifest?: string, env: Record<string, string> = {}) {
  const output = execFileSync(process.execPath, [FAKE, '-p', ASK_INVOICE], {
    cwd,
    env: {
      PATH: process.env.PATH,
      ...env,
      CLAUDE_CONFIG_DIR: join(cwd, 'config'),
      ...(manifest ? { FAKE_MANIFEST: manifest } : {}),
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function calls(records: ReturnType<typeof play>) {
  return records.flatMap((row) =>
    Array.isArray(row.message?.content)
      ? row.message.content.filter((part: { type: string }) => part.type === 'tool_use')
      : [],
  );
}

it('derives even a previously recorded ask from the estate given to it', async () => {
  for (const name of ['invoice-audit', 'order-check']) {
    const work = await estate(name, 'Read `references/policy.md`.\nRun `node scripts/check.mjs`.');
    const records = play(work.dir);
    const used = calls(records);
    expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
    expect(used[0].input.skill).toBe(name);
    expect(used[1].input.file_path).toBe(join(work.dir, '.claude/skills', name, 'references/policy.md'));
    expect(used[2].input.command).toBe(`node .claude/skills/${name}/scripts/check.mjs`);
    expect(JSON.stringify(records)).toContain('checked this estate');
  }
});

it('does not replay reads or commands absent from the current skill body', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

it('replays an unchanged recording only through an explicit manifest', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  const manifest = join(ESTATE, 'live/fake/manifest.json');
  const recorded = (await readFile(join(ESTATE, 'live/fake/streams/invoice-match.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line.replaceAll('{{cwd}}', work.dir)));
  const actual = play(work.dir, manifest).filter((row) => row.type !== 'system' && row.type !== 'result');
  expect(actual.map(({ session_id: _session, timestamp: _time, ...row }) => row)).toEqual(recorded);
});

it('runs the current hook command and obeys its blocking result', async () => {
  const work = await estate('invoice-audit', 'Read `references/policy.md`.');
  const hook = join(work.dir, '.claude', 'gate.cjs');
  await writeFile(hook, 'process.stderr.write("Read refused by this estate"); process.exit(2);');
  await writeFile(
    join(work.dir, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node .claude/gate.cjs' }] }],
      },
    }),
  );
  const blocked = play(work.dir);
  expect(blocked.find((row) => row.subtype === 'hook_response')).toMatchObject({
    exit_code: 2,
    stderr: 'Read refused by this estate',
  });
  expect(JSON.stringify(blocked)).not.toContain('Read from this estate.');
  await writeFile(hook, 'process.stdout.write("Read accepted by this estate");');
  const allowed = play(work.dir);
  expect(allowed.find((row) => row.subtype === 'hook_response')).toMatchObject({
    exit_code: 0,
    stdout: 'Read accepted by this estate',
  });
  expect(JSON.stringify(allowed)).toContain('Read from this estate.');
});

it('derives helper dispatch from valid metadata and stops dispatching when it disappears', async () => {
  const work = await estate('invoice-audit', 'Dispatch `amount-reader` for the amount check.');
  await mkdir(join(work.dir, '.claude/agents'));
  const helper = join(work.dir, '.claude/agents/amount-reader.md');
  const body =
    '---\nname: amount-reader\ndescription: Compare the amounts in records.\n---\nRead the amounts.\n';
  await writeFile(helper, body);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Agent']);
  await writeFile(helper, body.replace('name: amount-reader\n', ''));
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

it('walks arbitrary estate stage names instead of a fixed recorded sequence', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  const feed = join(work.dir, 'steps.jsonl');
  await writeFile(
    join(work.dir, '.claude/steps.json'),
    JSON.stringify({
      steps: [{ id: 'inspect', next: ['assemble'] }, { id: 'assemble', next: ['finish'] }, { id: 'finish' }],
    }),
  );
  play(work.dir, undefined, { STEP_FEED: feed });
  const stages = (await readFile(feed, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).step);
  expect(stages).toEqual(['inspect', 'assemble', 'finish']);
});
