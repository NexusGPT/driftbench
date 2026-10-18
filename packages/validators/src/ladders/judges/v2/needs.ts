/**
 * Quarantine (validators/judges/NEEDS.md): every family of the bank cites the docs page, design section or
 * command that needs it. A family nothing needs, and inside a needed family an item that asks for a new export
 * nothing needs, stays as code but leaves the bank: it counts toward no score, forecast or cause. An entry
 * returns to the bank when a page states its need, in the same commit that removes it from these lists.
 */

/** Families no page, design section or command needs. */
// Round 3: docs/concepts/judges.md, "Planned", states the needs of rubric, budget, evidence, turns and pairwise.
export const QUARANTINED_FAMILIES: readonly string[] = [];

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
  'calibration/metric-ppv',
  'calibration/metric-npv',
  'calibration/metric-f1',
  'calibration/metric-mcc',
  'calibration/metric-youden',
  'calibration/metric-scottPi',
  'calibration/metric-prevalenceIndex',
  'calibration/metric-biasIndex',
  'calibration/metric-accuracy',
  'calibration/fleiss-kappa-across-judges',
  'calibration/labels-for-an-unknown-criterion',
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
  // Helpers of the families round 3 brought back that no Planned line names.
  'budget/cost-of-usage',
  'budget/total-cost',
  'budget/guard',
  'budget/estimate-tokens',
  'budget/retry-delays',
  'budget/retry-after',
  'evidence/quote-span',
  'evidence/loose-quote',
  'evidence/highlight',
  'evidence/levenshtein',
  'evidence/jaccard',
  'turns/pairs',
  'turns/last-agent',
  'turns/first-match',
  'turns/recovery-rate',
  'pairwise/elo-win',
  'pairwise/elo-draw',
  'pairwise/elo-k-factor',
  'pairwise/win-rate',
  'pairwise/win-matrix',
  'pairwise/copeland',
  'pairwise/borda',
  // Behaviours of documented functions that no page states (NEEDS.md, "Items beyond the pages", round 2).
  'contract/score-contradicts-outcome',
  'contract/score-contradicts-near-the-middle',
  'contract/two-disagreeing-answers',
  'contract/key-given-twice',
  'clients/openai-tool-call-arguments',
  'clients/anthropic-tool-use-input',
  'clients/google-function-call-args',
  'clients/openai-legacy-text',
  'clients/decisions-percentage',
  'clients/decisions-answers-by-name',
  'clients/jev-probability-in-quotes',
  'clients/event-stream-body',
  'cassette/saved-entries-sorted',
  'criteria/rubric-too-long-reported',
  'criteria/fixtures-differ-only-in-spacing',
  'criteria/fixtures-differ-only-in-case',
  'criteria/same-pictures',
  'criteria/pictures-same-but-spacing',
  'check/council-that-throws-is-inconclusive',
];

const ITEMS = new Set(QUARANTINED_ITEMS);

/** Whether an item is out of the bank. */
export function isQuarantined(entry: { id: string; family: string }): boolean {
  return QUARANTINED_FAMILIES.includes(entry.family) || ITEMS.has(entry.id);
}
