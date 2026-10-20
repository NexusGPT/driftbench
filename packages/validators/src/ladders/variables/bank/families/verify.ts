import type { FileProvenance, FileStore, FileVariable } from '../../interface';
import { type FileCase, type FileCaseBuilder, fictionalStore, runFileCases, scenes, word } from '../files';
import type { StemRun } from '../item';
import { must, type Rng } from '../util';

/**
 * The stems that ask `quotes` whether the quotes of a store file are findable in the files they name
 * (docs/variables.md "Provenance"): word for word, after white space, typographic quotes, accents, characters
 * that print nothing and the backslash of markdown are folded; case and punctuation must match.
 *
 * What is right lives in the RELATION between a quote and its file, never in either alone. A scene asks five
 * requests, each with a store, a sentence and a file of its own (so no request names another):
 *   - the quote is in the file, written the way the scene's form says;
 *   - the same, with a quote that looks altered and a file that holds exactly that altered text;
 *   - the quote is altered and the file holds the original;
 *   - the quote is the original and the file holds the altered text;
 *   - the file is absent.
 * Whether a quote looks altered, how long it is, how its file looks and whether a file has decoy lines tell
 * nothing: an adapter that reads requests and remembers earlier ones, that answers a missing file from the file
 * list, has to guess on every request whose file is present. That is at least 2 to the minus 40 per item (48 or more such requests); the tests measure it.
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

/** Six shapes of one sentence, each with an apostrophe, quotation marks, an accent, an underscore and a star. */
const SHAPES: ReadonlyArray<(w: string[]) => string> = [
  (w) => `When the ${w[0]} is ${w[1]}, don't tell the "${w[2]}" at the café about ${w[3]}_x* again.`,
  (w) => `If a ${w[0]} is ${w[1]} then don't send the "${w[2]}" to the café before ${w[3]}_x*.`,
  (w) => `Never let the ${w[0]} near the café; don't forget "${w[2]}" and ${w[3]}_x* with the ${w[1]} today.`,
  (w) => `At the café the ${w[0]} is ${w[3]}_x*, so don't read "${w[2]}" aloud to the ${w[1]}.`,
  (w) => `Ask the ${w[0]}, then the ${w[1]}, and don't use the "${w[2]}" or ${w[3]}_x* at the café.`,
  (w) => `Please don't mix ${w[0]} with "${w[2]}" at the café unless ${w[3]}_x* says ${w[1]} again.`,
];

function sentence(rng: Rng): Sentence {
  const words = [word(rng, 5), word(rng, 4), word(rng, 6), word(rng, 5)];
  return { words, text: (rng.pick(SHAPES) as (w: string[]) => string)(words) };
}

const LETTERS = 'bdfgklmnprstvz';

/**
 * A different text that no cut of the original holds and that holds no cut of the original, so a quote and a
 * file that disagree this way never find each other in either direction.
 */
function alter(rng: Rng, s: Sentence, how: string): string {
  const [a, b, c, d] = s.words as [string, string, string, string];
  const tokens = s.text.split(' ');
  switch (how) {
    case 'inserted-word':
      return [...tokens.slice(0, 3), word(rng, 5), ...tokens.slice(3)].join(' ');
    case 'changed-letter': {
      const i = s.text.indexOf(a) + 1 + rng.int(0, a.length - 3);
      const old = s.text[i] as string;
      let letter = rng.pick([...LETTERS]);
      while (letter === old) letter = rng.pick([...LETTERS]);
      return `${s.text.slice(0, i)}${letter}${s.text.slice(i + 1)}`;
    }
    case 'swapped-words': {
      const bare = (token: string) => token.replace(/[^a-z]/gi, '');
      const i = tokens.findIndex((t) => bare(t) === a);
      const j = tokens.findIndex((t) => bare(t) === b);
      const copy = [...tokens];
      [copy[i], copy[j]] = [copy[j] as string, copy[i] as string];
      return copy.join(' ');
    }
    case 'changed-last-word': {
      let replacement = word(rng, d.length);
      while (replacement === d) replacement = word(rng, d.length);
      return s.text.replace(d, replacement);
    }
    // exact-forms
    case 'case':
      return s.text
        .replace(/^./, (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()))
        .replace(c, `${c.charAt(0).toUpperCase()}${c.slice(1)}`);
    default: {
      // punctuation: the full stop becomes a bang, the first comma or semicolon goes, or a quotation mark goes.
      const options = [
        s.text.replace(/\.$/, '!'),
        s.text.replace(/[,;]/, ''),
        s.text.replace('"', ''),
        s.text.replace(/\.$/, ','),
      ].filter((option) => option !== s.text);
      return options[rng.int(0, options.length - 1)] as string;
    }
  }
}

