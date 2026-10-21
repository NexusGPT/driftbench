import type { DocumentRole } from '../schema';

/**
 * The label set the scan asks once per prose file, on the first window of the file: what the document is as a
 * whole. Its answer is a recorded label, so a document's role is never read from a word of its name or its
 * headings. A role declared in driftbench.estate.yaml (`documents:`) wins over it; structure decides when neither
 * gives one. Labels build no atom.
 */
export const DOCUMENT_ROLES_SET_NAME = 'document-roles';

/** Each label and the role it gives. */
export const DOCUMENT_ROLE_LABELS: Readonly<Record<string, DocumentRole>> = {
  'document-normative': 'normative',
  'document-example': 'example',
  'document-template': 'template',
  'document-history': 'history',
  'document-changelog': 'changelog',
  'document-journal': 'journal',
  'document-archive': 'archive',
  'document-fixture': 'fixture',
};

export const DOCUMENT_ROLES_SET = `labels:
  - set: ${DOCUMENT_ROLES_SET_NAME}
    description: What a file of an agent's instructions is as a whole, read from its first lines. Label only the first unit of the file, with the one label that fits the whole document.
    labels:
      - name: document-normative
        description: The first unit of a live document, whose instructions the agent follows as written.
      - name: document-example
        description: The first unit of a document that only shows a case to learn from, and whose instructions are not to be followed as written.
      - name: document-template
        description: The first unit of a document that is a form to fill in, with places for values, not instructions to follow.
      - name: document-history
        description: The first unit of a document that records what happened or was decided before, entry by entry.
      - name: document-changelog
        description: The first unit of a document that lists the changes of a product or a file, release by release.
      - name: document-journal
        description: The first unit of a document that is a running log of work sessions, day by day.
      - name: document-archive
        description: The first unit of a document kept only for the record, no longer in force.
      - name: document-fixture
        description: The first unit of a document that is test data for a check, not instructions.
`;
