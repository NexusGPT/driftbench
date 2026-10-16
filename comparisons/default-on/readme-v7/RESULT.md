# default-on-v7 on the README judge rows: result

The run follows `PREREGISTRATION.json` and its pre-call amendments. Product eb2e61214; policy default-on-v7; Claude Haiku 5.5 over the Anthropic Messages API; run freeze `dcefaf5cd24416b9e618152ad2e3b19ed76d3f5a2ba4009d7d707272bc08d35c`.

All 2,700 items return across 15 datasets and 18 rows. Shared datasets supply multiple rows. Recorded spend is USD 1.5335619, counting each dataset once. No model or peer call is made for this analysis or chart update.

The earlier driftbench rows used `claude -p` with old prompts; knowledge retention mostly used the Messages API. v7 calls `createDefaultJudge` over the Messages API on the same items and model. This transport difference is part of the comparison; these are not prompt-only effects. Peers retain their recorded answers. The items were already known before this run, so this is not a new unseen population.

## README rule

Inconclusive answers count wrong. Most rows use separate Wilson 95% intervals: lead or deficit when they do not overlap, close otherwise. G-Eval strict and knowledge retention use exact paired tests, Holm over those two rows. A v7 inconclusive answer leaves the peer paired test but remains in the score denominator.

| Row | n | v7 correct | Earlier driftbench correct | Recorded peer correct | Standing |
|---|---:|---:|---:|---:|---|
| Turn relevancy | 72 | 72 | 65 | 36 | lead |
| DAG, one node | 72 | 72 | 65 | 65 | close |
| Role adherence | 72 | 72 | 72 | 63 | lead |
| Completeness | 72 | 72 | 70 | 46 | lead |
| Hallucination | 72 | 72 | 71 | 36 | lead |
| Faithfulness | 72 | 72 | 71 | 36 | lead |
| Task completion | 72 | 72 | 72 | 72 | close |
| G-Eval strict | 480 | 479 | 474 | 451 | lead |
| Knowledge retention | 1272 | 1271 | 1270 | 1272 | close |
| LLM rubric | 72 | 72 | 71 | 69 | close |
| Factuality | 72 | 72 | 70 | 70 | close |
| Personal data | 72 | 72 | 72 | 71 | close |
| Goal success | 72 | 72 | 72 | 71 | close |
| Reference correctness | 120 | 119 | 116 | 115 | close |
| Model-graded QA | 60 | 58 | 48 | 57 | close |
| Model-graded fact | 60 | 58 | 48 | 59 | close |
| Grader panel | 60 | 54 | 59 | 59 | close |
| Panel, borderline | 60 | 60 | 49 | 60 | close |

G-Eval strict retains the preregistered explicit response-relevance setting; Holm p = 1.1548399925231934e-7. Knowledge retention has Holm p = 1. The other rows use the v7 default. Six returned answers are inconclusive: one on retention, one on reference correctness and four on grader panel. `ANALYSIS.json` lists every excluded peer pair.

## Secondary comparisons

Against the recorded earlier driftbench answers, Holm over all 18 rows finds gains on model-graded QA and fact (10 fixed, none broken per row; Holm p 0.033203125) and borderline panel (11 fixed, none broken; Holm p 0.017578125). No loss is significant under this test. Grader panel still drops from 59 to 54 correct: one fixed and six broken, including four inconclusive answers; raw p 0.125, Holm p 1. This drop is retained, not hidden by the close standing against the peer.

The separate secondary peer tests, also Holm over 18 rows, remain diagnostic; they do not replace the preregistered README rule.

## Committed output and reproduction

* `manifest.json` is the unchanged analysis input manifest, SHA-256 `c3f837dba8f0793afda9e32f0e3530cd100c873f58e91b38f94d3e828af1b346`, matching the preregistration.
* `results/001.jsonl` through `results/014.jsonl` preserve all 2,700 judged records after transport-metadata redaction. Each file is below the leak guard's 10 MiB limit. `results/manifest.json` records each redacted file's SHA-256, bytes and line count and the combined redacted digest `5ae7c979889e48dc17555fe0bd851cbbc9c286526eb86715b52af17c41319624`. The unredacted source digest is `e03233a116b7a6d486a733cebc034d500a1f80c40e8f2c9d3e35c896f192677f`; the unredacted source is not published.
* `ANALYSIS.json` is the output of the committed `analyze.py`; `RESULT.md` reports every row, including the panel decline. No credentials, operator emails, raw-cache files or calls log are included.
* The owner's finish instruction authorizes updating the README on PR 371 before merge, superseding the preregistration's publication timing. The run and analysis rules remain unchanged.

From the repository root, without model calls:

```sh
cat comparisons/default-on/readme-v7/results/[0-9][0-9][0-9].jsonl > /tmp/driftbench-readme-v7-results.jsonl
python3 comparisons/default-on/readme-v7/analyze.py comparisons/default-on/readme-v7/manifest.json /tmp/driftbench-readme-v7-results.jsonl dcefaf5cd24416b9e618152ad2e3b19ed76d3f5a2ba4009d7d707272bc08d35c /tmp/driftbench-readme-v7-analysis.json
node tools/readme-charts.mjs --check
node tools/guard/guard.mjs comparisons/default-on/readme-v7
```

Compare the parsed analysis JSON with `ANALYSIS.json` (formatting may differ). Charts and README rows read that committed analysis through `tools/readme-charts.mjs`. Historical public benchmark rows retain their recorded judge versions and settings.

## Transport-metadata redaction

The publication decodes JSON nested in raw receipt strings and removes each complete response `headers` block. It also removes request identifier fields and provider message/request identifiers. The redacted output removes 3,277 header blocks and 6,554 provider identifier fields. No organization or workspace identifier value is included in this report or the guard; the guard compares fingerprints without revealing the values.

Judgments, predictions, labels, costs, usage and analytical fields remain unchanged. `analyze.py` on the redacted chunks reproduces every field of `ANALYSIS.json`; the committed analysis is unchanged. `tools/guard/readme-results.test.mjs` checks every chunk, nested JSON strings, identifier patterns and fingerprints, checksums, sizes, line counts and complete analysis reproduction. Synthetic negative cases prove the guard rejects those metadata forms.

The unredacted-source SHA-256 above identifies the original recording for provenance. Chunk and combined-output hashes now identify the redacted publication, so the original byte-for-byte publication claim no longer applies.
