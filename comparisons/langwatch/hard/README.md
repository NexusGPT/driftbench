# Hard model comparison

This round covers every model-mediated row on the comparison page. Pairwise was
hardened in the preceding round. The remaining rows are criterion rules, verdict
prompt, simulated user, injection and PII. All sets are fictional and labels are
fixed by construction before calls. No scoring metadata enters a model prompt.

## Full row inventory

The page has sixteen rows. This table records the starting evidence and scope.
Historical scores remain historical, not newly verified native-default results.

| Row | Starting outcome and evidence | Hardening scope |
|---|---|---|
| Per-criterion judge rules | Ahead; 12 fixture pairs, three repeats; bar 11/12 versus 10/12 | 120 cases, two independent criteria each |
| Judge verdict prompt | Ahead; 39/40 versus 37/40 labelled blocks | Same 120 cases; complete criterion-vector accuracy and aggregate verdict |
| Judge decision phase | Limit; fixed blocks have no per-turn decision | No model row is claimed |
| Simulated user prompt | Ahead; unsolicited email 0/24 versus 3/24 | 120 one-step request/withhold cases |
| Script succeed and fail | Equal; deterministic terminal state | Outside model scope |
| Caching | Ahead; key construction inspection, no measured run | Outside model scope |
| Seeding | Ahead; no recorded example | Outside model scope |
| Exact match | Ahead; historical 16/16 versus 15/16; newer set 200 | Deterministic, outside this round |
| ROUGE and BLEU | In progress; historical fixed-pair library agreement; newer set 120 | Deterministic, outside this round |
| Pairwise | Ahead research procedure; hard 120/120 versus 119/120, easy 120/120 versus 120/120 | Hard evidence retained; fresh 60 cases for all three procedures |
| Injection and jailbreak | In progress; easy judge 120/120; native classifiers not measured | 120 attack/benign cases; runnable native Azure adapters |
| PII | Ahead historical name/address comparison; easy 120/120 development and 119/120 check | 120 full-presence cases; actual native Presidio default settings |
| Retrieval metrics | Limit; our blocks carry no retrieved contexts | No existing common model row to harden |
| Annotation anchors | Equal; deterministic span linkage | Outside model scope |
| Annotation queues | Equal; deterministic assignment and scores | Outside model scope |
| Dataset model | Equal; storage design comparison | Outside model scope |

## Judge cases and the two rows

`judges-v4.json` contains 120 cases across twelve families. Primary labels are
48 pass, 48 fail and 24 inconclusive. Each case adds a separate receipt criterion
with sixty pass and sixty fail labels. Its label varies independently of the
primary criterion to test contamination between criteria. Near prices, units,
order of checks, fail-only wording, quoted instructions, tool errors, entity
binding, partly correct answers, mixed languages, old versus final answers,
strict thresholds and conditional promises define the families.

For the per-criterion row, report primary-criterion accuracy out of 120.
For the verdict prompt row, report cases whose entire two-criterion vector is
correct out of 120. The scorer also reports aggregate run verdict accuracy,
because a correct aggregate can hide a wrong individual criterion.
These are two measurements on a shared set, not independent replications.

Ours renders the shipped `buildPrompt` and asks one criterion per call. The
competitor uses its exact default verdict template, per-criterion rules and
`finish_test` argument schema from Scenario commit
`ad220e6a641c3aa38484cbb94d60566d5c9a2c10`. `vendor/prompts.json` extracts literal
prompt bytes mechanically; `vendor/criterion_verdicts.py` is unchanged source.
The default is not rewritten or replaced by a proxy prompt. The schema is sent
through Claude CLI structured output, not the Scenario SDK's tool runtime.
Remote traces are disabled and the supplied scenario/transcript is settled.
Native template placeholders and schema keys follow the pinned source.

The competitor transport permits two turns for structured output; plain-text
calls permit one. Both use the same Haiku alias and isolated `claude -p` path,
no tools, no settings sources, no session persistence and one active call at a
time. This is a prompt-and-schema experiment, not an end-to-end SDK comparison.
Ours may use extra calls; cost accompanies every score.

## Simulated user cases

`simulator.json` has 120 cases, sixty active current email requests and sixty
messages without one. Twelve families cover direct requests, paraphrases,
negation, quotation, translation, security, historical requests, conditional
future requests, mixed languages, JSON, role attacks and buried requests.
A requested email must be supplied; an unrequested one must be withheld.
Always withholding cannot pass. A parse/transport/driver error is incorrect.
Only the invented email for that case is checked; this measures fact disclosure,
not complete conversational quality or every possible invented identifier.

