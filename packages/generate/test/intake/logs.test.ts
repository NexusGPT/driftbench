import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gitWorkTreeOf,
  type IntakeMap,
  intakeFiles,
  intakeLogs,
  loadIntakeMap,
  parseLogs,
  sampleIds,
} from '../../src/intake';
import { ACME, realEmail, realMobile, scratch } from './support';

const line = (value: unknown) => JSON.stringify(value);

const MAP: IntakeMap = {
  agent: 'zed',
  dimensions: [
    {
      id: 'flow',
      title: 'Flows',
      kind: 'behaviour',
      values: [
        { id: 'balance', title: 'A customer asks for their account balance' },
        { id: 'card-lost', title: 'A customer reports a lost card and wants it blocked' },
      ],
    },
  ],
  constraints: [],
  phrases: [{ dimension: 'flow', value: 'balance', text: 'what is my balance' }],
};

function conversations(): string {
  return [
    line({
      id: 'a',
      turns: [
        { role: 'user', text: 'what is my account balance?' },
        { role: 'agent', text: 'Sure.' },
      ],
    }),
    line({ id: 'b', turns: [{ role: 'user', text: 'what is my balance today' }] }),
    line({
      id: 'c',
      turns: [{ role: 'user', text: `I lost my card, block it. I'm Ana Duarte, ${realEmail('ana')}` }],
      flags: ['negative_feedback'],
    }),
    line({
      id: 'd',
      turns: [{ role: 'user', text: `I lost my card, block it. I'm Bo Lin, ${realEmail('bo')}` }],
    }),
    line({ id: 'e', turns: [{ role: 'user', text: 'can you change the address on my letters' }] }),
    line({ id: 'f', turns: [{ role: 'user', text: 'what is my balance today' }] }),
    line({
      id: 'g',
      turns: [
        { role: 'assistant', text: 'Hello' },
        { role: 'user', text: `call ${realMobile()}` },
      ],
    }),
  ].join('\n');
}

describe('parseLogs', () => {
  it('reads one conversation per line, skips blank lines and names a line by its number', () => {
    const parsed = parseLogs(`${line({ turns: [{ role: 'user', text: 'hi' }] })}\n\n`);
    expect(parsed).toEqual({
      ok: true,
      conversations: [{ id: 'line-1', line: 1, turns: [{ role: 'user', text: 'hi' }], flags: [] }],
      replaced: 0,
    });
  });

  it('refuses a bad line without ever printing its text', () => {
    const secret = realEmail('hidden.person');
    const parsed = parseLogs(
      [
        `not json ${secret}`,
        line({ turns: [{ role: 'robot', text: secret }] }),
        line({ id: 'x', turns: [{ role: 'user', text: 'a' }] }),
        line({ id: 'x', turns: [{ role: 'user', text: 'b' }] }),
      ].join('\n'),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((error) => error.line)).toEqual([1, 2, 4]);
    expect(JSON.stringify(parsed.errors)).not.toContain('hidden.person');
    expect(parsed.errors[2]?.message).toBe('id: the id of line 3 again');
    expect(parseLogs('\n')).toMatchObject({ ok: false });
  });
});

