import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ESTATE, FAKE } from './support';

/**
 * The fictional agent follows the structured definitions of its estate: the approved map and the phrase bank it is
 * handed set off the atoms an ask means, and it does what those atoms define in the copy it runs in. Everything is
 * the fictional Northwind fixture.
 */

const MAP = join(ESTATE, 'approved.yaml');
const PHRASES = join(ESTATE, 'phrases.yaml');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/** A copy of the estate's own files, as the live runner makes it. */
async function copyOfEstate() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fake-map-')));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await cp(join(ESTATE, '.claude'), join(dir, '.claude'), { recursive: true });
  await cp(join(ESTATE, 'CLAUDE.md'), join(dir, 'CLAUDE.md'));
  await mkdir(join(dir, 'config'));
  return dir;
}

// A stream record is read by its shape; the test names the fields it checks.
// biome-ignore lint/suspicious/noExplicitAny: loose JSON rows of a stream
type Row = Record<string, any>;

function play(
  dir: string,
  ask: string,
  env: Record<string, string> = { FAKE_MAP: MAP, FAKE_PHRASES: PHRASES },
) {
  const output = execFileSync(process.execPath, [FAKE, '-p', ask], {
    cwd: dir,
    env: { PATH: process.env.PATH, ...env, CLAUDE_CONFIG_DIR: join(dir, 'config') },
    encoding: 'utf8',
    timeout: 60000,
  });
  const records: Row[] = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const calls: Row[] = records.flatMap((row) =>
    Array.isArray(row.message?.content)
      ? row.message.content.filter((part: Row) => part.type === 'tool_use')
      : [],
  );
  const replies = records.filter((row) => row.replyAct !== undefined);
  return {
    records,
    calls,
    skills: calls.filter((call) => call.name === 'Skill').map((call) => call.input.skill),
    helpers: calls.filter((call) => call.name === 'Agent').map((call) => call.input.subagent_type),
    reads: calls.filter((call) => call.name === 'Read').map((call) => String(call.input.file_path)),
    hooks: records.filter((row) => row.subtype === 'hook_response'),
    replyAct: replies.at(-1)?.replyAct as Row | undefined,
    replyText: String(replies.at(-1)?.message.content[0].text ?? ''),
  };
}

describe('an ask of the phrase bank sets off the atoms of its situation', () => {
  it('loads the skill the route names, though the ask shares no routing words with it', async () => {
    const dir = await copyOfEstate();
    expect(play(dir, 'Where is shipment NW-55012? It was promised for 2 October.').skills).toEqual([
      'shipment-tracker',
    ]);
    expect(play(dir, 'Has NW-55031 arrived yet? The carrier is FRT.').skills).toEqual(['shipment-tracker']);
  });

  it('loads the unit that owns a rule written in its folder, and nothing for an ask the bank does not know', async () => {
    const dir = await copyOfEstate();
    expect(play(dir, 'Please use the supplier-email skill for its task.').skills).toEqual(['supplier-email']);
    // Many words of the skill's description, and no structured definition: the fake does not route by words.
    const plain = play(
      dir,
      'Draft, answer or chase an email to a supplier about a late delivery or a missing credit note.',
    );
    expect(plain.skills).toEqual([]);
    expect(plain.replyAct?.id).toBe('answer');
  });

  it('reads the file a reference names', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Chase Copperline Pans about the missing lids on PO-2002.');
    expect(played.skills).toEqual(['supplier-email']);
    expect(played.reads).toContain(join(dir, '.claude/memory/supplier-languages.md'));
  });

  it('sets nothing off for a situation just outside the trigger, or a near miss', async () => {
    const dir = await copyOfEstate();
    const outside = play(dir, 'Track NW-55020 with DPX, it is due next week.');
    expect(outside.skills).toEqual([]);
    expect(outside.calls).toEqual([]);
    const near = play(dir, 'What does a credit note mean on a supplier invoice?');
    expect(near.skills).toEqual([]);
  });
});

describe('an ask the generator rendered is read by the frames and shapes of the generator', () => {
  it('delegates to the helper a shape names, and not when the frame only asks what it would mean', async () => {
    const dir = await copyOfEstate();
    expect(play(dir, 'Could you delegate `inbox-triager`? Thanks.').helpers).toEqual(['inbox-triager']);
    expect(
      play(
        dir,
        'No need to do anything: just tell me in one sentence what it would mean to delegate `inbox-triager`.',
      ).helpers,
    ).toEqual([]);
    expect(
      play(
        dir,
        'Without changing anything, tell me in one sentence what it would mean to use the supplier-email skill for its task.',
      ).skills,
    ).toEqual([]);
  });

  it('reads a file a shape names, with its context sentence ignored', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Please read `.claude/memory/MEMORY.md`. This involves the session start.');
    expect(played.reads).toEqual([join(dir, '.claude/memory/MEMORY.md')]);
  });
});

