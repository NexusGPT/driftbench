/**
 * Planted bugs of the round 3 audit (seat 4) in the blast radius, the atom builder, the dense labeler and the scan,
 * modelled on the reference so the tests of test/pointer/cr2-bugs-bugsB.test.ts can show each new item red on the
 * defect it guards. Empty in every other run: the reference follows the design.
 */
export type ReferenceBugB =
  /** The whole-suite reason names the last new unit of an unknown file, not the first. */
  | 'whole-reason-last-wins'
  /** A new unit in a file the old ledger did not hold reruns nothing instead of the whole suite. */
  | 'file-unknown-skipped'
  /** A unit that was already deleted in the old ledger is classed deleted again. */
  | 'old-deleted-reported'
  /** A new unit starts its section search at the heading above its own. */
  | 'section-skips-own-heading'
  /** A new unit whose own heading holds no old unit stops instead of falling back. */
  | 'section-stops-at-empty'
  /** The manifest maps an atom to the unit it was built from only, not to its condition units. */
  | 'condition-units-not-mapped'
  /** The manifest lists its unit changes in ledger order, not by id. */
  | 'manifest-unsorted'
  /** A cut title keeps 90 characters before the ellipsis. */
  | 'title-91'
  /** A condition whose target was labelled but built no atom is not reported. */
  | 'orphan-condition-unreported'
  /** A link to `none` is checked against the atoms of the estate and refused. */
  | 'none-link-refused'
  /** A template with an unfilled placeholder inside a longer text is filled with nothing. */
  | 'partial-template'
  /** A `whenFile` mapping builds whenever the unit has a code span, whether or not it names a file. */
  | 'whenfile-ignores-exists'
  /** The retried request of an answer that could not be read is the first request again, with no note. */
  | 'retry-note-never'
  /** A window whose units all kept their labels is still sent. */
  | 'carried-window-requested'
  /** A link kind lists the atoms of every kind as candidates. */
  | 'candidates-any-kind'
  /** A link kind lists its candidates in the order the atoms were given. */
  | 'candidates-unsorted';

export const referenceBugsB = new Set<ReferenceBugB>();
