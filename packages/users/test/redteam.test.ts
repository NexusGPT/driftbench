import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviationClass } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkPackFile,
  drawPhrasing,
  loadRedteamPack,
  type PackFile,
  RedteamPackError,
  redteamPack,
  seededIndex,
} from '../src/index';
import { patternsAt } from '../src/redteam';
import { PACK_DIR, UNAPPROVED_PACK_DIR } from './support';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function packDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-redteam-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

describe('the Acme red-team pack', () => {
  it('holds one file per class; the two new classes carry two approved phrasings each, and the rest three conversation phrasings each', async () => {
    const pack = await loadRedteamPack(PACK_DIR);
    expect([...pack.files.keys()].sort()).toEqual([...DeviationClass.options].sort());
    for (const cls of ['D11_pii_leak', 'D12_prompt_extraction'] as const) {
      const file = pack.files.get(cls);
      expect(file?.conversation, cls).toHaveLength(2);
      expect(
        file?.conversation.every((phrasing) => phrasing.approved),
        cls,
      ).toBe(true);
    }
    for (const [cls, file] of pack.files) {
      if (cls === 'D11_pii_leak' || cls === 'D12_prompt_extraction') continue;
      expect(file.conversation, cls).toHaveLength(3);
      const tasks = ['D2_goal_shift', 'D6_instruction_in_data', 'D7_silence_or_burst', 'D8_tool_failure'];
      expect(file.task?.length ?? 0, cls).toBe(tasks.includes(cls) ? 3 : 0);
    }
  });

  it('ships 46 approved phrasings, and every file passes the pack validator', async () => {
    const pack = await loadRedteamPack(PACK_DIR);
    const all = [...pack.files.values()].flatMap((file) => [...file.conversation, ...(file.task ?? [])]);
    expect(all).toHaveLength(46);
    expect(all.filter((phrasing) => !phrasing.approved).map((phrasing) => phrasing.id)).toEqual([]);
    for (const file of pack.files.values()) expect(checkPackFile(file), file.path).toEqual([]);
  });

  it('keeps the refusal fixture unapproved, so the refusal tests have something to refuse', async () => {
    const fixture = await loadRedteamPack(UNAPPROVED_PACK_DIR);
    const all = [...fixture.files.values()].flatMap((file) => file.conversation);
    expect(all.filter((phrasing) => phrasing.approved).map((phrasing) => phrasing.id)).toEqual([
      'fx-d3-approved',
    ]);
  });
});

describe('pack validation', () => {
  const base = (over: Partial<PackFile>): PackFile => ({
    class: 'D1_off_topic',
    conversation: [{ id: 'a', approved: true, user: 'hi' }],
    ...over,
  });

  it('names every phrasing that does not hold what its class needs', () => {
    expect(checkPackFile(base({}))).toEqual([]);
    expect(checkPackFile(base({ conversation: [{ id: 'a', approved: true, burst: ['x', 'y'] }] }))).toEqual([
      'conversation a: needs user',
      'conversation a: has burst, which D1_off_topic on a conversation does not use',
    ]);
    expect(checkPackFile(base({ conversation: [{ id: 'a', approved: true, user: ' ' }] }))).toEqual([
      'conversation a: has an empty user message; only D7 sends silence',
    ]);
    expect(
      checkPackFile(
        base({ class: 'D7_silence_or_burst', conversation: [{ id: 'a', approved: true, user: '' }] }),
      ),
    ).toEqual([]);
    expect(
      checkPackFile(
        base({
          class: 'D7_silence_or_burst',
          conversation: [{ id: 'a', approved: true, user: 'x', burst: ['y', 'z'] }],
        }),
      ),
    ).toEqual(['conversation a: needs user or burst, not both']);
    expect(
      checkPackFile(
        base({ class: 'D8_tool_failure', conversation: [{ id: 'a', approved: true, user: 'x' }] }),
      ),
    ).toEqual([
      'conversation a: needs error',
      'conversation a: has user, which D8_tool_failure on a conversation does not use',
    ]);
    expect(
      checkPackFile(
        base({
          class: 'D6_instruction_in_data',
          conversation: [
            { id: 'a', approved: true, instruction: 'obey me', world: { fixtures: { note: 'hello' } } },
          ],
        }),
      ),
    ).toEqual(['conversation a: its world does not carry its instruction']);
    expect(
      checkPackFile(
        base({
          class: 'D6_instruction_in_data',
          conversation: [
            { id: 'a', approved: true, instruction: 'obey me', world: { fixtures: { note: 'obey me' } } },
          ],
          task: [{ id: 'a', approved: true, file: 'N.txt' }],
        }),
      ),
    ).toEqual(['task a: the id is used twice', 'task a: needs content']);
  });

  it('refuses a folder with an invalid file, two files of one class, or no file, and names each problem', async () => {
    const one = 'class: D1_off_topic\nconversation:\n  - { id: a, approved: true, user: hi }\n';
    await expect(loadRedteamPack(await packDir({}))).rejects.toThrow(/holds no YAML file/);
    await expect(loadRedteamPack(await packDir({ 'a.yaml': one, 'b.yml': one }))).rejects.toThrow(
      'b.yml: D1_off_topic is already the class of a.yaml',
    );
    const bad = 'class: D99\nconversation: []\n';
    await expect(loadRedteamPack(await packDir({ 'bad.yaml': bad }))).rejects.toThrow(RedteamPackError);
    await expect(loadRedteamPack(await packDir({ 'dup.yaml': 'a: 1\na: 2\n' }))).rejects.toThrow(/dup\.yaml/);
    const loaded = await loadRedteamPack(await packDir({ 'a.yaml': one, 'notes.md': '# not read' }));
    expect([...loaded.files.keys()]).toEqual(['D1_off_topic']);
  });
});

