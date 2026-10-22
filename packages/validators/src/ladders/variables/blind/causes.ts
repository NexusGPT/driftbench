/**
 * The cause of each item of the blind bank: the one change that would make it pass (docs/validators.md 12.4).
 * Items that one change turns green share a cause and count once. The causes are written from the page, by the
 * lane that wrote the items, before any product ran the bank.
 */

type Group = readonly [cause: string, keys: readonly string[]];

const table = (groups: readonly Group[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [cause, keys] of groups) for (const key of keys) out[key] = cause;
  return out;
};

export const CAUSES: Readonly<Record<string, Record<string, string>>> = {
  'sources.file.provenance-shape': table([
    ['the loader accepts a well formed entry of every provenance kind', ['a-valid-entry-of-each-kind']],
    ['a conversations count may equal its total', ['conversation-count-equal-to-total']],
    ['a conversations count may be zero', ['conversation-count-zero']],
    ['a quote of exactly 1,000 characters is valid', ['quote-of-exactly-a-thousand-characters']],
    ['owner words of exactly 1,000 characters are valid', ['owner-words-of-exactly-a-thousand-characters']],
    ['a day on 29 February of a leap year is a real day', ['owner-date-on-a-leap-day']],
    ['a conversations count above its total is refused', ['conversation-count-above-total']],
    ['a conversations count that is not whole is refused', ['conversation-count-fractional']],
    ['a negative conversations count is refused', ['conversation-count-negative']],
    ['a conversations total below 1 is refused', ['conversation-total-zero']],
    [
      'a conversations entry with any key beyond count, total and set_hash is refused',
      ['conversation-entry-with-a-text-key'],
    ],
    [
      'a set hash must be 64 lowercase hexadecimal characters',
      ['conversation-hash-in-capitals', 'conversation-hash-one-character-short'],
    ],
    [
      'an owner date must be a real day written YYYY-MM-DD',
      ['owner-date-that-does-not-exist', 'owner-date-with-a-time'],
    ],
    ['blank owner words are refused', ['owner-words-blank']],
    ['owner words over 1,000 characters are refused', ['owner-words-over-a-thousand-characters']],
    ['a blank quote is refused', ['quote-blank', 'quote-empty']],
    ['a quote over 1,000 characters is refused', ['quote-over-a-thousand-characters']],
    [
      'a ledger id is 10 characters from a to z and 2 to 7',
      [
        'ledger-id-in-capitals',
        'ledger-id-one-character-short',
        'ledger-id-with-a-digit-outside-two-to-seven',
      ],
    ],
    [
      'a quote path may not start at the root or the home folder',
      ['quote-path-from-the-root', 'quote-path-from-the-home-folder'],
    ],
    ['a quote path may not hold a backslash', ['quote-path-with-a-backslash']],
    [
      'a quote path may not carry a scheme or a drive letter',
      ['quote-path-with-a-scheme', 'quote-path-with-a-drive-letter'],
    ],
    ['a provenance entry of an unknown kind is refused', ['entry-of-an-unknown-kind']],
    ['a structure hash is 64 lowercase hexadecimal characters', ['structure-hash-not-hexadecimal']],
    [
      'a structure entry holds exactly one of pointer and lines',
      ['structure-with-a-pointer-and-lines', 'structure-with-neither-pointer-nor-lines'],
    ],
    [
      'the last line of a structure entry is not before its first',
      ['structure-lines-ending-before-they-start'],
    ],
  ]),
  'sources.file.advice': table([
    [
      'a store whose entries name no source is valid and carries advice',
      ['a-store-without-provenance-is-valid'],
    ],
    [
      'the advice names each value, boundary and constraint that has no provenance, once',
      ['advice-names-every-unsourced-entry'],
    ],
    ['an entry that names its source gets no advice', ['a-sourced-entry-gets-no-advice']],
  ]),
  'sources.condition.numerals': table([
    [
      'the reader reads a thousands separator inside a number',
      ['thousands-separator', 'decimal-with-thousands'],
    ],
    ['the reader reads English number words as numbers', ['number-word-two', 'number-word-twelve']],
    ['the reader reads a compound number word as one number', ['number-word-compound']],
    ['the reader reads a currency sign before a number', ['dollar-sign', 'euro-sign']],
    ['the reader reads a percent sign after a number', ['percent-sign']],
    ['the reader reads a decimal that starts with zero', ['leading-zero-decimal']],
    ['the reader reads a negative number followed by a unit', ['negative-limit-with-a-unit']],
    ['the reader reads a space between groups of three digits', ['space-thousands']],
    ['the reader reads a no-break or narrow space between groups of digits', ['narrow-no-break-thousands']],
    ['the reader reads an apostrophe between groups of digits', ['apostrophe-thousands']],
    ['the reader reads a decimal comma after groups marked with points', ['european-decimal-comma']],
    ['the reader reads a currency code before a number', ['iso-code-before-the-number']],
    ['the reader reads a currency code after a number', ['iso-code-after-the-number']],
    ['the reader reads the minus sign of Unicode as a negative sign', ['unicode-minus-sign']],
    ['the reader reads a plus sign before a number', ['plus-sign']],
    ['the reader reads a unit written against its number', ['unit-attached-to-the-number']],
    ['the reader reads hundreds written in English words', ['hundreds-in-words']],
    ['the reader reads thousands written in English words', ['thousands-in-words']],
    ['the reader reads an and inside a number written in English words', ['and-in-words']],
    ['the reader reads the greater-than symbol as a comparison', ['symbol-greater-than']],
    [
      'the reader reads the two-character at-least symbol as a comparison',
      ['symbol-at-least-two-characters'],
    ],
    ['the reader reads the one-character at-least symbol as a comparison', ['symbol-at-least-one-character']],
    ['the reader reads the less-than symbol as a comparison', ['symbol-less-than']],
    ['the reader reads the two-character at-most symbol as a comparison', ['symbol-at-most-two-characters']],
    ['the reader reads the one-character at-most symbol as a comparison', ['symbol-at-most-one-character']],
    ['the reader reads a thousand written as k after a number', ['thousands-written-with-k']],
    ['the reader reads a million written as a word after a number word', ['millions-written-with-a-word']],
  ]),
  'sources.condition.kinds': table([
    ['an equality condition keeps a case below, at and above its limit', ['equality-keeps-all-three-cases']],
    [
      'an inequality condition keeps a case below, at and above its limit',
      ['inequality-keeps-all-three-cases'],
    ],
    ['a range condition keeps cases below, at each limit, inside and above', ['range-has-five-cases']],
    ['a range written with the word to keeps its five cases', ['range-written-with-to']],
    ['a range written with an en dash keeps its five cases', ['range-written-with-an-en-dash']],
    ['a range written with a hyphen keeps its five cases', ['range-written-with-a-hyphen']],
    ['a range whose two ends are both open (more than A and fewer than B) keeps its five cases', ['range-with-both-ends-open']],
    ['a range closed at one end only (at least A but under B) keeps its five cases', ['range-with-one-end-closed']],
    ['a range with a negative lower limit keeps its five cases', ['range-with-a-negative-lower-limit']],
    ['a range with decimal limits keeps its five cases', ['range-with-decimal-limits']],
    ['an exclusion (neither A nor B) is a membership condition with an in-list and an out-of-list sample', ['membership-written-as-neither-nor']],
    ['a choice (either A or B) is a membership condition with an in-list and an out-of-list sample', ['membership-written-as-either-or']],
    ['a fact and its negation about one subject are one true-or-false variable', ['a-fact-and-its-negation-are-one-variable']],
    [
      'a boolean condition produces the values true and false and no boundary',
      ['boolean-has-true-and-false'],
    ],
    [
      'a membership condition produces an in-list and an out-of-list sample and no boundary',
      ['membership-has-an-in-list-and-an-out-of-list-sample'],
    ],
  ]),
  'sources.merge': table([
    ['spans naming different quantities stay different variables', ['different-quantities-stay-distinct']],
    [
      'repeated evidence for one tool field merges into one variable',
      ['repeated-tool-field-merges-by-field'],
    ],
    [
      'one field name on two tools gives two variables',
      ['the-same-field-name-on-two-tools-stays-two-variables'],
    ],
    [
      'a rule lists every variable named by its conditions and tools',
      ['a-rule-lists-every-variable-it-names'],
    ],
    ['every rule of the estate appears in the rules of the store', ['every-rule-is-listed']],
    ['two rules that name one variable both list it', ['a-variable-shared-by-two-rules-is-in-both']],
    [
      'a rule with no condition and no tool adds no variable',
      ['a-rule-with-nothing-to-read-adds-no-variable'],
    ],
  ]),
  'sources.provenance': table([
    ['every estate value keeps a quote entry with its path', ['every-estate-value-names-a-quote']],
    [
      'a value known to estate, conversations and owner keeps one entry of each kind',
      ['a-value-known-to-three-sources-keeps-three-entries'],
    ],
    ['merging sources keeps the estate quote of a value', ['sources-merge-without-losing-the-estate-quote']],
  ]),
  'sources.conversations': table([
    ['conversations add a count and a total to every value of an observed variable', ['counts-per-value']],
    [
      'a value seen in conversations but unknown to the store becomes an unapproved proposal',
      ['unknown-value-becomes-an-unapproved-proposal'],
    ],
    ['a variable seen only in conversations is refused with a reason', ['unknown-variable-is-refused']],
    ['the set hash is a SHA-256 in lowercase hexadecimal', ['set-hash-has-the-shape-of-a-sha-256']],
    [
      'the set hash does not depend on the order of sessions',
      ['set-hash-does-not-depend-on-the-order-of-sessions'],
    ],
    ['the set hash changes when a session changes', ['set-hash-changes-when-a-session-changes']],
    ['no conversation text or identifier reaches the store', ['no-text-and-no-identifier-enters-the-store']],
    ['an empty list of conversations leaves the store as it was', ['empty-conversations-add-nothing']],
    [
      'conversations leave the variables no session showed untouched',
      ['conversations-never-touch-the-other-variables'],
    ],
    [
      'a session that shows two variables counts once for each',
      ['sessions-showing-two-variables-count-each-once'],
    ],
  ]),
  'sources.estate-and-owner': table([
    [
      'one call merges estate, conversations and owner without losing a source',
      ['all-three-sources-in-one-call'],
    ],
  ]),
  'quotes.check': table([
    [
      'the quote check finds a quote that sits in its file',
      ['quote-is-found', 'the-same-quote-twice-is-fine'],
    ],
    [
      'the quote check reports a quote missing from its file at the quote path',
      ['quote-is-not-found', 'quote-longer-than-the-file'],
    ],
    ['the quote check reads the provenance of a variable', ['not-found-in-a-variable']],
    ['the quote check reads the provenance of a boundary', ['not-found-in-a-boundary']],
    ['the quote check reads the provenance of a constraint', ['not-found-in-a-constraint']],
    ['the quote check reads every place a quote can sit', ['found-in-every-place-a-quote-can-sit']],
    [
      'the quote check reports an unreadable file at the path of the entry',
      ['file-is-missing', 'no-files-at-all'],
    ],
    [
      'the quote check reports a missing file once, at its first quote',
      ['one-missing-file-is-reported-once'],
    ],
    ['the quote check reports each missing file', ['two-missing-files-are-two-errors']],
    [
      'the quote check reports a missing file and a wrong quote together',
      ['a-missing-file-and-a-wrong-quote-are-both-reported'],
    ],
    ['the quote check looks only in the file the quote names', ['quote-is-in-another-file']],
    ['a file with no text is readable and holds no quote', ['an-empty-file-is-readable']],
    ['conversation and owner evidence need no file', ['conversation-and-owner-evidence-need-no-file']],
    ['the ledger id plays no part in the quote check', ['ledger-id-does-not-change-the-check']],
    ['a quote of 1,000 characters is found in its file', ['quote-of-a-thousand-characters']],
    [
      'a quote that differs in its last character is not found',
      ['quote-of-a-thousand-characters-off-by-one-at-the-end'],
    ],
  ]),
  'quotes.folding': table([
    [
      'runs of white space fold to one before the quote is compared',
      ['white-space-runs-in-the-quote', 'white-space-runs-in-the-file'],
    ],
    [
      'typographic double quotation marks fold to straight ones',
      ['typographic-double-quotes-in-the-file', 'typographic-quotes-in-the-quote'],
    ],
    ['typographic single quotation marks fold to straight ones', ['typographic-single-quotes-in-the-file']],
    [
      'composed and decomposed accents fold to one form',
      [
        'composed-accents-in-the-file-decomposed-in-the-quote',
        'decomposed-accents-in-the-file-composed-in-the-quote',
      ],
    ],
    [
      'characters that print nothing fold away',
      ['zero-width-characters-in-the-file', 'zero-width-characters-in-the-quote'],
    ],
    ['the soft hyphen folds away', ['soft-hyphen-prints-nothing']],
    [
      'the markdown backslash before a punctuation mark folds away',
      ['markdown-backslash-before-an-asterisk', 'markdown-backslash-before-an-underscore'],
    ],
    ['case must match after folding', ['case-must-match']],
    ['punctuation must match after folding', ['punctuation-must-match']],
    ['a quote with a word missing is not found', ['a-missing-word-is-not-found']],
    ['an accent is not folded away', ['accents-must-still-match']],
  ]),
  'quotes.structure': table([
    ['a structure entry resolves its JSON pointer and compares the hash', ['pointer-and-hash-match']],
    [
      'the hash of a structure entry is taken over the canonical JSON of the value',
      ['reformatted-file-and-another-key-order-keep-the-hash'],
    ],
    ['a changed value gives the hash mismatch code at the hash path', ['hash-does-not-match']],
    ['a pointer that names nothing gives the unresolved code at the pointer path', ['pointer-names-nothing']],
    ['a file that is neither JSON nor YAML leaves a pointer unresolved', ['file-is-not-json-or-yaml']],
    ['the empty pointer names the whole file', ['the-empty-pointer-is-the-whole-file']],
    ['a lines entry hashes the named lines joined by a line feed', ['lines-and-hash-match']],
    [
      'lines past the end of the file give the unresolved code at the lines path',
      ['lines-past-the-end-of-the-file'],
    ],
    ['a Windows line break reads as a line feed', ['windows-line-breaks-read-the-same']],
  ]),
  'quotes.reader': table([
    [
      'the reader keeps a quote that sits in its file with its path, unchanged',
      ['quotes-in-the-file-are-kept-unchanged'],
    ],
    [
      'the reader refuses a value whose quote is not in the file and keeps its siblings',
      ['quote-not-in-the-file-is-refused-and-siblings-stay'],
    ],
    [
      'the reader refuses values quoted from a file that was not supplied',
      ['file-not-supplied-refuses-the-values'],
    ],
    [
      'a refusal reason has at least eight characters and is not the identifier',
      ['refusal-reason-is-long-enough-and-is-not-the-identifier'],
    ],
    [
      'the reader gives one refusal to each rejected value, naming it',
      ['one-refusal-for-each-rejected-value'],
    ],
    [
      'a variable with no accepted value is left out of the store',
      ['variable-without-accepted-values-is-omitted'],
    ],
    [
      'the reader keeps the original quote when only the folded text matches',
      ['the-original-quote-is-kept-when-the-folded-text-matches'],
    ],
    ['the reader folds white space before it looks for a quote', ['white-space-differences-are-folded']],
    ['the reader folds accents before it looks for a quote', ['accent-forms-are-folded']],
    ['the reader folds characters that print nothing', ['zero-width-characters-are-folded']],
    ['the reader folds the markdown backslash', ['markdown-backslashes-are-folded']],
    ['the reader refuses a quote that differs in case', ['case-differences-are-refused']],
    ['the reader refuses a quote that differs in punctuation', ['punctuation-differences-are-refused']],
    ['the reader reads only the file a quote names', ['only-the-named-path-is-read']],
    [
      'the reader refuses a condition span that is not in its file and names it',
      ['a-condition-span-not-in-its-file-is-refused-and-named'],
    ],
    ['a quote that appears twice in its file is still found', ['estate-quote-appears-twice-in-the-file']],
  ]),
  'values.file.references': table([
    ['a value id repeated inside a variable is refused at the second place', ['duplicate-value-id']],
    ['a variable id repeated in the store is refused at the second place', ['duplicate-variable-id']],
    ['a value id in two axes of one kind is refused', ['value-id-in-two-axes-of-one-kind']],
    ['the value none may sit in several axes', ['none-in-two-axes-is-fine']],
    ['a value id may sit in an axis and a detail', ['same-value-in-an-axis-and-a-detail-is-fine']],
    ['a second axis of kind stage is refused', ['second-stage-axis']],
    ['a second axis of kind channel is refused', ['second-channel-axis']],
    ['a second axis of kind deviation is refused', ['second-deviation-axis']],
    ['a second channel that is a detail is allowed', ['second-channel-as-a-detail-is-fine']],
    ['a deviation axis holds none and the twelve classes only', ['unknown-deviation-class']],
    ['a deviation axis may hold none and all twelve classes', ['all-twelve-deviation-classes-and-none']],
    ['a deviation detail is exempt from the deviation rule', ['a-deviation-detail-may-hold-any-value']],
    ['a constraint on a missing variable is refused at its key', ['constraint-names-an-unknown-variable']],
    ['a constraint on a missing value is refused at its key', ['constraint-names-an-unknown-value']],
    ['a constraint that forbids nothing is refused', ['constraint-forbids-nothing']],
    [
      'the same combination written twice is refused in any key order',
      ['same-combination-twice-in-another-key-order'],
    ],
    ['a when on a missing variable is refused', ['when-names-an-unknown-variable']],
    ['an unless on a missing value is refused', ['unless-names-an-unknown-value']],
    ['a when on known values is accepted', ['when-naming-known-values-is-fine']],
    ['constraints that forbid every cell of the axes are refused', ['constraints-that-forbid-every-cell']],
    [
      'constraints that leave one cell of the axes are accepted',
      ['constraints-that-leave-one-cell-are-fine'],
    ],
    [
      'a constraint on a detail does not count toward the grid',
      ['a-constraint-on-a-detail-does-not-empty-the-grid'],
    ],
    ['a fitted prior needs a source', ['fitted-prior-without-a-source']],
    ['a fitted prior with a source is accepted', ['fitted-prior-with-a-source-is-fine']],
    ['an unknown key at the top of the file is refused', ['unknown-key-at-the-top']],
    ['an unknown key in a variable is refused', ['unknown-key-in-a-variable']],
    ['an unknown key in a value is refused', ['unknown-key-in-a-value']],
    ['a variable without the approved flag is refused', ['approved-flag-missing']],
    ['a kind outside the list is refused', ['kind-outside-the-list']],
    ['a format version other than 1 is refused', ['format-version-two']],
    ['a variable with no value is refused', ['variable-without-values']],
    ['a store with no variable is refused', ['store-without-variables']],
    ['an empty title is refused', ['empty-title']],
    ['a store without an agent is refused', ['agent-missing']],
    ['a version written as a number is refused', ['version-written-as-a-number']],
  ]),
  'values.file.ids': table([
    [
      'an id may not start with a hyphen, a dot or an underscore',
      [
        'variable-id-starts-with-a-hyphen',
        'variable-id-starts-with-a-dot',
        'variable-id-starts-with-an-underscore',
      ],
    ],
    ['an id may not hold a space', ['variable-id-has-a-space']],
    ['an empty id is refused', ['variable-id-is-empty']],
    ['an id may not hold an accented letter', ['variable-id-has-an-accent']],
    ['a value id may not hold a slash or a colon', ['value-id-has-a-slash', 'value-id-has-a-colon']],
    [
      'ids with digits, dots, underscores and hyphens inside are accepted',
      ['ids-with-dots-underscores-hyphens-and-digits-are-fine'],
    ],
  ]),
  'values.plan.approval': table([
    ['the plan leaves out a value nobody approved', ['unapproved-value-is-never-planned']],
    ['the plan leaves out a variable nobody approved', ['unapproved-variable-is-never-planned']],
    [
      'the plan drops a variable whose every value is unapproved',
      ['all-values-of-a-variable-unapproved-drops-the-variable'],
    ],
  ]),
  'values.owner': table([
    [
      'an owner value joins its variable with the owner words and day',
      ['new-value-is-added-with-provenance'],
    ],
    [
      'an owner value that exists already gains provenance instead of a copy',
      ['existing-value-gains-provenance-instead-of-a-duplicate'],
    ],
    [
      'an owner value for a missing variable is refused with a reason',
      ['value-for-a-missing-variable-is-refused'],
    ],
    ['owner words are stored byte for byte', ['owner-words-are-stored-unchanged']],
    ['blank owner words are refused', ['blank-words-are-refused']],
    ['an owner date that is not a real day is refused', ['unreal-dates-are-refused']],
    ['an owner date on a leap day is accepted only in a leap year', ['a-leap-day-is-a-real-day']],
  ]),
  'values.ids': table([
    ['ids do not depend on the order of the sources', ['stable-under-source-order']],
    ['ids do not change when unrelated sources are added', ['stable-under-unrelated-additions']],
    ['ids satisfy the grammar whatever the name they come from', ['grammar-for-awkward-field-names']],
    [
      'names that normalise to one id are told apart and none is dropped',
      ['near-collisions-are-disambiguated'],
    ],
    [
      'names like members of Object.prototype are ordinary data',
      ['javascript-prototype-names-are-ordinary-data'],
    ],
    [
      'value ids with spaces and accents are normalised, not dropped',
      ['value-ids-with-spaces-and-accents-are-normalised-not-dropped'],
    ],
    [
      'value ids are unique inside a variable only',
      ['the-same-value-ids-in-two-tools-stay-in-two-variables'],
    ],
    ['ids do not change with the white space of a span', ['stable-under-equivalent-whitespace']],
  ]),
  'boundaries.file.sides': table([
    ['a strict greater comparison refuses an edge that is the holds value', ['gt-edge-is-the-holds-value']],
    ['a strict greater comparison accepts an edge that is the fails value', ['gt-edge-is-the-fails-value']],
    ['a strict greater comparison accepts a third value for the edge', ['gt-edge-is-a-third-value']],
    ['a strict lesser comparison refuses an edge that is the holds value', ['lt-edge-is-the-holds-value']],
    ['a strict lesser comparison accepts an edge that is the fails value', ['lt-edge-is-the-fails-value']],
    ['a strict lesser comparison accepts a third value for the edge', ['lt-edge-is-a-third-value']],
    [
      'an inclusive greater comparison accepts an edge that is the holds value',
      ['ge-edge-is-the-holds-value'],
    ],
    [
      'an inclusive greater comparison refuses an edge that is the fails value',
      ['ge-edge-is-the-fails-value'],
    ],
    ['an inclusive greater comparison accepts a third value for the edge', ['ge-edge-is-a-third-value']],
    [
      'an inclusive lesser comparison accepts an edge that is the holds value',
      ['le-edge-is-the-holds-value'],
    ],
    [
      'an inclusive lesser comparison refuses an edge that is the fails value',
      ['le-edge-is-the-fails-value'],
    ],
    ['an inclusive lesser comparison accepts a third value for the edge', ['le-edge-is-a-third-value']],
    ['one value on both sides of a boundary is refused at fails', ['one-value-on-both-sides']],
    ['a boundary with no limit accepts its edge on the holds side', ['no-limit-the-edge-is-the-holds-value']],
    ['a boundary with no limit accepts a third value for its edge', ['no-limit-the-edge-is-a-third-value']],
    ['a holds value that the variable lacks is refused at holds', ['unknown-holds-value']],
    ['a fails value that the variable lacks is refused at fails', ['unknown-fails-value']],
    ['an edge value that the variable lacks is refused at edge', ['unknown-edge-value']],
    ['a limit without a comparison is refused', ['limit-without-a-comparison']],
    ['a comparison without a limit is refused', ['comparison-without-a-limit']],
    ['a unit without a limit is refused', ['unit-without-a-limit']],
    ['a negative limit is accepted', ['negative-limit']],
    ['a limit of zero is accepted', ['zero-limit']],
    ['a decimal limit is accepted', ['decimal-limit']],
    ['a limit that is not a number is refused', ['limit-is-not-finite-nan']],
    ['a limit that is infinite is refused', ['limit-is-not-finite-infinity']],
    ['a comparison outside lt, le, gt and ge is refused', ['comparison-outside-the-list']],
    ['a limit written as text is refused', ['limit-written-as-text']],
    ['a boundary with an unknown key is refused', ['boundary-with-an-unknown-key']],
    ['a variable may carry several boundaries', ['two-boundaries-on-one-variable']],
    [
      'a wrong edge is reported at the index of its boundary',
      ['second-boundary-wrong-side-is-reported-at-its-index'],
    ],
  ]),
  'boundaries.reader.roles': table([
    [
      'a greater comparison puts the holds value above the limit and the fails value below it',
      ['more-than', 'whole-limit-gives-whole-samples-gt', 'decimal-limit'],
    ],
    ['an inclusive greater comparison still gets an edge value of its own', ['at-least']],
    [
      'a lesser comparison puts the holds value below the limit and the fails value above it',
      ['under', 'whole-limit-gives-whole-samples-lt', 'zero-limit'],
    ],
    ['an inclusive lesser comparison still gets an edge value of its own', ['at-most', 'negative-limit']],
    ['a limit of a million keeps whole samples', ['large-limit']],
    ['the edge is always a third value', ['edge-is-always-a-third-value']],
    ['every sample carries the span and the path of its file', ['samples-carry-the-span-and-its-file']],
    [
      'spans of one quantity merge their samples without a repeated number',
      ['two-spans-of-one-quantity-share-samples-without-duplicates'],
    ],
    ['two limits of one quantity keep the samples of both', ['two-limits-of-one-quantity-keep-all-samples']],
  ]),
  'impossible.never-appears': table([
    ['no row holds a forbidden pair', ['one-pair', 'several-pairs']],
    ['a forbidden pair of axes is kept out of the rows', ['pairs-on-shared-axes-only']],
    ['a forbidden pair of details is kept out of the rows', ['pairs-on-details']],
    [
      'many forbidden pairs are kept out of the rows and every allowed tuple is still covered',
      ['dense-pairs'],
    ],
    ['a forbidden pair inside a rule is kept out of its rows', ['pair-inside-a-rule']],
    ['a tuple that no valid row can hold is not a target', ['pair-extendable-only-through-a-third-variable']],
  ]),
  'impossible.sizes': table([
    ['a constraint of one value removes every row that holds it and warns', ['one-value']],
    ['a constraint of three values removes only the rows that hold all three', ['three-values']],
    ['the pairs inside a forbidden triple stay targets', ['triple-leaves-every-pair-allowed']],
    ['a constraint written in the forbids field works like a pair', ['pair-through-the-forbids-field']],
    ['a pair written in the other order is the same pair', ['reversed-pair-is-the-same-pair']],
    ['a pair written again changes nothing', ['duplicate-pair-changes-nothing']],
    ['a pair of two values of one variable excludes nothing', ['same-variable-pair-excludes-nothing']],
  ]),
  'impossible.approval': table([
    [
      'a constraint that nobody approved plans nothing',
      ['unapproved-constraint-plans-nothing', 'unapproved-constraint-leaves-its-tuples-targets'],
    ],
    ['an approved constraint counts', ['approved-constraint-counts']],
    ['a constraint with no flag counts as approved', ['constraint-without-a-flag-counts']],
  ]),
  'impossible.unsatisfiable': table([
    [
      'a space with no valid row gives no new row or a named error',
      [
        'every-pair-of-two-binary-variables',
        'every-value-of-one-variable',
        'three-variables-with-a-cyclic-conflict',
      ],
    ],
    ['seeds are kept when the space has no valid row', ['unsatisfiable-space-with-seeds']],
  ]),
  'impossible.unreachable-value': table([
    ['a value forbidden alone warns value_unreachable and is left out', ['forbidden-alone']],
    [
      'a value forbidden with every value of another variable warns value_unreachable',
      [
        'forbidden-with-every-value-of-another-variable',
        'unreachable-because-the-only-value-of-another-variable-excludes-it',
      ],
    ],
    ['a store where every value can be held raises no warning', ['no-warning-when-every-value-can-be-held']],
  ]),
  'impossible.owner': table([
    ['an owner pair joins the store with the owner words and day', ['owner-pair-is-added-with-provenance']],
    ['an owner pair written in both orders is one pair', ['owner-pair-reversed-is-one-pair']],
    ['an owner pair written again is one pair', ['owner-pair-repeated-is-one-pair']],
    [
      'an owner pair that names a missing variable is refused with a reason',
      ['owner-pair-with-a-missing-variable-is-refused'],
    ],
    [
      'an owner pair that names a missing value is refused with a reason',
      ['owner-pair-with-a-missing-value-is-refused'],
    ],
    ['a valid owner pair survives a refused sibling', ['owner-valid-pair-survives-a-refused-sibling']],
    ['an owner pair with blank words is refused', ['owner-pair-blank-words-refused']],
    ['an owner pair with an unreal date is refused', ['owner-pair-unreal-date-refused']],
  ]),
  'weights.interval': table([
    [
      'weightInterval returns the Wilson score interval of the page',
      [
        'zero-of-one',
        'one-of-one',
        'zero-of-ten',
        'ten-of-ten',
        'five-of-ten',
        'three-of-seven',
        'fifty-of-a-hundred',
        'one-of-two',
        'two-of-three',
        'thirty-three-of-a-hundred',
      ],
    ],
    ['the interval of a zero count over many sessions starts at zero', ['zero-of-a-hundred']],
    [
      'the interval is exact for a rare share in many sessions',
      ['one-of-a-thousand', 'five-hundred-of-a-thousand'],
    ],
    ['the interval keeps its precision for a total of a million', ['one-million-total']],
    ['the interval keeps its precision for a total of a billion', ['one-billion-total']],
    ['the interval is not the constant zero to one', ['is-not-the-constant-zero-one']],
    ['the interval is ordered and inside zero and one', ['inside-zero-one-and-ordered']],
    ['the interval contains the observed share', ['contains-the-observed-share']],
    ['the interval of the complement is the mirror of the interval', ['is-mirrored-for-the-complement']],
    ['the interval narrows as the total grows', ['narrows-as-the-total-grows']],
    [
      'a zero count starts the interval at zero and a full count ends it at one',
      ['zero-count-starts-at-zero-and-full-count-ends-at-one'],
    ],
    [
      'the interval is clamped to zero and one, so rounding noise never leaves them',
      ['stays-inside-zero-one-despite-rounding'],
    ],
    [
      'the interval contains the true share about 95 percent of the time',
      ['contains-the-true-share-about-95-percent-of-the-time'],
    ],
  ]),
  'weights.file': table([
    [
      'weights on any scale are valid when every value has one',
      ['percent-weights-are-valid', 'fraction-weights-are-valid'],
    ],
    ['a store with no weights is valid', ['no-weights-are-valid']],
    ['one weight of zero among others is valid', ['one-zero-among-others-is-valid']],
    [
      'a variable that weighs some of its values is refused at the first value with no weight',
      [
        'weight-on-two-values-only',
        'weight-on-the-first-value-only',
        'weight-on-the-last-value-only',
        'incomplete-weights-in-the-second-variable',
      ],
    ],
    ['every weight of a variable at zero is refused', ['every-weight-zero']],
    ['a negative weight is refused', ['negative-weight']],
    ['a weight written as text is refused', ['weight-written-as-text']],
    ['a weight that is not a finite number is refused', ['weight-not-a-number', 'weight-infinite']],
    ['complete weights in several variables are valid', ['complete-weights-in-two-variables']],
  ]),
  'weights.reader': table([
    [
      'conversation weights are proportional to the counts',
      ['conversation-weights-are-proportional-to-counts'],
    ],
    ['a variable no session showed gains no weight', ['an-unobserved-variable-gains-no-weights']],
    ['empty conversations change no weight', ['empty-conversations-change-no-weight']],
    [
      'sessions that miss a variable do not raise its total',
      ['sessions-that-miss-the-variable-do-not-raise-its-total'],
    ],
    [
      'a proposed value is weighted by its count and stays unapproved',
      ['an-unknown-value-is-a-weighted-unapproved-proposal'],
    ],
    ['owner weights are stored as declared', ['owner-weights-are-stored-as-declared']],
    ['a negative owner weight is refused with a reason', ['owner-negative-weight-is-refused']],
    [
      'an owner weight that is not finite is refused with a reason',
      ['owner-weight-that-is-not-finite-is-refused'],
    ],
    ['an owner weight for a missing value is refused', ['owner-weight-for-a-missing-value-is-refused']],
  ]),
  'strength.rule-triples': table([
    ['a rule of one variable is covered by value', ['rule-of-one']],
    ['a rule of two variables is crossed in pairs', ['rule-of-two']],
    ['a rule of three or four variables is crossed in triples', ['rule-of-three', 'rule-of-four']],
    ['every triple of a rule of five variables is covered', ['rule-of-five']],
    [
      'a rule of six binary variables uses fewer than 60 percent of its full product',
      ['rule-of-six-binary-under-60-percent'],
    ],
    [
      'a rule of eight binary variables uses fewer than 60 percent of its full product',
      ['rule-of-eight-binary-under-60-percent'],
    ],
    [
      'a rule of five ternary variables uses fewer than 60 percent of its full product',
      ['rule-of-five-ternary-under-60-percent'],
    ],
    [
      'a rule of four quaternary variables uses fewer than 60 percent of its full product',
      ['rule-of-four-quaternary-under-60-percent'],
    ],
    [
      'a rule is crossed at strength 3 and not at the size of the rule',
      ['rule-covers-its-triples-not-its-quadruples'],
    ],
  ]),
  'strength.shared-pairs': table([
    [
      'axes are crossed in pairs',
      ['two-binary-axes', 'five-binary-axes', 'four-ternary-axes', 'mixed-arity-axes'],
    ],
    ['axes that no rule joins are still crossed in pairs', ['axes-no-rule-joins']],
    ['details are never crossed in pairs', ['details-are-not-crossed']],
    ['a lone axis is covered by value', ['one-axis-alone-is-covered-by-value']],
  ]),
  'strength.singles': table([
    ['a variable no group names is covered by value', ['one-detail', 'independent-details']],
    ['independent details share rows', ['details-share-rows']],
    ['a detail outside every rule is covered by value', ['detail-outside-the-rule']],
  ]),
  'strength.group-size': table([
    ['a variable repeated in a rule counts once', ['repeated-variable-in-a-rule']],
    ['a rule drops a variable the store lacks', ['rule-names-an-unknown-variable']],
    ['a rule drops a variable nobody approved', ['rule-names-an-unapproved-variable']],
    ['a rule with no variable plans nothing', ['rule-with-no-variables']],
    ['a rule of seven variables needs triples only', ['rule-of-seven-needs-triples-only']],
  ]),
  'strength.row-cap': table([
    ['the plan of binary axes stays under the row cap of the page', ['eight-binary-axes']],
    ['the plan of ternary axes stays under the row cap of the page', ['six-ternary-axes']],
    ['a rule beside axes stays under the row cap of the page', ['binary-rule-of-six-beside-axes']],
    ['seeds lower the row cap by the tuples they hold', ['after-seeds']],
    [
      'a wide axis beside binary axes stays under the row cap of the page',
      ['one-wide-axis-and-three-binary'],
    ],
  ]),
  'strength.report': table([
    ['the plan reports the allowed and covered counts of axes', ['axes-only']],
    ['the plan reports the counts of a rule', ['one-rule']],
    ['a pair of axes that a rule holds is not counted again', ['rule-overlapping-axes']],
    ['overlapping rules count each tuple once', ['two-overlapping-rules']],
    ['the report counts only the tuples a valid row can hold', ['with-constraints']],
    ['the report credits seeds', ['with-seeds-partly-covering']],
    ['the report leaves out values nobody approved', ['unapproved-value-is-outside-the-counts']],
  ]),
  'seeds.leading': table([
    ['seeds lead the plan in input order as kind seed', ['seeds-first-in-order']],
    ['a partial seed is kept as given', ['partial-seed-is-not-completed']],
    ['seed rows are copies of the input', ['seed-rows-are-copies']],
    ['frozen inputs are accepted', ['frozen-inputs-are-accepted']],
    ['rows have distinct non-empty ids', ['rows-have-distinct-nonempty-ids']],
    ['absent and empty seeds are the same', ['absent-and-empty-seeds-are-equal']],
    ['a seed given twice is kept twice', ['the-same-seed-twice-is-kept-twice']],
    ['a new row never repeats a seed', ['new-rows-repeat-no-seed']],
  ]),
  'seeds.credit': table([
    [
      'seeds that hold every tuple leave no new row',
      ['seeds-that-cover-everything-leave-no-new-row', 'every-full-row-as-a-seed'],
    ],
    [
      'a partial seed credits the tuples whose variables it assigns',
      ['partial-seeds-credit-the-tuples-they-assign'],
    ],
    [
      'a partial seed credits nothing it does not assign',
      ['partial-seed-does-not-credit-what-it-does-not-assign'],
    ],
    ['each new row holds a tuple the seeds miss', ['each-new-row-covers-a-tuple-the-seeds-miss']],
    [
      'seed credit lowers the number of new rows',
      ['thirty-percent-covered', 'half-covered', 'ninety-percent-covered', 'mostly-covered'],
    ],
    [
      'seeds and new rows together cover every required tuple',
      ['seeds-and-new-rows-cover-all-required-tuples'],
    ],
  ]),
  'seeds.warnings': table([
    [
      'a seed entry for a variable the store lacks is dropped with seed_unknown_value',
      ['unknown-variable-is-dropped-from-the-seed'],
    ],
    [
      'a seed entry for a value the store lacks is dropped with seed_unknown_value',
      ['unknown-value-is-dropped-from-the-seed'],
    ],
    [
      'a seed with a value nobody approved is kept whole with seed_unapproved_value',
      ['unapproved-value-is-kept-whole'],
    ],
    ['a seed that holds a forbidden combination is kept with seed_forbidden', ['forbidden-seed-is-kept']],
    [
      'with nothing approved the plan is the seeds alone with no_variables',
      ['nothing-approved-the-plan-is-the-seeds', 'nothing-approved-and-no-seeds'],
    ],
    ['a warning is a code and a message', ['a-warning-is-a-code-and-a-message']],
    ['regular seeds raise no warning', ['regular-seeds-raise-no-warning']],
  ]),
  'seeds.determinism': table([
    ['equal inputs give equal bytes', ['same-options-same-bytes']],
    ['seed zero is supported', ['zero-seed']],
    ['negative seeds are supported', ['negative-seed']],
    ['the largest safe integer seed is supported', ['largest-safe-seed']],
    ['the order of the keys of the store changes nothing', ['key-order-of-the-store-does-not-matter']],
    ['the order of the keys of a seed changes nothing', ['key-order-of-a-seed-does-not-matter']],
    ['the plan does not change its inputs', ['the-plan-does-not-change-its-inputs']],
    ['two plans share no mutable object', ['two-plans-share-no-object']],
    ['an object cache never returns a stale plan', ['a-reused-store-edited-in-place-is-read-again']],
  ]),
  'budget.traffic-order': table([
    ['new rows run from the most common to the rarest', ['new-rows-run-most-common-first']],
    ['the log weight of a row is the sum of the logs of its shares', ['log-weight-is-the-sum-of-log-shares']],
    ['the log weight is written to nine places', ['log-weight-is-written-to-nine-places']],
    ['a variable with no weights has uniform shares', ['uniform-shares-when-a-variable-has-no-weights']],
    ['weights are relative, so a scale changes no share', ['weights-are-relative']],
    [
      'a weight of zero gives minus infinity, written null, and the row comes last',
      ['weight-zero-is-minus-infinity-and-last'],
    ],
    ['values nobody approved leave the denominator of a share', ['unapproved-values-leave-the-denominator']],
    [
      'an unweighted variable has uniform shares beside a weighted one',
      ['unweighted-variable-beside-a-weighted-one'],
    ],
    [
      'rows are ordered in log space, so a product below the float floor keeps its order',
      ['shares-below-the-float-floor-keep-their-order'],
    ],
    ['a seed row carries a log weight', ['seed-rows-carry-a-log-weight']],
    ['seed rows stay first whatever their weight', ['rare-seed-stays-first']],
  ]),
  'budget.cut': table([
    [
      'a budget keeps a prefix of the uncut plan',
      [
        'budget-one',
        'budget-three',
        'budget-half-of-the-plan',
        'budget-one-below-the-plan',
        'budget-equal-to-the-plan',
        'budget-above-the-plan',
      ],
    ],
    ['a budget counts the seeds', ['budget-counts-the-seeds']],
    [
      'a budget below the seed count keeps every seed and no new row',
      ['budget-below-the-seed-count-keeps-every-seed', 'budget-equal-to-the-seed-count-adds-no-row'],
    ],
    ['a budget of zero without seeds gives no row', ['zero-budget-without-seeds']],
    ['a budget of zero with seeds keeps the seeds', ['zero-budget-with-seeds']],
    ['the cut drops the rarest rows', ['the-cut-drops-the-rarest-rows']],
    ['a cut plan reports what its kept rows hold', ['cut-plan-reports-what-its-rows-hold']],
    ['the same budget gives the same bytes', ['same-budget-same-bytes']],
  ]),
  'budget.errors': table([
    [
      'a negative budget raises a RangeError that names budget',
      ['negative', 'large-negative', 'a-bad-budget-with-seeds'],
    ],
    ['a budget that is not whole raises a RangeError that names budget', ['fractional', 'tiny-fraction']],
    [
      'a budget that is not a finite number raises an error that names budget',
      ['not-a-number', 'infinity', 'negative-infinity'],
    ],
    ['a budget that is not a number raises an error that names budget', ['text']],
  ]),
  'budget.ties': table([
    ['rows of equal weight keep an order fixed by the seed', ['equal-weights-stable-order']],
    ['any plan seed gives a sound plan ordered by weight', ['any-plan-seed-gives-a-sound-ordered-plan']],
  ]),
  'counter.exact': table([
    [
      'coverage counts the distinct allowed pairs and the pairs the rows hold',
      ['pairs-unconstrained', 'mixed-arities'],
    ],
    ['coverage counts triples', ['triples-unconstrained']],
    ['coverage counts single values', ['strength-one']],
    [
      'coverage counts only tuples that extend to a valid row',
      ['with-pair-constraints', 'with-dense-constraints', 'with-a-triple-forbid'],
    ],
    [
      'a tuple that fits pair by pair but no valid row is not allowed',
      ['a-tuple-that-fits-pair-by-pair-but-no-row-is-not-allowed'],
    ],
    [
      'a partial row credits only the tuples it assigns',
      ['partial-rows-credit-what-they-assign', 'partial-rows-at-strength-three'],
    ],
    ['overlapping groups never inflate a count', ['overlapping-groups-count-once', 'the-same-group-twice']],
    ['repeated rows never inflate a count', ['repeated-rows-count-once']],
    ['with no rows nothing is held and the allowed count still stands', ['no-rows']],
    ['every valid row holds every allowed tuple', ['every-valid-row']],
    [
      'a strength above the group size is capped at the size',
      ['strength-above-the-group-size', 'group-of-one-variable'],
    ],
    [
      'a row with a value the store lacks credits nothing for it',
      ['rows-with-unlisted-values-credit-nothing'],
    ],
    ['a value nobody approved is outside the space', ['unapproved-values-are-not-in-the-space']],
    [
      'coverage matches a brute force on random spaces',
      ['random-shape-one', 'random-shape-two', 'random-shape-three'],
    ],
  ]),
  'counter.uncovered': table([
    [
      'the uncovered list holds the smaller of the limit and the missing count',
      ['limit-below-the-count', 'limit-above-the-count-lists-all', 'limit-zero-lists-none'],
    ],
    ['the uncovered tuples are distinct', ['listed-tuples-are-distinct']],
    ['the uncovered tuples are allowed and held by no row', ['listed-tuples-are-allowed-and-unheld']],
    ['nothing missing lists nothing', ['nothing-missing-lists-nothing']],
  ]),
  'counter.errors': table([
    [
      'a group with an unknown variable raises a RangeError that names it',
      ['unknown-variable', 'unknown-variable-among-known', 'unknown-variable-in-the-second-group'],
    ],
    ['a group with a repeated variable raises a RangeError that names it', ['duplicate-variable']],
    [
      'a strength that is not a positive whole number raises a RangeError that names strength',
      [
        'strength-zero',
        'strength-negative',
        'strength-fraction',
        'strength-not-a-number',
        'strength-infinite',
      ],
    ],
  ]),
  'counter.exact-beyond-safe': table([
    [
      'counts above the safe integer range are exact bigint values, from a closed form',
      [
        'binary-sixty-variables-strength-thirty',
        'ternary-fifty-variables-strength-fifteen',
        'quaternary-forty-variables-strength-twelve',
      ],
    ],
    ['counts inside the safe range are exact', ['just-inside-the-safe-range']],
    [
      'the covered count is exact beyond the safe range without enumerating tuples',
      ['covered-by-two-rows-beyond-the-safe-range'],
    ],
  ]),
  'scale.axes': table([
    ['the plan of 20 or 50 binary axes stays under the row cap and five seconds', ['binary-20', 'binary-50']],
    ['the plan of 100 binary axes stays under the row cap and ten seconds', ['binary-100']],
    ['the plan of 200 binary axes stays under the row cap and fifteen seconds', ['binary-200']],
    ['the plan of 400 binary axes stays under the row cap and forty seconds', ['binary-400']],
    ['the plan of 30 or 60 ternary axes stays under the row cap and its time', ['ternary-30', 'ternary-60']],
    [
      'the plan of axes of eight values stays under the row cap and its time',
      ['arity-eight-10', 'arity-eight-20'],
    ],
    [
      'one wide axis beside binary axes stays under the row cap and ten seconds',
      ['one-arity-200-axis-and-three-binary'],
    ],
  ]),
  'scale.rules': table([
    ['20 rules of six binary variables stay under the row cap and thirty seconds', ['twenty-rules']],
    ['100 rules of six binary variables stay under the row cap and thirty seconds', ['hundred-rules']],
    ['overlapping rules stay under the row cap and thirty seconds', ['overlapping-rules']],
  ]),
  'scale.details': table([
    ['a thousand independent ternary variables need six rows and ten seconds at most', ['thousand-ternary']],
    [
      'five thousand independent ternary variables need six rows and ten seconds at most',
      ['five-thousand-ternary'],
    ],
  ]),
  'scale.dense-pairs': table([
    [
      '200 variables with 2,000 impossible pairs plan within four times the row cap and thirty seconds',
      ['two-thousand-pairs'],
    ],
    [
      '200 variables with 20,000 impossible pairs plan within four times the row cap and thirty seconds',
      ['twenty-thousand-pairs'],
    ],
  ]),
  'scale.seeds': table([
    ['500 seeds over 20 axes are kept and credited within eight seconds', ['five-hundred-seeds']],
    ['3,000 seeds over 20 axes are kept and credited within eight seconds', ['three-thousand-seeds']],
  ]),
  'scale.readers': table([
    ['200 condition spans are read within five seconds', ['spans-200']],
    ['2,000 condition spans are read within ten seconds', ['spans-2000']],
    ['10,000 condition spans are read within thirty seconds', ['spans-10000']],
    ['10,000 conversations are counted within two seconds', ['conversations-10000']],
    ['100,000 conversations are counted within five seconds', ['conversations-100000']],
    ['2,000 quotes in a one-megabyte file are checked within three seconds', ['quotes-2000-in-one-megabyte']],
    [
      'each of 2,000 quotes in a one-megabyte file that is wrong is reported with its code and its own path',
      ['quotes-2000-reports-each-wrong-one'],
    ],
    ['2,000 owner values are added within three seconds', ['owner-values-2000']],
    ['10,000 owner values are added within three seconds', ['owner-values-10000']],
  ]),
  'scale.counter': table([
    [
      'the count of 200 binary variables at strength 3 is a closed form of 50 milliseconds',
      ['closed-form-200-binary'],
    ],
    [
      'the count of 500 binary variables at strength 3 is a closed form of 50 milliseconds',
      ['closed-form-500-binary'],
    ],
    [
      'the coverage of 30 rows over 100 binary variables at strength 3 takes under twenty seconds',
      ['thirty-rows-100-binary-strength-3'],
    ],
    [
      'the coverage of 30 rows over 200 binary variables at strength 2 takes under twenty seconds',
      ['thirty-rows-200-binary-strength-2'],
    ],
  ]),
  'reach.build-store': table([['the adapter maps buildStore to a function of the product', ['mapped']]]),
  'reach.weight-interval': table([
    ['the adapter maps weightInterval to a function of the product', ['mapped']],
  ]),
  'reach.plan': table([['the adapter maps plan to a function of the product', ['mapped']]]),
  'reach.coverage': table([['the adapter maps coverage to a function of the product', ['mapped']]]),
  'reach.validate': table([['the adapter maps validate to a function of the product', ['mapped']]]),
  'reach.quotes': table([['the adapter maps quotes to a function of the product', ['mapped']]]),
  'values.file.ambiguous-value': table([
    [
      'a value id shared by an axis of kind behaviour and an axis of kind persona is refused',
      ['behaviour-and-persona'],
    ],
    [
      'a value id shared by an axis of kind behaviour and an axis of kind data is refused',
      ['behaviour-and-data'],
    ],
    [
      'a value id shared by an axis of kind behaviour and an axis of kind task is refused',
      ['behaviour-and-task'],
    ],
    [
      'a value id shared by an axis of kind persona and an axis of kind data is refused',
      ['persona-and-data'],
    ],
    [
      'a value id shared by an axis of kind persona and an axis of kind task is refused',
      ['persona-and-task'],
    ],
    ['a value id shared by an axis of kind data and an axis of kind task is refused', ['data-and-task']],
    [
      'a value id shared with a stage, channel or deviation axis is not an ambiguous value',
      ['ids-shared-with-a-stage-or-channel-axis-are-fine'],
    ],
    ['the value none may sit in axes of different kinds', ['none-in-axes-of-two-kinds-is-fine']],
    [
      'a detail may repeat the value id of an axis of another kind',
      ['a-detail-may-repeat-the-id-of-an-axis-of-another-kind'],
    ],
  ]),
  'impossible.same-variable': table([
    [
      'a pair of two values of one variable excludes nothing, whatever the words that carry it',
      ['wording-does-not-decide'],
    ],
    [
      'a constraint of one entry still excludes its value when a pair of one variable sits beside it',
      ['one-entry-constraint-binds-beside-a-same-variable-pair'],
    ],
  ]),
  'quotes.no-constraints': table([
    ['the quote check finds a quote in a store file that has no constraints list', ['true-quote-is-found']],
    [
      'the quote check reports a false quote in a store file that has no constraints list',
      ['false-quote-is-reported'],
    ],
    [
      'a store file with no constraints list gives the same issues as one with an empty list',
      ['absent-list-and-empty-list-agree'],
    ],
  ]),
};
