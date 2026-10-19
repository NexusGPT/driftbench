import type { StemDef } from './types';

/**
 * The stems that joined this bank from the second variables bank (PR 762): the checks of the store FILE
 * (`validate`, `quotes`) and the plan behaviours the first bank lacked. Each file-format stem asks its question
 * in twelve scenes and runs its calls in a certified order (bank/files.ts), so that a guess by call position or
 * by a hash of the request cannot pass it. Every rule they check is on docs/variables.md.
 */

const SCENES =
  'Twelve scenes, each its own fictional store (3 to 5 variables, details, an unapproved decoy, a title that carries an instruction) and the same store with exactly one defect.';

const RELATION =
  'Five requests per scene, each with a store, a sentence and a file of its own: the quote is in the file; the quote looks altered and the file holds exactly that text; the quote is altered and the file holds the original; the quote is the original and the file holds the altered text; the file is absent. A decoy line (another alteration) sits in every file. The twelve scenes use six shapes of sentence, and a quote sits in a variable, a value, a boundary or a constraint.';

export const MERGED: readonly StemDef[] = [
  {
    id: 'sources.file.provenance-shape',
    family: 'sources',
    component: 'store/validate',
    need: 'F1',
    generator: `${SCENES} The defect is in one provenance entry: a conversations entry whose count is above its total, not a whole number, with an extra key, with an uppercase hash or with a total of 0; an owner entry with a day that does not exist or with blank words; a quote entry with a malformed ledger id.`,
    oracle:
      'validate refuses the store with the code the page names (SCHEMA_CUSTOM, SCHEMA_INVALID_TYPE, SCHEMA_UNRECOGNIZED_KEYS, SCHEMA_INVALID_FORMAT, SCHEMA_TOO_SMALL) at the entry or its field, and accepts the two valid stores of the scene (the edge value of the same field, and an ordinary entry).',
    cause: 'the store loader checks every provenance entry against the shape of the page',
    variantCauses: {
      'count-over-total': 'a conversations count above its total is refused',
      'fractional-count': 'a conversations count that is not a whole number is refused',
      'extra-key':
        'a conversations entry with a key beyond count, total and set_hash is refused (no text enters a store)',
      'uppercase-hash': 'a set hash must be 64 lowercase hexadecimal characters',
      'zero-total': 'a conversations total below 1 is refused',
      'unreal-day': 'an owner date must be a real day written YYYY-MM-DD',
      'blank-words': 'blank owner words are refused',
      'ledger-shape': 'a ledger id must be 10 characters from a to z and 2 to 7',
    },
    variants: [
      ['count-over-total', 2],
      ['fractional-count', 2],
      ['extra-key', 3],
      ['uppercase-hash', 2],
      ['zero-total', 2],
      ['unreal-day', 3],
      ['blank-words', 3],
      ['ledger-shape', 3],
    ],
  },
  {
    id: 'values.file.references',
    family: 'values',
    component: 'store/validate',
    need: 'F1',
    generator: `${SCENES} The defect is a repeated id, a value id in two axes, a second axis of one kind, a deviation value outside the twelve classes, a when or unless that names a missing variable or value, a constraint with a missing variable or value, an empty constraint, the same constraint written twice with its keys reordered, or constraints that forbid every cell.`,
    oracle:
      'validate refuses the store with the VARIABLES code of the page at the path of the page (for example variables.1.values.0.id, constraints.0.forbid.NAME, constraints.1), and accepts the valid twin: the same id in a detail, the value none in two axes, a second channel that is a detail, a known deviation class, a constraint that leaves one value free.',
    cause: 'the store loader checks the references and the uniqueness rules of the page',
    variantCauses: {
      'duplicate-value': 'a value id repeated inside one variable is refused',
      'duplicate-variable-id': 'a variable id repeated in the store is refused',
      'ambiguous-axis-value':
        'a value id in two axes that a spec names by value is refused (a detail and none are exempt)',
      'repeated-channel': 'two axes of kind channel are refused',
      'repeated-stage': 'two axes of kind stage are refused',
      'repeated-deviation': 'two axes of kind deviation are refused',
      'unknown-deviation-class': 'a deviation axis holds none and the twelve classes only',
      'unknown-when-variable': 'a when that names a variable the store lacks is refused',
      'unknown-unless-value': 'an unless that names a value its variable lacks is refused',
      'unknown-constraint-variable': 'a constraint that names a variable the store lacks is refused',
      'unknown-constraint-value': 'a constraint that names a value its variable lacks is refused',
      'empty-constraint': 'a constraint that forbids nothing is refused',
      'duplicate-constraint-reordered': 'the same combination written twice, in any key order, is refused',
      'grid-empty': 'constraints that forbid every cell of the axes are refused',
    },
    variants: [
      ['duplicate-value', 1],
      ['duplicate-variable-id', 1],
      ['ambiguous-axis-value', 3],
      ['repeated-channel', 2],
      ['repeated-stage', 2],
      ['repeated-deviation', 3],
      ['unknown-deviation-class', 3],
      ['unknown-when-variable', 2],
      ['unknown-unless-value', 3],
      ['unknown-constraint-variable', 2],
      ['unknown-constraint-value', 2],
      ['empty-constraint', 1],
      ['duplicate-constraint-reordered', 4],
      ['grid-empty', 4],
    ],
  },
  {
    id: 'boundaries.file.sides',
    family: 'boundaries',
    component: 'store/validate',
    need: 'F1',
    generator: `${SCENES} A variable with three values and a boundary: a strict comparison whose edge is the value of the holding side, an inclusive one whose edge is the failing side's value, one value on both sides, an edge or a holding value the variable lacks, or a limit with no comparison. Limits are zero, negative, whole and decimal.`,
    oracle:
      'validate refuses with VARIABLES_BOUNDARY at .edge (wrong side) or .fails (one value on both sides), VARIABLES_UNKNOWN_VALUE at the missing id, or SCHEMA_CUSTOM for a limit with no comparison; it accepts a third value as the edge for every comparison, the failing side for a strict one, the holding side for an inclusive one, and a condition with no number.',
    cause: 'the store loader checks the sides of a boundary against its comparison',
    variantCauses: {
      'strict-gt':
        'a strict comparison leaves the limit on the failing side, so the edge is not the holding value',
      'strict-lt':
        'a strict comparison leaves the limit on the failing side, so the edge is not the holding value',
      'inclusive-ge':
        'an inclusive comparison puts the limit on the holding side, so the edge is not the failing value',
      'inclusive-le':
        'an inclusive comparison puts the limit on the holding side, so the edge is not the failing value',
      'same-value-both-sides': 'the two sides of a boundary are two values',
      'unknown-edge': 'a boundary names only values of its variable',
      'unknown-holds': 'a boundary names only values of its variable',
      'limit-without-comparison': 'a limit and a comparison go together',
    },
    variants: [
      ['strict-gt', 2],
      ['strict-lt', 2],
      ['inclusive-ge', 2],
      ['inclusive-le', 2],
      ['same-value-both-sides', 1],
      ['unknown-edge', 2],
      ['unknown-holds', 2],
      ['limit-without-comparison', 3],
    ],
  },
  {
    id: 'weights.file.validity',
    family: 'weights',
    component: 'store/validate',
    need: 'F1',
    generator: `${SCENES} A variable with weights 60, 15, 25 (or another mix) and one defect: a value without a weight, every weight 0, a negative weight, a weight that is NaN or infinite, or a fitted prior with no source.`,
    oracle:
      'validate refuses with VARIABLES_WEIGHT_INCOMPLETE at the first value without a weight, VARIABLES_WEIGHT_ZERO at the values, SCHEMA_TOO_SMALL at a negative weight, a SCHEMA_ code at a non-finite one, VARIABLES_PRIOR_SOURCE at prior.source; it accepts the complete weights, one weight of 0 beside others, a fitted prior with a source and a declared prior.',
    cause: 'the store loader checks the weights of a variable and the source of a fitted prior',
    variantCauses: {
      incomplete: 'a variable weighs all its values or none',
      'all-zero': 'weights that are all 0 are refused',
      negative: 'a negative weight is refused',
      nonfinite: 'a weight that is NaN or infinite is refused',
      'fitted-without-source': 'a fitted prior needs a source text',
    },
    variants: [
      ['incomplete', 2],
      ['all-zero', 2],
      ['negative', 1],
      ['nonfinite', 3],
      ['fitted-without-source', 2],
    ],
  },
  {
    id: 'quotes.verify.folded-forms',
    family: 'quotes',
    component: 'store/quotes',
    need: 'F2',
    generator: `${RELATION} The file (even scenes) or the quote (odd scenes) writes the sentence with extra white space, typographic quote marks, a decomposed accent, markdown backslashes or characters that print nothing; the broken requests carry the same form.`,
    oracle:
      'quotes reports nothing when the folded quote is in the folded file, VARIABLES_QUOTE_NOT_FOUND at PATH.quote when the relation is broken on either side, and VARIABLES_SOURCE_UNREADABLE at PATH.path when the file is absent. The bank checks with its own folding that each request is what it says.',
    cause:
      'the quote check folds white space, typographic quotes, accents, characters that print nothing and markdown backslashes',
    variantCauses: {
      whitespace: 'the quote check folds runs of white space',
      typographic: 'the quote check folds typographic quote marks',
      'unicode-composition': 'the quote check folds composed and decomposed accents',
      'markdown-escape': 'the quote check folds the backslash of markdown',
      'invisible-characters': 'the quote check folds characters that print nothing',
    },
    variants: [
      ['whitespace', 2],
      ['typographic', 3],
      ['unicode-composition', 4],
      ['markdown-escape', 3],
      ['invisible-characters', 5],
    ],
  },
  {
    id: 'quotes.verify.exact-forms',
    family: 'quotes',
    component: 'store/quotes',
    need: 'F2',
    generator: `${RELATION} The alteration is a change of case (the first letter and one word) or of one punctuation mark (the full stop, a comma or semicolon, a quotation mark).`,
    oracle:
      'quotes reports VARIABLES_QUOTE_NOT_FOUND at PATH.quote when the quote and the file differ in case or punctuation, on either side, nothing when they agree (also when both are the altered text), and VARIABLES_SOURCE_UNREADABLE for an absent file.',
    cause: 'the quote check does not fold case or punctuation',
    variants: [
      ['case-sensitive', 2],
      ['punctuation-sensitive', 3],
    ],
  },
  {
    id: 'quotes.verify.not-found',
    family: 'quotes',
    component: 'store/quotes',
    need: 'F2',
    generator: `${RELATION} The alteration is a word inserted, a letter changed, two words swapped or the last word replaced, so that neither text holds a cut of the other.`,
    oracle:
      'quotes reports exactly VARIABLES_QUOTE_NOT_FOUND at PATH.quote when the relation is broken on either side and nothing when it holds, even when other files are given.',
    cause: 'a quote that no part of its file holds is reported at its own path',
    variants: [
      ['inserted-word', 1],
      ['changed-letter', 2],
      ['swapped-words', 3],
      ['changed-last-word', 3],
    ],
  },
  {
    id: 'quotes.verify.unreadable-file',
    family: 'quotes',
    component: 'store/quotes',
    need: 'F2',
    generator: `${RELATION} A quote names a file that is not among the files given (alone, or beside an unrelated file); two quotes in one list name one missing file beside a third on a present file that holds it or not; a missing file beside a present file whose quote is found or not. The sentences of one store are unrelated.`,
    oracle:
      'quotes reports VARIABLES_SOURCE_UNREADABLE at PATH.path of the first quote that names a missing file, once per file, and also VARIABLES_QUOTE_NOT_FOUND for a quote on a present file that does not hold it.',
    cause: 'a missing file is reported once, at the first quote that names it',
    variantCauses: {
      'missing-file': 'a quote whose file is not given is reported unreadable at its path',
      'once-per-file': 'a missing file is reported once, at the first quote that names it',
      'unreadable-and-not-found':
        'an unreadable file does not hide the wrong quotes of the files that are present',
    },
    variants: [
      ['missing-file', 1],
      ['once-per-file', 4],
      ['unreadable-and-not-found', 3],
    ],
  },
  {
    id: 'budget.below-seed-count',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'P7',
    generator:
      'A space of 6 variables with 4 real sessions as seeds and a budget of 0, of one less than the seeds, and of exactly the seeds.',
    oracle: 'The plan is the seeds, in order and as given, and no new row.',
    cause: 'a budget below the seed count keeps every seed and no new row',
    variants: [
      ['zero-with-seeds', 2],
      ['one-below', 3],
      ['exactly-seeds', 2],
    ],
  },
  {
    id: 'seeds.kept-with-warnings',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator:
      'Seeds that name a variable or a value the store lacks; a seed that holds an impossible pair; a seed with an entry on an unapproved variable; a store with nothing approved.',
    oracle:
      'Seed rows come first, in order, as the page keeps them (unknown entries gone, forbidden and unapproved entries kept), the plan warns with the code of the page (seed_unknown_value, seed_forbidden, seed_unapproved_value, no_variables), and the new rows cover what the kept seeds miss.',
    cause: 'seeds are kept as the page says and every irregular one is reported',
    variantCauses: {
      'unknown-variable': 'a seed entry the store does not have is dropped and reported',
      'unknown-value': 'a seed entry the store does not have is dropped and reported',
      'forbidden-seed': 'a seed that holds an impossible combination is kept and reported',
      'unapproved-value': 'a seed entry on an unapproved variable is kept whole and reported',
      'nothing-approved': 'a store with nothing approved plans the seeds alone and says so',
    },
    variants: [
      ['unknown-variable', 2],
      ['unknown-value', 3],
      ['forbidden-seed', 3],
      ['unapproved-value', 4],
      ['nothing-approved', 3],
    ],
  },
  {
    id: 'weights.plan-shares',
    family: 'weights',
    component: 'planner/budget',
    need: 'P7',
    generator:
      'A weighted space; the same space with every weight multiplied by 100; a space where one value has weight 0.',
    oracle:
      'Scaling every weight changes no row and no log weight; a row that holds a value of weight 0 reports logWeight null, comes after every finite row, and its value is still covered.',
    cause: 'weights are relative and a weight of 0 is minus infinity written null',
    variantCauses: {
      'scale-invariant': 'a share is a weight over the total weight of its variable',
      'zero-share': 'a weight of 0 gives a log weight of minus infinity, written null',
    },
    variants: [
      ['scale-invariant', 3],
      ['zero-share', 4],
    ],
  },
  {
    id: 'impossible.general-forbid',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    generator:
      'A space of 5 ternary variables (two shared axes, a rule of three) and a combination of one value, of three values, one that is not approved, or one that names a variable no axis joins.',
    oracle:
      'No row holds an approved combination, every allowed required tuple is covered (independent brute force), an unapproved combination plans nothing and its tuples stay required, and a value no row can hold is reported value_unreachable.',
    cause: 'the planner honours approved combinations of any size',
    variantCauses: {
      'single-value':
        'a combination of one value excludes that value from every row and is reported unreachable',
      triple: 'a combination of three values excludes only the rows that hold all three',
      'unapproved-ignored': 'a combination that is not approved plans nothing',
      'detail-named': 'a combination that names a variable no axis joins is honoured',
    },
    variants: [
      ['single-value', 3],
      ['triple', 4],
      ['unapproved-ignored', 3],
      ['detail-named', 3],
    ],
  },
];