Ours runs the actual `createSimulatedUser` with a scripted agent, no model judges,
`script=none` and configured email ask patterns. The competitor uses its exact
text simulator default and the same fictional goal/persona with its fact known.
The reversed greeting and latest agent turn are coalesced into one user message
for the text-only CLI transport. This differs from the native multi-message SDK
transport and is disclosed. No extra instruction is appended to its default.

The research `checked` variant first asks a separate intent classifier whether
there is an active current request, then gates the production driver's fact
release. It never receives the construction label. The configuration and any
production changes proposed from it belong in the report, not packages here.

## Native PII and injection

Read [PII](pii/README.md) for the imported native evaluator, exact large spaCy
model, settings, subgroup scores and reproducible dependency pins. The full-set
oracle includes personal names and homes. Native defaults disable PERSON and
LOCATION, so publish full and enabled-scope scores together. Their thirty
scope misses are not evidence of poor enabled person/address recognition.
Ours' baseline combines its shipped name/address judge and identifier patterns
with reserved example email domains included. Reserved fictional phones remain
excluded by those shipped patterns; IP is outside their shipped pattern scope.
The full-scope research audit is separate from that baseline.

Read [injection](injection/README.md) for exact Azure Content Safety requests,
chunking and native-source parity tests. Azure results remain unmeasured until
credentials exist and actual requests succeed. Missing keys, errors and dry
fixtures cannot establish a score. No generative proxy is used.

## Reproduce

Commands run from the repository root. Paid calls are serialized and cached.
New-task spend is capped cumulatively at eight USD in `recorded/calls.jsonl`.
Each new call reserves 0.03 USD; unknown failed-call cost uses that reservation.
`--replay` forbids a new model call. Every item is saved after its calls.

```sh
python3 comparisons/langwatch/hard/generate-judges.py --check
node comparisons/langwatch/hard/generate-simulator.mjs --check
node comparisons/langwatch/hard/pii/generate.mjs --check
node comparisons/langwatch/hard/injection/generate.mjs --check
pnpm exec tsx comparisons/langwatch/hard/judges.mts ours --replay
pnpm exec tsx comparisons/langwatch/hard/judges.mts theirs --replay
pnpm exec tsx comparisons/langwatch/hard/simulator.mts ours --replay
pnpm exec tsx comparisons/langwatch/hard/simulator.mts theirs --replay
pnpm exec tsx comparisons/langwatch/hard/measure.mts pii ours --replay
pnpm exec tsx comparisons/langwatch/hard/measure.mts injection ours --replay
python3 comparisons/langwatch/hard/score.py
```

Remove `--replay` only to authorize paid missing recordings. Run just one
measurement process. Audit variants use `judges.mts audit`, `measure.mts pii
audit`, `measure.mts injection audit`; the intent-gated simulator uses
`simulator.mts checked`. Recorded scores identify which variants were measured.

```sh
pnpm exec vitest run --config comparisons/langwatch/hard/vitest.config.ts --maxWorkers=2
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/test_score.py
node comparisons/langwatch/hard/pii/test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/pii/test_native.py
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/injection/test_native.py
```

`recorded/results.md` and `summary.json` give full-population denominators,
Wilson 95% intervals, unanswered counts and attributable costs. Historical cached
cost is included in variant cost; fresh unique spend is counted once. Intervals
are descriptive because related templates are correlated. The hard sets are development cohorts. This round adds fresh held-out cohorts
with seed 20261013 and at least sixty cases, scored once for shipped, candidate
and native default. Candidate sources and fixtures are frozen before generative
held-out calls in frozen.json. No held-out tuning occurs. Shared template
families limit generalization; a small margin is not established superiority.


## Fresh held-out cohorts and the final judge oracle

Each candidate is **not yet the shipped default**. `recorded/results.md` puts
hard and fresh results side by side for shipped, candidate and native default.
The hard pairwise 120/120 is development evidence, not the fresh result.

The final judge set is `judges-v4.json`; its fresh counterpart is
`judges-heldout-v4.json`. The lead explicitly requires the deciding final
response or tool trace: absent deciding evidence is inconclusive for both sides.
Receipt identifiers use a disjoint namespace from plan identifiers. The
generator asserts receipt token presence against every label. All original
criterion labels remain unchanged. Earlier prototypes are archived and excluded
from accuracy; their costs and interrupted-call reservations remain charged.

