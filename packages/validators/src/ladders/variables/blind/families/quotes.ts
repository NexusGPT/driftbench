import { createHash } from 'node:crypto';
import type { ItemContext } from '../../bank/item';
import type { Rng } from '../../bank/util';
import type { FileProvenance, FileStore } from '../../interface';
import { baseFile, constraintOf, copy, variableOf } from '../files';
import * as f from '../folds';
import { callBuild, callQuotes, must, type Stem, show } from '../kit';
import { OWNER_DATE, varOf } from '../scene';

/** Family quotes: R2 (a quote is findable after the folding of Provenance, else the value is refused), the quote check. */

const PATH = 'agent/prompt.md';
const SENTENCE = 'When a parcel is late by more than two days, tell the customer and offer a supplier email.';
const FILE = [
  '# Returns desk',
  '',
  'Our returns desk answers within two working days.',
  SENTENCE,
  'Never promise a refund before the case is approved.',
  'Ask for the order number before any lookup.',
  '',
].join('\n');

type Where = 'variable' | 'value' | 'boundary' | 'constraint';

const BASES: Record<Where, string> = {
  variable: 'variables.2.provenance.0',
  value: 'variables.2.values.0.provenance.0',
  boundary: 'variables.2.boundaries.0.provenance.0',
  constraint: 'constraints.0.provenance.0',
};

function storeWith(ctx: ItemContext, where: Where, entry: FileProvenance): FileStore {
  const { store } = baseFile(ctx);
  const q = copy(entry);
  if (where === 'variable') variableOf(store, 2).provenance = [q];
  if (where === 'value')
    (variableOf(store, 2).values[0] as { provenance?: FileProvenance[] }).provenance = [q];
  if (where === 'boundary')
    (variableOf(store, 2).boundaries?.[0] as { provenance?: FileProvenance[] }).provenance = [q];
  if (where === 'constraint') constraintOf(store, 0).provenance = [q];
  return store;
}

const quote = (text: string, path = PATH): FileProvenance => ({ kind: 'quote', path, quote: text });

function noErrors(ctx: ItemContext, store: FileStore, files: Record<string, string>, label: string): void {
  const r = callQuotes(ctx, store, files);
  must(r.errors.length === 0, () => `${label}: ${show(r.errors, 240)}`);
}

function oneError(
  ctx: ItemContext,
  store: FileStore,
  files: Record<string, string>,
  code: string,
  path: string,
): void {
  const r = callQuotes(ctx, store, files);
  must(
    r.errors.length === 1,
    () => `${r.errors.length} errors ${show(r.errors, 240)}; expected the one ${code} at ${path}`,
  );
  const e = r.errors[0] as { code: string; path: string };
  must(e.code === code && e.path === path, () => `error ${e.code} at ${e.path}; expected ${code} at ${path}`);
}

const foundAt =
  (where: Where) =>
  (ctx: ItemContext): void =>
    oneError(
      ctx,
      storeWith(ctx, where, quote('Offer a refund in euros before the case is approved.')),
      { [PATH]: FILE },
      'VARIABLES_QUOTE_NOT_FOUND',
      `${BASES[where]}.quote`,
    );

/** The text is findable once folded: the quote and the file differ only in what the page folds. */
const folds =
  (label: string, make: (rng: Rng) => f.Pair) =>
  (ctx: ItemContext): void => {
    const { inFile, inQuote } = make(ctx.rng);
    noErrors(
      ctx,
      storeWith(ctx, 'value', quote(inQuote)),
      { [PATH]: f.around(ctx.rng, inFile) },
      `${label}: the quote ${show(inQuote)} is the file text ${show(inFile)} once folded, and was reported`,
    );
  };

const differs =
  (make: (rng: Rng) => f.Pair) =>
  (ctx: ItemContext): void => {
    const { inFile, inQuote } = make(ctx.rng);
    oneError(
      ctx,
      storeWith(ctx, 'value', quote(inQuote)),
      { [PATH]: f.around(ctx.rng, inFile) },
      'VARIABLES_QUOTE_NOT_FOUND',
      `${BASES.value}.quote`,
    );
  };

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const SETTINGS = {
  permissions: { deny: ['rm', 'curl'], allow: ['ls'] },
  steps: [{ name: 'intake' }, { name: 'resolve' }],
};

