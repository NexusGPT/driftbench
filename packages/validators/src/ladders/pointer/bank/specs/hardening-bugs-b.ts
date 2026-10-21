import { HARDENING_CAP_MS } from './hardening';
import { type Need, row, type Spec } from './types';

/**
 * Items for the planted bugs of the round 3 audit, seat 4, that lost no item: the bugs of the blast radius
 * (`radius.ts`), the atom builder (`atoms.ts`), the dense labeler (`dense.ts`) and the scan (`scan.ts`). Each
 * oracle is what the reader does on a case the bug changes; test/pointer/cr2-bugs-bugsB.test.ts shows each item red
 * on the reference with that bug, and green on the reference without it.
 */

const cap = { capMs: HARDENING_CAP_MS } as const;
const radiusNeeds = { ...cap, component: 'radius', needs: ['scan', 'rerun'] as Need[] };

export const HARDENING_BUGS_B_SPECS: Record<string, Spec[]> = {
  radius: [
    row(
      'new-file-reruns-whole-suite',
      3,
      'Units in a file the old ledger did not hold rerun the whole suite',
      'A world of two files of long units; the first scan holds the first file, the second scan adds the second file (a heading and four units).',
      'The rerun of the edit sets a whole-suite reason, and the reason names the new file.',
      'radius:new-file-reruns-whole-suite',
      { ...radiusNeeds },
    ),
    row(
      'whole-reason-names-first-new-unit',
      3,
      'The whole-suite reason names the first new unit of the new file',
      'As above: a new file of five units arrives in the second scan.',
      'The whole-suite reason names the id of the first unit of the new file in file order, and the id of no later unit of it.',
      'radius:whole-reason-names-first-new-unit',
      { ...radiusNeeds },
    ),
    row(
      'deleted-before-not-deleted-again',
      3,
      'A unit deleted by an earlier edit is not deleted again by the next one',
      'Three scans of one file of eight units: the second deletes a unit, the third rewords another one by one word.',
      'Between the second and the third ledger, the unit deleted before is in no class and not in the rerun set; the reworded unit is classed changed and is the whole rerun set.',
      'radius:only-live-units-can-be-deleted',
      { ...radiusNeeds },
    ),
    row(
      'new-unit-reruns-its-own-section',
      3,
      'A unit added under an old heading reruns the old units under that heading only',
      'One file of two top-level sections of three long units each; the second scan adds a unit at the end of the first section.',
      'The rerun set is exactly the three old units under the heading of the new unit; no whole-suite reason.',
      'radius:new-unit-reruns-its-own-section-first',
      { ...radiusNeeds },
    ),
    row(
      'new-unit-under-empty-heading-falls-back',
      3,
      'A unit added under a heading that holds no old unit reruns every old unit of its file',
      'One file: a section of two units, then a last heading with nothing under it; a second file of three units. The second scan adds a unit under the last heading.',
      'The rerun set is exactly the four old units of the first file (its two headings and two units), none of the second file; no whole-suite reason.',
      'radius:new-unit-falls-back-past-a-heading-with-no-old-unit',
      { ...radiusNeeds },
    ),
    row(
      'manifest-condition-unit-reruns-its-atom',
      3,
      'An edit of a condition unit reruns the atom the condition belongs to',
      'One file of eight units; two atoms with seeded ids: one built from the second unit with the fifth as its condition, one built from the seventh. The fifth unit is reworded.',
      'The change manifest is exactly one prompt change, of the atom whose condition is the fifth unit.',
      'radius:manifest-maps-condition-units-to-their-atom',
      { ...radiusNeeds },
    ),
    row(
      'manifest-unit-changes-in-id-order',
      3,
      'The unit changes of a change manifest come in id order',
      'One file of twelve units; two units apart in the file whose ids run against the file order are reworded; no atom sits on any unit.',
      'The change manifest is two unit changes, in id order.',
      'radius:manifest-unit-changes-in-id-order',
      { ...radiusNeeds },
    ),
  ],
  grouping: [
    row(
      'title-ninety-characters',
      3,
      'The title of an atom holds at most 90 characters',
      'One file: a long unit (over 90 characters) and a short one (80 or fewer), both labelled rule.',
      'The long unit gives the title of its first 89 characters, trailing white space dropped, and an ellipsis; the short unit gives its own text.',
      'atoms:title-at-most-90-characters',
      { ...cap, component: 'atoms', needs: ['scan'] },
    ),
    row(
      'orphan-condition-refused',
      3,
      'A condition whose target builds no atom is reported',
      'One file: a rule written twice on one line, then a condition unit whose target is the second copy (a repeat, so it builds no atom).',
      'One instruction atom, with no situation; the second copy is reported as a duplicate; a diagnostic other than a duplicate names the condition unit.',
      'atoms:report-condition-on-a-unit-with-no-atom',
      { ...cap, component: 'atoms', needs: ['scan'] },
    ),
    row(
      'none-link-builds-no-refusal',
      3,
      'A link to none names nothing and refuses nothing',
      'A set whose rule label carries links of a kind to instruction atoms; three long units labelled rule, the first with a link to none.',
      'Each unit builds one atom, and no diagnostic names the unit with the link to none.',
      'atoms:link-to-none-names-nothing',
      { ...cap, component: 'atoms', needs: ['scan'] },
    ),
    row(
      'template-placeholder-unfilled-refused',
      3,
      'A template with a placeholder the unit does not fill refuses the atom',
      'A set whose rule mapping sets the situation from a template with the code span of the unit; one unit with a seeded code span, one without.',
      'The unit with a code span builds an atom whose situation is the template filled with it; the unit without builds no atom and a diagnostic names it.',
      'atoms:unfilled-template-refuses-the-atom',
      { ...cap, component: 'atoms', needs: ['scan'] },
    ),
    row(
      'when-file-needs-a-file',
      3,
      'A whenFile mapping builds nothing when the code span names no file of the estate',
      'A set with a whenFile reference mapping; one unit whose code span names a seeded path that is no file of the estate, one rule unit.',
      'No reference atom; no diagnostic names the unit with the code span; the rule unit builds its atom.',
      'atoms:when-file-builds-only-for-an-estate-file',
      { ...cap, component: 'atoms', needs: ['scan'] },
    ),
  ],
  labels: [
    row(
      'haiku-retry-says-why',
      3,
      'The request asked again after an answer that is no JSON adds a note to the system text',
      'Haiku arm on a fake transport; the first answer is a sentence with no JSON, every later one the truth; six units.',
      'Four requests: the retry shows the same messages and a system text that extends the first with a note; the next run sends the first system text.',
      'labeler:retry-says-the-answer-could-not-be-read',
      { ...cap, component: 'labeler', needs: ['transport'] },
    ),
    row(
      'carried-window-not-asked-again',
      3,
      'A rescan does not send a window whose units all kept their labels',
      'One file of two top-level sections of three units; the second scan rewords the last unit of the second section.',
      'The first scan asks two windows; the rescan asks exactly one, and it holds the reworded unit.',
      'scan:send-only-windows-with-a-unit-to-label',
      { ...cap, component: 'scan', needs: ['scan'] },
    ),
    row(
      'link-candidates-of-its-kind',
      3,
      'A link kind lists the atoms of the kind it names, and no other',
      'Haiku arm on a fake transport; a set whose link kind names instruction atoms; the scan is given four instruction atoms and three hazard atoms with seeded ids, mixed.',
      'Every request lists the id of each instruction atom and of no hazard atom.',
      'scan:link-candidates-of-the-kind-named',
      { ...cap, component: 'scan', needs: ['transport'] },
    ),
    row(
      'link-candidates-in-id-order',
      3,
      'The candidates of a link kind come in id order',
      'As above: the instruction atoms are given out of id order.',
      'Every request lists the instruction atom ids in id order.',
      'scan:link-candidates-in-id-order',
      { ...cap, component: 'scan', needs: ['transport'] },
    ),
  ],
};
