/**
 * Planted defects for the tests of the comment privacy items (test/pointer/cr2-comment-privacy.test.ts). Each
 * models, on the reference, a reader that does not follow the rule that no comment text reaches a request.
 * Empty in every other run: the reference follows the rule.
 */
export type BugPrivacy =
  /** The reader as it was before the rule: a comment is sent as it is written, an opaque one by its first line. */
  | 'comment-text-sent'
  /** A reader that drops the whole unit that holds a comment, and sends only the marker in its place. */
  | 'comment-unit-dropped'
  /** A reader that lists a link candidate as the atom gives it: its title and its id hold the comment text. */
  | 'candidate-comment-sent'
  /** A reader that lists no link candidate at all: nothing leaks, and nothing is offered to the labeler. */
  | 'candidates-all-withheld';

export const referenceBugsPrivacy = new Set<BugPrivacy>();