type Structure = {
  kind: 'structure';
  path: string;
  hash: string;
  pointer?: string;
  lines?: { start: number; end: number };
};
const structure = (entry: Structure): FileProvenance => entry as unknown as FileProvenance;

const SCRIPT = ['#!/bin/sh', 'echo intake', 'echo resolve', 'echo close'];

/** Builds an estate whose file text is `fileText` and whose tool values carry the given quotes. */
function estateWith(fileText: string, quotes: Record<string, string>, source = PATH) {
  return {
    files: { [PATH]: fileText },
    rules: [
      {
        id: 'rule.0',
        source,
        conditions: [],
        tools: [
          {
            tool: 'desk_tool',
            field: 'queue',
            source,
            values: Object.entries(quotes).map(([id, q]) => ({ id, quote: q })),
          },
        ],
      },
    ],
  };
}

const Q1 = 'Route the case to alpha when the parcel is damaged.';
const Q2 = 'Route the case to beta when the parcel is late.';
const Q3 = 'Route the case to gamma when the order is a gift.';
const READER_FILE = [Q1, Q2, Q3, 'Nothing else matters.'].join('\n');

function kept(store: ReturnType<typeof callBuild>, id: string): boolean {
  return store.variables.some((v) => v.values.some((x) => x.id === id));
}

