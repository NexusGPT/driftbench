import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The rule the docs follow from the scan to the radius of an edit, declared once in docs/story-anchor.json. */
export type StoryAnchor = {
  atom: string;
  ledger: string;
  file: string;
  sentence: string;
  edit: { from: string; to: string };
  ask: string;
};

export const ANCHOR: StoryAnchor = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../docs/story-anchor.json', import.meta.url)), 'utf8'),
);
