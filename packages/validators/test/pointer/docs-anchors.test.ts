import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../../src/ladders/pointer/bank/specs/index';
import { SPLIT_MERGE_MIN, TEXT_FLOOR, THRESHOLD, WEIGHTS } from './reference/anchor';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PAGE = readFileSync(join(ROOT, 'docs/estate-pointer-reader.md'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'docs/index.md'), 'utf8');

const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ /g, '-');
const headings = [...PAGE.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1] as string);
const headingSlugs = new Set(headings.map(slug));
const numbered = new Set(headings.map((h) => /^(\d+)[a-z]?\. /.exec(h)?.[1]).filter(Boolean));

/** The section each bank family rests on. A family not listed here has no page to rest on. */
const FAMILY_SECTIONS: Record<string, string[]> = {
  cutting: ['2-layer-a-cutting'],
  ids: ['4-layer-a-the-ledger'],
  're-anchoring': ['re-anchoring-on-a-changed-file', 're-anchoring-context-score'],
  grouping: ['6-from-labels-to-atoms', 'windows-and-carry-forward'],
  labels: [
    '1-label-sets-are-user-configuration',
    '3-layer-b-the-labeler-port',
    'validation-of-an-answer',
    'the-default-stack-margin-and-unanimous-votes',
  ],
  replay: ['5-cache-and-cassette', 'cassette-integrity-on-a-key-hit'],
  privacy: ['11-model-key-and-cost'],
  links: ['7-layer-c-links-and-monitoring'],
  radius: ['7-layer-c-links-and-monitoring', 'rerun-after-an-edit'],
  scale: ['2-layer-a-cutting'],
  adversarial: ['2-layer-a-cutting', 'sentence-boundaries-and-generic-templates'],
};

/** Every file that cites the page, with the sections it names. */
function citations(dir: string, out: Array<{ file: string; sections: string[] }> = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) citations(path, out);
    else if (/\.(ts|md)$/.test(name)) {
      const text = readFileSync(path, 'utf8');
      if (text.includes('estate-pointer-reader.md'))
        out.push({
          file: path,
          sections: [...text.matchAll(/estate-pointer-reader\.md section (\d+)/g)].map((m) => m[1] as string),
        });
    }
  }
  return out;
}

describe('the bank rests on docs/estate-pointer-reader.md', () => {
  it('is reachable from the docs index', () => {
    expect(INDEX).toContain('(estate-pointer-reader.md)');
  });

  it('gives every bank family a section of the page to rest on', () => {
    expect(Object.keys(FAMILY_SECTIONS).sort()).toEqual(FAMILIES.map((f) => f.id).sort());
    for (const [family, sections] of Object.entries(FAMILY_SECTIONS))
      for (const section of sections) expect(headingSlugs.has(section), `${family}: ${section}`).toBe(true);
  });

  it('names an existing section wherever the code cites one', () => {
    const cited = [
      ...citations(join(ROOT, 'packages/validators/src/ladders/pointer')),
      ...citations(join(ROOT, 'packages/validators/test/pointer')),
    ];
    expect(cited.length).toBeGreaterThanOrEqual(8);
    for (const { file, sections } of cited)
      for (const section of sections)
        expect(numbered.has(section), `${file} cites section ${section}`).toBe(true);
  });

  it('states the re-anchoring thresholds the reference reader uses', () => {
    expect(PAGE).toContain(`strictly above \`${TEXT_FLOOR}\``);
    expect(PAGE).toContain(
      `${WEIGHTS.text} × text similarity + ${WEIGHTS.context} × context similarity\` is strictly above \`${THRESHOLD}\``,
    );
    expect(PAGE).toContain(
      `${WEIGHTS.text} × normalised Levenshtein on text plus ${WEIGHTS.context} × context similarity`,
    );
    expect(PAGE).toContain(`(starting value ${THRESHOLD})`);
    expect(PAGE).toContain(`(starting value ${TEXT_FLOOR})`);
    expect(SPLIT_MERGE_MIN).toBeGreaterThan(THRESHOLD);
  });

  it('states the stack cut and the vote rules the stack items use', () => {
    expect(PAGE).toContain('`marginCut` defaults to `0.65`');
    expect(PAGE).toContain('the total differs from one by at most `0.01`');
    expect(PAGE).toContain('System 2 supplies three independent runs');
    expect(PAGE).toContain('`requireAgreement` defaults to false');
    expect(PAGE).toContain('A system-1 call retries once');
  });

  it('names the vendor of the system 1 client nowhere on the page', () => {
    expect(PAGE).not.toMatch(/\bjev\b/i);
  });
});
