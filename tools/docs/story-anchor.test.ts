import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANCHOR } from './story-anchor';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const read = (path: string) => readFile(join(ROOT, path), 'utf8');

describe('the rule the docs follow, declared in docs/story-anchor.json', () => {
  it('is a unit of the committed fixture ledger, and an atom of its map', async () => {
    const ledger = JSON.parse(await readFile(join(FIXTURE, 'ledger.json'), 'utf8')) as {
      entries: Array<{ id: string; path: string; quote: string }>;
    };
    const unit = ledger.entries.find((entry) => entry.id === ANCHOR.ledger);
    expect(unit, 'the ledger holds the unit').toBeDefined();
    expect(unit?.path).toBe(ANCHOR.file);
    expect(unit?.quote).toBe(ANCHOR.sentence);
    expect(ANCHOR.sentence).toContain(ANCHOR.edit.from);
    expect(await readFile(join(FIXTURE, 'map.yaml'), 'utf8')).toContain(`  - id: ${ANCHOR.atom}\n`);
  });

  it('is the rule each page names, with the same ids', async () => {
    const pages: Array<[string, string[]]> = [
      ['README.md', [ANCHOR.atom, ANCHOR.ledger]],
      ['docs/innovations.md', [ANCHOR.atom, ANCHOR.ledger]],
      ['docs/rule-links.md', [ANCHOR.atom, ANCHOR.ledger, ANCHOR.sentence]],
      ['docs/guide/walkthrough.md', [ANCHOR.atom, ANCHOR.ledger, ANCHOR.sentence, ANCHOR.ask]],
      ['docs/guide/index.md', [ANCHOR.ledger]],
      ['docs/guide/rerun-less.md', [ANCHOR.ledger]],
    ];
    for (const [path, needles] of pages) {
      const text = await read(path);
      for (const needle of needles) expect(text, `${path} names ${needle}`).toContain(needle);
    }
  });
});
