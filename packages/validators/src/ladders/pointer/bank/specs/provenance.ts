/**
 * Who wrote each item of the bank. The first 402 items began as a blind bank (commit cf184f594), but the maintainer
 * changed the harness, the runners and the oracles afterwards, and every one of them now runs through changed code.
 * This bank therefore claims no blind item: all 402 are "maintainer-repaired", and the 17 stack and label-set
 * validation items, the 18 capability items of 2026-10-23 (cutting and re-anchoring) and the Golden Rules family,
 * added later, are "maintainer-added". The blind measure is the separate 340-item bank of PR 759
 * (the levels `blind-1` to `blind-5`), which keeps its own label. The type keeps `blind` for that bank's entries.
 */
export type Provenance = 'blind' | 'maintainer-repaired' | 'maintainer-added';

export const PROVENANCE_LABELS: readonly Provenance[] = ['blind', 'maintainer-repaired', 'maintainer-added'];

const ADDED: ReadonlySet<string> = new Set([
  'labels.stack-margin-exact',
  'labels.stack-margin-invalid',
  'labels.stack-margin-boundary',
  'labels.stack-zero-cut',
  'labels.stack-monotone-routing',
  'labels.stack-unanimity',
  'labels.stack-unsure-disagreement',
  'labels.stack-missing-vote',
  'labels.stack-malformed-vote',
  'labels.stack-require-agreement',
  'labels.stack-route-independent',
  'labels.stack-no-empty-label',
  'labels.set-validation-duplicate-set',
  'labels.set-validation-reserved-none',
  'labels.set-validation-duplicate-label',
  'labels.set-validation-label-identifier',
  'labels.set-validation-target-value',
  'cutting.footnote-reference-after-stop',
  'cutting.footnote-definition-path',
  'cutting.footnote-definition-paragraphs',
  'cutting.alert-marker-not-prose',
  'cutting.alert-type-path',
  'cutting.front-matter-toml',
  'cutting.front-matter-json',
  'cutting.sentence-terminal-every-script',
  'cutting.thai-no-dictionary',
  'cutting.directive-marker-not-prose',
  'cutting.directive-name-path',
  'cutting.math-block-opaque',
  're-anchoring.cross-file-move-reword',
  're-anchoring.cross-file-move-split',
  're-anchoring.renamed-file-reword',
  're-anchoring.table-row-moved',
  're-anchoring.table-column-reordered',
  're-anchoring.table-column-inserted',
  're-anchoring.table-cell-text-follows',
  're-anchoring.table-cell-key-follows',
  're-anchoring.table-cell-new-id',
]);

export function provenanceOf(id: string): Provenance {
  if (ADDED.has(id) || id.startsWith('golden.')) return 'maintainer-added';
  return 'maintainer-repaired';
}
