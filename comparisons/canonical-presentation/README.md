# Canonical presentation: free historical replay

`judgePairwise(..., { presentation: 'canonical' })` presents candidates in ascending
SHA-256 order of their raw UTF-8 content. It maps the result back to the caller's
`first` or `second` candidate. The default still judges both orders.

This replay exercises the public API with historical RubricBench responses. It
makes **zero model calls and zero candidate-code executions**. The recorded cost
figures describe the historical runs, not a charge for running this script.

## Reproduce

Run from the repository root with dependencies installed:

```sh
# Obtain the historical git objects if they are not already present.
git fetch origin codex/rb-judge

# Download public dataset pages into the ignored cache, then replay.
pnpm exec tsx tools/benchmarks/canonical-replay.ts --download

# Subsequent runs require no network and verify the committed report byte for byte.
pnpm exec tsx tools/benchmarks/canonical-replay.ts --check
```

Without `--download`, a missing dataset page is an error. A missing recording,
execution observation, source boundary, or changed dev dataset also stops the
replay. The script has no model-provider or candidate-executor fallback.

The historical source is pinned to
`8c1d1ca707d6505028a4e0db80c937dd6cfaef71`, originally
`origin/codex/rb-judge`. Moving that branch does not change the selected source.
The report records hashes of each historical input and the current pairwise
implementation. An implementation change requires regenerating the report before
`--check` can pass.

The public import `@agent-nexus/driftbench-judges` resolves through the repository's
TypeScript alias to `packages/judges/src/index.ts` under `tsx`. It does not use an
installed release or a copied package build.

## Results

The complete population is **357 development pairs**, selected from 1,147 public
RubricBench rows by `SHA256('split:rubricbench:' + id)[0] < 77`.

The benefit is **one primary judgement per pair instead of two**. When the same
recorded judgement serves both caller orders, its cost is counted once.

| Historical procedure | Unique recorded calls | Historical cost |
| --- | ---: | ---: |
| Atomic binary, canonical, recorded execution evidence | 357 | $0.59679915 |
| Adaptive, both orders, three samples per order | 2,586 | $2.34737535 |

Of the 357 canonical recordings, **344 (96.36%) are non-tie judgements** and 13
are ties. Each judgement is reused for both caller orders. Reversing the caller
inputs checks the mapping of that same recorded judgement. The 96.36% figure
counts non-tie reused judgements; it does not measure consistency.

The API exposes the recorded `outcome` and `aIsFirst` mapping. It does not invent
an unmeasured swapped outcome or position-bias diagnostic.

The cost ratio is **25.424%**, but it compares different procedures. The adaptive
procedure uses 357 routing calls, 87 reference calls and 2,142 judgment samples.
Atomic execution evidence also changes the inputs. These figures do not show
that canonical ordering alone cuts costs to a quarter.

A separate synthetic public-API probe verifies **one canonical primary call
versus two default primary calls**. That is a halving of primary calls, with no
quality conclusion. Malformed-answer retries and other optional behavior can
change total calls or token costs.

## Same-procedure recorded subset

An opportunistic **8/357 subset** has both raw orders of the same atomic prompt
recorded without execution evidence. Both API options replay those exact prompt
keys with the same historical binary aggregation. No population inference is
supported by this availability-selected subset.

| API option | Measured result | Unique raw calls | Historical cost |
| --- | --- | ---: | ---: |
| Default both orders | 7 consistent; 1 position-bias flag; 1 final tie | 16 | $0.02840305 |
| Canonical | 8/8 identity mappings preserved; 8 decisive; 0 ties | 8 | $0.01384448 |

The canonical comparison reuses one of each pair's two raw recordings. Each pair
is also submitted with its caller order reversed to verify the same request and
winning content. Those validation repeats produce 16 canonical API invocations
and 16 adapter calls, but only eight unique historical observations. Default
mode uses eight API invocations and 16 adapter calls. Neither option incurred a
new model charge. All selected raw outputs parse; canonical outputs also match
the expected rubric counts.

The default's position-bias flag exposes disagreement between presentations.
Canonical removes that measurement; its eight decisive results do not establish
better quality. The full 357-pair historical results above remain separate.

## What is verified

- Each canonical request reconstructs the exact historical atomic system and
  user prompts. Recording keys are
  `SHA256(JSON.stringify(['haiku', system, user])).slice(0, 20)`.
- All five committed RubricBench recording shards load in order, with the last
  occurrence of a key winning. Contestant labels do not filter canonical lookup:
  different procedures can share the same prompt key.
- Pure historical prompt, parser, binary aggregation and rubric routines are
  extracted from the pinned git objects into the ignored cache. The historical
  model caller and candidate executor are never imported.
- Execution observations come only from the committed journal. Their full key
  binds `['code-evidence-v6', question, a, b]`; the historical prefix and JSON
  serialization are preserved. Missing observations stop the run.
- Both original caller orders pass through today's `judgePairwise` API. The
  replay asserts identical canonical requests, hash ordering, one adapter call
  per invocation, and identical winning content after identity mapping.
- Historical cost counts each recording key once, although the invariance test
  invokes the API twice per pair. Every canonical mapped result is checked
  against the committed audit. Aggregate outcome counts, cost and call
  counts are checked against the historical reports.

## Limits

- The adapter replaces today's prompt with the historical atomic prompt. This
  tests current orchestration, ordering and mapping, **not current prompt
  quality**, fresh model behavior or held-out generalization. The old procedures
  were tuned on this development split.
- The historical atomic outputs include **three invalid parses and three
  rubric-count mismatches**. The replay reports them and preserves historical
  scoring, including its tie fallback. It does not relabel them as valid outputs.
- Adaptive samples use the pinned historical parser and majority vote for each
  order. Their selection validates item, model, contestant, route/reference and
  sample metadata. Their exact historical prompt keys are not reconstructed.
  There are 31 invalid sample parses under that historical parser.
- Only **8/357** dev pairs have both raw orders of the same atomic prompt without
  execution evidence recorded. This is insufficient for a full-population,
  same-procedure comparison. No missing responses are generated or imputed.
- Recorded code observations can include incomplete environments or unsupported
  snippets. Reusing them is not proof that the candidates are correct or safe.
- Dataset rows are downloaded from the public
  [RubricBench rows endpoint](https://datasets-server.huggingface.co/rows?dataset=DonJoey/rubricbench&config=default&split=train)
  into `.cache/canonical-replay` only. No rows are committed; this replay does
  not establish redistribution rights. Dev IDs and normalized dev content have
  pinned SHA-256 digests to detect source drift.

The machine-readable evidence is [replay.json](replay.json); the executable is
[canonical-replay.ts](../../tools/benchmarks/canonical-replay.ts).
