# Census scripts

Replay-only tools that rebuild each item's decisions from the recordings, for error analysis. They never call the model.

- `census.ts <bench> <dev|test|all> <out.jsonl>`: one row per item for the contestant named by `CONTESTANT` (default `driftbench-adaptive`), with the route, the reference, each sampled judgement and the game results.
- `replay-test.ts <bench> <split> <sample|0> <contestant,...>`: the same scoring as `run.ts --replay-only`, with missing answers counted as they are in the charts. Use `0` for no sample.
