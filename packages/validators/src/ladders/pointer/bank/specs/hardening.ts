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

/** The items that start a process of their own for a planted reader: two of them, each with a load of the reader. */
export const HARDENING_PROBE_CAP_MS = 140_000;

const cap = { capMs: HARDENING_CAP_MS } as const;

export const HARDENING_SPECS: Record<string, Spec[]> = {
  adversarial: [
    row(
      'verdict-channel-is-not-the-readers',
      4,
      'A reader that rewrites the verdicts its process sends, or writes a pass to the channel of the parent, gains nothing',
      'The reader under test cuts the control file (the companion positive control: two sentences on one line, a heading and a list item; a reader that cuts nothing, or a file or a line as one unit, earns no credit). Then two planted readers, each broken (it cuts nothing) and each carrying a cheat that runs when it loads: one wraps `process.send` and rewrites every verdict into a pass, one writes a forged pass to the descriptor of the IPC channel. The harness serves each from a process of its own and asks one control cut.',
      'The reader under test cuts the control file. The control on each planted reader fails on the outputs of the reader, or the process of the reader ends. A control that passes means the reader reached the verdict.',
      'harness:reader-runs-apart-from-the-oracle',
      {
        component: 'harness',
        needs: ['cut', 'child'],
        seedFree: true,
        capMs: HARDENING_PROBE_CAP_MS,
        role: 'catch',
      },
    ),
    row(
      'sut-env-not-trusted-in-reader-process',
      4,
      'A reader that sets DRIFTBENCH_POINTER_SUT when it loads changes neither the reader that ran nor the reader of a sandboxed process',
      'The reader under test cuts the control file (the companion positive control: two sentences on one line, a heading and a list item). Then one planted reader that cuts a marker and, when it loads and when it is called, points `DRIFTBENCH_POINTER_SUT` at a second reader that cuts another marker. The harness asks one control cut here and one in a sandboxed process.',
      'The reader under test cuts the control file. Both cuts of the planted reader give its marker. The marker of the second reader means the harness read the variable after the reader changed it.',
      'harness:pin-the-reader-before-it-loads',
      {
        component: 'harness',
        needs: ['cut', 'child'],
        seedFree: true,
        capMs: HARDENING_PROBE_CAP_MS,
        role: 'catch',
      },
    ),
    row(
      'reader-imports-no-bank',
      2,
      'The source of the reader names nothing of the validators',
      'The reader under test cuts the control file (the companion positive control: two sentences on one line, a heading and a list item). Then every source file of `packages/estate/src/pointer`, read for its import, export-from, dynamic import, require and `new URL` specifiers.',
      'The reader under test cuts the control file. No specifier names a `validators` folder or the validators package. A reader that imports the bank, an oracle or the reference reader can read the truth of an item.',
      'harness:reader-imports-no-validators',
      { component: 'harness', needs: ['cut'], seedFree: true, ...cap, role: 'catch' },
    ),
  ],
  replay: [
    row(
      'repeat-run-is-part-of-key',
      2,
      'The run is part of the key',
      'Record three files with the Haiku arm: each window is asked in three independent runs of the same request.',
      'Every window has one entry per run with distinct keys; the transport is called once per entry and no run reuses the answer of another.',
      'cassette:run-in-key',
      { ...cap, component: 'cassette', needs: ['transport', 'cassette'] },
    ),
    row(
      'cassette-ascending-keys',
      2,
      'The entries of a cassette are rendered in ascending key order',
      'Record the same files twice with the order of the files reversed the second time.',
      'In each cassette the keys read in ascending order; the two cassettes are the same bytes.',
      'cassette:render-ascending-keys',
      { ...cap, component: 'cassette', needs: ['transport', 'cassette'] },
    ),
  ],
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
    row(
      'heading-edit-relabels-interior-unit',
      3,
      'A unit whose text and neighbours are the same, under a renamed heading, is labelled again',
      'One file: a heading and four long paragraphs, labelled; the second scan renames the heading only and flips the answer for the second paragraph.',
      'The second paragraph keeps its fingerprint and its id; its context fingerprint differs, and the recorded label is not carried: it takes the new answer.',
      'ledger:ctxfp-covers-heading-path',
      { ...cap, component: 'ledger' },
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
    row(
      'moved-unit-is-advisory',
      3,
      'A unit moved to another file is reported as advisory, and nothing reruns for it',
      'Two files of eight units; one long unit moves from the first file to the second.',
      'The unit is classed moved; it is in the advisory set and not in the rerun set, and no global rerun is introduced.',
      'radius:moved-is-advisory',
      { ...cap, component: 'radius', needs: ['scan', 'rerun'] },
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
    row(
      'condition-ids-in-review-predicate',
      3,
      'The review predicate of an atom lists the ids of the units that are its conditions',
      'Three paragraphs: two units labelled `when` (a condition) that point at the third, labelled `rule`.',
      'The condition ids occur in the atom fields and in the options of its one reviewed prose_pointer entry, and the two lists match one for one: the ledger ids of the two condition units, in file order.',
      'atoms:condition-ids-in-pointer',
      { ...cap, component: 'atoms' },
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
    row(
      'settings-inherited-threshold-key-refused',
      2,
      'A threshold key that every object inherits is not a threshold: it is refused by name',
      'The settings text `threshold: { <key>: 0.5 }` for constructor, toString, hasOwnProperty and valueOf, then `labeler: 0.5`.',
      'Each inherited key gives a refusal that names the key; the real key gives none.',
      'settings:threshold-keys-are-own',
      { ...cap, component: 'settings', needs: ['settings'], seedFree: true, role: 'catch' },
    ),
    row(
      'top-level-heading-window-boundary',
      3,
      'Two top-level sections make two windows, whatever their size',
      'One file: two top-level headings with one sentence below each, far under the unit cap; Haiku arm on a fake transport.',
      'Two windows are asked, one per top-level section; neither holds a unit of the other section.',
      'labeler:window-ends-at-top-level-heading',
      { ...cap, component: 'labeler', needs: ['transport'] },
    ),
    row(
      'read-unit-not-labelable-under-heading',
      3,
      'A unit already read by code is not offered for labelling and holds no label, in a file that has a top-level heading',
      'A skill whose `description` front matter value is read by the structured reader, followed by a top-level heading and four paragraphs.',
      'No window offers that unit as labelable and it holds no label; every paragraph holds the label the labeler gave it.',
      'scan:read-units-marked',
      { ...cap, component: 'scan' },
    ),
  ],
};
