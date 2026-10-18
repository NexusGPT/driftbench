import type { FileProvenance, FileStore, FileVariable } from '../../interface';
import { type FileCase, type FileCaseBuilder, fictionalStore, runFileCases, scenes, word } from '../files';
import type { StemRun } from '../item';
import { must, type Rng } from '../util';

/**
 * The stems that ask `quotes` whether the quotes of a store file are findable in the files they name
 * (docs/variables.md "Provenance"): word for word, after white space, typographic quotes, accents, characters
 * that print nothing and the backslash of markdown are folded; case and punctuation must match. Every scene has
 * its own file (depth, lines around the quote), words, place of the quote in the store and way of being wrong.
 */

const SCENES = 12;

/** The folding of the page, written again here so the bank can check that its own wrong quotes are wrong. */
function fold(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ');
}

const found = (file: string, quote: string) => fold(file).includes(fold(quote));

type Sentence = { text: string; words: string[] };

/** The canonical sentence of a scene: it carries an apostrophe, quotation marks, an accent, an underscore and a star. */
function sentence(rng: Rng): Sentence {
  const words = [word(rng, 5), word(rng, 4), word(rng, 6), word(rng, 5), word(rng, 4)];
  return {
    words,
    text: `When the ${words[0]} is ${words[1]}, don't tell the "${words[2]}" at the café about ${words[3]}_x* again.`,
  };
}

function fileText(rng: Rng, sentenceText: string): string {
  const before = Array.from(
    { length: rng.int(1, 4) },
    () => `Fictional line ${word(rng, 6)} ${word(rng, 4)}.`,
  );
  const after = Array.from(
    { length: rng.int(1, 4) },
    () => `Fictional line ${word(rng, 5)} ${word(rng, 5)}.`,
  );
  return `# Fictional file ${word(rng, 5)}\n\n${before.join('\n')}\n${sentenceText}\n${after.join('\n')}\n`;
}

