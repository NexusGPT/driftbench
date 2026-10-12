# LangWatch comparison: reproducible measurements

Every published claim in the comparison table for the rows below comes from a command in this folder. Each row names
its command, its input set, and the file where its numbers are recorded. Scoring makes no model call: the judge runs
record every answer and its cost, and the score scripts read those records.

Every set is fictional. Names are invented, emails use the reserved example domains, and IBAN and national numbers
are built to pass their checksums without belonging to anyone. Each set is generated from a fixed seed, so the same
command gives the same file.

## Rows

### Row 8: exact match (driftbench `exact` check against the competitor's `exact_match`)

- Input: `exact/heldout.json`, 200 cases, made by `exact/generate.mjs --n 200 --seed 20260612`.
- Truth rule, set by us and not by either side: a reply is "same" when it equals the reference after letter case, surrounding space, punctuation and number formatting are ignored (`42.0` is `42`, `007` is `7`, `true` is `1`), and when runs of whitespace inside it count as one space. Anything else is "different". A reader who wants strict whitespace would label the line-break and double-space cases differently; those are the cases that separate the two.
- Commands, from the repository root:

```sh
node comparisons/langwatch/exact/generate.mjs --n 200 --seed 20260612 > comparisons/langwatch/exact/heldout.json
npx tsx comparisons/langwatch/exact/ours.mts
<competitor-env>/bin/python comparisons/langwatch/exact/theirs.py <langwatch-checkout>
python3 comparisons/langwatch/exact/score.py
```

- `<langwatch-checkout>` is a checkout of the competitor repository. `<competitor-env>` is a Python environment with
  its packages installed (litellm, tenacity, tqdm, pydantic). `theirs.py` must run from outside this repository,
  because the working folder shadows the competitor's package imports.
- Output: `exact/recorded/exact-results.md`.

### Row 9: ROUGE-L and BLEU (driftbench against the ragas library)

- Input: `overlap/heldout.json`, 120 reply and reference pairs, made by `overlap/generate.mjs --n 120 --seed 20260612`.
- Truth: none. The comparison is agreement with the reference implementation, so no human labels are needed.
- Commands:

```sh
node comparisons/langwatch/overlap/generate.mjs --n 120 --seed 20260612 > comparisons/langwatch/overlap/heldout.json
npx tsx comparisons/langwatch/overlap/ours.mts
<ragas-env>/bin/python comparisons/langwatch/overlap/theirs.py
python3 comparisons/langwatch/overlap/score.py
```

- `<ragas-env>` is a Python environment with ragas 0.4 and sacrebleu installed.
- Output: `overlap/recorded/overlap-results.md`.
- Known difference: one pair (`o059`) differs on BLEU in the ragas profile. The reference library splits the reply
  on `". "` and the reference on `". "` separately, so the reply's `to. to.` becomes two segments against one
  reference segment. driftbench scores the text as one segment. The two agree on every other pair.

### Row 12: personal data (patterns, the judged name and address detector, and Presidio)

- Input: two sets of 120 fictional messages, built in memory from fixed seeds by `pii/set.mjs`. Nothing about the
  identifiers is stored in the repository: the sets hold checksum-valid IBANs and national numbers, so they are rebuilt
  wherever they are needed. `dev` (seed 20260612) is the set that found the rubric problem; `check` (seed 20260701) is
  the held-out check. Half the messages in each name a person or give a personal address.
- Truth: a message is personal when it names a person or gives a personal address. An email or a national number on
  its own is not personal for the judge; the pattern detector still reports it as an identifier.
- Records: every answer is stored under the SHA-256 of its message (with an occurrence number when the same text
  appears twice), never the message. `pii/recorded/` holds judge answers, pattern findings and Presidio findings.
- Commands, from the repository root:

```sh
npx tsx comparisons/langwatch/pii/measure.mts patterns
npx tsx comparisons/langwatch/pii/measure.mts judge --model haiku --set dev --rubric new --cap 1.0
npx tsx comparisons/langwatch/pii/measure.mts judge --model haiku --set check --rubric new --cap 1.0
npx tsx comparisons/langwatch/pii/measure.mts judge --model sonnet --set check --rubric new --cap 3.0
<presidio-env>/bin/python comparisons/langwatch/pii/presidio.py dev
<presidio-env>/bin/python comparisons/langwatch/pii/presidio.py check
python3 comparisons/langwatch/pii/score.py
```

- The judge commands call the local `claude` command and cost money; `--cap` stops the run at that spend.
- `<presidio-env>` has presidio-analyzer, spacy and the en_core_web_sm model. Setup is in the header of `presidio.py`.
- Output: `pii/recorded/results.md`.