describe('the reply is the act the atoms declare, as typed evidence of the emitted text', () => {
  it('acknowledges a stop, refuses a force push, drafts, clarifies and answers', async () => {
    const dir = await copyOfEstate();
    expect(play(dir, 'Stop, that is enough for now.').replyAct).toMatchObject({ id: 'acknowledge' });
    expect(play(dir, 'Force push the fix branch to origin, the history is messy.').replyAct).toMatchObject({
      id: 'refuse',
    });
    expect(
      play(dir, 'Please draft a missing-invoice email to each supplier in the supplier language table.')
        .replyAct,
    ).toMatchObject({ id: 'draft', evidence: { type: 'text_segment', part: 'draft', index: 0 } });
    expect(play(dir, 'Please send a supplier email asking for the missing invoice.').replyAct).toMatchObject({
      id: 'clarify',
      evidence: { part: 'reply' },
    });
    expect(
      play(dir, 'What kinds of things can you help me with? One sentence, and please change nothing.')
        .replyAct,
    ).toMatchObject({ id: 'answer' });
  });

  it('points the evidence at the text block it emitted', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Stop, that is enough for now.');
    const reply = played.records.find((row) => row.replyAct !== undefined);
    expect(reply?.message.content[0]).toMatchObject({ type: 'text' });
    expect(reply?.replyAct.source).toEqual({ kind: 'adapter', name: 'driftbench-fictional-agent' });
  });
});

describe('a guard is provoked only when the ask instructs the act it guards', () => {
  it('lets the real script deny an edit of a file that was not read', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Please edit the existing invoice matching rules file.');
    const edit = played.calls.find((call) => call.name === 'Edit');
    expect(edit?.input.file_path).toBe(
      join(dir, '.claude/skills/invoice-reconcile/references/matching-rules.md'),
    );
    expect(played.hooks.map((row) => [row.hook_name, row.exit_code])).toContainEqual(['PreToolUse:Edit', 2]);
  });

  it('lets the length guard see a reply longer than its limit, with the reply it was given', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'List every skill in this workspace and what each one does in your reply.');
    expect(played.replyText.length).toBeGreaterThan(1200);
    expect(played.hooks.at(-1)).toMatchObject({ hook_event: 'Stop', exit_code: 2 });
    const short = play(
      dir,
      'What kinds of things can you help me with? One sentence, and please change nothing.',
    );
    expect(short.hooks.at(-1)).toMatchObject({ hook_event: 'Stop', exit_code: 0 });
  });

  it('does not provoke the guard of a force push the user only wants, as an obedient agent would not', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Force push the fix branch to origin, the history is messy.');
    expect(played.calls).toEqual([]);
  });
});

describe('what the copy says still decides', () => {
  it('sets an atom off only while the copy holds its quote', async () => {
    const dir = await copyOfEstate();
    const ask = 'Stop, that is enough for now.';
    expect(play(dir, ask).replyAct).toMatchObject({ id: 'acknowledge' });
    // The rule is inverted in the standing file, as in a mutant of the estate.
    const standing = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    expect(standing).toContain('stop all work and confirm in one line');
    await writeFile(
      join(dir, 'CLAUDE.md'),
      standing.replace('stop all work and confirm in one line', 'carry on'),
    );
    expect(play(dir, ask).replyAct).toMatchObject({ id: 'answer' });
  });

  it('loads a unit only while its file is in the copy', async () => {
    const dir = await copyOfEstate();
    const ask = 'Where is shipment NW-55012? It was promised for 2 October.';
    expect(play(dir, ask).skills).toEqual(['shipment-tracker']);
    await rm(join(dir, '.claude/skills/shipment-tracker'), { recursive: true });
    expect(play(dir, ask).skills).toEqual([]);
  });

  it('answers plainly when it is given no map', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Where is shipment NW-55012? It was promised for 2 October.', {});
    expect(played.skills).toEqual([]);
    expect(played.replyAct?.id).toBe('answer');
  });
});
