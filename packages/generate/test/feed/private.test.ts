import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertOutsideRepository,
  conversationSetHash,
  feedVariables,
  loadConversationDir,
  privateCountsOf,
  privateDir,
  writePrivateCounts,
} from '../../src/feed';
import { fixtureStore, Population, simulatedReader } from './support';

describe('the set hash', () => {
  it('does not depend on the order and changes when a conversation changes', () => {
    const a = [
      { id: 'x', text: 'one' },
      { id: 'y', text: 'two' },
    ];
    expect(conversationSetHash(a)).toBe(conversationSetHash([...a].reverse()));
    expect(conversationSetHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(conversationSetHash(a)).not.toBe(
      conversationSetHash([
        { id: 'x', text: 'one' },
        { id: 'y', text: 'two!' },
      ]),
    );
  });

  it('does not depend on the ids', () => {
    expect(conversationSetHash([{ id: 'a', text: 'one' }])).toBe(
      conversationSetHash([{ id: 'b', text: 'one' }]),
    );
  });
});

describe('what leaves a private run', () => {
  async function run() {
    const population = new Population(21);
    const conversations = Array.from({ length: 80 }, (_, i) => ({
      id: `secret-name-${i}.txt`,
      text: population.conversation().text,
    }));
    const result = await feedVariables({
      store: fixtureStore(),
      conversations,
      reader: simulatedReader(population, { accuracy: 0.95, unsure: 0.02, seed: 21 }),
    });
    return { conversations, result };
  }

  it('holds no line of any conversation, no id and no marker, in the store, the report or the counts file', async () => {
    const { conversations, result } = await run();
    const dir = await mkdtemp(join(tmpdir(), 'feed-private-'));
    const path = await writePrivateCounts(privateCountsOf(result.report), { dir });
    const everything = [
      JSON.stringify(result.store),
      JSON.stringify(result.report),
      await readFile(path, 'utf8'),
    ].join('\n');
    expect(everything).not.toContain('PRIVATE-MARKER');
    for (const conversation of conversations) {
      expect(everything).not.toContain(conversation.id);
      for (const line of conversation.text.split('\n')) expect(everything).not.toContain(line);
    }
  });

  it('writes the counts file readable by its owner only, named by agent and hash', async () => {
    const { result } = await run();
    const dir = await mkdtemp(join(tmpdir(), 'feed-private-'));
    const path = await writePrivateCounts(privateCountsOf(result.report), { dir });
    expect(path).toBe(join(dir, `feed-fixture-agent-${result.report.set_hash.slice(0, 12)}.json`));
    expect((await stat(path)).mode & 0o077).toBe(0);
    const counts = JSON.parse(await readFile(path, 'utf8')) as { variables: Array<{ values: unknown[] }> };
    expect(counts.variables[0]?.values[0]).toEqual(expect.objectContaining({ count: expect.any(Number) }));
  });

  it('refuses a folder inside a git repository', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'feed-repo-'));
    await mkdir(join(repo, '.git'));
    expect(() => assertOutsideRepository(join(repo, 'a', 'b'))).toThrow(/inside a git repository/);
    const { result } = await run();
    await expect(
      writePrivateCounts(privateCountsOf(result.report), { dir: join(repo, 'private') }),
    ).rejects.toThrow(/inside a git repository/);
    expect(() => assertOutsideRepository(`${repo}-elsewhere`)).not.toThrow();
  });

  it('defaults to a folder under the home of the user, and lets the environment move it', () => {
    expect(privateDir({})).toMatch(/\.driftbench[\\/]private$/);
    expect(privateDir({ DRIFTBENCH_PRIVATE_DIR: '/somewhere/else' })).toBe('/somewhere/else');
  });
});

describe('reading a folder of conversations', () => {
  it('reads text files and message files, and skips the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'feed-conv-'));
    await writeFile(join(dir, 'a.txt'), 'plain text');
    await writeFile(
      join(dir, 'b.json'),
      JSON.stringify({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      }),
    );
    await writeFile(join(dir, 'c.png'), 'x');
    const read = await loadConversationDir(dir);
    expect(read).toEqual([
      { id: 'a.txt', text: 'plain text' },
      { id: 'b.json', text: 'user: hi\nassistant: hello' },
    ]);
  });

  it('names a file it cannot read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'feed-conv-'));
    await writeFile(join(dir, 'bad.json'), '{"messages": 3}');
    await expect(loadConversationDir(dir)).rejects.toThrow(/bad\.json has no "messages" array/);
  });
});