Three empty native structured CLI outputs occur in the completed prototype.
All three recover with the same inputs and a six-turn transport allowance.
They are transport failures, never quality losses. The final default protocol
also retries only empty failed structured output once; valid wrong answers are
never retried. If recovery fails, the contestant has an unscored case and its
coverage is disclosed.

Fresh reproduction appends `--heldout` to `judges.mts`, `simulator.mts` and
`measure.mts`. The pairwise fresh runner is `pairwise.mts ours|checked|theirs`.
Append `--replay` to every command for zero new model calls.

```sh
python3 comparisons/langwatch/hard/generate-judges.py --seed 20261013 --n 60 --out judges-heldout-v4.json --check
node comparisons/langwatch/hard/generate-simulator.mjs --seed 20261013 --n 60 --out simulator-heldout.json --check
node comparisons/langwatch/hard/pii/generate.mjs --seed 20261013 --n 60 --out heldout.json --check
node comparisons/langwatch/hard/injection/generate.mjs --seed 20261013 --n 60 --out comparisons/langwatch/hard/injection/heldout.json --check
pnpm exec tsx comparisons/langwatch/hard/judges.mts ours --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/judges.mts audit --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/judges.mts theirs --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/simulator.mts ours --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/simulator.mts checked --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/simulator.mts theirs --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/measure.mts pii ours --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/measure.mts pii audit --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/measure.mts injection ours --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/measure.mts injection audit --heldout --replay
pnpm exec tsx comparisons/langwatch/hard/pairwise.mts ours --replay
pnpm exec tsx comparisons/langwatch/hard/pairwise.mts checked --replay
pnpm exec tsx comparisons/langwatch/hard/pairwise.mts theirs --replay
```

Native Presidio has one actual run per cohort; Azure stays unmeasured on both.
Fresh instances share generator families with development but have zero complete
input overlap. Native PII full/enabled scores are 88/120 and 88/90 on hard,
45/60 and 45/46 on fresh. Thirty hard and fourteen fresh positives fall under
native default-disabled PERSON/LOCATION. The remaining misses are phones.

The pairwise comparison retains the preceding experiment's JSON outcome adapter and exact golden-aware user template. It does not exercise the native tool-calling SDK system message. The pinned evaluator is marked deprecated upstream but remains runnable. Fresh scores therefore measure this disclosed prompt adapter, with swap-and-confirm preserved.

## Superseded unmeasured long-trace plan

The original `longtrace/` seed20261014 construction and flat-role runner are unmeasured. The owner confirms defective role framing before any call. They remain historical construction artifacts. Use the trusted-event v2 studies below.

## Request-digest storage naming

The lead requires `request_sha256` names for request digests. After all frozen
runs finish, the storage migration renames only digest metadata and matching
recording code. Original frozen source bytes and manifest remain archived;
prompt, decoder, held-out input, prediction and cost equality are checked.
The prior helper commit is rebuilt with its original parent, as authorized.
A local `gitleaks detect --log-opts="origin/harvest-langwatch6..HEAD"` must find
zero before the known-head `--force-with-lease` update to PR 109.

The PII shipped column combines the declared name/address judged half with the
shipped identifier patterns, using `reservedDomains=include` for fictional
benchmark emails. This option is explicit, not the default reserved-domain
setting. The bare shipped judge is also scored separately against full PII and
its declared name/address scope; it intentionally excludes identifier-only
messages. These component scores reuse the same recorded calls and add no run.

## Approved PR 115 default

The historical pairwise shipped column uses main's old contract. PR115 default
is measured separately from a fresh detached checkout at
`8195902dd20c84267f85feba268c17868e00dfbe`, with actual default `judgePairwise`,
`buildPrompt` and request-aware `parseJudgeText`. Both swap confirmation and
the shipped bounded contract repair/fact-ledger fallback remain enabled.
The fresh checkout is ignored and untouched. Its dependencies reuse installed
versions; the pinned tsconfig resolves workspace source imports in that checkout.
The root's budgeted serial recorder supplies the same Haiku CLI flags as the
native production client. All request digests use `request_sha256` after storage migration.
PR115 is approved; its replacement status depends on CI/merge, not this score.

To reproduce, create a detached worktree inside this ignored directory at the
approved commit and supply installed dependencies. Then run from the repository root:

```sh
pnpm exec tsx --tsconfig comparisons/langwatch/hard/.pr115-source/tsconfig.json comparisons/langwatch/hard/pr115.mts --heldout --replay
pnpm exec tsx --tsconfig comparisons/langwatch/hard/.pr115-source/tsconfig.json comparisons/langwatch/hard/pr115.mts --replay
```