/** How a file writes the canonical sentence in another form that the page folds to the same text. */
const FOLDED_FORMS: Record<string, (text: string, rng: Rng) => string> = {
  whitespace: (text, rng) =>
    text.replace(/ /g, () => ['  ', '\n', '\t', '   ', ' \n '][rng.int(0, 4)] as string),
  typographic: (text) => text.replace(/'/g, '’').replace(/"([^"]*)"/g, '“$1”'),
  'unicode-composition': (text) => text.replace(/é/g, 'é'),
  'markdown-escape': (text) => text.replace(/_/g, '\\_').replace(/\*/g, '\\*'),
  'invisible-characters': (text, rng) =>
    text.replace(/[a-z]{5,}/g, (w) => `${w.slice(0, 2)}${rng.chance(0.5) ? '​' : '‍'}${w.slice(2)}`),
};

/** Where a quote lives in a store: a variable, a value, a boundary or a constraint (docs/variables.md "Provenance"). */
function place(store: FileStore, scene: number, entry: FileProvenance, shift = 0): string {
  const n = store.variables.length;
  const v = (scene + shift) % n;
  const variable = store.variables[v] as FileVariable;
  switch ((scene + shift) % 4) {
    case 0: {
      variable.provenance = [...(variable.provenance ?? []), entry];
      return `variables.${v}.provenance.${variable.provenance.length - 1}`;
    }
    case 1: {
      const value = variable.values[variable.values.length - 1] as { provenance?: FileProvenance[] };
      value.provenance = [...(value.provenance ?? []), entry];
      return `variables.${v}.values.${variable.values.length - 1}.provenance.${value.provenance.length - 1}`;
    }
    case 2: {
      const first = variable.values[0] as { id: string };
      const second = variable.values[1] as { id: string };
      const edge = { id: `edge_${v}_${shift}`, title: 'Exactly at the limit' };
      variable.values.push(edge);
      const boundary = { holds: first.id, fails: second.id, edge: edge.id, provenance: [entry] };
      variable.boundaries = [...(variable.boundaries ?? []), boundary];
      return `variables.${v}.boundaries.${variable.boundaries.length - 1}.provenance.0`;
    }
    default: {
      const constraint = store.constraints?.[0];
      must(!!constraint, 'the fictional store has a constraint');
      const target = constraint as { provenance?: FileProvenance[] };
      target.provenance = [...(target.provenance ?? []), entry];
      return `constraints.0.provenance.${target.provenance.length - 1}`;
    }
  }
}

type Scene = {
  store: FileStore;
  path: string;
  /** The place of the quote entry in the store, as the page's dotted path. */
  at: string;
  s: Sentence;
  /** The quote the store cites. */
  quote: string;
  file: string;
};

function scene(
  rng: Rng,
  index: number,
  quote: (s: Sentence) => string,
  text?: (s: Sentence) => string,
): Scene {
  const { store } = fictionalStore(rng, index);
  const s = sentence(rng);
  const path = `fiction/${word(rng, 4)}/${index % 2 === 0 ? `${word(rng, 5)}/` : ''}${word(rng, 6)}.md`;
  const cited = quote(s);
  const entry: FileProvenance = { kind: 'quote', path, quote: cited };
  const at = place(store, index, entry);
  return { store, path, at, s, quote: cited, file: fileText(rng, text ? text(s) : s.text) };
}

/** The provenance list that a dotted entry path (`...provenance.K`) points into. */
function listAt(store: FileStore, entryPath: string): FileProvenance[] {
  const parts = entryPath.split('.').slice(0, -1);
  let node: unknown = store;
  for (const part of parts) node = (node as Record<string, unknown>)[part];
  must(Array.isArray(node), () => `the bank cannot find the provenance list of ${entryPath}`);
  return node as FileProvenance[];
}

const issue = (code: string, path: string) => ({ code, path });
const NOT_FOUND = 'VARIABLES_QUOTE_NOT_FOUND';
const UNREADABLE = 'VARIABLES_SOURCE_UNREADABLE';

const ok = (store: FileStore, files: Record<string, string>): FileCase => ({
  op: 'quotes',
  store,
  files,
  want: { kind: 'issues', issues: [] },
});
const wrong = (store: FileStore, files: Record<string, string>, code: string, path: string): FileCase => ({
  op: 'quotes',
  store,
  files,
  want: { kind: 'issues', issues: [issue(code, path)] },
});

/** A quote that is wrong because of its own words: no cut of the file holds it, folded or not. */
function broken(rng: Rng, s: Sentence, how: string): string {
  const parts = s.text.split(' ');
  switch (how) {
    case 'inserted-word':
      return [...parts.slice(0, 4), word(rng, 5), ...parts.slice(4)].join(' ');
    case 'changed-letter': {
      const i = s.text.indexOf(s.words[1] as string) + 1;
      const c = s.text[i] === 'z' ? 'q' : 'z';
      return `${s.text.slice(0, i)}${c}${s.text.slice(i + 1)}`;
    }
    case 'swapped-words':
      return [...parts.slice(0, 2), parts[3], parts[2], ...parts.slice(4)].join(' ');
    default:
      return `${s.text} ${word(rng, 5)}`;
  }
}

function checkedWrong(file: string, quote: string, label: string): string {
  must(!found(file, quote), () => `the bank's wrong quote is findable (${label}): this is a bug in the bank`);
  return quote;
}

const foldedForms: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) => {
    const form = FOLDED_FORMS[variant] as (text: string, rng: Rng) => string;
    // Even scenes write the form in the file, odd scenes write it in the quote; both fold to the same text.
    const inFile = index % 2 === 0;
    const a = scene(
      rng,
      index,
      (s) => (inFile ? s.text : form(s.text, rng)),
      (s) => (inFile ? form(s.text, rng) : s.text),
    );
    const b = scene(rng, index + 1, (s) => s.text);
    const c = scene(rng, index + 2, (s) =>
      broken(
        rng,
        s,
        ['inserted-word', 'changed-letter', 'swapped-words', 'appended-word'][index % 4] as string,
      ),
    );
    checkedWrong(c.file, c.quote, variant);
    const d = scene(rng, index + 3, (s) => s.text);
    return [
      ok(a.store, { [a.path]: a.file }),
      ok(b.store, { [b.path]: b.file }),
      wrong(c.store, { [c.path]: c.file }, NOT_FOUND, `${c.at}.quote`),
      wrong(d.store, {}, UNREADABLE, `${d.at}.path`),
    ];
  });