/** How a file (or a quote) writes the original in another form that the page folds to the same text. */
const FORMS: Record<string, (text: string, rng: Rng) => string> = {
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

/** The provenance list that a dotted entry path (`...provenance.K`) points into. */
function listAt(store: FileStore, entryPath: string): FileProvenance[] {
  const parts = entryPath.split('.').slice(0, -1);
  let node: unknown = store;
  for (const part of parts) node = (node as Record<string, unknown>)[part];
  must(Array.isArray(node), () => `the bank cannot find the provenance list of ${entryPath}`);
  return node as FileProvenance[];
}

type Built = { store: FileStore; path: string; at: string; file: string; quote: string };

type Relation =
  /** The quote is in the file; `altered` writes both as the altered text. */
  | { holds: true; altered?: boolean }
  /** The quote is altered and the file holds the original, or the other way round. */
  | { holds: false; side: 'quote' | 'file' };

type Spec = {
  rng: Rng;
  index: number;
  relation: Relation;
  /** How the altered text is made. */
  how: string;
  /** A form the page folds, written on one side. */
  form?: { name: string; side: 'quote' | 'file' };
};

/** One request: a store with its own agent, a sentence of its own, and a file that relates to the quote as asked. */
function request({ rng, index, relation, how, form }: Spec): Built {
  const { store } = fictionalStore(rng, index);
  const s = sentence(rng);
  const alt = alter(rng, s, how);
  const other = alter(rng, s, how === 'inserted-word' ? 'changed-letter' : 'inserted-word');
  let quote: string;
  let inFile: string;
  if (relation.holds) {
    quote = relation.altered ? alt : s.text;
    inFile = quote;
  } else if (relation.side === 'quote') {
    quote = alt;
    inFile = s.text;
  } else {
    quote = s.text;
    inFile = alt;
  }
  if (form) {
    const make = FORMS[form.name] as (text: string, rng: Rng) => string;
    if (form.side === 'quote') quote = make(quote, rng);
    else inFile = make(inFile, rng);
  }
  const path = `fiction/${word(rng, 4)}/${index % 2 === 0 ? `${word(rng, 5)}/` : ''}${word(rng, 6)}.md`;
  const entry: FileProvenance = { kind: 'quote', path, quote };
  const at = place(store, index, entry);
  // A decoy line: another alteration of the sentence the file holds. It is never the quote, so it tells nothing.
  const decoy =
    relation.holds || relation.side === 'quote'
      ? other
      : alter(rng, { ...s, text: s.text }, 'changed-letter');
  const before = Array.from(
    { length: rng.int(1, 4) },
    () => `Fictional line ${word(rng, 6)} ${word(rng, 4)}.`,
  );
  const after = Array.from(
    { length: rng.int(1, 4) },
    () => `Fictional line ${word(rng, 5)} ${word(rng, 5)}.`,
  );
  const lines = rng.chance(0.5) ? [...before, inFile, decoy, ...after] : [...before, decoy, inFile, ...after];
  const file = `# Fictional file ${word(rng, 5)}\n\n${lines.join('\n')}\n`;
  const expected = relation.holds;
  must(
    found(file, quote) === expected,
    () =>
      `the bank's ${expected ? 'findable' : 'wrong'} quote is ${expected ? 'not findable' : 'findable'} (${how}): this is a bug in the bank`,
  );
  return { store, path, at, file, quote };
}

const issue = (code: string, path: string) => ({ code, path });
const NOT_FOUND = 'VARIABLES_QUOTE_NOT_FOUND';
const UNREADABLE = 'VARIABLES_SOURCE_UNREADABLE';

const ok = (b: Built): FileCase => ({
  op: 'quotes',
  store: b.store,
  files: { [b.path]: b.file },
  want: { kind: 'issues', issues: [] },
});
const notFound = (b: Built): FileCase => ({
  op: 'quotes',
  store: b.store,
  files: { [b.path]: b.file },
  want: { kind: 'issues', issues: [issue(NOT_FOUND, `${b.at}.quote`)] },
});
/** The file is not among the files given (alone, or beside a file the store does not name). */
const missing = (b: Built, elsewhere = false, rng?: Rng): FileCase => ({
  op: 'quotes',
  store: b.store,
  files: elsewhere && rng ? { [`other/${word(rng, 4)}.md`]: 'Fictional unrelated file.\n' } : {},
  want: { kind: 'issues', issues: [issue(UNREADABLE, `${b.at}.path`)] },
});

/** The five requests of a scene: two that hold, two that break the relation (one on each side), one missing file. */
function fiveRequests(
  rng: Rng,
  index: number,
  how: string,
  form?: { name: string; side: 'quote' | 'file' },
): FileCase[] {
  const flip = form
    ? ({ name: form.name, side: form.side === 'quote' ? 'file' : 'quote' } as const)
    : undefined;
  return [
    ok(request({ rng, index, relation: { holds: true }, how, ...(form ? { form } : {}) })),
    ok(
      request({
        rng,
        index: index + 1,
        relation: { holds: true, altered: true },
        how,
        ...(flip ? { form: flip } : {}),
      }),
    ),
    notFound(
      request({
        rng,
        index: index + 2,
        relation: { holds: false, side: 'quote' },
        how,
        ...(form ? { form } : {}),
      }),
    ),
    notFound(
      request({
        rng,
        index: index + 3,
        relation: { holds: false, side: 'file' },
        how,
        ...(form ? { form } : {}),
      }),
    ),
    missing(request({ rng, index: index + 4, relation: { holds: true }, how }), index % 2 === 1, rng),
  ];
}

const foldedForms: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) =>
    // Even scenes write the form in the file, odd scenes write it in the quote; both fold to the same text.
    fiveRequests(
      rng,
      index,
      ['inserted-word', 'changed-letter', 'swapped-words', 'changed-last-word'][index % 4] as string,
      {
        name: variant,
        side: index % 2 === 0 ? 'file' : 'quote',
      },
    ),
  );

