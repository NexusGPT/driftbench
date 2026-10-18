# Deciding factual comparison

The owner requests one fresh 60-case run for four procedures: main's shipped judge, PR 115's default, the original frozen candidate, and the default fact template.

`freeze.json` fixes the labels and procedure hashes before any run. Seed 20261056 uses the unchanged construction generator with 30 passing and 30 failing cases. It is selected only for request uniqueness: every procedure has 60 unique prompts and no matches to earlier recordings. No score is used to select the seed. Expected labels, family names and case IDs do not enter prompts.

Main is pinned at `40aab09551e1b8702d576d3f28b63b12848cf572`. Its archived prompt and parser in `main-snapshot.json` match the earlier baseline source. The actual archived modules produce prompts and verdicts. PR 115 is pinned at `c576033232a7643d52a2b8a2d295e26f79a6b26a`, using the default pointwise contract, with only criterion and transcript supplied. Its exact source is in `../arch-deciding-snapshot.json`. No calls use the superseded 5e163e86 commit.

The candidate is the original `../audit.ts` procedure. It is **not yet the shipped default**. The later correction for escaped evidence quotes is excluded. The competing fact template and instructions are verbatim pinned assets from the original comparison.

Each procedure runs once, with two calls in flight at most, on the same shared `claude -p --model haiku` transport. `fact-*.json` holds the verdicts, costs, unscored counts and Wilson intervals. Complete prompts and raw replies remain in `../calls.jsonl`, indexed by `request_sha256`. `recordings.jsonl` collects the four runs when all are complete; `failures.jsonl` collects their wrong and unscored cases.

Free replay, from the repository root:

```sh
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts fact ours --deciding --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts fact arch --deciding --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts fact audit --deciding --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts fact theirs --deciding --replay
```

The source and input hashes must still match the frozen manifest. New paid calls require an explicit cap and a later deadline. These synthetic cases share templates; their confidence intervals describe this set and do not prove general population superiority.