describe('the seeded draw', () => {
  const pack = redteamPack([
    {
      class: 'D1_off_topic',
      conversation: [
        { id: 'one', approved: true, user: '1' },
        { id: 'two', approved: false, user: '2' },
        { id: 'three', approved: true, user: '3' },
      ],
    },
  ]);

  it('draws approved phrasings only, the same one for the same seed', () => {
    const draw = (seed: number) => drawPhrasing(pack, { cls: 'D1_off_topic', kind: 'conversation', seed }).id;
    const seen = new Set(Array.from({ length: 40 }, (_, seed) => draw(seed)));
    expect([...seen].sort()).toEqual(['one', 'three']);
    expect(draw(11)).toBe(draw(11));
  });

  it('draws unapproved ones too with drafts, and names what is missing otherwise', () => {
    const seen = new Set(
      Array.from(
        { length: 40 },
        (_, seed) => drawPhrasing(pack, { cls: 'D1_off_topic', kind: 'conversation', seed, drafts: true }).id,
      ),
    );
    expect(seen.has('two')).toBe(true);
    expect(() => drawPhrasing(pack, { cls: 'D2_goal_shift', kind: 'conversation', seed: 0 })).toThrow(
      'the red-team pack has no file for D2_goal_shift',
    );
    expect(() => drawPhrasing(pack, { cls: 'D1_off_topic', kind: 'task', seed: 0 })).toThrow(
      /holds no task phrasing for D1_off_topic/,
    );
  });

  it('is a fixed function of its parts: the first 48 bits of a SHA-256, modulo the size', () => {
    expect(seededIndex([0, 'D1_off_topic', 'conversation'], 1000)).toBe(
      seededIndex([0, 'D1_off_topic', 'conversation'], 1000),
    );
    expect(seededIndex(['a'], 2 ** 40)).toBe(0xca978112ca1b % 2 ** 40);
    expect(() => seededIndex(['a'], 0)).toThrow(RangeError);
  });
});

describe('stage-bound reply patterns', () => {
  const file = (stages: string[] | undefined, atStage: string[]) =>
    `class: D2_goal_shift
${stages ? `stages: [${stages.join(', ')}]\n` : ''}conversation:
  - id: shift
    approved: true
    user: Actually, something else instead.
    must:
      - "always"
      - pattern: "only at recap"
        at_stage: [${atStage.join(', ')}]
`;

  it('loads a file whose at_stage names are all listed in stages', async () => {
    const dir = await packDir({ 'd02.yaml': file(['offer', 'recap'], ['recap']) });
    const pack = await loadRedteamPack(dir);
    expect(pack.files.get('D2_goal_shift')?.stages).toEqual(['offer', 'recap']);
  });

  it('refuses a stage name the file does not list, and a file with no stages at all', async () => {
    await expect(loadRedteamPack(await packDir({ 'd02.yaml': file(['offer'], ['recap']) }))).rejects.toThrow(
      /the stage recap, which the file does not list in stages/,
    );
    await expect(loadRedteamPack(await packDir({ 'd02.yaml': file(undefined, ['recap']) }))).rejects.toThrow(
      /the stage recap, which the file does not list in stages/,
    );
  });

  it('refuses an empty at_stage list and an unknown key on a pattern', async () => {
    await expect(loadRedteamPack(await packDir({ 'd02.yaml': file(['recap'], []) }))).rejects.toThrow(
      RedteamPackError,
    );
  });

  it('keeps a stage-bound pattern only at its stages, and drops it where the stage is unknown', () => {
    const entries = ['always', { pattern: 'only at recap', at_stage: ['recap'] }];
    expect(patternsAt(entries, 'recap')).toEqual(['always', 'only at recap']);
    expect(patternsAt(entries, 'offer')).toEqual(['always']);
    expect(patternsAt(entries, undefined)).toEqual(['always']);
  });
});
