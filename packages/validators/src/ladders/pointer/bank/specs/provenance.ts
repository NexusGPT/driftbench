/**
 * Who wrote each item of the bank and whether it changed afterwards. The first 402 items were written blind, from
 * the design page alone (commit cf184f594). Later commits by the maintainer changed the inputs, expected values
 * or pass conditions of some of them ("maintainer-repaired") and added others ("maintainer-added"). Every other
 * item is "blind". A reader of the report must not take a repaired or added item as blind.
 */
export type Provenance = 'blind' | 'maintainer-repaired' | 'maintainer-added';

export const PROVENANCE_LABELS: readonly Provenance[] = ['blind', 'maintainer-repaired', 'maintainer-added'];

const REPAIRED: ReadonlySet<string> = new Set([
  'adversarial.binary-and-invalid-utf8',
  'adversarial.bold-decoy',
  'adversarial.bom-in-middle',
  'adversarial.deep-nested-quotes',
  'adversarial.identical-files-100',
  'adversarial.label-named-like-prototype',
  'adversarial.many-empty-headings',
  'adversarial.yaml-custom-tags',
  'cutting.cut-pure',
  'cutting.digest-cosmetic',
  'cutting.digest-reorder',
  'cutting.digest-same-text',
  'cutting.empty-and-blank-files',
  'cutting.html-nested-depth',
  'cutting.sentences-lowercase-start-merges',
  'grouping.atom-evidence-prose-pointer',
  'grouping.atom-flags',
  'grouping.atom-no-labeler-text',
  'grouping.atom-order-deterministic',
  'ids.fp-whitespace',
  'ids.id-env-independent',
  'ids.id-twin-boilerplate',
  'ids.ledger-sorted-keys',
  'ids.ledger-status-live',
  'labels.anchoring-independent-of-labeler',
  'labels.carry-forward-unchanged-no-calls',
  'labels.jev-threshold-is-a-replay-setting',
  'labels.label-flip-not-deleted',
  'labels.none-labeller',
  'labels.prompt-examples-max-three',
  'labels.prompt-generic-template',
  'labels.set-hash-ignores-yaml-formatting',
  'labels.set-validation-errors',
  'privacy.crash-leaves-no-secret',
  'privacy.env-secret-not-printed',
  'privacy.error-messages-quote-no-unit-text',
  'privacy.estate-files-unchanged',
  'privacy.fingerprints-are-hashes',
  'privacy.model-key-never-in-outputs',
  'privacy.replay-makes-no-network',
  'privacy.temp-files-removed',
  're-anchoring.reword-sweep-monotone',
  'replay.answers-frozen-despite-random-transport',
  'replay.carry-forward-needs-only-dirty-entries',
  'replay.cut-digest-mismatch-names-versions',
  'replay.failed-recording-keeps-valid-cassette',
  'replay.fixture-haiku-replays-committed',
  'replay.fixture-jev-replays-committed',
  'replay.fixture-jev-unit-replays-committed',
  'replay.fixture-replay-twice-identical',
  'replay.fresh-replay-needs-all-entries',
  'replay.key-ignores-clone-path',
  'replay.key-ignores-threshold',
  'replay.key-ignores-yaml-formatting',
  'replay.miss-fails-without-network',
  'replay.miss-names-changed-unit',
  'replay.miss-names-cut-digest',
  'replay.miss-names-labeler',
  'replay.miss-names-nearest-entry',
  'replay.miss-names-renamed-label',
  'replay.miss-names-set-name',
  'replay.model-mismatch-warns',
  'replay.one-cassette-per-arm',
  'replay.record-is-explicit',
  'replay.record-then-replay-identical',
  'replay.replay-env-independent',
  'replay.replay-twice-identical',
  'scale.growth-cut',
  'scale.growth-rescan',
  'scale.replay-100x',
]);

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
]);

export function provenanceOf(id: string): Provenance {
  if (ADDED.has(id)) return 'maintainer-added';
  if (REPAIRED.has(id)) return 'maintainer-repaired';
  return 'blind';
}
