import { row, type Spec } from './types';

/**
 * Re-anchoring items for the capabilities written into docs/estate-pointer-reader.md section 4 on 2026-10-23:
 * steps 3 and 4 read the whole estate (a unit moved to another file and edited keeps its id), and a table cell keeps
 * its id by its text when unique and long, else by its row key and column header, else gets a new id. Each fails
 * on the shared `ItemFailure`: a message prints the edit and the fates the reader gave, never the planted ones.
 */
export const reanchoringCapabilitySpecs: Spec[] = [
  row(
    'cross-file-move-reword',
    3,
    'A unit moved to another file and reworded keeps its id',
    'Two files of 8 long units; one unit leaves file A for file B with a few words replaced (text similarity 0.75 to 0.95).',
    'The old id lives in file B on the new text, with the event `changed`.',
    'anchor:cross-file-pairwise',
  ),
  row(
    'cross-file-move-split',
    4,
    'A unit moved to another file and split keeps its id on one part',
    'Two files; one unit `A, and b.` leaves file A and comes back in file B as the sentences `A.` and `B.`.',
    'The old id lives in file B on one of the two parts, with the event `split`.',
    'anchor:cross-file-split',
  ),
  row(
    'renamed-file-reword',
    3,
    'A unit reworded in a renamed file keeps its id',
    'Two files; file A is renamed and one of its units reworded (text similarity 0.75 to 0.95).',
    'The old id lives under the new path on the new text, with the event `changed`.',
    'anchor:cross-file-pairwise',
  ),
  row(
    'table-row-moved',
    2,
    'A moved table row keeps the ids of its cells',
    'A table of 4 rows of long cells; the first row moves to the end.',
    'Every cell keeps its id on its own text.',
    'anchor:table-cell-follows-edit',
  ),
  row(
    'table-column-reordered',
    3,
    'A reordered table column keeps the ids of its cells',
    'A table of 3 rows by 3 columns of long cells; the last column moves to the front.',
    'Every cell keeps its id on its own text.',
    'anchor:table-cell-follows-edit',
  ),
  row(
    'table-column-inserted',
    3,
    'An inserted table column keeps the ids of the other cells',
    'A table of 3 rows by 2 columns of long cells; a new column is inserted between them.',
    'Every old cell keeps its id on its own text.',
    'anchor:table-cell-follows-edit',
  ),
  row(
    'table-cell-text-follows',
    3,
    'A long unique cell keeps its id by its text when its column header changes',
    'A table of 4 rows, short row keys and long cells; the rows move and the long column is renamed.',
    'Every long cell keeps its id on its own text, though its row key and column header no longer match.',
    'anchor:table-cell-follows-edit',
  ),
  row(
    'table-cell-key-follows',
    3,
    'A short repeated cell keeps its id by its row key and column header',
    '4 rows, long row keys, a `Done` column of `Yes` and `No`; the rows reverse and a column is inserted.',
    'Each `Done` cell keeps its id in the row of its row key, under `Done`.',
    'anchor:table-cell-by-key',
  ),
  row(
    'table-cell-new-id',
    3,
    'A short repeated cell gets a new id when its row key does not survive',
    'The same table; every row key is rewritten, the `Done` column is unchanged.',
    'No old `Done` id is live: each `Done` cell has a new id.',
    'anchor:table-cell-new-id',
  ),
];
