/**
 * Quarantine (validators/judges/NEEDS.md): every family of the bank cites the docs page, design section or
 * command that needs it. A family nothing needs, and inside a needed family an item that asks for a new export
 * nothing needs, stays as code but leaves the bank: it counts toward no score, forecast or cause. An entry
 * returns to the bank when a page states its need, in the same commit that removes it from these lists.
 */

/** Families no page, design section or command needs. */
export const QUARANTINED_FAMILIES: readonly string[] = ['rubric', 'budget', 'evidence', 'turns', 'pairwise'];

/** Items of needed families that ask for an export no page, design section or command needs. */
export const QUARANTINED_ITEMS: readonly string[] = [
  // contract: the answer is strict JSON (docs/concepts/judges.md, "The request and the answer").
  'contract/xml-answer',
  'contract/yaml-answer',
  'contract/clamp-reasoning',
  'contract/answer-json-schema',
  // cassette: record, replay and refuse; no page asks to merge, prune, count, diff or convert a cassette.
  'cassette/merge-joins-two-cassettes',
  'cassette/merge-refuses-a-conflict',
  'cassette/prune-keeps-listed-keys',
  'cassette/stats',
  'cassette/unused-entries',
  'cassette/diff',
  'cassette/jsonl-round-trip',
  // clients: no page reads token usage or masks request headers.
  'clients/mask-headers',
  'clients/usage-from-openai',
  'clients/usage-from-anthropic',
  'clients/usage-from-google',
  // criteria: `judge check` lists its reports; none of these is one of them.
  'criteria/name-problem',
  'criteria/duplicate-names',
  'criteria/hash',
  'criteria/word-count',
  'criteria/coverage',
  // council: the verdict is a majority; no page asks for these summaries.
  'council/unanimity',
  'council/supermajority',
  'council/dissent',
  'council/median-score',
  'council/trimmed-mean',
  'council/cost',
  // calibration: the page reports kappa, the agreement interval and alpha; nothing else.
  'calibration/pabak-prevalence-0.5',
  'calibration/pabak-prevalence-0.9',
  'calibration/pabak-prevalence-0.95',
  'calibration/pabak-prevalence-0.98',
  'calibration/pabak-prevalence-0.995',
  'calibration/ac1-prevalence-0.5',
  'calibration/ac1-prevalence-0.9',
  'calibration/ac1-prevalence-0.95',
  'calibration/ac1-prevalence-0.98',
  'calibration/ac1-prevalence-0.995',
  'calibration/metric-confusion',
  'calibration/metric-sensitivity',
  'calibration/metric-specificity',
  'calibration/metric-balancedAccuracy',
  'calibration/metric-ppv',
  'calibration/metric-npv',
  'calibration/metric-f1',
  'calibration/metric-mcc',
  'calibration/metric-youden',
  'calibration/metric-scottPi',
  'calibration/metric-prevalenceIndex',
  'calibration/metric-biasIndex',
  'calibration/metric-accuracy',
  'calibration/metric-falsePositiveRate',
  'calibration/metric-falseNegativeRate',
  'calibration/fleiss-kappa-across-judges',
  'calibration/labels-conflicting-duplicates',
  'calibration/labels-fixture-leak',
  'calibration/labels-for-an-unknown-criterion',
  'calibration/labels-few-in-a-class',
  'calibration/cohen-kappa',
  'calibration/cohen-kappa-length-mismatch',
  'calibration/fleiss-kappa',
  'calibration/confusion-fail-positive',
  'calibration/precision-recall-f1',
  'calibration/matthews',
  'calibration/balanced-accuracy',
  'calibration/brier',
  'calibration/ece',
  'calibration/log-loss',
  'calibration/wilson',
  'calibration/wilson-empty',
  'calibration/spearman-ties',
  'calibration/kendall-tau-b',
  'calibration/roc-auc',
  'calibration/mcnemar',
  'calibration/agreement-with-gold',
  'calibration/threshold-sweep',
  'calibration/position-bias',
  'calibration/majority-label',
  'calibration/stability-rate',
  'calibration/flaky-criteria',
  'calibration/pass-rate',
  'calibration/outcome-counts',
  'calibration/percentile-nearest-rank',
  'calibration/latency-summary',
  'calibration/histogram',
  'calibration/verbosity-bias',
  // render: the prompt kit renders and escapes; no page asks for these text helpers.
  'render/redact-secrets',
  'render/redact-pii',
  'render/truncate-middle',
  'render/dedupe-transcript',
  'render/normalise-transcript',
  'render/format-tool-call',
  'render/transcript-stats',
  'render/sentences',
  // scale: chunking is not a judges operation any page names.
  'scale/chunk-transcript',
];

const ITEMS = new Set(QUARANTINED_ITEMS);

/** Whether an item is out of the bank. */
export function isQuarantined(entry: { id: string; family: string }): boolean {
  return QUARANTINED_FAMILIES.includes(entry.family) || ITEMS.has(entry.id);
}
