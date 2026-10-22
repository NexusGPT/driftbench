import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { longSentences, SENTENCE_LIMIT } from './sentence-length';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

async function pages(): Promise<string[]> {
  const guide = (await readdir(join(ROOT, 'docs/guide'))).filter((name) => name.endsWith('.md')).sort();
  return ['README.md', ...guide.map((name) => `docs/guide/${name}`)];
}

describe('sentence length', () => {
  it(`no sentence of the README or the guide holds more than ${SENTENCE_LIMIT} words`, async () => {
    const problems: string[] = [];
    for (const page of await pages()) {
      const text = await readFile(join(ROOT, page), 'utf8');
      for (const long of longSentences(text)) {
        problems.push(`${page}:${long.line} ${long.words} words: ${long.sentence.slice(0, 120)}`);
      }
    }
    expect(problems.join('\n')).toBe('');
  });

  it('finds a long sentence, and ignores code, tables, HTML and generated regions', () => {
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');
    expect(longSentences(`${long}.`).map((found) => found.words)).toEqual([26]);
    expect(longSentences(`A short one. ${long}.`)).toHaveLength(1);
    expect(longSentences(`- \`a command\` does it · ${long}.`)).toHaveLength(1);
    expect(longSentences(`\`\`\`text\n${long}\n\`\`\``)).toEqual([]);
    expect(longSentences(`| ${long} |`)).toEqual([]);
    expect(longSentences(`<img alt="${long}">`)).toEqual([]);
    expect(longSentences(`<!-- readme-table:start -->\n${long}\n<!-- readme-table:end -->`)).toEqual([]);
  });
});
