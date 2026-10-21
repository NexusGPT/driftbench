import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { type Atom, calls, declare, declared, estate, names, play } from './declared';
import { ESTATE } from './support';

/**
 * The fake's default agent derives its run from the estate copy and the map it is handed: what a loaded skill
 * holds is what the map declares of it, as long as the copy still holds each quote. Everything is fictional.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const SKILL = '.claude/skills/invoice-audit';
const POLICY = `${SKILL}/references/policy.md`;
const CHECK = `${SKILL}/scripts/check.mjs`;
const RUN = 'Run `node scripts/check.mjs`.';
const READ = 'Read `references/policy.md`.';

async function audit(body: string, atoms: Atom[] = [], folder = 'invoice-audit') {
  const work = await estate(folder, body);
  cleanups.push(work.done);
  declare(work, atoms);
  return work;
}

const script = (quote = RUN, path = CHECK) => declared.script(`script.${path}`, quote, path);
const reference = (quote = READ, path = POLICY) => declared.reference(`reference.${path}`, quote, path);

it('derives even a previously recorded ask from the estate given to it', async () => {
  for (const name of ['invoice-audit', 'order-check']) {
    const work = await audit(`${READ}\n${RUN}`, [], name);
    declare(work, [
      reference(READ, `.claude/skills/${name}/references/policy.md`),
      script(RUN, `.claude/skills/${name}/scripts/check.mjs`),
    ]);
    const records = play(work.dir);
    const used = calls(records);
    expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
    expect(used[0]?.input.skill).toBe(name);
    expect(used[1]?.input.file_path).toBe(join(work.dir, '.claude/skills', name, 'references/policy.md'));
    expect(used[2]?.input.command).toBe(`node .claude/skills/${name}/scripts/check.mjs`);
    expect(JSON.stringify(records)).toContain('checked this estate');
  }
});

it('does nothing the map does not declare of the skill', async () => {
  const work = await audit(`Report what can be checked.\n${READ}\n${RUN}`);
  expect(names(play(work.dir))).toEqual(['Skill']);
});

it('stops doing what a declared line said once the copy no longer holds its quote', async () => {
  const work = await audit(`${READ}\n${RUN}`, [reference(), script()]);
  expect(names(play(work.dir))).toEqual(['Skill', 'Read', 'Bash']);
  const file = join(work.dir, SKILL, 'SKILL.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace(RUN, 'Run `node scripts/check.mjs` twice.'));
  expect(names(play(work.dir))).toEqual(['Skill', 'Read']);
});

it('replays an unchanged recording only through an explicit manifest', async () => {
  // The manifest plays the read-first recording while the estate still holds the rule the recording follows.
  const work = await audit('Read `references/matching-rules.md` before matching any line.', [], 'invoice-reconcile');
  const manifest = join(ESTATE, 'live/fake/manifest.json');
  const recorded = (await readFile(join(ESTATE, 'live/fake/streams/invoice-match.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line.replaceAll('{{cwd}}', work.dir)));
  const actual = play(work.dir, { manifest }).filter((row) => row.type !== 'system' && row.type !== 'result');
  expect(actual.map(({ session_id: _session, timestamp: _time, ...row }) => row)).toEqual(recorded);
});

it('runs the current hook command and obeys its blocking result', async () => {
  const work = await audit(READ, [reference()]);
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

it('dispatches the helper a dispatch link names, while the helper is in force', async () => {
  const line = 'Dispatch `amount-reader` for the amount check.';
  const work = await audit(line);
  await mkdir(join(work.dir, '.claude/agents'));
  const helper = join(work.dir, '.claude/agents/amount-reader.md');
  const body = '---\nname: amount-reader\ndescription: Compare the amounts in records.\n---\nRead the amounts.\n';
  await writeFile(helper, body);
  declare(work, [declared.helper('amount-reader'), declared.dispatch('instruction.amounts', line, 'amount-reader')]);
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Agent']);
  expect(used[1]?.input.subagent_type).toBe('amount-reader');
  await writeFile(helper, body.replace('name: amount-reader\n', ''));
  expect(names(play(work.dir))).toEqual(['Skill']);
});

it('walks arbitrary estate stage names instead of a fixed recorded sequence', async () => {
  const work = await audit('Report what can be checked.');
  const feed = join(work.dir, 'steps.jsonl');
  await writeFile(
    join(work.dir, '.claude/steps.json'),
    JSON.stringify({
      steps: [{ id: 'inspect', next: ['assemble'] }, { id: 'assemble', next: ['finish'] }, { id: 'finish' }],
    }),
  );
  play(work.dir, { env: { STEP_FEED: feed } });
  const stages = (await readFile(feed, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).step);
  expect(stages).toEqual(['inspect', 'assemble', 'finish']);
});

it('keeps the order of the lines when no gate orders the actions', async () => {
  const work = await audit(`${RUN}\n${READ}`, [script(), reference()]);
  expect(names(play(work.dir))).toEqual(['Skill', 'Bash', 'Read']);
});

it('puts the read of a gate before every action of the tool its act uses, wherever the gate stands', async () => {
  const gate = 'Before running the check, read `references/policy.md`.';
  for (const body of [`${gate}\n${RUN}`, `${RUN}\n${gate}`, `## Work\n${RUN}\n\n## Prerequisites\n${gate}`]) {
    const work = await audit(body, [script(), reference(gate), declared.gate('gate.policy', gate, POLICY, 'Bash')]);
    const used = calls(play(work.dir));
    expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
    expect(used[1]?.input.file_path).toBe(join(work.dir, POLICY));
    expect(used[2]?.input.command).toBe(`node ${CHECK}`);
  }
});

it('reads the file of a gate that no reference declares, before the act it governs', async () => {
  const gate = 'Policy first.';
  const work = await audit(`${RUN}\n${gate}`, [script(), declared.gate('gate.policy', gate, POLICY, 'Bash')]);
  expect(names(play(work.dir))).toEqual(['Skill', 'Read', 'Bash']);
});

it('applies two gates to one command, each read once', async () => {
  const limits = `${SKILL}/references/limits.md`;
  const first = 'Read `references/policy.md` before running the check.';
  const second = 'Only after reading `references/limits.md`, run the check.';
  const work = await audit(`## Work\n${RUN}\n## Rules\n${first}\n## Limits\n${second}`, [
    script(),
    reference(first),
    reference(second, limits),
    declared.gate('gate.policy', first, POLICY, 'Bash'),
    declared.gate('gate.limits', second, limits, 'Bash'),
  ]);
  await writeFile(join(work.dir, limits), 'Limits for this estate.');
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Read', 'Bash']);
  expect(used.slice(1, 3).map((call) => call.input.file_path)).toEqual([
    join(work.dir, POLICY),
    join(work.dir, limits),
  ]);
});

it('does not order the actions of a tool the gate does not govern', async () => {
  const gate = 'Read `references/policy.md` before matching any line.';
  const work = await audit(`${RUN}\n${gate}`, [
    script(),
    reference(gate),
    declared.gate('gate.policy', gate, POLICY, 'Edit'),
  ]);
  expect(names(play(work.dir))).toEqual(['Skill', 'Bash', 'Read']);
});

it('orders nothing by a gate whose two acts use one tool and that names no calls', async () => {
  const gate = 'Read `references/policy.md` before reading anything else.';
  const other = 'Read `references/other.md`.';
  const work = await audit(`${other}\n${gate}`, [
    reference(other, `${SKILL}/references/other.md`),
    reference(gate),
    declared.gate('gate.policy', gate, POLICY, 'Read'),
  ]);
  await writeFile(join(work.dir, SKILL, 'references/other.md'), 'Other.');
  const used = calls(play(work.dir));
  expect(used.map((call) => call.input.file_path)).toEqual([
    undefined,
    join(work.dir, SKILL, 'references/other.md'),
    join(work.dir, POLICY),
  ]);
});

it('runs the command of a gate before the act it governs, so that the command can produce the file', async () => {
  const gate = 'Read `references/policy.md` only after running `node scripts/check.mjs`.';
  const work = await audit(gate, [
    reference(gate),
    script(gate),
    declared.gateCommand('gate.check', gate, 'node scripts/check.mjs', 'Read'),
  ]);
  await writeFile(
    join(work.dir, CHECK),
    `import {writeFileSync} from "node:fs"; writeFileSync("${POLICY}", "Produced by the command.");`,
  );
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill', 'Bash', 'Read']);
  expect(JSON.stringify(records)).toContain('Produced by the command.');
});

it('orders two calls of one tool by the calls the gate names', async () => {
  const prepare = 'Run `node scripts/prepare.mjs`.';
  const gate = 'Run the check only once the preparation ran.';
  const work = await audit(`${RUN}\n${prepare}\n${gate}`, [
    script(),
    script(prepare, `${SKILL}/scripts/prepare.mjs`),
    declared.gateCalls('gate.calls', gate, 'Bash', 'prepare.mjs', 'check.mjs'),
  ]);
  await writeFile(join(work.dir, SKILL, 'scripts/prepare.mjs'), 'console.log("prepared");');
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash', 'Bash']);
  expect(used[1]?.input.command).toContain('scripts/prepare.mjs');
  expect(used[2]?.input.command).toContain('scripts/check.mjs');
});

it('stops as unresolved when a gate names a call no action holds', async () => {
  const gate = 'Publish the package only after the check.';
  const work = await audit(`${RUN}\n${gate}`, [
    script(),
    declared.gateCalls('gate.calls', gate, 'Bash', 'check.mjs', 'publish'),
  ]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('actions cannot be resolved');
});

it('stops on gates that contradict each other instead of choosing an order', async () => {
  const first = 'Run `node scripts/check.mjs` before reading `references/policy.md`.';
  const second = 'Read `references/policy.md` before running the check.';
  const work = await audit(`${first}\n${second}`, [
    script(first),
    reference(second),
    declared.gateCommand('gate.check', first, 'node scripts/check.mjs', 'Read'),
    declared.gate('gate.policy', second, POLICY, 'Bash'),
  ]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('contradictory ordering obligations');
});

it('does not run a command whose gated file cannot be read', async () => {
  const missing = `${SKILL}/references/missing.md`;
  const gate = 'Before running the check, read `references/missing.md`.';
  const work = await audit(`${RUN}\n${gate}`, [script(), declared.gate('gate.missing', gate, missing, 'Bash')]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill', 'Read']);
  expect(JSON.stringify(records)).toContain(`File not found: ${missing}`);
  expect(JSON.stringify(records)).not.toContain('checked this estate');
});

it('does not run a command when a hook blocks its gated read', async () => {
  const gate = 'Never run the check until `references/policy.md` has been read.';
  const work = await audit(`${RUN}\n${gate}`, [script(), declared.gate('gate.policy', gate, POLICY, 'Bash')]);
  await writeFile(
    join(work.dir, '.claude/settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'exit 2' }] }] },
    }),
  );
  expect(names(play(work.dir))).toEqual(['Skill', 'Read']);
});

it('runs a script with the code span of its own line that names it, without unfilled placeholders', async () => {
  const line = 'Pass the amounts to `node scripts/check.mjs <invoice> <order>` and show what it prints.';
  const work = await audit(line, [script(line)]);
  const used = calls(play(work.dir));
  expect(used[1]?.input.command).toBe(`node ${CHECK}`);
});

it('refuses a call a declared forbid case names, by tool and by glob', async () => {
  const ban = 'Never run `node scripts/check*.mjs`.';
  const prepare = 'Run `node scripts/prepare.mjs`.';
  const work = await audit(`${ban}\n${prepare}\n${RUN}`, [
    declared.ban('instruction.ban', ban, 'Bash', 'node scripts/check*.mjs'),
    script(prepare, `${SKILL}/scripts/prepare.mjs`),
    script(),
  ]);
  await writeFile(join(work.dir, SKILL, 'scripts/prepare.mjs'), 'console.log("prepared");');
  const records = play(work.dir);
  const used = calls(records);
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(used[1]?.input.command).toContain('scripts/prepare.mjs');
  expect(JSON.stringify(records)).not.toContain('checked this estate');
  expect(JSON.stringify(records)).toContain('An estate prohibition forbids this action');
});

it('does not broaden a forbid case to another tool or another target', async () => {
  const ban = 'Never edit `references/policy.md`; never read `references/private-*.md`.';
  const allowed = 'Read `references/private-a.txt`.';
  const work = await audit(`${ban}\n${READ}\n${allowed}`, [
    {
      ...declared.ban('instruction.ban', ban, 'Edit', 'references/policy.md'),
      fields: {
        polarity: 'prohibition',
        unitCases: [
          { effect: 'forbid', tool: 'Edit', material: 'references/policy.md' },
          { effect: 'forbid', tool: 'Read', material: 'references/private-*.md' },
        ],
      },
    },
    reference(),
    reference(allowed, `${SKILL}/references/private-a.txt`),
  ]);
  await writeFile(join(work.dir, SKILL, 'references/private-a.txt'), 'Allowed text.');
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Read']);
  expect(used[2]?.input.file_path).toContain('private-a.txt');
});

it('applies a forbid case of a standing file to the skill, relative to the estate root', async () => {
  const ban = 'Never read `.claude/skills/invoice-audit/references/policy.md`.';
  const work = await audit(READ, [reference()]);
  await writeFile(join(work.dir, 'CLAUDE.md'), `${ban}\n`);
  declare(work, [
    { ...declared.ban('instruction.standing', ban, 'Read', POLICY), file: 'CLAUDE.md' },
  ]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill']);
  expect(JSON.stringify(records)).not.toContain('Read from this estate.');
});

it('stops as unresolved when the passage of a forbid case holds a condition', async () => {
  const ban = 'If the supplier has withdrawn consent, never read `references/policy.md`.';
  const work = await audit(`${ban}\n${READ}`, [
    declared.ban('instruction.ban', ban, 'Read', 'references/policy.md', ['consent']),
    reference(),
  ]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('condition of an estate prohibition cannot be resolved');
});

it('lifts a forbid case once the copy no longer holds its quote', async () => {
  const ban = 'Never run `node scripts/check.mjs`.';
  const work = await audit(`${ban}\n${RUN}`, [declared.ban('instruction.ban', ban, 'Bash', 'node scripts/check.mjs'), script()]);
  await writeFile(join(work.dir, CHECK), 'import { writeFileSync } from "node:fs"; writeFileSync("executed.txt", "ran");');
  expect(names(play(work.dir))).toEqual(['Skill']);
  expect(existsSync(join(work.dir, 'executed.txt'))).toBe(false);
  const file = join(work.dir, SKILL, 'SKILL.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace(ban, 'Run it whenever you like.'));
  expect(names(play(work.dir))).toEqual(['Skill', 'Bash']);
  expect(existsSync(join(work.dir, 'executed.txt'))).toBe(true);
});

it('answers an ask the map does not declare plainly, whatever it asks for', async () => {
  const work = await audit(RUN, [script()]);
  await writeFile(join(work.dir, 'check.cjs'), 'console.log("standalone requested command");');
  const records = play(work.dir, { ask: 'Could you please execute `node check.cjs`?', declared: false });
  expect(names(records)).toEqual([]);
  expect(JSON.stringify(records)).not.toContain('standalone requested command');
});
