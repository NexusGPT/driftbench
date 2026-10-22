import { HARDENING_CAP_MS } from './hardening';
import { row, type Spec } from './types';

/**
 * Items for the rule that no comment text reaches a labeler request. An opaque comment is shown by its kind; a
 * comment inside another unit is replaced in the request by `(comment)` and the rest of the unit is sent as
 * before. One item per placement. Each passes on the reference reader and fails on a reader that sends the
 * comment text, and on one that drops the whole unit (test/pointer/cr2-comment-privacy.test.ts).
 */

const placed: Pick<Spec, 'capMs' | 'component' | 'needs'> = {
  capMs: HARDENING_CAP_MS,
  component: 'privacy',
  needs: ['scan', 'transport'],
};

export const HARDENING_PRIVACY_SPECS: Record<string, Spec[]> = {
  privacy: [
    row(
      'comment-text-never-leaves-inline',
      3,
      'A comment inside a sentence never leaves in a request; the rest of the sentence does',
      'A file of a plain sentence and a sentence split at a seeded word, a comment holding a seeded private marker (twelve private-use characters) between the two halves; a recording scan of the `haiku` arm on a fake transport.',
      'A request leaves and holds the plain sentence; no request holds a character of the marker; a request holds the first half and a request holds the second half.',
      'privacy:comment-text-never-leaves-inline',
      placed,
    ),
    row(
      'comment-text-never-leaves-eol',
      3,
      'A comment at the end of a line after text never leaves in a request; the text before and after it does',
      'A file of a plain sentence and a seeded sentence split at a seeded word across two lines, a comment holding a seeded private marker at the end of the first line after its words; a recording scan of the `haiku` arm on a fake transport.',
      'A request leaves and holds the plain sentence; no request holds a character of the marker; a request holds the words before the comment and a request holds the words after it.',
      'privacy:comment-text-never-leaves-eol',
      placed,
    ),
    row(
      'comment-text-never-leaves-heading',
      3,
      'A comment inside a heading never leaves in a request, in the heading or in the path of a window; the rest of the heading does',
      'A file of a heading of seeded words followed by a comment holding a seeded private marker, and a plain sentence under the heading; a recording scan of the `haiku` arm on a fake transport.',
      'A request leaves and holds the plain sentence; no request holds a character of the marker; a request holds the words of the heading.',
      'privacy:comment-text-never-leaves-heading',
      placed,
    ),
    row(
      'comment-text-never-leaves-table',
      3,
      'A comment inside a table cell never leaves in a request; the rest of the cell does',
      'A file of a plain sentence and a table of one row whose first cell is a seeded sentence split at a seeded word with a comment holding a seeded private marker between the two halves; a recording scan of the `haiku` arm on a fake transport.',
      'A request leaves and holds the plain sentence; no request holds a character of the marker; a request holds the first half and a request holds the second half of the cell.',
      'privacy:comment-text-never-leaves-table',
      placed,
    ),
  ],
};
