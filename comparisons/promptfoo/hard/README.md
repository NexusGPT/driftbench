# Hard model-graded comparisons

Four sets have 120 fictional cases each. Each set has 60 passing and 60 failing cases, including five of each label in each of 12 families. `generate.py` creates the cases deterministically. The case files are the reported tuning sets. These are synthetic stress tests, not unseen-data estimates of general superiority.

Each row also has a fresh held-out set of 72 cases: three passing and three failing cases per family. Seed `20261113` supplies new entities, numeric values, service features and fictional contact bindings through the same generator. Hard seed `20261012` retains the original factuality and goal inputs. Rubric has the approved repair below; privacy adds phone cases before its first model call. Held-out labels and canonical file hashes are fixed in `heldout-manifest.json` before any held-out call. `candidate-freeze.json` pins the procedure before these runs; a changed procedure or changed held-out labels blocks scoring. The candidate is **not yet the shipped default**. Held-out outcomes do not tune it.

The first rubric construction has 120 case IDs but 88 distinct payloads. Its peer-only benchmark is **archived and unpublished** under `archived/`. The owner approves regeneration with a unique offer identity in each requirement and reply. The reported rubric hard set has 120 distinct payloads, with identical case IDs, truth labels and family balance. The old answers remain recorded and charged, but do not contribute to the published comparison scores.

| Row | Easy evidence | Hard skill |
|---|---|---|
| 18 LLM rubric | The page says ahead, but the supplied branches have no measured rubric set. | Conjunction, negation, scope, periods, arithmetic, partial completion, quoted claims, alternatives, French, contradiction, long replies, and judge injection. |
| 19 Factuality | PR 50 records 100/100 for both sides. | Nearby numbers, negation, distractor entities, old prices, unit conversions, fees, conditions, subsets, French, partly right replies, long references, and judge injection. |
| 32 Personal data | PR 50 records ours 200/200 versus 199/200. | Ownership, obfuscation, disclaimers, JSON, purpose excuses, mixed contacts, French, split fields, quotation, long replies, zero-width characters, and judge injection. |
| 31 Goal success | The existing 100-case output-only recordings compare a synthetic prompt with our deterministic end-state check. | Five required state fields, plausible success claims, empty state, stale nested records, French, long replies, contradictory replies, and judge injection. |

`easy-baselines.json` preserves the supplied summaries. Factuality and personal-data easy evidence comes from `lane/harvest-promptfoo-4`, PR 50, read from its local worktree. Those easy scripts store aggregate counts, not item-level answers. No easy results are invented for rubric.

## Procedures

The default competitor templates are copied from `src/prompts/grading.ts` at commit `801428268b5e421b2f6994332f6a06f86b27bb1f`, with its MIT notice. `vendor/grading.ts.txt` preserves the source, and `vendor/defaults.json` preserves the resolved message strings. No default instruction is changed. Their system message goes to `--system-prompt` and their user message goes to stdin. Both sides use the same Haiku alias and Claude print-mode flags. This isolates prompt and procedure effects on one backend; it does not run the competitor's entire package.

Upstream `src/util/templates.ts` configures its grader template engine with `autoescape: false`. The single substitution pass here preserves literal XML delimiters inside evaluated output, matching that setting. On the regenerated rubric hard set, the peer's five errors treat an injected final `<Output>` opening as an empty output. The original passing content remains in the complete evaluated string. The comparison tests that boundary handling without modifying the default template.

The rubric and privacy rows use its default LLM rubric template. Factuality uses its default A/B/C/D/E template and default weights: only D fails. Goal success uses its actual trajectory-goal-success template, replacing the old synthetic output-only prompt for the new measurement. The summary carries index, type, name, and a numeric status object, as `summarizeTrajectoryForJudge` does. It omits tool argument and result values. `trajectory-parity.mts` executes the pinned upstream helper on all 192 goal traces and compares its output with the cases. The helper and its attribute utilities are retained verbatim under `vendor/` and hash-pinned in the provenance file. A status-format repair occurs before any goal call, with labels and balance unchanged; the held-out manifest records it.

Our `shipped` variant reproduces judge commit `c07c705cbd0275ec2c59ca8119fab09a539179e5` through `render.mts`. The verbatim prompt builder and decoder are preserved under `pinned-judge/`, with source hashes in its manifest. Later changes to the production judge do not change this comparison. Our `audit` variant asks for independent requirement checks and computes the final outcome in code. Any violated requirement fails; an unknown requirement without a violation stays inconclusive; all met requirements pass. Empty or malformed ledgers remain inconclusive. No case ID, truth label, construction family, or expected-state metadata reaches a model.

Baseline decoding follows the actual contracts: the shipped judge reads its last complete top-level JSON object with strict schema validation and its existing quote repair; the peer reads its first JSON object. Native peer string-verdict coercion, score-only fallback without a custom threshold, factuality weights and legacy category responses are retained. Grader errors stay inconclusive and earn no credit. `decoder-parity.mts` replays every shipped answer through that pinned parser. `peer-decoder-parity.mts` executes the pinned native JSON extraction and verdict functions on every peer recording. It fails if an answer needs the untested YAML repair path. `verify.py` requires exact agreement. A correction in the model's own final object is retained by the shipped contract. Explanations never override a verdict label. Free reparse notes remain in the result metadata when decoding was normalized during the study.

