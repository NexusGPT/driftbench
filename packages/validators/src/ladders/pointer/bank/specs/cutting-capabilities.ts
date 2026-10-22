import { row, type Spec } from './types';

/**
 * Cut items for the capabilities written into docs/estate-pointer-reader.md section 2 on 2026-10-23 (the lead's
 * approved list): footnotes, GitHub alerts, TOML and JSON front matter, the sentence ends of every script,
 * directives and display math. Each plants its units by construction and fails on the shared `ItemFailure`, so a
 * message names the rule, the file and the cut, never the planted units.
 */
export const cuttingCapabilitySpecs: Spec[] = [
  row(
    'footnote-reference-after-stop',
    2,
    'A footnote reference stays in the sentence it follows',
    'A sentence, `[^1]` right after its full stop, a second sentence; then the definition `[^1]: ` and a sentence.',
    'Exact cut: the first sentence with its reference, the second sentence, the definition sentence without its marker.',
    'cutter:footnote-reference-in-sentence',
  ),
  row(
    'footnote-definition-path',
    3,
    'A footnote definition carries its label in the heading path',
    'A heading, a sentence, then a definition `[^n1]: ` with one sentence.',
    'The definition sentence has the heading path of the file followed by its label.',
    'cutter:footnote-definition-path',
  ),
  row(
    'footnote-definition-paragraphs',
    3,
    'Every paragraph of a footnote definition is cut like prose',
    'A sentence with `[^2]`, then a definition of two paragraphs (the second indented four spaces).',
    'Exact cut: one sentence unit per paragraph sentence, the marker in no unit.',
    'cutter:footnote-definition-prose',
  ),
  row(
    'alert-marker-not-prose',
    2,
    'The marker of a GitHub alert is in no unit',
    '`> [!WARNING]` and one quoted sentence.',
    'Exact cut: one block quote unit, the sentence alone.',
    'cutter:alert-marker-not-prose',
  ),
  row(
    'alert-type-path',
    3,
    'A GitHub alert type ends the heading path of its units',
    'A heading, then `> [!NOTE]` and one quoted sentence.',
    'The quote unit has the heading path of the file followed by the alert type.',
    'cutter:alert-type-path',
  ),
  row(
    'front-matter-toml',
    2,
    'TOML front matter values are units keyed by their path',
    'Front matter between `+++` lines: a title, an array of two tags, a table with a name; then one sentence.',
    'Exact cut: four front matter units with their paths, then the sentence.',
    'cutter:toml-front-matter',
  ),
  row(
    'front-matter-json',
    2,
    'JSON front matter values are units keyed by their path',
    'A JSON object opening the file: a title, an array with one tag, an object with a name; then one sentence.',
    'Exact cut: three front matter units with their paths, then the sentence.',
    'cutter:json-front-matter',
  ),
  row(
    'sentence-terminal-every-script',
    2,
    'Every Sentence_Terminal character ends a sentence, and no other does',
    'Two sentences each in Mongolian, Syriac, N’Ko and Balinese script, ended by their full stops; two Tibetan phrases ended by the shad.',
    'Two units per script with the property; one unit for the Tibetan paragraph (the shad has no Sentence_Terminal property).',
    'cutter:sentence-terminal-property',
    { seedFree: true },
  ),
  row(
    'thai-no-dictionary',
    2,
    'A space in Thai is no sentence end (UAX #29, no dictionary)',
    'Two Thai clauses separated by a space.',
    'One unit.',
    'cutter:uax29-no-dictionary',
    { seedFree: true },
  ),
  row(
    'directive-marker-not-prose',
    2,
    'The lines of a container directive are in no unit',
    '`:::note`, one sentence, `:::`.',
    'Exact cut: the sentence alone.',
    'cutter:directive-marker-not-prose',
  ),
  row(
    'directive-name-path',
    3,
    'A container directive name ends the heading path of its units',
    'A heading, then `:::warning`, one sentence, `:::`.',
    'The sentence has the heading path of the file followed by the directive name.',
    'cutter:directive-name-path',
  ),
  row(
    'math-block-opaque',
    2,
    'A display math block is one opaque unit',
    '`$$`, a line with full stops, `$$`; then one sentence.',
    'Exact cut: one opaque unit over the block, then the sentence.',
    'cutter:math-block-opaque',
  ),
];
