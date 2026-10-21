import { row, type Spec } from './types';

/**
 * Items added after the four audits of the bank (validators/pointer/audit.md). Each one is red on a defect an audit
 * planted or a cheat an audit wrote, and green on the reference reader. They belong to the family named by their
 * key, and the catalogue lists them with the others. `HARDENING_CAPS` is the longest each may take.
 */

/** The longest an item of this file may take, in milliseconds. */
export const HARDENING_CAP_MS = 90_000;
/** The item whose reader call runs in a child process: the child is killed at 120 s, the item at 150 s. */
export const HARDENING_CHILD_CAP_MS = 150_000;

const cap = { capMs: HARDENING_CAP_MS } as const;

export const HARDENING_SPECS: Record<string, Spec[]> = {
  cutting: [
    row(
      'url-query-capital-after-mark',
      3,
      'A question mark inside a URL does not end the sentence, even before a capital letter',
      'A sentence that holds `https://shop.example/<word>?<Key>=<n>&<Key>=<word>` in the middle, then a second sentence.',
      'Two units; the first holds the whole URL and ends at its own full stop. A cutter that does not mask the URL splits at the `?` before the capital key.',
      'cutter:mask-urls-before-segmenting',
      { ...cap, component: 'cutter', role: 'catch' },
    ),
  ],
  ids: [
    row(
      'lineage-is-history',
      3,
      'The lineage of an entry is its history: one step per change, none for a rescan that changes nothing',
      'One file of eight units scanned four times: fresh, unchanged, one unit reworded, one unit deleted.',
      'Every entry shows lineage; the unchanged rescan writes the same ledger bytes; the reworded entry ends with `changed` and the deleted one with `deleted`; every other entry still holds only `new`.',
      'ledger:lineage-appends-true-events',
      { ...cap, component: 'ledger' },
    ),
    row(
      'entry-slices-with-bom-and-crlf',
      3,
      'In a file with a byte-order mark and CRLF line ends, an entry quote is the slice of the source its hint names',
      'A file with a BOM and CRLF holding a heading, a paragraph whose sentences wrap over two lines, and a list.',
      'For every live entry, `source.slice(hint.start, hint.end)` equals the quote, and prefix + quote + suffix occurs in the source.',
      'ledger:quote-is-the-source-slice',
      { ...cap, component: 'ledger' },
    ),
    row(
      'id-unique-for-repeated-text',
      2,
      'Fifty identical sentences in one file get fifty distinct ids, and the scan ends',
      'One file holding the same long sentence in fifty paragraphs, scanned in a child process that is killed after 120 s.',
      'The scan ends; fifty live entries; fifty distinct ids. A reader that never ends fails this one item.',
      'ids:occurrence-in-the-id',
      {
        component: 'ids',
        needs: ['scan', 'child'],
        seedFree: true,
        capMs: HARDENING_CHILD_CAP_MS,
        role: 'catch',
      },
    ),
  ],
  're-anchoring': [
    row(
      'events-follow-the-text',
      3,
      'The event of each id is what a comparison of the old and the new text gives',
      'Two files of eight units. One unit moves to the other file, one is reworded by one word, one is deleted, one is added.',
      '`moved` for the moved unit, `changed` for the reworded one, `deleted` for the deleted one, `unchanged` for the others, `new` for the added one; a reader that calls every surviving id `unchanged` fails.',
      'scan:events-by-id',
      { ...cap, component: 'anchor' },
    ),
    row(
      'neighbour-edit-relabels',
      3,
      'A unit whose text is the same but whose neighbour changed is labelled again, and the new answer lands',
      'One file of twelve units; the unit in the middle is reworded; the second scan flips the answer for its two neighbours.',
      'The two neighbours keep their ids and their text and take the new answer; units farther away keep their old label.',
      'ledger:labels-carry-only-with-context',
      { ...cap, component: 'ledger', role: 'catch' },
    ),
    row(
      'short-repeated-text-stays-in-file',
      3,
      'A short text that two files repeat is not followed from one file to a third',
      'Three files; two hold the same five-letter sentence; the copy of the first file is removed and the third file gains it.',
      'The third file takes a fresh id; the id of the removed copy is deleted; the copy of the second file keeps its id.',
      'anchor:short-text-needs-to-be-unique',
      { ...cap, component: 'anchor', role: 'catch' },
    ),
  ],
  privacy: [
    row(
      'warning-names-models-not-units',
      3,
      'The warning of a model mismatch names both models and quotes no unit text',
      'The committed Haiku fixture re-recorded against a cassette whose models are `m-1` while the transport answers `m-2`.',
      'The scan succeeds; the warnings are not empty; one names `m-1` and `m-2`; none holds a stretch of unit text.',
      'scan:warn-on-returned-model-mismatch',
      { ...cap, component: 'scan' },
    ),
  ],
  radius: [
    row(
      'deleted-unit-reruns-its-links',
      3,
      'A deleted unit reruns the tests that link it',
      'A world of rules with linked blocks; one linked rule is deleted.',
      'The rerun set is exactly the owners of the links on the deleted rule.',
      'radius:deleted-units-rerun',
      { ...cap, component: 'radius', needs: ['scan', 'rerun'], role: 'catch' },
    ),
    row(
      'new-unit-falls-back-to-whole-file',
      3,
      'A new unit under a heading nobody linked reruns every link of its file',
      'A world of rules with linked blocks; a new unit is added under a new top-level heading of a file the ledger holds.',
      'The rerun set is the owners of the links on every old unit of that file.',
      'radius:new-unit-section-fallback',
      { ...cap, component: 'radius', needs: ['scan', 'rerun'], role: 'catch' },
    ),
    row(
      'context-edit-is-advisory',
      3,
      'A unit whose neighbour changed is reported as advisory, and nothing reruns for it',
      'A world of rules with linked blocks; one rule is reworded, so the rules beside it change only their context.',
      'The owners of the neighbours are advisory and are not in the rerun set; the reworded rule reruns its owners.',
      'radius:context-change-is-advisory',
      { ...cap, component: 'radius', needs: ['scan', 'rerun'], role: 'catch' },
    ),
  ],
  grouping: [
    row(
      'same-unit-in-two-sets-is-one-atom',
      3,
      'Two label sets that map one unit to one atom kind build one atom and report the repeat',
      'Two sets, each with a label that maps to the instruction atom; both label every unit of a file.',
      'One atom per unit and one `duplicate` diagnostic per unit; no unit has two atoms of one kind on its lines.',
      'atoms:report-repeated-atoms',
      { ...cap, component: 'atoms', role: 'catch' },
    ),
    row(
      'conditions-join-in-file-order',
      3,
      'The conditions of one target become its situation in file order, whatever order the labeller names them',
      'Three paragraphs: two units labelled `when` (a condition) that point at the third, labelled `rule`.',
      'One instruction atom; its situation is the text of the first condition, a space, the text of the second; no atom for a condition.',
      'atoms:conditions-in-file-order',
      { ...cap, component: 'atoms', role: 'catch' },
    ),
  ],
  labels: [
    row(
      'settings-threshold-range-refused',
      2,
      'A threshold of the settings file outside 0 to 1 is refused and named; 0 and 1 are accepted',
      'The settings text `threshold: { <key>: <n> }` for each of the four keys, with n in 1.5, 2, -0.1 and 100, then 0, 0.4 and 1.',
      'Each value outside 0 to 1 gives a refusal that names the key; each value inside gives no refusal and is returned as written.',
      'settings:threshold-between-zero-and-one',
      { ...cap, component: 'settings', needs: ['settings'], seedFree: true, role: 'catch' },
    ),
  ],
};