export const QUOTES_STEMS: readonly Stem[] = [
  {
    id: 'quotes.check',
    rules: ['Provenance'],
    family: 'quotes',
    component: 'store/quotes',
    cause: 'the quote check reports each wrong quote and each missing file once, at the path of the page',
    cases: [
      [
        'quote-is-found',
        1,
        (ctx) =>
          noErrors(
            ctx,
            storeWith(ctx, 'value', quote(SENTENCE)),
            { [PATH]: FILE },
            'a quote that is in its file was reported',
          ),
      ],
      ['quote-is-not-found', 1, foundAt('value')],
      ['not-found-in-a-variable', 2, foundAt('variable')],
      ['not-found-in-a-boundary', 2, foundAt('boundary')],
      ['not-found-in-a-constraint', 2, foundAt('constraint')],
      [
        'found-in-every-place-a-quote-can-sit',
        2,
        (ctx) => {
          const store = storeWith(ctx, 'value', quote(SENTENCE));
          variableOf(store, 2).provenance = [quote('Ask for the order number before any lookup.')];
          (variableOf(store, 2).boundaries?.[0] as { provenance?: FileProvenance[] }).provenance = [
            quote('Never promise a refund before the case is approved.'),
          ];
          constraintOf(store, 0).provenance = [quote('Our returns desk answers within two working days.')];
          noErrors(ctx, store, { [PATH]: FILE }, 'quotes that sit in their file were reported');
        },
      ],
      [
        'file-is-missing',
        1,
        (ctx) =>
          oneError(
            ctx,
            storeWith(ctx, 'value', quote(SENTENCE, 'agent/gone.md')),
            { [PATH]: FILE },
            'VARIABLES_SOURCE_UNREADABLE',
            `${BASES.value}.path`,
          ),
      ],
      [
        'one-missing-file-is-reported-once',
        2,
        (ctx) => {
          const store = storeWith(ctx, 'value', quote(SENTENCE, 'agent/gone.md'));
          const v = variableOf(store, 2);
          (v.values[1] as { provenance?: FileProvenance[] }).provenance = [
            quote('Another line of the same missing file.', 'agent/gone.md'),
          ];
          (v.values[2] as { provenance?: FileProvenance[] }).provenance = [
            quote('And a third line.', 'agent/gone.md'),
          ];
          oneError(
            ctx,
            store,
            { [PATH]: FILE },
            'VARIABLES_SOURCE_UNREADABLE',
            'variables.2.values.0.provenance.0.path',
          );
        },
      ],
      [
        'two-missing-files-are-two-errors',
        2,
        (ctx) => {
          const store = storeWith(ctx, 'value', quote(SENTENCE, 'agent/gone.md'));
          (variableOf(store, 2).values[1] as { provenance?: FileProvenance[] }).provenance = [
            quote(SENTENCE, 'agent/lost.md'),
          ];
          const r = callQuotes(ctx, store, { [PATH]: FILE });
          const paths = r.errors.map((e) => e.path).sort();
          must(
            r.errors.length === 2 &&
              r.errors.every((e) => e.code === 'VARIABLES_SOURCE_UNREADABLE') &&
              paths[0] === 'variables.2.values.0.provenance.0.path' &&
              paths[1] === 'variables.2.values.1.provenance.0.path',
            () =>
              `errors ${show(r.errors, 300)}; expected one VARIABLES_SOURCE_UNREADABLE for each missing file`,
          );
        },
      ],
      [
        'a-missing-file-and-a-wrong-quote-are-both-reported',
        3,
        (ctx) => {
          const store = storeWith(ctx, 'value', quote(SENTENCE, 'agent/gone.md'));
          (variableOf(store, 2).values[1] as { provenance?: FileProvenance[] }).provenance = [
            quote('Pay out the refund at once.'),
          ];
          const r = callQuotes(ctx, store, { [PATH]: FILE });
          const codes = r.errors.map((e) => `${e.code} at ${e.path}`).sort();
          must(
            JSON.stringify(codes) ===
              JSON.stringify([
                'VARIABLES_QUOTE_NOT_FOUND at variables.2.values.1.provenance.0.quote',
                'VARIABLES_SOURCE_UNREADABLE at variables.2.values.0.provenance.0.path',
              ]),
            () => `errors ${show(codes, 300)}`,
          );
        },
      ],
      [
        'quote-is-in-another-file',
        2,
        (ctx) =>
          oneError(
            ctx,
            storeWith(ctx, 'value', quote(SENTENCE, 'agent/other.md')),
            { [PATH]: FILE, 'agent/other.md': 'A file with other words.\n' },
            'VARIABLES_QUOTE_NOT_FOUND',
            `${BASES.value}.quote`,
          ),
      ],
      [
        'no-files-at-all',
        2,
        (ctx) =>
          oneError(
            ctx,
            storeWith(ctx, 'value', quote(SENTENCE)),
            {},
            'VARIABLES_SOURCE_UNREADABLE',
            `${BASES.value}.path`,
          ),
      ],
      [
        'an-empty-file-is-readable',
        3,
        (ctx) =>
          oneError(
            ctx,
            storeWith(ctx, 'value', quote(SENTENCE)),
            { [PATH]: '' },
            'VARIABLES_QUOTE_NOT_FOUND',
            `${BASES.value}.quote`,
          ),
      ],
      [
        'quote-longer-than-the-file',
        2,
        (ctx) =>
          oneError(
            ctx,
            storeWith(ctx, 'value', quote(`${SENTENCE} ${SENTENCE} ${SENTENCE}`)),
            { [PATH]: FILE },
            'VARIABLES_QUOTE_NOT_FOUND',
            `${BASES.value}.quote`,
          ),
      ],
      [
        'conversation-and-owner-evidence-need-no-file',
        2,
        (ctx) => {
          const store = storeWith(ctx, 'value', {
            kind: 'conversations',
            count: 3,
            total: 10,
            set_hash: 'a'.repeat(64),
          });
          (variableOf(store, 2).values[1] as { provenance?: FileProvenance[] }).provenance = [
            { kind: 'owner', words: 'I have seen this.', date: OWNER_DATE },
          ];
          noErrors(ctx, store, {}, 'evidence that is no quote was checked against files');
        },
      ],
      [
        'ledger-id-does-not-change-the-check',
        2,
        (ctx) =>
          noErrors(
            ctx,
            storeWith(ctx, 'value', { kind: 'quote', path: PATH, quote: SENTENCE, ledger: 'abcdefghij' }),
            { [PATH]: FILE },
            'a quote with a ledger id was reported',
          ),
      ],
      [
        'the-same-quote-twice-is-fine',
        1,
        (ctx) => {
          const store = storeWith(ctx, 'value', quote(SENTENCE));
          (variableOf(store, 2).values[1] as { provenance?: FileProvenance[] }).provenance = [
            quote(SENTENCE),
          ];
          noErrors(ctx, store, { [PATH]: FILE }, 'a quote used twice was reported');
        },
      ],
      [
        'quote-of-a-thousand-characters',
        3,
        (ctx) => {
          const text = 'word '.repeat(200).slice(0, 999).trimEnd().padEnd(1000, 'x');
          noErrors(
            ctx,
            storeWith(ctx, 'value', quote(text)),
            { [PATH]: `Intro line.\n${text}\nOutro line.\n` },
            'a quote of 1000 characters in its file was reported',
          );
        },
      ],
      [
        'quote-of-a-thousand-characters-off-by-one-at-the-end',
        4,
        (ctx) => {
          const text = 'word '.repeat(200).slice(0, 999).trimEnd().padEnd(1000, 'x');
          oneError(
            ctx,
            storeWith(ctx, 'value', quote(`${text.slice(0, 999)}y`)),
            { [PATH]: `Intro line.\n${text}\nOutro line.\n` },
            'VARIABLES_QUOTE_NOT_FOUND',
            `${BASES.value}.quote`,
          );
        },
      ],
    ],
  },
  {
    id: 'quotes.folding',
    rules: ['Provenance'],
    family: 'quotes',
    component: 'store/quotes',
    cause:
      'a quote is found word for word after the folding of white space, typographic quotes, accents, characters that print nothing and the markdown backslash, and case and punctuation must match',
    cases: [
      ['white-space-runs-in-the-quote', 2, folds('white space', f.whiteSpaceInTheQuote)],
      ['white-space-runs-in-the-file', 2, folds('white space', f.whiteSpaceInTheFile)],
      ['typographic-double-quotes-in-the-file', 2, folds('double quotes', f.doubleQuotesInTheFile)],
      ['typographic-single-quotes-in-the-file', 2, folds('single quotes', f.singleQuotesInTheFile)],
      ['typographic-quotes-in-the-quote', 3, folds('quotes in the quote', f.typographicQuotesInTheQuote)],
      ['composed-accents-in-the-file-decomposed-in-the-quote', 3, folds('accents', f.composedInTheFile)],
      ['decomposed-accents-in-the-file-composed-in-the-quote', 3, folds('accents', f.decomposedInTheFile)],
      ['zero-width-characters-in-the-file', 3, folds('zero width', f.zeroWidthInTheFile)],
      ['zero-width-characters-in-the-quote', 3, folds('zero width', f.zeroWidthInTheQuote)],
      ['soft-hyphen-prints-nothing', 4, folds('soft hyphen', f.softHyphen)],
      ['markdown-backslash-before-an-asterisk', 3, folds('markdown backslash', f.backslashBeforeAsterisk)],
      ['markdown-backslash-before-an-underscore', 3, folds('markdown backslash', f.backslashBeforeUnderscore)],
      ['case-must-match', 2, differs(f.caseMustMatch)],
      ['punctuation-must-match', 2, differs(f.punctuationMustMatch)],
      ['a-missing-word-is-not-found', 2, differs(f.missingWord)],
      ['accents-must-still-match', 3, differs(f.accentMustMatch)],
    ],
  },
  {
    id: 'quotes.structure',
    rules: ['Provenance'],
    family: 'quotes',
    component: 'store/quotes',
    cause:
      'a structure entry resolves its JSON pointer or its lines and compares the hash of that place, with the codes of the page',
    cases: [
      [
        'pointer-and-hash-match',
        3,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'settings.json',
            pointer: '/permissions/deny/0',
            hash: sha(canon('rm')),
          });
          noErrors(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'settings.json': JSON.stringify(SETTINGS, null, 2) },
            'a structure entry that matches was reported',
          );
        },
      ],
      [
        'reformatted-file-and-another-key-order-keep-the-hash',
        4,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'settings.json',
            pointer: '/permissions',
            hash: sha(canon(SETTINGS.permissions)),
          });
          const shuffled = `{"steps":[{"name":"intake"},{"name":"resolve"}],\n\n"permissions":{ "allow":["ls"],"deny":["rm","curl"] }}`;
          noErrors(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'settings.json': shuffled },
            'a reformatted file with another key order changed the hash',
          );
        },
      ],
      [
        'hash-does-not-match',
        3,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'settings.json',
            pointer: '/permissions/deny/0',
            hash: sha(canon('rm')),
          });
          const changed = { ...SETTINGS, permissions: { ...SETTINGS.permissions, deny: ['mv', 'curl'] } };
          oneError(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'settings.json': JSON.stringify(changed) },
            'VARIABLES_HASH_MISMATCH',
            `${BASES.value}.hash`,
          );
        },
      ],
      [
        'pointer-names-nothing',
        3,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'settings.json',
            pointer: '/permissions/deny/9',
            hash: sha(canon('rm')),
          });
          oneError(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'settings.json': JSON.stringify(SETTINGS) },
            'VARIABLES_POINTER_UNRESOLVED',
            `${BASES.value}.pointer`,
          );
        },
      ],
      [
        'file-is-not-json-or-yaml',
        4,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'settings.json',
            pointer: '/permissions',
            hash: sha(canon(SETTINGS.permissions)),
          });
          oneError(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'settings.json': '{ "permissions": [ unclosed' },
            'VARIABLES_POINTER_UNRESOLVED',
            `${BASES.value}.pointer`,
          );
        },
      ],
      [
        'the-empty-pointer-is-the-whole-file',
        4,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'settings.json',
            pointer: '',
            hash: sha(canon(SETTINGS)),
          });
          noErrors(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'settings.json': JSON.stringify(SETTINGS) },
            'the empty pointer did not resolve to the whole file',
          );
        },
      ],
      [
        'lines-and-hash-match',
        3,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'run.sh',
            lines: { start: 2, end: 3 },
            hash: sha(SCRIPT.slice(1, 3).join('\n')),
          });
          noErrors(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'run.sh': SCRIPT.join('\n') },
            'a lines entry that matches was reported',
          );
        },
      ],
      [
        'lines-past-the-end-of-the-file',
        4,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'run.sh',
            lines: { start: 2, end: 40 },
            hash: sha(SCRIPT.slice(1).join('\n')),
          });
          oneError(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'run.sh': SCRIPT.join('\n') },
            'VARIABLES_POINTER_UNRESOLVED',
            `${BASES.value}.lines`,
          );
        },
      ],
      [
        'windows-line-breaks-read-the-same',
        4,
        (ctx) => {
          const entry = structure({
            kind: 'structure',
            path: 'run.sh',
            lines: { start: 1, end: 4 },
            hash: sha(SCRIPT.join('\n')),
          });
          noErrors(
            ctx,
            storeWith(ctx, 'value', entry),
            { 'run.sh': SCRIPT.join('\r\n') },
            'a Windows line break changed the hash of the lines',
          );
        },
      ],
    ],
  },
  {
    id: 'quotes.reader',
    rules: ['R2'],
    family: 'quotes',
    component: 'store/estate',
    cause:
      'an estate reader keeps a value only when its quote is findable in the supplied file under the exact named path, else refuses it with a reason',
    cases: [
      [
        'quotes-in-the-file-are-kept-unchanged',
        1,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, { alpha: Q1, beta: Q2, gamma: Q3 }),
          });
          const v = varOf(store, ['alpha', 'beta', 'gamma']);
          must(store.refused.length === 0, () => `refusals ${show(store.refused)}`);
          const q = v.values.find((x) => x.id === 'beta')?.provenance?.find((p) => p.kind === 'quote');
          must(q?.kind === 'quote' && q.quote === Q2 && q.path === PATH, () => `provenance ${show(q)}`);
        },
      ],
      [
        'quote-not-in-the-file-is-refused-and-siblings-stay',
        2,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, {
              alpha: Q1,
              beta: 'Route the case to beta when it rains.',
              gamma: Q3,
            }),
          });
          must(
            kept(store, 'alpha') && kept(store, 'gamma') && !kept(store, 'beta'),
            () => `values kept: ${show(store.variables.map((v) => v.values.map((x) => x.id)))}`,
          );
          must(
            store.refused.length === 1 && store.refused[0]?.what.includes('beta'),
            () => `refused ${show(store.refused)}`,
          );
        },
      ],
      [
        'file-not-supplied-refuses-the-values',
        2,
        (ctx) => {
          const estate = estateWith(READER_FILE, { alpha: Q1, beta: Q2 }, 'agent/not_supplied.md');
          const store = callBuild(ctx, { estate });
          must(
            !kept(store, 'alpha') && !kept(store, 'beta'),
            () => 'values with a quote from a file that was not supplied entered the store',
          );
          must(store.refused.length >= 1, () => 'no refusal for a missing file');
        },
      ],
      [
        'refusal-reason-is-long-enough-and-is-not-the-identifier',
        2,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, { alpha: Q1, beta: 'A sentence that is nowhere.' }),
          });
          must(store.refused.length >= 1, () => 'no refusal');
          for (const r of store.refused)
            must(
              r.reason.length >= 8 && r.reason !== 'beta' && r.reason !== r.what,
              () => `refusal ${show(r)}; the reason is at least eight characters and not the identifier`,
            );
        },
      ],
      [
        'one-refusal-for-each-rejected-value',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, { alpha: Q1, beta: 'Not here one.', gamma: 'Not here two.' }),
          });
          must(store.refused.length === 2, () => `${store.refused.length} refusals for two rejected values`);
          must(
            store.refused.some((r) => r.what.includes('beta')) &&
              store.refused.some((r) => r.what.includes('gamma')),
            () => `refusals ${show(store.refused)} do not name beta and gamma`,
          );
        },
      ],
      [
        'variable-without-accepted-values-is-omitted',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, { alpha: 'Not here one.', beta: 'Not here two.' }),
          });
          must(
            store.variables.length === 0,
            () => `${store.variables.length} variables although every value was refused`,
          );
          must(store.refused.length === 2, () => `${store.refused.length} refusals for two rejected values`);
        },
      ],
      [
        'the-original-quote-is-kept-when-the-folded-text-matches',
        3,
        (ctx) => {
          const odd = 'Route  the case\tto beta when the “parcel” is late.';
          const file =
            'Route the case to beta when the "parcel" is late.\nRoute the case to alpha when the parcel is damaged.';
          const store = callBuild(ctx, {
            estate: estateWith(file, {
              beta: odd,
              alpha: 'Route the case to alpha when the parcel is damaged.',
            }),
          });
          const q = store.variables
            .flatMap((v) => v.values)
            .find((x) => x.id === 'beta')
            ?.provenance?.find((p) => p.kind === 'quote');
          must(
            q?.kind === 'quote' && q.quote === odd && q.path === PATH,
            () => `provenance ${show(q)}; the original quote and path stay unchanged`,
          );
        },
      ],
      [
        'white-space-differences-are-folded',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(
              'Route the case to\n  beta   when the parcel\tis late.\nRoute the case to alpha when it is damaged.',
              { beta: Q2, alpha: 'Route the case to alpha when it is damaged.' },
            ),
          });
          must(kept(store, 'beta') && store.refused.length === 0, () => `refusals ${show(store.refused)}`);
        },
      ],
      [
        'accent-forms-are-folded',
        3,
        (ctx) => {
          const q = 'Route the café case to beta.';
          const store = callBuild(ctx, {
            estate: estateWith('Route the café case to beta.\nRoute the case to alpha.', {
              beta: q,
              alpha: 'Route the case to alpha.',
            }),
          });
          must(kept(store, 'beta') && store.refused.length === 0, () => `refusals ${show(store.refused)}`);
        },
      ],
      [
        'zero-width-characters-are-folded',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith('Route the case to be​ta now.\nRoute the case to alpha.', {
              beta: 'Route the case to beta now.',
              alpha: 'Route the case to alpha.',
            }),
          });
          must(kept(store, 'beta') && store.refused.length === 0, () => `refusals ${show(store.refused)}`);
        },
      ],
      [
        'markdown-backslashes-are-folded',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith('Route the \\*urgent\\* case to beta.\nRoute the case to alpha.', {
              beta: 'Route the *urgent* case to beta.',
              alpha: 'Route the case to alpha.',
            }),
          });
          must(kept(store, 'beta') && store.refused.length === 0, () => `refusals ${show(store.refused)}`);
        },
      ],
      [
        'case-differences-are-refused',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, { alpha: Q1, beta: Q2.toUpperCase() }),
          });
          must(
            kept(store, 'alpha') && !kept(store, 'beta') && store.refused.length === 1,
            () =>
              `kept ${show(store.variables.map((v) => v.values.map((x) => x.id)))}, refused ${show(store.refused)}`,
          );
        },
      ],
      [
        'punctuation-differences-are-refused',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(READER_FILE, { alpha: Q1, beta: Q2.replace('beta', 'beta,') }),
          });
          must(
            kept(store, 'alpha') && !kept(store, 'beta') && store.refused.length === 1,
            () =>
              `kept ${show(store.variables.map((v) => v.values.map((x) => x.id)))}, refused ${show(store.refused)}`,
          );
        },
      ],
      [
        'only-the-named-path-is-read',
        4,
        (ctx) => {
          const estate = {
            files: { [PATH]: 'Nothing about routing here.', 'agent/other.md': READER_FILE },
            rules: [
              {
                id: 'rule.0',
                source: PATH,
                conditions: [],
                tools: [
                  {
                    tool: 'desk_tool',
                    field: 'queue',
                    source: PATH,
                    values: [
                      { id: 'alpha', quote: Q1 },
                      { id: 'beta', quote: Q2 },
                    ],
                  },
                ],
              },
            ],
          };
          const store = callBuild(ctx, { estate });
          must(
            !kept(store, 'alpha') && !kept(store, 'beta'),
            () => 'a value was kept because its quote sits in a file other than the one it names',
          );
          must(
            store.refused.length === 2,
            () => `${store.refused.length} refusals for two values quoted from the wrong file`,
          );
        },
      ],
      [
        'a-condition-span-not-in-its-file-is-refused-and-named',
        3,
        (ctx) => {
          const text = 'the delay is more than 9 days';
          const estate = {
            files: { [PATH]: 'The file says something else entirely.' },
            rules: [{ id: 'rule.delay', source: PATH, conditions: [{ text }], tools: [] }],
          };
          const store = callBuild(ctx, { estate });
          must(
            store.variables.length === 0,
            () => `${store.variables.length} variables from a span that is not in its file`,
          );
          must(
            store.refused.length >= 1 &&
              store.refused.some((r) => r.what.includes(text) || r.what.includes('rule.delay')),
            () => `refused ${show(store.refused)}; a refused condition names its span or its rule`,
          );
          for (const r of store.refused)
            must(r.reason.length >= 8, () => `refusal reason ${show(r.reason)} is under eight characters`);
        },
      ],
      [
        'estate-quote-appears-twice-in-the-file',
        2,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: estateWith(`${READER_FILE}\n${READER_FILE}`, { alpha: Q1, beta: Q2 }),
          });
          must(
            kept(store, 'alpha') && kept(store, 'beta') && store.refused.length === 0,
            () => `refusals ${show(store.refused)}`,
          );
        },
      ],
    ],
  },
];
