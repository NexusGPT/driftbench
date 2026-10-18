import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';

// Fictional family owned by the two review items. No committed example or product
// review helper supplies its signature or expected state.
const FAMILY = `version: 1
id: validator-review-family
title: Copy fictional item names
description: A small fictional family for the review contract.
target: { adapter: process, agent: fictional-copier }
spec: { channel: chat, lang: EN }
oracle: oracle.mjs
review: review.yaml
knobs:
  wording: { class: style, values: [plain] }
wording_knob: wording
tables:
  items:
    rows: 1
    columns:
      - { name: name, gen: { choice: [FictionalWidget] } }
files:
  - path: items.csv
    csv: { table: items, columns: [name] }
corners:
  per_instance: 0
  kinds:
    - { id: duplicate, duplicate_row: { table: items } }
phrases:
  - { id: copy, approved: true, text: Copy items.csv to copied.csv. }
blocks:
  - id: copy
    parts:
      - phrases: [copy]
checks:
  csv: [header, rows]
`;

const ORACLE = `export function expected({ files }) {
  const rows = files['items.csv'].trim().split(/\\r?\\n/).slice(1).map((name) => [name]);
  return { slots: {}, blocks: { copy: {
    files: [{ path: 'copied.csv', kind: 'csv', header: ['name'], rows }],
    workspace: { created: ['copied.csv'], changed: [], deleted: [] }
  } } };
}
`;

/** A pending review with matching hashes; sign changes only its fictional signature. */
export function reviewFamily(dir: string): { path: string; sign(): void } {
  const path = join(dir, 'review-family');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'family.yaml'), FAMILY);
  writeFileSync(join(path, 'oracle.mjs'), ORACLE);
  const review = {
    family: 'validator-review-family',
    family_sha256: createHash('sha256').update(FAMILY).digest('hex'),
    oracle_sha256: createHash('sha256').update(ORACLE).digest('hex'),
    questions: ['Does this fictional family copy the item names without changing them?'],
    signed_by: null as string | null,
    signed_on: null as string | null,
  };
  const write = () => writeFileSync(join(path, 'review.yaml'), stringify(review));
  write();
  return {
    path,
    sign() {
      review.signed_by = 'Fictional Reviewer';
      review.signed_on = '2026-01-01';
      write();
    },
  };
}
