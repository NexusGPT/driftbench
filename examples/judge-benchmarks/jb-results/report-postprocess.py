"""Add post-freeze evidence to the external report, leaving frozen source unchanged."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORT = Path(os.environ['JB_REPORT_PATH'])
load = lambda name: json.loads((ROOT / name).read_text())
text = REPORT.read_text()
text = text.replace(
    '- All tuning and label-audit decisions use dev only. After freezing the configuration, one test run compares it with and without format parsing. No tuning follows that held-out run.',
    '- Configuration and threshold selection use dev only tonight. After the freeze, one test confirmation compares reference3 with and without format parsing. The separate test audit sees questions and proposals, but no labels or tonight\'s decisions before its exclusion list is locked. Post-freeze dev controls do not change the frozen judge.')
text = text.replace('## One frozen held-out test run', '## Frozen test confirmation on a previously evaluated split')
text = text.replace('held-out', 'test-split').replace('heldout', 'test')
text = text.replace('No test-split result informs this choice.',
                    'Tonight\'s threshold ranking uses only the dev curve; prior test scores are known and historical design influence remains unresolved.')
text = text.replace('No two real model calls run together.', 'No two real model calls from this helper run together.')
text = text.replace('- Every pair is judged in both orders using the existing JudgeBench net-vote metric. Official labels and competitor templates stay unchanged.',
                    '- Driftbench variants judge each pair in both orders using the existing JudgeBench net-vote metric. Pointwise peers use one comparison game. Official labels and competitor templates stay unchanged.')
text = text.replace('direct-format-ledger and -format counterparts', 'direct-format-ledger and tools/strategy format counterparts')
text = text.replace('No test retry or source change follows the score.', 'No second test run or frozen-judge change follows the completed run.')
text = text.replace(
    '- Cost per 100 pairs includes every reference, review and judgement that the candidate needs, including replayed calls at their recorded original price. New task spend is counted separately.',
    '- Cost per 100 pairs sums reported prices for successful references, reviews and judgements, including replays at their recorded original price. Unpriced failed or interrupted requests are excluded. New task spend is counted separately.')
text = text.replace('No configuration changes follow the test-split run.',
                    'The frozen test configuration stays unchanged. Preplanned dev-only threshold controls run afterward and do not select a new design.')
text = text.replace('### Stratified control measured before the complete run', '### Stratified dev control, completed after the test confirmation')
text = text.replace(
    'Their in-flight requests have no returned price; the driver reserves 0.20 USD for them and the last-call cap margin.',
    'Their in-flight requests have no returned price. Unpriced test failures are accounted for separately below; reported-price spend is not an exact all-request invoice.')
text = text.replace('The design freezes by 04:30 Brussels.', 'The design froze at 02:16:21 Brussels, before the 04:30 deadline.')
text = text.replace(
    'This screen does not establish the absence of subtle contradictions.',
    'On 262 direct outputs, replaying the correctness ledger changes three calls across three items from a named winner to a tie because both factual correctness fields are true. One is the ambiguous sensory question; the other two distinguish final-answer formatting or derivation quality. These are not confirmed pass/fail mapping inversions. Evidence: direct-ledger-differences.json. This screen does not establish the absence of subtle contradictions.')
text = text.replace('The frozen stratified selection contains 229 of 229 test-split pairs', 'The full fixed test split contains 229 of 229 pairs')
text = text.replace(
    '- Model cache, model runtime folders and diagnostics stay inside this worktree. Initial unit fixtures use the host temporary folder and clean up after verification; subsequent verification sets TMPDIR inside this worktree. The shared spend ledger receives append-only run rows.',
    '- Model jobs and diagnostics use worktree cache and runtime folders. Scope exceptions: initial unit fixtures use host-temp folders and clean them up. One later free baseline replay omits both local overrides and uses the default host dataset cache. Execution records show zero new Python executions during that replay, so no new host-temp program writes are established. Remaining runs restore both worktree overrides. The shared spend ledger receives append-only run rows.')

paired = load('test-paired-comparison.json')
audit = load('test-label-audit.json')
frozen = load('freeze.json')
test = load('final-test.json')
history = load('reference3-history-audit.json')
base = paired['scores']['driftbench-reference3']
formatted = paired['scores']['driftbench-reference3-format']
names = {'deepeval': 'DeepEval', 'promptfoo': 'promptfoo', 'inspect': 'Inspect',
         'langfuse': 'Langfuse', 'scenario': 'LangWatch Scenario',
         'driftbench-adaptive': 'driftbench-adaptive',
         'driftbench-reference3': 'reference3 (tonight)',
         'driftbench-reference3-format': 'reference3 with format (tonight)'}

provenance = [
    '## Prior test exposure and freeze provenance', '',
    '**Tonight is a frozen confirmation on a previously evaluated split, not an unseen holdout.**', '',
    '- Run B comes from the earlier judge-benchmarks harness lane, branch lane/judge-benchmarks, on 12 Oct in the afternoon, before tonight\'s dev-only rule. The individual operator is unknown.',
    '- The shared spend ledger records Run B at 15:20 Brussels on 12 Oct. Reference3 test accuracy is 85.2 percent; adaptive is 86.5 percent. Both figures are available before tonight\'s freeze.',
    '- This helper reads the prior reference3 ledger figure before freezing; the initial job log contains that read at jb.log line 4556. The adaptive figure is also in the supplied brief and census. No unseen-test claim is warranted.',
    f'- The first reachable commit containing the reference3 design is {history["firstDesignCommit"]}, at 16:01:52 Brussels on 12 Oct, after the 15:20 test score.',
    '- A separate ledger entry names reference3 dev tuning at 15:01, before Run B. Git cannot determine the order of uncommitted design edits and scoring between 15:01 and 16:01. Precommit test influence cannot be ruled out.',
    '- Eight base prompt and vote declarations are byte-identical from the first committed design to tonight\'s freeze. No later tracked change to those reference3 declarations is found in this branch history. This does not establish absence of earlier uncommitted changes.',
    f'- Freeze commit: {frozen["sha"]}, 13 Oct at 02:16:21 Brussels. The one-shot confirmation starts at 02:16:22. Source hashes are checked again at handover. Later commits contain results and diagnostics only.',
    '',
    '| Configuration | Earlier test, 12 Oct | Tonight, official | Tonight, audited retained subset | Tonight USD/100 |',
    '|---|---|---|---|---|',
    f'| reference3 | 85.2 percent | {base["correct"]}/229 = {base["percent"]:.1f} percent | {base["auditedCorrect"]}/175 = {base["auditedPercent"]:.1f} percent | {base["cost100"]:.4f} |',
    f'| reference3 with general format parser | not asserted | {formatted["correct"]}/229 = {formatted["percent"]:.1f} percent | {formatted["auditedCorrect"]}/175 = {formatted["auditedPercent"]:.1f} percent | {formatted["cost100"]:.4f} |',
    '| adaptive, census replay | 86.5 percent | 198/229 = 86.5 percent | 162/175 = 92.6 percent | 0.7865 |', '',
    'The format parser adds no correct test pair and costs an additional 0.1045 USD per 100 pairs. All its pair decisions match the base configuration.', '',
    'Format qualification: original reference3 gates the parser on equivalent extracted finals, which does not itself prove factual correctness. The new ledger variants separately require both factual correctness fields to be true. This frozen ablation measures the implemented equivalence gate; it does not establish a general correctness guarantee for formatting overrides.', ''
]

comparison = [
    '## All census peers and exact paired comparisons', '',
    '**Driftbench adaptive ranks first (198/229). Frozen reference3 ranks second (195/229), ahead of all five external default templates.**', '',
    'The table replays the 12 Oct recordings on exactly the same 229 IDs. No new peer model calls are made. Rank uses seven methods; format parsing is a tied reference3 ablation.', '',
    '| Rank | Method | Official percent (correct/229) | Audited percent (correct/175) | USD per 100 pairs |',
    '|---|---|---|---|---|'
]
for key, score in sorted(paired['scores'].items(), key=lambda row: (-row[1]['correct'], row[1]['cost100'])):
    comparison.append(f'| {score["rank"]} | {names[key]} | {score["percent"]:.1f} ({score["correct"]}/229) | {score["auditedPercent"]:.1f} ({score["auditedCorrect"]}/175) | {score["cost100"]:.4f} |')
comparison += ['',
    'Pair correctness uses the unchanged JudgeBench net vote across orders, or the one pointwise comparison game. Each missing answer contributes no vote. All methods lack the same one pair and count it as incorrect.', '',
    '| Census peer | Tonight minus peer, percentage points (229 pairs) | Tonight alone correct | Peer alone correct | Exact two-sided p | Holm p, six comparisons | Difference on 228 shared complete pairs |',
    '|---|---|---|---|---|---|---|']
for row in paired['comparisons']:
    if row['ours'] != 'driftbench-reference3':
        continue
    comparison.append(f'| {names[row["peer"]]} | {row["differencePercentagePoints"]:+.3f} | {row["oursOnlyCorrect"]} | {row["peerOnlyCorrect"]} | {row["exactTwoSidedP"]:.8g} | {row["holmAdjustedP"]:.8g} | {row["sharedComplete"]["differencePercentagePoints"]:+.3f} |')
comparison += ['',
    'This is the exact two-sided McNemar conditional binomial test: p = min(1, 2 sum(C(b+c,i), i=0..min(b,c)) / 2^(b+c)). The artifact retains exact rational probabilities. Shared-complete coverage is 228 for every comparison and gives identical discordance counts and p values. Both format ablations give identical paired results.', '',
    '- At a 0.05 threshold, the gaps against adaptive (p=0.25), promptfoo (p=0.6476) and DeepEval (p=0.2863) do not establish a difference.',
    '- Wins over Inspect, Langfuse and Scenario remain significant after Holm adjustment across the six comparisons. These results concern this recorded split, model and default-template setup.',
    '- The 95 percent target is not reached. The 92.0 percent audited result concerns a restricted factual-final subset and does not replace the official 85.2 percent.',
    '', 'Reproduction: jb-results/test-paired-comparison.py. Full per-ID decisions and exact test results: test-peer-replay.json and test-paired-comparison.json.', '']

coverage = [
    '## Test coverage, audit qualifications and unpriced failures', '',
    '- All 229 test pairs are attempted; 228 have complete judgements. Pair b7bbea2c-8e83-50be-a385-70d16a0d507c lacks both order answers. It is retained in the audit and counts as incorrect in both metrics.',
    f'- The final run records {test["failedCalls"]} failed call events. Its retained diagnostics do not identify the underlying cause or returned price. No test retry or source change follows the score.',
    '- Reported cost includes successful recorded model calls at their original prices, including replays. It excludes unpriced failed requests. The test ablation makes 261 new successful calls for 0.23923810 USD; reference3 itself needs no new successful call.',
    '- A conservative planning allowance uses three attempts times 0.04 USD for each of 15 failed call events, plus 0.20 USD for earlier interruptions and the last-call margin: 2.00 USD. This is a reserve, not a measured invoice or guaranteed failure-price bound. The upper-threshold driver uses a successful-price ceiling of 6.00 USD. The resumed control retains its earlier 7.80 ceiling and is monitored against the additional reserve.',
    f'- The test exclusion list is locked at {audit["stamp"]}, before tonight\'s test score is read. All 229 questions and factual finals are reviewed. The audit excludes 54 and retains 175; no official label is rewritten.',
    '- Audit policy differs from whole-response preference: correct equivalent finals, missing conventions, malformed inputs and valid counterexamples can remove a pair. Format compliance, explanation quality or fewer bugs can still justify its official preference. Exclusion does not mean the official label is necessarily wrong.',
    '- Exact truth constraints cover 30 truth puzzles; exhaustive permutations cover 18 line puzzles. Independent arithmetic and polygon clipping verify the documented math alternatives. All 60 coding proposals are submitted for sandbox execution. One initially stops at a missing import; the supplemental dependency audit below closes that gap. Execution exceptions are preserved; sample passes do not prove full correctness.',
    '- The strict frozen audit script rejects incomplete judgements. The offline diagnostic applies the same scorePairs function to all 229 decisions, preserves missing answers, and reports 161/175. It does not silently drop the failed pair.',
    '', '| Qualified test item retained | Evidence and limit |', '|---|---|']
for row in audit['qualified_retained']:
    coverage.append(f'| {row["id"]} (index {row["index"]}) | {row["reason"]} |')
coverage += ['', '### Supplemental dependency check, after the score', '',
             'The locked initial audit retains item 214 while its SortedList dependency is unavailable. A later diagnostic installs [sortedcontainers 2.4.0](https://pypi.org/project/sortedcontainers/) only inside the worktree runtime and verifies the imported version and path. Both unchanged proposal bodies pass 2,644 independently checked small cases and two valid 100,000-element cases in the native sandbox. The descending-array case takes 1.4564 seconds for A and 0.0917 for B on this host. These single observations do not establish a portable benchmark time limit or complete correctness. The initial audit manifest, exclusion list, 175-pair denominator, official labels and frozen judge remain unchanged. Evidence: test-code-dependency-audit.py and test-code-dependency-audit.json.', '']
coverage += ['', 'Evidence artifacts: test-label-audit.json, final-test-audited.json, test-logic-audit.json, test-puzzle-audit.json, test-arithmetic-audit.json and test-code-audit.json. Reproduce the saved-score audit with node --import tsx examples/judge-benchmarks/jb-results/score-test-audit.mjs; it verifies the pre-score audit hash and never calls a model.', '']

bounds = [
    '## Freeze decision and later dev diagnostics', '',
    'The best measured dev candidate uses confidence threshold 0.50 and format parsing: 112/121 official, 108/111 primary audited, 22/121 escalated, 1.2100 USD/100. Its paired no-format counterpart scores 111/121. The only changed pair is 70bf4c34 (Hume): both factual finals choose C, but only one follows the question\'s explicit five-letter repetition. The generic checker selects that response in both orders. This is an instruction-compliance gain; it gives no gain on the primary factual-final audit. Evidence: best-dev-format-effect.json.', '',
    '- Original reference3 remains frozen at 111/121. The best complete candidate reaches 112/121; the approved replacement floor is 113/121.',
    '- Before freezing, the standalone full-escalation replay already has 12 known errors without format and 11 with format among 50 complete items. This set differs from the later stratified 50-pair control. Even perfect remaining answers cap those designs at 109/121 and 110/121. These are exact error bounds, not sample accuracy estimates.',
    '- The proportional 50-pair control and thresholds 0.85 and 0.90 are diagnostic runs after the frozen test starts. They share the call budget and cannot change the judge, threshold choice or final test result.',
    '', '| Upper dev threshold | Parser | Complete pairs before freeze | Known errors | Maximum correct out of 121 |',
    '|---|---|---|---|---|']
for row in load('upper-threshold-coverage.json'):
    suffix = row['id'].rsplit('-', 1)[1]
    bounds.append(f'| {int(suffix)/100:.2f} | {"with" if "-format" in row["id"] else "without"} | {row["completed"]} | {row["knownErrors"]} | {row["ceiling"]} |')
try:
    upper = load('post-freeze-upper-thresholds.json')
except FileNotFoundError:
    upper = []
if upper:
    bounds += ['', '| Post-freeze threshold | Parser | Official percent (correct/121) | Primary audited percent | Escalated | USD/100 | Coverage |', '|---|---|---|---|---|---|---|']
    for row in upper:
        r = row['report']; c = r['contestants'][0]; s = c['summary']; a = row['audited']
        bounds.append(f'| {row["threshold"]:.2f} | {"with" if "-format" in row["id"] else "without"} | {s["value"]["estimate"]*100:.1f} ({round(s["value"]["estimate"]*s["n"])}/{s["n"]}) | {a["value"]["estimate"]*100:.1f} ({round(a["value"]["estimate"]*a["n"])}/{a["n"]}) | {r["escalated"]}/{s["n"]} | {c["costUsd"]*100/s["n"]:.4f} | missing {s["missing"]}; stopped {r.get("stopped", "no")} |')
bounds += ['', 'The original dev-only reporting threshold remains 0.50, tied with 0.60. The frozen reference3 design has no cascade threshold.', '']
effects = load('best-dev-vs-reference3.json')
bounds += ['', 'The parser recovers the Hume pair that original reference3 already gets right. Against original reference3, the formatted cascade gains the achievement and ambiguous-schizophrenia pairs, but loses the square/triangle pair. The primary audited gains and losses cancel. Thus the net one-item official gain is not evidence of better retained factual accuracy.', '',
           '| Dev item, official pair correctness | Reference3 | Cascade 0.50 without format | Cascade 0.50 with format | Primary audit |',
           '|---|---|---|---|---|']
for row in effects['changed']:
    c = row['correct']
    cell = lambda value: 'correct' if value else 'incorrect or tie'
    bounds.append(f'| {row["id"]} | {cell(c["driftbench-reference3"])} | {cell(c["driftbench-reference3-tools-cascade-50"])} | {cell(c["driftbench-reference3-tools-format-cascade-50"])} | {"excluded" if row["auditExcluded"] else "retained"} |')
bounds += ['', 'These are replayed dev observations, not item-specific judging rules. Evidence: best-dev-vs-reference3.json.', '']
try:
    refreshed = load('control-frozen-runtime.json')
except FileNotFoundError:
    refreshed = []
if refreshed:
    bounds += ['### Control verified with the frozen modules', '',
               'The resumed process loads modules before the last pre-freeze repair/recovery edits. These fresh-module runs verify the control against the frozen source hashes. They reuse recorded calls, generate only missing dev diagnostics, and never run the test split again. The earlier control artifacts remain preserved.', '',
               '| Frozen control on 50 dev pairs | Official percent | Primary audited percent | Escalated share | USD/100 | New calls on refresh | Missing |',
               '|---|---|---|---|---|---|---|']
    for row in refreshed:
        r = row['report']; c = r['contestants'][0]; s = c['summary']; a = row['audited']; escalated = r.get('escalated', 50)
        bounds.append(f'| {row["id"]} | {s["value"]["estimate"]*100:.1f} ({round(s["value"]["estimate"]*s["n"])}/{s["n"]}) | {a["value"]["estimate"]*100:.1f} ({round(a["value"]["estimate"]*a["n"])}/{a["n"]}) | {escalated}/{s["n"]} ({escalated/s["n"]*100:.1f} percent) | {c["costUsd"]*100/s["n"]:.4f} | {r["newCalls"]} | {s["missing"]} |')
    bounds += ['', 'These fresh-module results are the final control comparison. It includes the previously chosen 0.50 threshold on the same 50 dev pairs. Any earlier table is an intermediate resumed-process measurement, not additional selection evidence.', '']
    bounds += ['The 0.50 cascade matches reference3 on this dev sample: 47/50 official and 46/47 audited, with 12/50 pairs escalated. Its 1.1812 USD/100 cost exceeds reference3\'s 0.7522. The default 0.75 cascade improves over full escalation (90.0 versus 88.0 percent) and costs less (1.2684 versus 1.8688), but trails reference3\'s 94.0 percent. Format parsing changes none of these sample accuracies and adds cost. This is descriptive evidence on the same dev population, not an independent validation split.', '']
baselines = load('control-sample-baselines.json')
bounds += ['### Same-sample reference3 baselines', '',
           'These zero-new-call replays use the identical codex-jb-control-v1 sample: 24 MMLU, 21 LiveBench and 5 LiveCodeBench pairs.', '',
           '| Base on 50 dev pairs | Official percent | Audited percent (47 retained) | USD/100 |',
           '|---|---|---|---|']
for row in baselines:
    c = row['report']['contestants'][0]
    bounds.append(f'| {row["id"]} | {c["summary"]["value"]["estimate"]*100:.1f} | {row["audited"]["value"]["estimate"]*100:.1f} | {c["costUsd"]*2:.4f} |')
bounds += ['', 'A baseline or control sampled from dev does not estimate independent test generalization. The full fixed dev curve remains the selection evidence.', '']
pilot = load('direct-strategy-pilot-audited.json')
bounds += ['### Earlier executable-path pilot', '',
           '| Pilot | Official | Primary audited | USD/100 | New successful calls |',
           '|---|---|---|---|---|',
           f'| direct-strategy, 12 stratified dev pairs | 9/12 = 75.0 percent | 9/10 = 90.0 percent | {pilot["cost100"]:.4f} | 74 (plus 4 shared replays) |', '',
           'This small pilot checks the executable route and is not a full-dev score. Its 95 percent official interval is 46.8 to 91.1 percent. Audit reconstruction uses original saved judgements and content-keyed shared calls, without preparing new evidence or calling a model. Evidence: direct-strategy-pilot-audited.json.', '']

text += '\n' + '\n'.join(provenance + comparison + coverage + bounds)
lead = ('Frozen test confirmation: 195/229 = 85.2 percent official, 161/175 = 92.0 percent audited; '
        '0.7646 USD/100 without format and 0.8690 USD/100 with format. '
        'Reference3 ranks second behind adaptive at 86.5 percent. '
        'This is a previously evaluated split, not an unseen holdout; the 95 percent target is unmet.\n\n')
text = text.replace('## Scope and scoring\n', lead + '## Scope and scoring\n', 1)
text = text.replace('\u2014', ', ').replace('\u2013', '-')
REPORT.write_text(text)
print(str(REPORT))
