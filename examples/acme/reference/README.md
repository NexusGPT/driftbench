# The Acme reference set

User turns per cell of the approved Acme map, built through path (ii) of the reference set intake: no past
conversation exists for this fictional agent, so a fictional owner answered the interview and the turns were
generated from the answers. Nothing here counts until a person approves it.

| File | What it is |
|---|---|
| `answers.yaml` | the owner's interview: three personas, the share of each flow, example messages per stage, what users never do, tone, languages and channels |
| `recorded.yaml` | the reference writer's answers, one per cell, written by hand by the intake lane under the writer's contract because no model key was set |
| `reference.yaml` | the set: 53 turns in 20 cells, each with its cell and the answer it came from; the cells with their weights; refused turns and dropped cells |
| `approval.yaml` | one entry per turn, `approved: false`, the text repeated for the reader |

## How it was made

```sh
pnpm driftbench intake interview --map examples/acme/map/approved.yaml --out questions.yaml
# the owner answers questions.yaml; here, answers.yaml
pnpm driftbench intake from-interview examples/acme/reference/answers.yaml \
  --map examples/acme/map/approved.yaml --out examples/acme/reference \
  --replay examples/acme/reference/recorded.yaml --turns 30 --force
```

* Code read the answers against the approved map: every stage, flow, channel and persona value is an
  approved value of the map, and every share is answered.
* Code enumerated the cells: one per example entry, language and channel of its persona, minus the cells a
  map constraint forbids (none here: each persona's map values already agree with its flows). 20 cells.
* Code weighed each cell by the declared shares (persona, flow, language, channel, split over the stages
  the owner gave examples for) and allocated 30 written turns by largest remainder, at least one per cell:
  34 requested.
* The owner's 19 example messages entered the set as they are (`origin: interview`). The 34 written turns
  (`origin: model`) passed the checks in code: no speaker label, a known source answer, no real-looking
  personal data, none of the never-match phrases, no copy of an owner example, no near-duplicate in the
  cell. `produced_by.family` is `lane`, so no one mistakes them for a model run.
* `packages/generate/test/intake/acme.test.ts` regenerates both files from the answers and the recording
  and checks they match byte for byte.

## Approving it

```sh
pnpm driftbench intake approve examples/acme/reference/approval.yaml        # lists what is not approved
pnpm driftbench intake approve examples/acme/reference/approval.yaml --all  # approves every turn
```

Then `driftbench intake fidelity --reference examples/acme/reference --candidate <generated turns>`
compares a simulated user with the approved turns.