## Additional conformance and injection attempt studies

The seed20261018 conformance transport plan is superseded and unmeasured. Its frozen candidate prompt and decoder now use the common trusted-event adapter on new seeds20261019 and20261020.

`INJECTION-ATTEMPT-PROTOCOL.md` fixes an attempt-aware repair from the audit's
hard failure to distinguish a user attempt from auditor adoption. A new draw
at seed20261017 has sixty fixed cases and zero full text overlap. Shipped and
candidate run once on this new draw; native Azure remains unmeasured.
Neither repair uses a held-out prediction for design.

```sh
pnpm exec tsx comparisons/langwatch/hard/injection-attempt.mts attempt --replay
pnpm exec tsx comparisons/langwatch/hard/injection-attempt.mts ours --heldout-v2 --replay
pnpm exec tsx comparisons/langwatch/hard/injection-attempt.mts attempt --heldout-v2 --replay
```

The same approved PR115 measurement round includes the actual default criterion
ledger on the original hard120/frozenfresh60, without changing the source,
labels, prompts or fresh cohort. `pr115-criteria.mts` uses the same pinned
client builder/parser as the pairwise run. It records grounded checks and
parser failures for diagnosis. No fresh-set tuning occurs. Append `--heldout`
for the frozen fresh draw and `--replay` for zero new calls, with the same
explicit pinned tsconfig as the pairwise command.

The old `pr115-criteria.mts --longtrace` transport remains unmeasured. The versioned common adapter below supplies the new long cohort.


## Trusted event adapter v2

The old criterion adapter collapses agent receipts, user requests and context gaps into one agent entry. The judge-architecture review confirms this defect. The published old scores, including PR115119/120 and59/60, stay unchanged and are qualified as defective-adapter measurements. They do not isolate pure judge quality.

`trusted-adapter-v2.mts` consumes only construction-time `entries`. It never parses bracket tags or splits an entry. Nested `[agent]` text in a context gap stays literal. Scenario reference context and agent/user/tool/context entries stay separate. Native receives the same trusted visible events as JSON inside its unchanged default transcript wrapper. Default prompts and decoders stay frozen.

`ADAPTER-V2-PREREGISTRATION.md` fixes two new seeds before any call: seed20261019 short validation120 and seed20261020 long validation120. No fixed-adapter run occurs on the previously seen hard120/fresh60. All five procedures run once on each new cohort. All240criterion scores,120primary,120receipt and120vector views, costs and losses are reported separately. Old seed18/seed14 artifacts are unmeasured plans.

```sh
python3 comparisons/langwatch/hard/generate-judges-entries-v2.py --check
python3 comparisons/langwatch/hard/test_entries_v2.py
python3 comparisons/langwatch/hard/longtrace-v2/generate.py --check
python3 comparisons/langwatch/hard/longtrace-v2/test_construction.py
pnpm exec tsx comparisons/langwatch/hard/criteria-v2.mts ours --replay
pnpm exec tsx comparisons/langwatch/hard/criteria-v2.mts audit --replay
pnpm exec tsx comparisons/langwatch/hard/criteria-v2.mts theirs --replay
pnpm exec tsx comparisons/langwatch/hard/criteria-v2.mts compliance --replay
pnpm exec tsx --tsconfig comparisons/langwatch/hard/.pr115-source/tsconfig.json comparisons/langwatch/hard/criteria-v2.mts pr115 --replay
```

Append `--longtrace-v2` to each of those five commands for the new long cohort. PR115 requires the approved ignored source checkout and pinned tsconfig described above. `adapter-v2-freeze.json` freezes procedure, fixture and preregistration hashes; the runner refuses a call unless all are committed and unchanged. A fresh-data outcome never changes the adapter, generator, rubric, label, prompt or decoder.

## Bounded publication storage

Before any Node replay or native fixture command, run `python3 comparisons/langwatch/hard/restore-recordings.py`. The scorer and record checker restore automatically. Reviewable JSONL parts stay below the privacy guard size limit; the original ledger and two PII fixture files are restored locally and ignored by Git. SHA-256 checks require the restored bytes to equal the measured files exactly. No request, response, label, score or cost changes. Inline pattern annotations apply only to constructed GB IBANs with the unallocated ZZZZ bank code; the private denylist remains active. The pinned PR 115 wrapper and verification notes retain their historical package scope through the codemod.