describe('personal data in the fields around the turns', () => {
  it('replaces an id that is an email by the line number, and drops a flag or channel holding one', () => {
    const email = realEmail('owner.of.id');
    const parsed = parseLogs(
      [
        line({ id: email, turns: [{ role: 'user', text: 'a' }], flags: ['incident', `by ${email}`] }),
        line({ id: 'ticket-9912345', turns: [{ role: 'user', text: 'b' }], channel: email }),
        line({ id: 'line-1', turns: [{ role: 'user', text: 'c' }] }),
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.conversations.map((c) => [c.id, c.flags, c.channel])).toEqual([
      ['line-1', ['incident'], undefined],
      ['ticket-9912345', [], undefined],
      ['line-3', [], undefined],
    ]);
    expect(parsed.replaced).toBe(3);
    expect(JSON.stringify(parsed)).not.toContain('owner.of.id');
  });
});

describe('gitWorkTreeOf', () => {
  it('finds the work tree above a path that does not exist yet, and nothing under the temp folder', async () => {
    const root = await scratch('git');
    await mkdir(join(root, 'repo', '.git'), { recursive: true });
    expect(await gitWorkTreeOf(join(root, 'repo', 'private', 'set'))).toBe(join(root, 'repo'));
    expect(await gitWorkTreeOf(join(root, 'elsewhere'))).toBeUndefined();
  });

  it('follows a symbolic link into a work tree', async () => {
    const root = await scratch('git');
    await mkdir(join(root, 'repo', '.git'), { recursive: true });
    await mkdir(join(root, 'repo', 'inside'));
    await symlink(join(root, 'repo', 'inside'), join(root, 'innocent'));
    expect(await gitWorkTreeOf(join(root, 'innocent', 'set'))).toBe(await realpath(join(root, 'repo')));
  });

  it('counts a .git file, the form a linked worktree uses', async () => {
    const root = await scratch('git');
    await writeFile(join(root, '.git'), 'gitdir: /somewhere\n');
    expect(await gitWorkTreeOf(join(root, 'a'))).toBe(root);
  });
});

describe('intakeLogs', () => {
  async function run(options: Partial<Parameters<typeof intakeLogs>[1]> = {}) {
    const parsed = parseLogs(conversations());
    if (!parsed.ok) throw new Error('fixture');
    return intakeLogs(parsed.conversations, { second: 'rules', map: MAP, ...options });
  }

  it('drops a near-duplicate after redaction and keeps the failure-flagged variant of a group', async () => {
    const intake = await run();
    expect(intake.duplicates[0]?.score).toBeCloseTo(1, 10);
    expect(intake.duplicates.map((d) => [d.id, d.keptAs])).toEqual([
      ['d', 'c'],
      ['f', 'b'],
    ]);
    expect(intake.kept.map((c) => c.id)).toEqual(['a', 'b', 'c', 'e', 'g']);
  });

  it('places openings on the map intents and clusters the rest as new intents', async () => {
    const intake = await run();
    expect(intake.kept.map((c) => `${c.id}=${c.intent}`)).toEqual([
      'a=balance',
      'b=balance',
      'c=card-lost',
      'e=new-1',
      'g=new-2',
    ]);
    expect(intake.intents.map((i) => [i.id, i.fromMap, i.conversations])).toEqual([
      ['balance', true, 2],
      ['card-lost', true, 1],
      ['new-1', false, 1],
      ['new-2', false, 1],
    ]);
    expect(intake.intentDimension).toBe('flow');
  });

  it('computes the Good-Turing discovery probability f1 / n and the Chao coverage', async () => {
    const { discovery } = await run();
    expect(discovery).toMatchObject({ n: 5, f1: 3, f2: 1 });
    expect(discovery.probability).toBeCloseTo(3 / 5, 12);
    expect(discovery.coverage).toBeCloseTo(1 - (3 / 5) * ((4 * 3) / (4 * 3 + 2)), 12);
  });

  it('counts detections per pass and type, and flags what the second pass found', async () => {
    const intake = await run();
    expect(intake.detections.pass1).toEqual({ email: 2, phone: 1 });
    expect(intake.detections.pass2).toEqual({ name: 2 });
    expect(intake.residual).toEqual([
      { id: 'c', types: ['name'] },
      { id: 'd', types: ['name'] },
    ]);
  });

  it('clusters without a map, under the dimension name intent', async () => {
    const intake = await run({ map: undefined });
    expect(intake.intentDimension).toBe('intent');
    expect(intake.intents.every((intent) => !intent.fromMap)).toBe(true);
  });

  it('draws the same spot-check sample for the same seed, and another for another seed', async () => {
    const one = await run({ spotCheck: 3, seed: 7 });
    const two = await run({ spotCheck: 3, seed: 7 });
    expect(one.spotCheck).toEqual(two.spotCheck);
    expect(one.spotCheck).toHaveLength(3);
    const ids = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) ids.add((await run({ spotCheck: 3, seed })).spotCheck.join());
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('sampleIds', () => {
  it('samples without replacement, keeps the original order, and caps at the pool size', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const drawn = sampleIds(ids, 4, 3);
    expect(new Set(drawn).size).toBe(4);
    expect(drawn).toEqual([...drawn].sort((x, y) => ids.indexOf(x) - ids.indexOf(y)));
    expect(sampleIds(ids, 10, 3)).toEqual(ids);
  });
});

describe('intakeFiles', () => {
  it('writes no raw value and no detected value into any file', async () => {
    const parsed = parseLogs(conversations());
    if (!parsed.ok) throw new Error('fixture');
    const intake = await intakeLogs(parsed.conversations, { second: 'rules', map: MAP, spotCheck: 5 });
    const files = intakeFiles(intake, { name: 'logs.jsonl', total: 7 });
    const all = Object.values(files).join('\n');
    expect(all).not.toContain('mailbox');
    expect(all).not.toContain('471');
    expect(all).not.toContain('Duarte');
    expect(Object.keys(files)).toEqual([
      'conversations.jsonl',
      'reference-turns.jsonl',
      'spot-check.yaml',
      'intake-report.json',
    ]);
    const report = JSON.parse(files['intake-report.json'] as string);
    expect(report.conversations).toEqual({
      read: 7,
      fields_replaced: 0,
      kept: 5,
      near_duplicates: 2,
      failures: 1,
    });
    const turns = (files['reference-turns.jsonl'] as string)
      .trim()
      .split('\n')
      .map((text) => JSON.parse(text));
    expect(turns[0]).toEqual({
      id: 'a#0',
      text: 'what is my account balance?',
      cell: { flow: 'balance' },
      origin: 'logs',
    });
    expect(files['spot-check.yaml']).toContain('clean: null');
  });
});

describe('loadIntakeMap', () => {
  it('reads only the approved entries of the Acme proposal', async () => {
    const loaded = await loadIntakeMap(`${ACME}map/approved.yaml`);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.map.agent).toBe('acme');
    expect(loaded.map.dimensions.find((d) => d.id === 'flow')?.values.map((v) => v.id)).toEqual([
      'upgrade',
      'new-home',
      'porting',
      'order',
      'price-sheet',
    ]);
    const pending = await loadIntakeMap(`${ACME}map/proposal.yaml`);
    expect(pending.ok && pending.map.dimensions).toEqual([]);
  });
});
