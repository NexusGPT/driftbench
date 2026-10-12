/**
 * Causes of the items in families/more.ts, one per item id (docs/validators.md section 12.4, point 4). Kept as
 * plain data so causes.ts can read it without importing the items. Each text is the one change in
 * packages/judges that makes its item pass.
 */

const S = 'packages/judges';
const M = `${S} (export it from src/index.ts)`;

export const MORE_CAUSES: Readonly<Record<string, string>> = {
  // calibration: judge agreement and quality metrics
  'calibration/cohen-kappa': `Add cohenKappa(a, b) to ${M}: Cohen's kappa of two equal-length label lists, (po - pe) / (1 - pe) over the labels either list uses; 1 when pe is 1.`,
  'calibration/cohen-kappa-length-mismatch': `In cohenKappa: throw a RangeError when the two lists differ in length or are empty.`,
  'calibration/fleiss-kappa': `Add fleissKappa(table) to ${M}: Fleiss' kappa of a table with one row per item and one column per category, each cell the number of raters who chose it.`,
  'calibration/confusion-fail-positive': `Add confusionMatrix(predicted, gold) to ${M}: { tp, fp, tn, fn } with fail as the positive class; items where either side is inconclusive are left out.`,
  'calibration/precision-recall-f1': `Add precisionRecall(predicted, gold) to ${M}: { precision, recall, f1 } of the fail class; a ratio with a zero denominator is 0.`,
  'calibration/matthews': `Add matthews(predicted, gold) to ${M}: the Matthews correlation of the fail class; 0 when a margin is empty.`,
  'calibration/balanced-accuracy': `Add balancedAccuracy(predicted, gold) to ${M}: the mean of the recall on fail and the recall on pass.`,
  'calibration/brier': `Add brierScore(probabilities, labels) to ${M}: the mean squared gap between each pass probability and its label (true = 1).`,
  'calibration/ece': `Add expectedCalibrationError(probabilities, labels, bins = 10) to ${M}: bin i holds probabilities in (i/bins, (i+1)/bins], the first bin also 0; the sum over bins of share times |accuracy - mean probability|.`,
  'calibration/log-loss': `Add logLoss(probabilities, labels) to ${M}: the mean negative log likelihood, each probability clipped to [1e-15, 1 - 1e-15].`,
  'calibration/wilson': `Add wilsonInterval(k, n, z = 1.96) to ${M}: the Wilson score interval [low, high] of k successes in n.`,
  'calibration/wilson-empty': `In wilsonInterval: return [0, 1] when n is 0.`,
  'calibration/spearman-ties': `Add spearman(x, y) to ${M}: the Pearson correlation of the ranks, tied values taking their average rank.`,
  'calibration/kendall-tau-b': `Add kendallTau(x, y) to ${M}: Kendall's tau-b, corrected for ties on either side.`,
  'calibration/roc-auc': `Add rocAuc(scores, labels) to ${M}: the share of (positive, negative) pairs where the positive scores higher, ties counting one half.`,
  'calibration/mcnemar': `Add mcnemar(aCorrect, bCorrect) to ${M}: { b01, b10, chi2 } with the continuity correction (|b01 - b10| - 1)^2 / (b01 + b10); chi2 is 0 when b01 + b10 is 0.`,
  'calibration/agreement-with-gold': `Add agreementWithGold(verdicts, gold) to ${M}: { agreement, coverage }, agreement over the items where the verdict is not inconclusive, coverage the share of those items.`,
  'calibration/threshold-sweep': `Add thresholdSweep(scores, labels) to ${M}: the threshold t among the scores that maximises the accuracy of score >= t as pass, the lowest such t on a tie, as { threshold, accuracy }.`,
  'calibration/position-bias': `Add positionBias(pairs) to ${M}: the share of pairs whose winner changes when the two answers swap places (first: a, swapped: a means the position won).`,
  'calibration/majority-label': `Add majorityLabel(labels) to ${M}: the most frequent label; inconclusive on a tie or an empty list.`,
  'calibration/stability-rate': `Add stabilityRate(outcomes) to ${M}: the share of repeated outcomes equal to the most frequent one.`,
  'calibration/flaky-criteria': `Add flakyCriteria(runs) to ${M}: the names, sorted, whose repeated outcomes are not all the same.`,
  'calibration/pass-rate': `Add passRate(verdicts) to ${M}: passes over passes and fails, inconclusive left out; undefined when none is left.`,
  'calibration/outcome-counts': `Add outcomeCounts(verdicts) to ${M}: { pass, fail, inconclusive } counts.`,
  'calibration/percentile-nearest-rank': `Add percentile(values, p) to ${M}: the nearest-rank percentile, the value at rank ceil(p / 100 * n), at least rank 1.`,
  'calibration/latency-summary': `Add latencySummary(ms) to ${M}: { p50, p95, max } by nearest rank.`,
  'calibration/histogram': `Add scoreHistogram(scores, bins) to ${M}: counts of scores in [i/bins, (i+1)/bins), the last bin closed at 1.`,
  'calibration/verbosity-bias': `Add verbosityBias(lengths, scores) to ${M}: the Spearman correlation between answer length and score.`,
  // contract: more answer formats
  'contract/xml-answer': `Add parseAnswerXml(text) to ${M}: read <outcome> and <reasoning> elements into { outcome, reasoning }; inconclusive when outcome is missing or not pass, fail or inconclusive.`,
  'contract/yaml-answer': `Add parseAnswerYaml(text) to ${M}: read outcome: and reasoning: lines into { outcome, reasoning }; inconclusive when outcome is missing or unknown.`,
  'contract/clamp-reasoning': `Add clampReasoning(answer, max) to ${M}: the same answer with reasoning cut to max characters, the last one an ellipsis (…) when it was cut.`,
  'contract/answer-json-schema': `Export ANSWER_SCHEMA from ${S}: a JSON schema object with type object, required [outcome, reasoning], outcome an enum of pass, fail, inconclusive, score a number from 0 to 1.`,
  // render: what the judge reads
  'render/redact-secrets': `Add redactSecrets(text) to ${M}: replace sk- keys (sk- then 20 or more letters, digits, - or _) and AWS key ids (AKIA then 16 capitals or digits) with [secret].`,
  'render/redact-pii': `Add redactPii(text) to ${M}: replace email addresses with [email] and phone numbers (a + then 8 or more digits, spaces allowed between) with [phone].`,
  'render/truncate-middle': `Add truncateMiddle(text, max) to ${M}: text unchanged when it fits; else its head, " […] " and its tail, the whole at most max characters, head and tail differing in length by at most one.`,
  'render/dedupe-transcript': `Add dedupeTranscript(transcript) to ${M}: drop an entry equal in role and text to the entry just before it.`,
  'render/normalise-transcript': `Add normaliseTranscript(transcript) to ${M}: each entry's text with runs of white space collapsed to one space and trimmed.`,
  'render/format-tool-call': `Add formatToolCall(name, args) to ${M}: name(key=value, ...) with keys sorted and each value written as JSON.`,
  'render/transcript-stats': `Add transcriptStats(transcript) to ${M}: { entries, userTurns, characters } where characters sums the text lengths.`,
  'render/sentences': `Add splitSentences(text) to ${M}: split after . ! ? or ; followed by white space, and at line breaks; drop empty pieces, trim each.`,
  // cassette
  'cassette/stats': `Add cassetteStats(cassette) to ${M}: { entries, judges } where judges counts entries per judge id.`,
  'cassette/unused-entries': `Add unusedEntries(cassette, keys) to ${M}: the entries whose key is not in keys.`,
  'cassette/diff': `Add diffCassettes(a, b) to ${M}: { added, removed, changed }, keys sorted: in b only, in a only, in both with different answers.`,
  'cassette/jsonl-round-trip': `Add cassetteToJsonl(cassette) and cassetteFromJsonl(text) to ${M}: one JSON entry per line, the judges list rebuilt from the entries; reading the written text gives the same entries.`,
  // criteria
  'criteria/name-problem': `Add criterionNameProblem(name) to ${M}: a message when the name is not snake_case (lower-case letters, digits and single underscores, starting with a letter), else undefined.`,
  'criteria/duplicate-names': `Add duplicateCriteria(criteria) to ${M}: the names used more than once, sorted, each once.`,
  'criteria/hash': `Add criterionHash(criterion) to ${M}: the sha256 hex of the name, a line break and the rubric.`,
  'criteria/word-count': `Add rubricWordCount(rubric) to ${M}: the number of white-space separated words.`,
  'criteria/coverage': `Add uncoveredCriteria(criteria, verdicts) to ${M}: the names, in criteria order, that no verdict names.`,
  // budget
  'budget/cost-of-usage': `Add costOf(usage, price) to ${M}: usage { input, output } tokens, price { input, output } in USD per million tokens; the cost in USD.`,
  'budget/total-cost': `Add totalCost(costs) to ${M}: the sum rounded to 6 decimals.`,
  'budget/guard': `Add budgetGuard(cap) to ${M}: { spend(usd), spent } where spend throws a RangeError once the total would go over cap and leaves spent unchanged.`,
  'budget/estimate-tokens': `Add estimateTokens(text) to ${M}: ceil(characters / 4), 0 for the empty text.`,
  'budget/retry-delays': `Add retryDelays(n, base, cap) to ${M}: n delays base * 2^i, each at most cap.`,
  'budget/retry-after': `Add retryAfterMs(header, now) to ${M}: milliseconds from a Retry-After header in seconds or as an HTTP date (from now, at least 0); undefined when it is neither.`,
  // council
  'council/unanimity': `Add unanimity(votes) to ${M}: the shared outcome when every vote is the same pass or fail, else inconclusive.`,
  'council/supermajority': `Add supermajority(votes, share) to ${M}: the outcome held by more than share of all votes, else inconclusive.`,
  'council/dissent': `Add dissent(votes, outcome) to ${M}: the judge ids whose vote is not outcome, sorted.`,
  'council/median-score': `Add medianScore(votes) to ${M}: the median of the votes' scores, undefined when none has a score.`,
  'council/trimmed-mean': `Add trimmedMeanScore(votes, trim) to ${M}: the mean of the scores after dropping floor(trim * n) from each end of the sorted list.`,
  'council/cost': `Add councilCost(votes, costs) to ${M}: the sum of costs[judge] over the votes, a judge with no cost counting 0.`,
  // pairwise
  'pairwise/win-rate': `Add winRate(results, id) to ${M}: the share of id's comparisons it won, a tie counting one half.`,
  'pairwise/win-matrix': `Add winMatrix(results) to ${M}: matrix[a][b] = wins of a over b.`,
  'pairwise/copeland': `Add copelandRanking(results) to ${M}: ids sorted by pairwise wins minus losses over opponents (each opponent counted once), then by id.`,
  'pairwise/borda': `Add bordaRanking(rankings) to ${M}: ids sorted by Borda points (n - 1 for first, down to 0), then by id.`,
  'pairwise/swap-consistent': `Add swapConsistent(first, swapped) to ${M}: true when the winner of the swapped comparison, mapped back, is the same (a tie matches a tie).`,
  // turns
  'turns/pairs': `Add turnPairs(transcript) to ${M}: [{ user, agent }] for each user entry and the agent entries after it up to the next user entry, their texts joined by a space.`,
  'turns/last-agent': `Add lastAgentTurn(transcript) to ${M}: the index of the last agent entry, -1 when there is none.`,
  'turns/first-match': `Add firstTurnMatching(transcript, pattern) to ${M}: the index of the first entry whose text matches the RegExp, -1 when none.`,
  'turns/recovery-rate': `Add recoveryRate(outcomes) to ${M}: of the turns after the first fail, the share that pass; undefined when there is no fail or no later turn.`,
  // evidence
  'evidence/quote-span': `Add quoteSpan(text, quote) to ${M}: { start, end } of the first exact occurrence, undefined when absent.`,
  'evidence/loose-quote': `Add findQuoteLoosely(text, quote) to ${M}: true when the quote is found after both sides are lower-cased and their white space runs collapsed.`,
  'evidence/highlight': `Add highlightEvidence(text, quote) to ${M}: the text with every occurrence of the quote wrapped in « and ».`,
  'evidence/levenshtein': `Add levenshtein(a, b) to ${M}: the edit distance with insertions, deletions and substitutions of cost 1.`,
  'evidence/jaccard': `Add jaccardWords(a, b) to ${M}: the Jaccard index of the two texts' sets of white-space separated words.`,
  // clients
  'clients/mask-headers': `Add maskHeaders(headers) to ${M}: a copy where authorization, x-api-key and x-goog-api-key values (any case) keep their last 4 characters behind ****.`,
  'clients/usage-from-openai': `Add usageFromResponse(provider, body) to ${M}: { input, output } tokens from an openai body (usage.prompt_tokens, usage.completion_tokens).`,
  'clients/usage-from-anthropic': `In usageFromResponse: read an anthropic body (usage.input_tokens, usage.output_tokens).`,
  'clients/usage-from-google': `In usageFromResponse: read a google body (usageMetadata.promptTokenCount, usageMetadata.candidatesTokenCount).`,
  // scale
  'scale/chunk-transcript': `Add chunkTranscript(transcript, maxChars) to ${M}: consecutive chunks of whole entries, each chunk's text lengths summing to at most maxChars; an entry longer than maxChars sits alone in its chunk.`,
};
