import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { calls, declare, declared, estate, names, play } from './declared';
import { ASK_INVOICE } from './support';

/**
 * The fake's behaviour comes from the map's declared fields, never from the words of the estate or of the ask. One
 * structure, said in plain English, in a paraphrase and in French, gives one run. Everything is fictional.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const HELPER = '---\nname: amount-reader\ndescription: Compare the amounts in records.\n---\nRead the amounts.\n';

/** One structure in three wordings: a command, a file to read before any command, and a helper to hand work to. */
const wordings = [
  {
    name: 'plain English',
    body: [
      'Run `node scripts/check.mjs`.',
      'Before running the check, read `references/policy.md`.',
      'Dispatch `amount-reader` for the amount check.',
    ],
  },
  {
    name: 'a paraphrase',
    body: [
      'The check itself is `node scripts/check.mjs`.',
      'It waits until `references/policy.md` has been looked at.',
      'The amounts are a job for `amount-reader`.',
    ],
  },
  {
    name: 'French',
    body: [
      'Lancez `node scripts/check.mjs`.',
      'Avant la vérification, lisez `references/policy.md`.',
      'Confiez le contrôle des montants à `amount-reader`.',
    ],
  },
] as const;

it.each(wordings)('does what the map declares, whatever the words of the skill: $name', async ({ body }) => {
  const work = await estate('invoice-audit', body.join('\n'));
  cleanups.push(work.done);
  await mkdir(join(work.dir, '.claude/agents'));
  await writeFile(join(work.dir, '.claude/agents/amount-reader.md'), HELPER);
  declare(work, [
    declared.script('script.check', body[0], '.claude/skills/invoice-audit/scripts/check.mjs'),
    declared.reference('reference.policy', body[1], '.claude/skills/invoice-audit/references/policy.md'),
    declared.gate('gate.policy', body[1], '.claude/skills/invoice-audit/references/policy.md', 'Bash'),
    declared.helper('amount-reader'),
    declared.dispatch('instruction.amounts', body[2], 'amount-reader'),
  ]);
  const records = play(work.dir);
  const used = calls(records);
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash', 'Agent']);
  expect(used[1].input.file_path).toBe(join(work.dir, '.claude/skills/invoice-audit/references/policy.md'));
  expect(used[2].input.command).toBe('node .claude/skills/invoice-audit/scripts/check.mjs');
  expect(used[3].input.subagent_type).toBe('amount-reader');
  expect(JSON.stringify(records)).toContain('checked this estate');
});

const bans = [
  ['plain English', 'Run `node scripts/check.mjs`.', 'Never run `node scripts/check.mjs`.'],
  ['a paraphrase', 'The check is `node scripts/check.mjs`.', '`node scripts/check.mjs` is off limits.'],
  ['French', 'Lancez `node scripts/check.mjs`.', 'Ne lancez jamais `node scripts/check.mjs`.'],
] as const;

it.each(bans)('refuses the call a declared prohibition forbids, whatever its words: %s', async (_name, run, ban) => {
  const work = await estate('invoice-audit', `${run}\n${ban}`);
  cleanups.push(work.done);
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/check.mjs'),
    'require("node:fs").writeFileSync("executed.txt", "forbidden command ran");',
  );
  declare(work, [
    declared.script('script.check', run, '.claude/skills/invoice-audit/scripts/check.mjs'),
    declared.ban('instruction.ban', ban, 'Bash', 'node scripts/check.mjs'),
  ]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill']);
  expect(existsSync(join(work.dir, 'executed.txt'))).toBe(false);
  expect(JSON.stringify(records)).toContain('An estate prohibition forbids this action');
});

it('does not take a prohibition from the words of a line the map does not declare as one', async () => {
  const work = await estate('invoice-audit', 'Run `node scripts/check.mjs`.\nNever run `node scripts/check.mjs`.');
  cleanups.push(work.done);
  declare(work, [
    declared.script('script.check', 'Run `node scripts/check.mjs`.', '.claude/skills/invoice-audit/scripts/check.mjs'),
  ]);
  const records = play(work.dir);
  expect(names(records)).toEqual(['Skill', 'Bash']);
  expect(JSON.stringify(records)).toContain('checked this estate');
});

it('does not take an order from the words of a line the map does not declare as a gate', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nBefore running the check, read `references/policy.md`.',
  );
  cleanups.push(work.done);
  declare(work, [
    declared.script('script.check', 'Run `node scripts/check.mjs`.', '.claude/skills/invoice-audit/scripts/check.mjs'),
    declared.reference(
      'reference.policy',
      'Before running the check, read `references/policy.md`.',
      '.claude/skills/invoice-audit/references/policy.md',
    ),
  ]);
  expect(names(play(work.dir))).toEqual(['Skill', 'Bash', 'Read']);
});

it('takes no action from the words of the ask', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  cleanups.push(work.done);
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/check.mjs'),
    'require("node:fs").writeFileSync("executed.txt", "a command the ask spelled out ran");',
  );
  // The map declares this whole ask as the route's request: it loads the skill, and nothing else.
  for (const request of [
    'Please run `node .claude/skills/invoice-audit/scripts/check.mjs`.',
    'Read `.claude/skills/invoice-audit/references/policy.md`.',
    'Lancez `node .claude/skills/invoice-audit/scripts/check.mjs`.',
  ]) {
    const records = play(work.dir, { ask: `${ASK_INVOICE}\n${request}` });
    expect(names(records)).toEqual(['Skill']);
  }
  expect(existsSync(join(work.dir, 'executed.txt'))).toBe(false);
});
