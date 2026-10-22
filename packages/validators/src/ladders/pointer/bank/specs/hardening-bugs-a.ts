import { HARDENING_CAP_MS } from './hardening';
import { row, type Spec } from './types';

/**
 * Round 3 audit, seat 4: planted bugs in the cutter and the ledger of the reader that lost no item. Each item below
 * is green on the reader as it is and red on one of those bugs; its oracle is what the reader does on a case the
 * bug changes. The bug each one guards is named in `validators/pointer/audit.md` and in the test of this file.
 */

const cap = { capMs: HARDENING_CAP_MS } as const;

export const HARDENING_BUGS_A_SPECS: Record<string, Spec[]> = {
  cutting: [
    row(
      'sentence-stop-before-digit-merges',
      3,
      'A full stop followed by a number and a capital word does not end the sentence',
      'A paragraph: a seeded sentence, then a number drawn from the seed and a second seeded sentence that starts with a capital, then a third sentence.',
      'Two units: the first holds the first sentence, the number and the second sentence; the second is the third sentence. A cutter that splits before the number makes three.',
      'cutter:merge-before-digit-start',
      { ...cap, component: 'cutter' },
    ),
    row(
      'list-in-quote-container',
      2,
      'An item of a list inside a block quote is a list item, not a quote paragraph',
      'A block quote holding a seeded paragraph, a quote line that is blank, then a list of two seeded items, every line opened by `> `.',
      'Three units in order: a `block_quote` for the paragraph and a `list_item` for each item, each with its own text.',
      'cutter:list-item-inside-quote',
      { ...cap, component: 'cutter' },
    ),
    row(
      'number-stop-before-word-splits',
      3,
      'A full stop after a number ends the sentence when a capital word follows',
      'A paragraph: a seeded sentence that ends with `in <year>.` (year drawn from the seed), then a second seeded sentence that starts with a capital.',
      'Two units, one per sentence. A cutter that merges every break after a number makes one.',
      'cutter:number-stop-merges-only-before-digit',
      { ...cap, component: 'cutter' },
    ),
    row(
      'double-backtick-code-masked',
      3,
      'A full stop inside double-backtick inline code does not end the sentence',
      'A paragraph: a seeded sentence that holds ``` ``<Word>. <Word> <word>`` ``` (words drawn from the seed), then a second seeded sentence.',
      'Two units: the first holds the whole code span and ends at its own full stop. A cutter that masks only single-backtick code splits inside the span.',
      'cutter:mask-multi-backtick-code',
      { ...cap, component: 'cutter' },
    ),
  ],
  ids: [
    row(
      'short-text-repeated-in-new-estate-not-moved',
      3,
      'A short text found once in the old estate and twice in the new one keeps no old id',
      'Three files of long seeded units; the first holds a short sentence (one seeded word, under 12 characters). The edit removes it there and writes it once in each of the two other files.',
      'The old id of the short text is not live after the rescan (its entry is deleted); both new copies take ids no old entry had.',
      'anchor:short-text-unique-in-new-estate',
      { ...cap, component: 'anchor' },
    ),
    row(
      'deleted-event-counts-live-only',
      3,
      'The deleted count of a scan counts the units that scan removed, not the ones removed before',
      'One file of ten long seeded units scanned three times: fresh, then with a number of units drawn from the seed removed, then with more removed.',
      'The `deleted` count of the second scan equals the units it removed, and the `deleted` count of the third scan equals the units the third removed; a missing count is a failure.',
      'ledger:deleted-count-this-scan',
      { ...cap, component: 'ledger' },
    ),
    row(
      'estate-key-in-id',
      2,
      'The estate key is part of every id',
      'Two files of long seeded units scanned fresh under an estate key drawn from the seed, again under the same key, and under a second key drawn from the seed.',
      'The two scans under one key give each text the same id; the scans under the two keys share no id.',
      'ids:estate-key-in-id',
      { ...cap, component: 'ids' },
    ),
    row(
      'deleted-id-not-reminted',
      3,
      'A text deleted and then written again in its place takes a fresh id, and the old id stays deleted',
      'One file of eight long seeded units scanned three times: fresh, with one unit drawn from the seed removed, then with that unit written back in its place.',
      'After the third scan the text has a live entry whose id differs from its first id, and the first id is still in the ledger and not live.',
      'ids:deleted-ids-stay-taken',
      { ...cap, component: 'ids' },
    ),
  ],
  're-anchoring': [
    row(
      'context-window-24',
      3,
      'The context of an entry is the 24 code units of source on each side',
      'One file: a heading and eight long seeded paragraphs, scanned fresh.',
      'For every live entry the prefix is the 24 UTF-16 code units of the source before its span and the suffix the 24 after it, clipped at the file ends.',
      'anchor:context-24-code-units',
      { ...cap, component: 'anchor' },
    ),
    row(
      'split-needs-margin',
      3,
      'A unit cut in two is split only when the two pieces together read clearly better than the closer piece alone',
      'Two files of long seeded units. In the first, one unit loses a short last word to a sentence of its own (the pieces together beat the longer piece by less than 0.1). In the second, one unit of two clauses is cut into two sentences (the pieces together beat each piece by more than 0.25).',
      'The `split` count of the rescan is 1 and the `changed` count is 1: the near tie is changed and keeps its id on the longer piece; the clear cut is split and its id lives on in one piece.',
      'anchor:split-margin',
      { ...cap, component: 'anchor' },
    ),
    row(
      'merge-needs-margin',
      3,
      'Two units joined into one are merged only when the join reads like the new unit',
      'Two files of long seeded units. In the first, two neighbouring units are replaced by one sentence that reads like their join at a similarity between 0.5 and 0.64 and like each alone under 0.36. In the second, two neighbouring units are joined into one sentence with a comma.',
      'In the first file neither old id is live and the new sentence takes an id no old entry had; in the second exactly one of the two old ids lives on with the joined text.',
      'anchor:merge-margin',
      { ...cap, component: 'anchor' },
    ),
    row(
      'ambiguous-claims-every-copy',
      3,
      'A text that now stands in two places claims both copies, so no other old unit takes one',
      'One file of six long seeded units, one more unit T and a unit V that is T with one word changed. The edit removes T and V and writes T once after the heading and once at the end.',
      "V's old id is not live after the rescan and neither copy of T carries it.",
      'anchor:ambiguous-claims-all-copies',
      { ...cap, component: 'anchor' },
    ),
  ],
};
