# Mixture of Judges (MoJ): research harness

**Mixture of Judges (MoJ)**: a System-1 first pass on every item, then a full judge mixing System-1 and
System-2 models on the items the first pass leaves unsure.

- System 1 is a fast decision model: a yes or no question in, a probability out, no prose (here: Jev).
- System 2 is a generative model that reasons in text (here: `gpt-6-luna`).
- System 1 has two jobs: it judges (first-pass verdict with a margin) and it routes (it reads the terrain of an
  item and picks which judge design handles it, and how much to spend).
- Every output carries a confidence. High confidence stops, middle adds one expert, low goes to the full mix.

This folder is research. Nothing here changes the package. MoJ is an option until every recorded benchmark
set holds on replay.

## Layout

| Path | What it is |
|---|---|
| `moj/client.py` | Recorder. Every request and answer goes to `recordings/*.jsonl`, keyed by the request hash. A returned answer is never asked again; a call with no answer is submitted at most 3 times. |
| `moj/benches.py` | Benchmark adapters: criterion, requirement rows, known cheap rules, the fixed tune and validation split. |
| `moj/experts.py` | The catalogue of experts (judge designs). Each returns `pA`, the probability that candidate A is better. |
| `moj/collect.py` | Runs experts on practice pairs, stores `results/signals/<bench>.json`. |
| `moj/policy.py` | Stage 1, confidence levels, the terrain router, the fitted combination. |
| `moj/score.py` | Scoreboard of one variant against the baselines. Zero model calls. |
| `configs/*.json` | One file per variant. |
| `data/<bench>.json` | Practice pairs with recorded baselines. Practice splits only. |
| `prepare.py` | Builds `data/` from the practice splits of the ledger harnesses. |
| `probe.py` | Probe of the System-1 endpoint with fictional data. |

## Run

```sh
cd research/moj
python3 -m moj.collect --offline                      # replay every recorded call, rebuild the signals
python3 -m moj.score configs/r0-terrain.json           # scoreboard of one variant, no calls
python3 -m moj.collect --bench mmeval --experts s1p    # live: only calls with no recording are sent
```

Python 3 with numpy. No other dependency.

Live calls read keys from files inside the process (`moj/client.py` names them). A key is never printed,
logged or written. At most 8 calls run at a time.

## Add a benchmark

1. Write `data/<name>.json`: a list of pairs `{id, split, group, language, question, a, b, label, baselines}`.
   `label` is `A` or `B`. `baselines` maps a judge name (`ledger`, `promptfoo`) to `{games: [g1, g2]}`, the two
   order games of a recorded run mapped to the original labels. Use practice splits only.
2. Add an entry to `BENCHES` in `moj/benches.py`: the criterion, the requirement rows (or `'decompose'` plus an
   `item_type` sentence: System 2 then writes the rows once into `data/rows-<name>.json`), the known cheaters.
3. `python3 -m moj.collect --bench <name>` then `python3 -m moj.score configs/<variant>.json`.

A pointwise benchmark (one output, a pass or fail label) fits the same shape when the pair is
"the output" against "an empty reference": this adapter is not written yet.

## Add an expert (a judge design)

In `moj/experts.py`:

```python
@expert('my_unit', kind='adversarial', cost='1 S2 + 1 S1', job='One sentence: what it decides.')
def my_unit(ctx):
    p = ctx.jev({'request': ctx.item['question'], 'reply': ctx.item['a']}, {'q': {'question': '...'}})['q']
    return {'pA': p, 'detail': {...}}
```

`pA` is in 0 to 1, 0.5 means no information, `None` means no answer. Ask in both orders (`both_orders`) or per
candidate (`diff`) so a position effect cancels. Then `python3 -m moj.collect --experts my_unit`.

## Add a variant

Copy a file in `configs/`. Fields: `stage1` (experts on every item), `hi` and `lo` (confidence boundaries),
`cards` (ordered capability cards `{expert, terrain}`; the first match is added at the middle level), `always`
(cards applied whatever the confidence), `low` (experts of the full mix), `abstain_below`.
Terrain features come from the `route` expert: `needs_reasoning`, `safety_case`, `checkable_answer`,
`subjective_writing`, `near_identical`, `undecidable`, `injection`, `has_code`, `has_reference` (System-1
probabilities) and `chars`, `length_gap`, `non_latin` (code). A route reads content only, never a benchmark name.

## Rules of the rounds

- One hypothesis per round, one change, the refuting number stated before the run.
- Each practice set is split once by a fixed hash into a tuning half and a validation half. Tune on the first.
  A gain counts when it also shows on the second.
- Weights are fitted by cross-validation on the tuning half, pooled over benchmarks.
- No sealed test split is read. No benchmark label is used by a route.

## Split, groups and sealed ids

