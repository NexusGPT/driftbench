# Caller-owned rubric item IDs: offline replay

The production `parseJudgeValue` replay recovers correct clean and defect grades for 16 of the 17 archived extra-row failures.
All 17 clean candidates retain full scores. The parser ignores 22 unknown rows and preserves the unresolved numeric conflict in `rb-bank-036`.

| Offline method | Clean full scores | Defects rejected | Unresolved defect IDs |
|---|---:|---:|---|
| Verified intended-row mapping | 17/17 | 16/17 | `rb-bank-036` |
| Blindly label legacy row 1 as required | 17/17 | 14/17 | `rb-bank-025`, `rb-bank-036`, `rb-bank-046` |

These results measure parser behavior on archived outputs with human-verified row identity.
They do not measure a new prompt, fresh model performance, retry success, or generalization.
No model client, provider, benchmark runner, or network call is used.

## Run

From the repository root, with its existing dependencies available:

```sh
node --import tsx research/caller-owned-rubric-ids/replay.ts
```

The script imports `../../packages/judges/src/assessment` directly and uses the repository's TypeScript path aliases.
It prints JSON and fails on any score, mapping, diagnostic, or required-item assertion mismatch.
Tests can import the exported `replay()` function to obtain the same result without console output or file writes.
The checked-in `replay-output.json` captures a successful run, including fixture and production parser SHA-256 hashes.
An earlier run against the unmodified parser failed on `rb-bank-006` because that parser rejected additional rows.

To regenerate the compact fixture from the pinned Git objects already in the local repository:

```sh
python3 research/caller-owned-rubric-ids/build-fixture.py
```

This extraction command requires the source commits below to be present locally.
The normal replay requires only this fixture and the production parser dependencies.

## Mapping and score adapter

The caller-owned stable rubric item ID is `rubric:<sourceTemplate>`, carried in the production rubric item's `name` field.
Its definition is the original bank criterion string, unchanged.
The same source template receives the same stable ID across cases.

Legacy numeric row IDs were assigned by the model. They are not caller-owned IDs.
The adapter uses the diagnosis's explicitly verified `intendedRow.id` mapping to assign the stable name retrospectively.
Each other row receives a distinct `unknown:<bank-id>:legacy-row-<id>` name and is still sent to the production parser.
The parser, rather than the adapter, removes those rows from scoring and reports their names in `ignoredRequirementIds`.

| Verified legacy row | Cases |
|---|---|
| 2 | `rb-bank-025`, `rb-bank-046` |
| 1 | `rb-bank-006`, `007`, `014`, `015`, `017`, `026`, `027`, `035`, `036`, `045`, `047`, `048`, `054`, `057`, `058` |

The blind-ID1 comparison deliberately assigns the stable name to row 1 in every case.
Its separate result demonstrates why selecting row 1 cannot replace semantic mapping.

Recorded scores use integers from 0 to 2. Production scores use integers from 0 to 4.
The adapter multiplies each recorded numeric score by 2, preserving fractional fulfillment exactly.
Production returned item scores and normalized aggregates are asserted against the original numbers.
The model's weights remain in the raw recording; the replay supplies one caller-owned weight of 1 for its single required item.
Recorded `evidence` becomes `reasoning` unchanged. The adapter does not pretend this prose satisfies a literal-quote grounding contract.

Candidate order is reconstructed from the bank's clean and defect SHA-256 values and checked against the diagnosis's saved reversal flag.
Clean and defect labels are used only to evaluate replay results. They never enter the production judge request.

## Unresolved conflict

`rb-bank-036` has structured A=2 and B=2, while its prose says defective A should receive 0.
The adapter preserves 2/2 as production 4/4. The production parser returns a tie, and the defect remains unrejected.
It does not replace the numeric grade with the prose or borrow the recorded winner B.
The original benchmark could choose B from its recorded winner when numeric totals tied.
Consequently, correct winner selection is not equivalent to correct per-requirement grading.

## Provenance and checks

`fixture.json` contains only the 17 affected cases, unchanged raw output strings, candidate strings, verified mapping IDs, and source hashes.
The original recordings and banks remain unchanged.
Each raw string has a SHA-256 hash of its exact UTF-8 bytes.
Full source files have pinned commits, Git blob IDs, byte counts, and SHA-256 hashes in `sources`.

- Diagnosis commit: `628a0c30433d4eaf385f398dbe59aa21a211cae3`, originally `origin/research/astra-planted-why`.
- Recording and bank commit: `492fce432e1d34a62c5f5c5586d23026133b390b`, originally `origin/research/astra-planted-truth`.
- Mapping: `research/planted-why/classification.json` and `research/planted-why/astra-planted-why.md`.
- Raw source: `research/planted/results/recordings/bank-rb/haiku.jsonl`.
- Candidate and order sources: `research/planted/bank-rb.json` and `research/planted/results/bank-rb.json`.

Extraction compares all 60 saved decisions against the affected classification set, then copies exactly the 17 extra-row cases.
It checks recording keys, line numbers, candidate order, intended rows, extra rows, and the source report's evidence text.
Replay checks all 17 cases, all raw and candidate hashes, exact score preservation, and all 22 ignored names.
For both mapped and blind-ID1 variants, it also removes or duplicates the required row and asserts parser rejection.
That produces 34 missing-item and 34 duplicate-item negative checks.

The stored recording model labels are historical metadata, not proof of the current provider or model configuration.
This replay does not execute the other 43 bank pairs or report a new full-bank benchmark result.
The verified mapping is a supplied annotation, not an automatic recovery capability of the parser.
