/**
 * Planted defects for the tests of the comment privacy items (test/pointer/cr2-comment-privacy.test.ts). Each
 * models, on the reference, a reader that does not follow the rule that no comment text reaches a request.
 * Empty in every other run: the reference follows the rule.
 */
export type BugPrivacy =
  /** The reader as it was before the rule: a comment is sent as it is written, an opaque one by its first line. */
  | 'comment-text-sent'
  /** A reader that drops the whole unit that holds a comment, and sends only the marker in its place. */
  | 'comment-unit-dropped';

export const referenceBugsPrivacy = new Set<BugPrivacy>();
