// No English word reader stays in the estate path (the owner's rule: no word lists anywhere in it): no estate or
// generator source imports a natural-language lexicon, and none of the readers #866 removed from #509's work is
// defined. Each one read prose by English words (verbs, negations, condition words, nouns, stop words); the behaviour
// it decided now comes from declared labels or structure. This file catches a reader coming back under its name.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sources(folder: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, folder), { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** The identifiers of the removed readers, by the file each one lived in. */
const REMOVED: Record<string, readonly string[]> = {
  'packages/estate/src/scan/code.ts': [
    'PROHIBITION_VERBS',
    'PROHIBITION_STATES',
    'OMISSION_VERBS',
    'NEGATED',
    'SUBORDINATE',
    'HISTORY_VERB',
    'REFERENCE_ACT',
    'scriptInvocation',
    'referenceClauses',
    'gateClauses',
    'directiveHead',
    'runtimeTransition',
  ],
  'packages/estate/src/graph/edges.ts': [
    'ENTITY_DESIGNATORS',
    'ENTITY_PLURALS',
    'CONDITION',
    'designates',
    'repeats',
  ],
  'packages/estate/src/plan/relevance.ts': ['CONTEXT', 'capabilities'],
  'packages/generate/src/estate/asks.ts': ['COMMON', 'stemOf', 'significant', 'imperativeOf'],
  'packages/generate/src/estate/unit.ts': ['OBLIGES', 'ACT_COMMANDS', 'clausesOf', 'bashForm'],
  'packages/generate/src/estate/then.ts': ['SAME_OBJECT', 'recoveryAction'],
  'packages/estate/src/scan/document-roles.ts': [
    'NAVIGATION_FOLDERS',
    'HEADING_ROLE',
    'headingRole',
    'PLACEHOLDER',
  ],
};

describe('the estate path holds no English word reader that was taken out', () => {
  it('imports no natural-language lexicon in the estate or generator sources, nor declares one', () => {
    const files = [...sources('packages/estate/src'), ...sources('packages/generate/src')];
    expect(files.length).toBeGreaterThan(20);
    const importing = files.filter((file) =>
      /from ['"]compromise/.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(importing).toEqual([]);
    for (const pkg of ['packages/estate/package.json', 'packages/generate/package.json']) {
      const manifest = JSON.parse(readFileSync(join(ROOT, pkg), 'utf8')) as Record<
        string,
        Record<string, string>
      >;
      expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }), pkg).not.toContain(
        'compromise',
      );
    }
  });

  it('defines none of the removed readers again, and the dispatch and recovery readers stay deleted', () => {
    const back: string[] = [];
    for (const [file, names] of Object.entries(REMOVED)) {
      // A file that does not exist holds no reader.
      if (!existsSync(join(ROOT, file))) continue;
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const name of names)
        if (new RegExp(`\\b(?:const|let|function|class)\\s+${name}\\b`).test(text))
          back.push(`${file}: ${name}`);
    }
    expect(back).toEqual([]);
    expect(existsSync(join(ROOT, 'packages/estate/src/graph/dispatch.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'packages/generate/src/estate/recovery.ts'))).toBe(false);
  });
});
