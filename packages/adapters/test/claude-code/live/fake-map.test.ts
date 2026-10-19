import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ESTATE, FAKE } from './support';

/**
 * The fictional agent follows the structured definitions of its estate: the approved map and the phrase bank it is
 * handed set off the atoms an ask means, and it does what those atoms define in the copy it runs in. Everything is
 * the fictional Northwind fixture.
 */

// The adapters package keeps no YAML reader; the generate package of the workspace does.
const { parse } = createRequire(join(ESTATE, '../../../packages/generate/package.json'))('yaml') as {
  parse: (text: string) => unknown;
};
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
  resume?: string,
) {
  const output = execFileSync(process.execPath, [FAKE, '-p', ask, ...(resume ? ['--resume', resume] : [])], {
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
  it('points the evidence at the text block it emitted', async () => {
    const dir = await copyOfEstate();
    const played = play(
      dir,
      'What kinds of things can you help me with? One sentence, and please change nothing.',
    );
    const reply = played.records.find((row) => row.replyAct !== undefined);
    expect(reply?.message.content[0]).toMatchObject({ type: 'text' });
    expect(reply?.replyAct.source).toEqual({ kind: 'adapter', name: 'driftbench-fictional-agent' });
  });
});

describe('a guard is provoked only when the ask instructs the act it guards', () => {
  it('does not provoke the guard of a force push the user only wants, as an obedient agent would not', async () => {
    const dir = await copyOfEstate();
    const played = play(dir, 'Force push the fix branch to origin, the history is messy.');
    expect(played.calls).toEqual([]);
  });
});

describe('after a compaction the fake reads again what the hazard atoms of the map name', () => {
  /** A session file whose last records are a compaction boundary and its summary, as the runner plants them. */
  async function compacted(dir: string, id: string) {
    const folder = join(dir, 'config', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
    await mkdir(folder, { recursive: true });
    const rows = [
      { type: 'user', sessionId: id, message: { role: 'user', content: 'Earlier work.' } },
      {
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'auto', preTokens: 150000 },
      },
      { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Summary of the work.' } },
    ];
    await writeFile(join(folder, `${id}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  }
  const ASK = 'Carry on with the week 42 report where we were.';

  it('reads the file the hazard is written in, from the map, when the session holds a compaction', async () => {
    const dir = await copyOfEstate();
    await compacted(dir, 'aaaa1111-0000-4000-8000-000000000001');
    const played = play(dir, ASK, undefined, 'aaaa1111-0000-4000-8000-000000000001');
    expect(played.reads).toContain(join(dir, 'CLAUDE.md'));
  });

  it('reads nothing of the kind in a session with no compaction', async () => {
    const dir = await copyOfEstate();
    expect(play(dir, ASK).reads).not.toContain(join(dir, 'CLAUDE.md'));
  });

  it('reads no file once the copy no longer holds the quote of the hazard', async () => {
    const dir = await copyOfEstate();
    await compacted(dir, 'aaaa1111-0000-4000-8000-000000000002');
    const file = join(dir, 'CLAUDE.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('After a compaction', 'After a holiday'));
    const played = play(dir, ASK, undefined, 'aaaa1111-0000-4000-8000-000000000002');
    expect(played.reads).not.toContain(file);
  });

  it('reads the files a hazard atom declares to read again, besides its own file', async () => {
    const dir = await copyOfEstate();
    await compacted(dir, 'aaaa1111-0000-4000-8000-000000000003');
    const map = parse(await readFile(MAP, 'utf8')) as { atoms: Array<Record<string, any>> };
    const hazard = map.atoms.find((atom) => atom.id === 'hazard.standing.recover-from-a-compaction-of-the');
    hazard!.fields.reread = ['tracker/open.md'];
    const own = join(dir, 'fake-map.json');
    await writeFile(own, JSON.stringify(map));
    const played = play(
      dir,
      ASK,
      { FAKE_MAP: own, FAKE_PHRASES: PHRASES },
      'aaaa1111-0000-4000-8000-000000000003',
    );
    expect(played.reads).toEqual(
      expect.arrayContaining([join(dir, 'CLAUDE.md'), join(dir, 'tracker/open.md')]),
    );
  });
});

describe('what the copy says still decides', () => {
  /** The hazard atom of a compaction, and the quote it holds in the standing file. */
  const HAZARD = 'hazard.standing.recover-from-a-compaction-of-the';
  const QUOTE = 'After a compaction, re-read this file';
  async function compactedCopy(id: string) {
    const dir = await copyOfEstate();
    const folder = join(dir, 'config', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
    await mkdir(folder, { recursive: true });
    const rows = [
      { type: 'user', sessionId: id, message: { role: 'user', content: 'Earlier work.' } },
      { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 1 } },
      { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Summary.' } },
    ];
    await writeFile(join(folder, `${id}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    return dir;
  }
  const ID = 'bbbb2222-0000-4000-8000-000000000001';
  const ASK = 'Carry on with the week 42 report where we were.';
  const rereads = (dir: string, env?: Record<string, string>) =>
    play(dir, ASK, env ?? { FAKE_MAP: MAP, FAKE_PHRASES: PHRASES }, ID).reads.includes(
      join(dir, 'CLAUDE.md'),
    );

  it('drops an atom when its quote is edited by one character, inverted or deleted', async () => {
    for (const change of [
      (text: string) => text.replace(QUOTE, 'After a compaction, re-read this fil'),
      (text: string) => text.replace(QUOTE, 'After a compaction, never read this file'),
      (text: string) => text.replace(/^.*After a compaction, re-read this file.*$/m, ''),
    ]) {
      const dir = await compactedCopy(ID);
      expect(rereads(dir)).toBe(true);
      const standing = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
      expect(standing).toContain(QUOTE);
      await writeFile(join(dir, 'CLAUDE.md'), change(standing));
      expect(rereads(dir)).toBe(false);
    }
  });

  it('does not trust a map whose atom no longer matches its own provenance hash', async () => {
    const dir = await compactedCopy(ID);
    const map = parse(await readFile(MAP, 'utf8')) as { atoms: Row[] };
    const tampered = join(dir, 'tampered-map.json');
    // The atom keeps its quote, and the copy holds it; its hash no longer recomputes from file, span and quote.
    for (const atom of map.atoms) if (atom.id === HAZARD) atom.provenance.hash = '0'.repeat(64);
    await writeFile(tampered, JSON.stringify(map));
    expect(rereads(dir, { FAKE_MAP: tampered, FAKE_PHRASES: PHRASES })).toBe(false);
    expect(rereads(dir)).toBe(true);
  });

  it('keeps an atom whose quote the map folded across the lines of a wrapped paragraph', async () => {
    const dir = await compactedCopy(ID);
    const text = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    const map = parse(await readFile(MAP, 'utf8')) as { atoms: Row[] };
    const quote: string = map.atoms.find((atom) => atom.id === HAZARD)?.provenance.quote;
    // The copy wraps the quoted sentence after its fourth word; the quote still reads as one line.
    const words = quote.split(' ');
    await writeFile(
      join(dir, 'CLAUDE.md'),
      text.replace(quote, `${words.slice(0, 4).join(' ')}\n${words.slice(4).join(' ')}`),
    );
    const wrapped = join(dir, 'wrapped-map.json');
    await writeFile(wrapped, JSON.stringify(map));
    expect(rereads(dir, { FAKE_MAP: wrapped, FAKE_PHRASES: PHRASES })).toBe(true);
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
    const played = play(dir, 'Where is shipment NW-55012? It was promised for 2 October.', {
      FAKE_MAP: 'none',
    });
    expect(played.skills).toEqual([]);
    expect(played.replyAct?.id).toBe('answer');
  });
});