The privacy comparison is semantic: ownership is explicitly defined by a fictional world. Six families concern phones and six concern email; each family and contact type has balanced passing and failing labels. Every email uses a reserved `.test` domain. Phones use the fictional NANP `555-0100` through `555-0199` range, with new area codes in the held-out set. This is a model-judge comparison, not a claim that the shipped local PII scanner detects these cases. That scanner deliberately exempts reserved domains and fictional phone ranges. IBAN and national-register checks are not included. No real customer data, contact target, bank account, or secret is included.

The construction labels permit a masked local part with a generic shared provider domain, such as `[redacted]@contact.test`. The held-out candidate rejects two of these passing cases, and the peer rejects one. These errors are retained under the pre-fixed labels. The frozen procedure is not tuned from them, and the shipped judge remains stronger on this privacy set.

The goal construction requires the exact requested plan identifier, quantity, confirmed status, currency and monthly price. A `-Plus` identifier is a distinct plan in this set. The comparison gives our judge the persisted final state, as the product's end-state check can read it. The default competitor summary cannot identify wrong arguments on a successful tool call. This information difference is disclosed, not attributed to better reasoning. `peer-full-state` keeps its default prompt unchanged and adds the same persisted state to the trajectory JSON for an equal-evidence ablation.

Rows 20 and 21 remain explicit relevance and RAG limits. This study does not implement embeddings or retrieval. The grouped rubric row does not claim separate hard results for closed QA, G-Eval, or an agent with external tools. Privacy is only the personal-data half of red-team plugins, not the full plugin catalogue or prompt extraction. Refusal is a provider-flag/local-pattern comparison, not a model-judge comparison. Simulated users generate conversation turns; they are not graded-output rows here.

## Reproduce without spending

From the repository root:

```sh
pnpm install --frozen-lockfile
python3 comparisons/promptfoo/hard/verify.py
python3 comparisons/promptfoo/hard/generate.py
pnpm exec tsx comparisons/promptfoo/hard/render.mts
python3 comparisons/promptfoo/hard/run.py factuality peer --cap-usd 0
python3 comparisons/promptfoo/hard/run.py factuality shipped --cap-usd 0
python3 comparisons/promptfoo/hard/run.py factuality audit --cap-usd 0
python3 comparisons/promptfoo/hard/score.py
python3 -m unittest discover -s comparisons/promptfoo/hard -p 'test_*.py' -v
pnpm exec vitest run --config comparisons/promptfoo/hard/vitest.config.ts --maxWorkers=2
pnpm exec tsc -p comparisons/promptfoo/hard/tsconfig.json --noEmit
```

The Python tests explicitly create the ignored `runtime/` directory during setup, including on a fresh clone. `verify.py` checks both folds and native decoders without writing recordings or calling a model. Replay needs no Git history or model credentials.

Replace `factuality` with `rubric`, `pii`, or `goal` to replay another row. `goal peer-full-state --cap-usd 0` replays the equal-evidence ablation. Replaying a missing answer fails; it never quietly spends. To record missing answers, supply a positive invocation cap and the desired spend-ledger path through `--ledger`. Successful answers with the same content key remain cached. The driver always limits cumulative recorded spend to 8 USD and reserves 0.02 USD before each call. This campaign's ignored runtime configuration stops new calls at `2026-10-13T07:00:00+02:00`. For a later paid run, pass its own future ISO timestamp with offset through `--deadline`.

Add `--set heldout` to replay a held-out row. `generate.py --heldout` and `render.mts --heldout` reproduce its cases and shipped prompts. Run held-out measurements only after all hard measurements and `freeze.py`. Each shipped judge, frozen candidate and default peer is scored once on each held-out case; identical peer inputs share a recording. The equal-evidence goal ablation is also recorded on held-out cases. The default goal summary intentionally collapses state-distinct pairs, so it has fewer distinct inputs than cases. The full-state ablation removes that information gap.

Each `run.py` invocation holds a filesystem lock and calls one model at a time. Completed calls are appended and fsynced immediately. Cache keys cover the complete prompts, model and CLI flags. The per-call cap is 0.02 USD. Failed calls preserve diagnostics and stop the invocation; calls without a returned cost reserve their entire cap. `recorded/calls.jsonl` contains all unique paid answers, complete prompts, reported costs and resolved model names. `recorded/summary.json` counts all attempted cases, with inconclusive answers treated as wrong.

Request digests use the field `request_sha256` and retain their original hexadecimal values. They are request fingerprints, not API keys. A scanner false positive is fixed in the scanner; inputs, answers and digest values are not changed to pass it.

Confidence intervals are 95% Wilson intervals on the synthetic case population. `score.py` also reports the exact two-sided paired sign test. Its ahead/equal/behind outcome requires p below 0.05, following the earlier comparison convention. A higher raw score with a non-significant sign test remains equal. Intervals alone do not prove that one procedure beats another.

`recorded/losses.md` contains the full error census with actual inputs and recorded answers. Replay and scoring make no model calls. A `score.py` run that reproduces the committed numbers leaves `recorded/summary.json` byte for byte. A table's attributed cost includes its underlying shared recordings. Such table costs must not be summed as additional billed spend; the unique-call total is the budget measure.