const exactForms: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) =>
    fiveRequests(rng, index, variant === 'case-sensitive' ? 'case' : 'punctuation'),
  );

const notFoundForms: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) => fiveRequests(rng, index, variant));

const unreadable: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, index) => {
    const how = ['inserted-word', 'changed-letter', 'swapped-words', 'changed-last-word'][
      index % 4
    ] as string;
    const plain = (relation: Relation, shift: number) =>
      request({ rng, index: index + shift, relation, how });
    const third: Relation =
      index % 2 === 0 ? { holds: true } : { holds: false, side: index % 4 === 1 ? 'quote' : 'file' };
    if (variant === 'missing-file') {
      return [
        missing(plain({ holds: true }, 0), index % 2 === 1, rng),
        ok(plain({ holds: true }, 1)),
        notFound(plain({ holds: false, side: 'quote' }, 2)),
        notFound(plain({ holds: false, side: 'file' }, 3)),
        ok(plain({ holds: true, altered: true }, 4)),
      ];
    }
    if (variant === 'once-per-file') {
      // Two quotes in one list name one missing file: one issue, at the first of them. A third quote names a
      // present file, and whether it is found depends on the file. The three sentences are unrelated.
      const a = plain({ holds: true }, 0);
      listAt(a.store, a.at).push({
        kind: 'quote',
        path: a.path,
        quote: `Fictional second quote ${word(rng, 6)}.`,
      });
      const c = plain(third, 1);
      const thirdEntry = { kind: 'quote' as const, path: c.path, quote: c.quote };
      const thirdAt = place(a.store, index, thirdEntry, 2);
      const issues = [issue(UNREADABLE, `${a.at}.path`)];
      if (!third.holds) issues.push(issue(NOT_FOUND, `${thirdAt}.quote`));
      return [
        { op: 'quotes', store: a.store, files: { [c.path]: c.file }, want: { kind: 'issues', issues } },
        missing(plain({ holds: true }, 2)),
        ok(plain({ holds: true, altered: true }, 3)),
        notFound(plain({ holds: false, side: 'file' }, 4)),
        notFound(plain({ holds: false, side: 'quote' }, 5)),
      ];
    }
    // unreadable-and-not-found: a missing file and a present file in one store; the present quote is found or not.
    const a = plain({ holds: true }, 0);
    const c = plain(third, 1);
    const cAt = place(a.store, index, { kind: 'quote', path: c.path, quote: c.quote }, 1);
    const issues = [issue(UNREADABLE, `${a.at}.path`)];
    if (!third.holds) issues.push(issue(NOT_FOUND, `${cAt}.quote`));
    return [
      { op: 'quotes', store: a.store, files: { [c.path]: c.file }, want: { kind: 'issues', issues } },
      missing(plain({ holds: true }, 2)),
      ok(plain({ holds: true }, 3)),
      notFound(plain({ holds: false, side: 'quote' }, 4)),
      notFound(plain({ holds: false, side: 'file' }, 5)),
    ];
  });

/** The cases of each quote-verification stem, by stem id. */
export const VERIFY_CASES: Record<string, FileCaseBuilder> = {
  'quotes.verify.folded-forms': foldedForms,
  'quotes.verify.exact-forms': exactForms,
  'quotes.verify.not-found': notFoundForms,
  'quotes.verify.unreadable-file': unreadable,
};

export const VERIFY_RUNS: Record<string, StemRun> = Object.fromEntries(
  Object.entries(VERIFY_CASES).map(([stem, build]) => [
    stem,
    (variant, ctx) => runFileCases(ctx, build(variant, ctx), `${stem}.${variant}`),
  ]),
);
