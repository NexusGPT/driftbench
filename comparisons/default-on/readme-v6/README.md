# Frozen default on the README benchmarks

The frozen product default `default-on-v6` (source `779f6e9d3973e43bcb83e2a4b84a31f277900b5e`, runtime freeze `7d3d8fece5a57d3a929930efc68343b89f14efe37a38e1b7b87d54dc8b2c0f02`) ran unchanged on Claude Haiku 5.5 through the Anthropic Messages API over 2,054 items: JudgeBench 270, MM-Eval 600, RubricBench 790, LongJudgeBench verify 221 and writing 173. Only the default made new calls. Competitor answers are the recorded runs in `examples/all-peers-public`, scored again here; they are unverified historical (lane report).

- `RESULTS.md`: the 25 exact paired tests against every recorded peer, with Holm correction.
- `results.json`: scores, comparisons, metadata and the hashes of every consumed source.
- `outcomes.json`: one public outcome per item.
- `receipt-provenance.json`: physical call identities, costs and response hashes. Full inputs and raw provider responses stay local.

Recompute without network access from the repository root:

```
python3 comparisons/default-on/readme-v6/RECOMPUTE.py comparisons/default-on/readme-v6 --repo .
```

The chart inputs are `docs/assets/data/default-on-v6/*.json`.
