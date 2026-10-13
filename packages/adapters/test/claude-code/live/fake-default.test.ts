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

const orderedBodies = [
  [
    'before above command',
    'Before running the check, read `references/policy.md`.\nRun `node scripts/check.mjs`.',
  ],
  [
    'before below command',
    'Run `node scripts/check.mjs`.\nBefore running the check, read `references/policy.md`.',
  ],
  [
    'before in another section',
    '## Work\nRun `node scripts/check.mjs`.\n\n## Prerequisites\nRead `references/policy.md` before running the check.',
  ],
  ['after prefix', 'After reading `references/policy.md`, run `node scripts/check.mjs`.'],
  ['only after suffix', 'Run `node scripts/check.mjs` only after reading `references/policy.md`.'],
  [
    'only after prefix below command',
    'Run `node scripts/check.mjs`.\nOnly after reading `references/policy.md`, run the check.',
  ],
  [
    'first in a later section',
    '## Work\nRun `node scripts/check.mjs`.\n## Setup\nFirst read `references/policy.md`.',
  ],
  ['first then on one line', 'First read `references/policy.md`, then run `node scripts/check.mjs`.'],
  ['until suffix', 'Do not run `node scripts/check.mjs` until you have read `references/policy.md`.'],
  [
    'until relation below command',
    'Run `node scripts/check.mjs`.\nNever run the check until `references/policy.md` has been read.',
  ],
] as const;

it.each(orderedBodies)('obeys the wording of %s', async (_name, body) => {
  const work = await estate('invoice-audit', body);
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
  expect(used[1].input.file_path).toBe(join(work.dir, '.claude/skills/invoice-audit/references/policy.md'));
  expect(used[2].input.command).toBe('node .claude/skills/invoice-audit/scripts/check.mjs');
});

it('applies two obligations to one command across sections, without repeating the command', async () => {
  const work = await estate(
    'invoice-audit',
    [
      '## Work',
      'Run `node scripts/check.mjs`.',
      '## Rules',
      'Read `references/policy.md` before running the check.',
      '## Limits',
      'Only after reading `references/limits.md`, run the check.',
    ].join('\n'),
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/references/limits.md'),
    'Limits for this estate.',
  );
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Read', 'Bash']);
  expect(used.slice(1, 3).map((call) => call.input.file_path)).toEqual([
    join(work.dir, '.claude/skills/invoice-audit/references/policy.md'),
    join(work.dir, '.claude/skills/invoice-audit/references/limits.md'),
  ]);
});

it('applies after in the reverse direction when the command produces the reference', async () => {
  const work = await estate(
    'invoice-audit',
    'Read `references/policy.md` only after running `node scripts/check.mjs`.',
  );
  const script = join(work.dir, '.claude/skills/invoice-audit/scripts/check.mjs');
  await writeFile(
    script,
    'import {writeFileSync} from "node:fs"; writeFileSync(".claude/skills/invoice-audit/references/policy.md", "Produced by the command.");',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
  expect(JSON.stringify(records)).toContain('Produced by the command.');
});

it('keeps source order for actions with no ordering words', async () => {
  const work = await estate('invoice-audit', 'Run `node scripts/check.mjs`.\nRead `references/policy.md`.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
});

it('binds an obligation to its named command, not every command', async () => {
  const work = await estate(
    'invoice-audit',
    [
      'Run `node scripts/prepare.mjs`.',
      'Run `node scripts/check.mjs`.',
      'Before running the check, read `references/policy.md`.',
    ].join('\n'),
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/prepare.mjs'),
    'console.log("prepared");',
  );
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read', 'Bash']);
  expect(used[1].input.command).toContain('scripts/prepare.mjs');
  expect(used[3].input.command).toContain('scripts/check.mjs');
});

it('keeps the exact reviewed cjs gate before its command in either placement', async () => {
  const gate = 'Before running the check, read `references/policy.md`.';
  const command = 'Run `node scripts/check.cjs`.';
  for (const body of [`${gate}\n${command}`, `${command}\n${gate}`]) {
    const work = await estate('invoice-audit', body);
    await writeFile(
      join(work.dir, '.claude/skills/invoice-audit/scripts/check.cjs'),
      'console.log("checked");',
    );
    const used = calls(play(work.dir));
    expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
    expect(used[2].input.command).toBe('node .claude/skills/invoice-audit/scripts/check.cjs');
  }
});

it.each([
  'Run `node scripts/check.mjs`.\nRead `references/policy.md` first.',
  'Run `node scripts/check.mjs`.\nBefore running the check read `references/policy.md`.',
])('supports ordering words without relying on comma placement: %s', async (body) => {
  const work = await estate('invoice-audit', body);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
});

it('requires both prerequisites in one only-after clause', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs` only after reading `references/policy.md` and `references/limits.md`.',
  );
  await writeFile(join(work.dir, '.claude/skills/invoice-audit/references/limits.md'), 'Limits.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Read', 'Bash']);
});

it('does not execute a command whose required file cannot be read', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nBefore running the check, read `references/missing.md`.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Read']);
  expect(JSON.stringify(records)).toContain('File not found: references/missing.md');
  expect(JSON.stringify(records)).not.toContain('checked this estate');
});

it('does not execute a command when a hook blocks its required read', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nNever run the check until `references/policy.md` has been read.',
  );
  await writeFile(
    join(work.dir, '.claude/settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'exit 2' }] }] },
    }),
  );
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read']);
});

it('stops on contradictory obligations instead of choosing a source order', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs` before reading `references/policy.md`.\nRead `references/policy.md` before running the check.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('contradictory ordering obligations');
});

it('stops when an ordering clause cannot identify its action', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nBefore publishing the package, read `references/policy.md`.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('actions cannot be resolved');
});

it.each([
  'Run `node scripts/check.mjs`.\nNever run the check before reading `references/policy.md`.',
  'Run `node scripts/check.mjs`.\nBefore reading `references/policy.md`, do not run the check.',
])('treats a prohibition before a prerequisite as a gate: %s', async (body) => {
  const work = await estate('invoice-audit', body);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
});

it('applies first in a first-then clause ahead of unrelated earlier actions', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/prepare.mjs`.\nFirst read `references/policy.md`, then run `node scripts/check.mjs`.',
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/prepare.mjs'),
    'console.log("prepared");',
  );
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash', 'Bash']);
  expect(used[2].input.command).toContain('scripts/prepare.mjs');
  expect(used[3].input.command).toContain('scripts/check.mjs');
});

it.each([
  [
    'Run `node scripts/check.mjs --label after reading`.\nRead `references/policy.md`.',
    'node .claude/skills/invoice-audit/scripts/check.mjs --label after reading',
  ],
  [
    'After running `node scripts/check.mjs --label after,reading`, read `references/policy.md`.',
    'node .claude/skills/invoice-audit/scripts/check.mjs --label after,reading',
  ],
])('keeps quoted arguments out of the ordering grammar: %s', async (body, command) => {
  const work = await estate('invoice-audit', body);
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
  expect(used[1].input.command).toBe(command);
});

it('does not turn a plain prohibition into a gate from a quoted argument', async () => {
  const work = await estate('invoice-audit', 'Never run `node scripts/check.mjs --label before reading`.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});
