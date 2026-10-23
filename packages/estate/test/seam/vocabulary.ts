// The vocabulary of the seam tests is the common model's own (step 1, `@agent-nexus/driftbench-core`): aspects, link
// kinds and the check outcome. Every expectation of the seam tests is written over these words and over the opaque
// ids a variant generator gives its parts, never over a file name or a path.
import type { Aspect, CheckStatus, LinkKind } from '@agent-nexus/driftbench-core';

export { ASPECTS, LINK_KINDS } from '@agent-nexus/driftbench-core';
export type { Aspect, LinkKind };

/**
 * The link kind each fix states, in one place:
 * - an `@` import of a standing file includes the file it names;
 * - a path a part's text writes (code span, link, table cell, quoted name) references the file;
 * - a script's import of a module includes the module.
 */
export const IMPORT_LINK: LinkKind = 'includes';
export const MENTION_LINK: LinkKind = 'references';
export const SCRIPT_IMPORT_LINK: LinkKind = 'includes';

/** What a check reports when it ran. A check that read nothing is `not-run`, never `pass`. */
export type Status = CheckStatus;