- **Split version `moj-split-v2`** (in `moj/benches.py`, stored in every signal's `_meta.split_version`). A practice
  set is split once into a tuning half and a validation half by a hash of the item's **group**: every pair that
  shares a prompt, a source item or a reference has the same group (an explicit `groupId`, else the hash of the
  prompt text). Version 1 hashed the pair id and let one writing prompt sit in both halves; numbers quoted with
  version 1 are not comparable. Cross-validation folds are made of groups too.
- **Practice sets**: the first 168 pairs are the fixed subset `set: "core"`; `prepare_more.py` adds `set: "ext"` pairs
  from practice or DEV data only (JudgeBench: GPT-4o response split; MM-Eval: the exposed DEV400; writing: the
  LongJudge DEV slice, then source pairs no run ever scored). No sealed TEST pool and no item scored by a sealed
  run is used.
- **MM-Eval core holds 45 pairs, not 50**: the source harness's pilot (20) and noise (30) files share 5 ids
  (3540, 1660, 4140, 4050, 2357). Duplicates are kept once.
- **`data/sealed-confirmation.json`**: ids reserved for the confirmation run, with a digest. Nothing in it is
  scored. A prompt is either practice or confirmation, never both.

## Pacing

- At most 8 worker threads per runner, and at most 3 System-1 calls in flight per runner (`JEV_PARALLEL`): several
  helpers share the gateway.
- A call with no answer is submitted at most 3 times. After HTTP 403 or 429 the waits are 20, 60 and 180 seconds.
  A returned answer is never asked again.

## State of the recorded data

| File | State |
|---|---|
| `results/signals/judgebench.json` | complete, split v2: 250 practice pairs (68 core, 182 ext). Main experts (s1p, s1pr, s1r, s1cf, route, ref, s2v, s2l, length, first) on all; adv, debate, s2h on the core only |
| `results/signals/mmeval.json` | complete, split v2: 300 pairs (45 core, 255 ext), same expert coverage. The recorded ledger baseline covers only the pairs whose `_meta.baselines` holds `ledger` |
| `results/signals/writing.json` | complete, split v2: 300 pairs (50 core, 250 ext), same expert coverage. One pair (`07ca2300...`) has no System-1 answer: the gateway answers HTTP 403 to it on every submission |
| `recordings/jev.jsonl`, `recordings/luna.jsonl` | complete for the above; `python3 -m moj.collect --offline --experts s1p,s1pr,s1r,s1cf,route,ref,s2v,s2l,length,first` replays them |

Each signal file maps a pair id to `{<expert>: {pA, detail, calls, usd, seconds}, _meta: {label, half, split, group, language, baselines}}`.

## Pointwise benchmarks (appended)

`moj/pointwise.py` is the pointwise adapter: `python3 -m moj.pointwise collect|tune|score|board`. Its experts are in
`POINT_CATALOGUE` (end of `moj/experts.py`), its benchmarks in `POINT_BENCHES` (end of `moj/benches.py`), its clients in
`moj/clients_s2.py` (System 1, gpt-6-luna, gemini-3.8-flash, Haiku through the local CLI), its noise floor in `moj/noise.py`.
Recordings are `recordings/pw-*.jsonl`, results are under `results/pointwise/`. `prepare_pointwise.py` builds the data.

| File | Items | What an item carries | `reference` field |
|---|---|---|---|
| `data/rubricbench.json` | 100 DEV pairs | `rows`: the expert rubric questions of the item | none: the rubric rows are the evidence |
| `data/verify.json` | 95 DEV answers | only `question` and the answer in `a` | none. The benchmark gives the judge no reference, source passage or claim: the label says whether the final answer is correct. Upstream publishes a separate `verify_bench_hard_reference.jsonl`; no local harness fetches it and it is not used here |
| `data/hardrows.json` | 96 tuning cases | factuality rows: `reference`. Rubric rows: `rubric` | the expert answer the reply must not contradict (factuality rows only) |

| `data/verify-with-reference.json` | the same 95 DEV answers | `reference`: the upstream reference solution of the question | the reference text of the benchmark's reference-guided mode. A separate entry (`verify-with-reference`) with its own content class and its own halves, left out of tuning, so a reference-guided score is never mixed with a reference-free one |

What the upstream reference file is, from the benchmark's own README (https://github.com/cjj826/LongJudgeBench, read 2026-10-13):
"Reference files (`{dataset}_reference.jsonl`) contain ground-truth reference texts used by the reference prompt mode." and, in
its list of prompt variants, "`reference`: Reference article provided for scoring". It also reports "Reference mode improves
accuracy on verify_bench_hard (70.9% → 82.3%)". So the reference is an input the judge may see in the reference mode, and it is
hidden in the vanilla mode: `data/verify.json` is the vanilla mode. Only rows whose id is a DEV id were read from that file.
Recorded baselines are not carried to the reference-guided entry: they were recorded without a reference.

Every item has `split_group`, a hash of the shared reference, criterion or question. The tuning and validation halves are
cut on it, so items that share a prompt, a source or a reference stay in the same half.