const exactForms: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) => {
    const make = (s: Sentence) =>
      variant === 'case-sensitive'
        ? s.text.replace(/^When/, 'when').replace(/ again\.$/, ' Again.')
        : ([
            s.text.replace(',', ';'),
            s.text.replace(', ', ' '),
            s.text.replace('.', '!'),
            s.text.replace('"', ''),
          ][index % 4] as string);
    const a = scene(rng, index, make);
    checkedWrong(a.file, make(a.s), variant);
    const b = scene(rng, index + 1, (s) => s.text);
    const c = scene(rng, index + 2, (s) => s.text);
    return [
      wrong(a.store, { [a.path]: a.file }, NOT_FOUND, `${a.at}.quote`),
      ok(b.store, { [b.path]: b.file }),
      wrong(
        c.store,
        { [`other/${word(rng, 4)}.md`]: 'Fictional unrelated file.\n' },
        UNREADABLE,
        `${c.at}.path`,
      ),
    ];
  });

const notFound: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) => {
    const a = scene(rng, index, (s) => broken(rng, s, variant));
    checkedWrong(a.file, a.quote, variant);
    const b = scene(rng, index + 1, (s) => s.text);
    const c = scene(rng, index + 2, (s) => s.text);
    return [
      wrong(a.store, { [a.path]: a.file }, NOT_FOUND, `${a.at}.quote`),
      ok(b.store, { [b.path]: b.file }),
      ok(c.store, { [c.path]: c.file, [`extra/${word(rng, 4)}.md`]: 'Fictional unused file.\n' }),
    ];
  });

const unreadable: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) => {
    if (variant === 'missing-file') {
      const a = scene(rng, index, (s) => s.text);
      const b = scene(rng, index + 1, (s) => s.text);
      const elsewhere = index % 2 === 1 ? { [`other/${word(rng, 4)}.md`]: 'Fictional other file.\n' } : {};
      return [wrong(a.store, elsewhere, UNREADABLE, `${a.at}.path`), ok(b.store, { [b.path]: b.file })];
    }
    if (variant === 'once-per-file') {
      // Two quotes in one list name one missing file: one issue, at the first of them. A third quote on a present
      // file, placed elsewhere, is fine.
      const a = scene(rng, index, (s) => s.text);
      listAt(a.store, a.at).push({
        kind: 'quote',
        path: a.path,
        quote: `${a.s.text} Fictional second quote.`,
      });
      const present = `fiction/present_${word(rng, 4)}.md`;
      place(a.store, index, { kind: 'quote', path: present, quote: a.s.text }, 2);
      const files = { [present]: fileText(rng, a.s.text) };
      const b = scene(rng, index + 1, (s) => s.text);
      const c = scene(rng, index + 2, (s) => s.text);
      return [
        wrong(a.store, files, UNREADABLE, `${a.at}.path`),
        ok(b.store, { [b.path]: b.file }),
        wrong(c.store, {}, UNREADABLE, `${c.at}.path`),
      ];
    }
    // unreadable-and-not-found: a missing file and a present file with a wrong quote, in one store.
    const a = scene(rng, index, (s) => s.text);
    const present = `fiction/present_${word(rng, 4)}.md`;
    const bad: FileProvenance = { kind: 'quote', path: present, quote: broken(rng, a.s, 'inserted-word') };
    const badAt = place(a.store, index, bad, 1);
    const text = fileText(rng, a.s.text);
    checkedWrong(text, bad.quote, variant);
    const b = scene(rng, index + 1, (s) => s.text);
    const c = scene(rng, index + 2, (s) => s.text);
    return [
      {
        op: 'quotes',
        store: a.store,
        files: { [present]: text },
        want: {
          kind: 'issues',
          issues: [issue(UNREADABLE, `${a.at}.path`), issue(NOT_FOUND, `${badAt}.quote`)],
        },
      },
      ok(b.store, { [b.path]: b.file }),
      wrong(c.store, {}, UNREADABLE, `${c.at}.path`),
    ];
  });

/** The cases of each quote-verification stem, by stem id. */
export const VERIFY_CASES: Record<string, FileCaseBuilder> = {
  'quotes.verify.folded-forms': foldedForms,
  'quotes.verify.exact-forms': exactForms,
  'quotes.verify.not-found': notFound,
  'quotes.verify.unreadable-file': unreadable,
};

export const VERIFY_RUNS: Record<string, StemRun> = Object.fromEntries(
  Object.entries(VERIFY_CASES).map(([stem, build]) => [
    stem,
    (variant, ctx) => runFileCases(ctx, build(variant, ctx), `${stem}.${variant}`),
  ]),
);
