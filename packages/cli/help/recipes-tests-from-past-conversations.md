---
title: Tests from past conversations
summary: Turn past conversations and production traces into a reference set and draft specs, then generate, gate and select a golden set.
commands:
  - intake logs
  - intake interview
  - intake from-interview
  - intake approve
  - import traces
  - import approve
  - generate
  - gate
  - select
  - campaign run
see_also:
  - core-configuration
  - core-exit-codes
  - recipes-test-a-chat-agent
  - recipes-test-a-code-agent
next:
  - recipes-gate-in-ci
---

## Goal

Your agent already talks to users. You want tests grounded in what users really say and in states production
really reached, and a suite you can trust: blocks that tell a good agent from a broken one, and the fewest
conversations that cover the map of situations.

The chain is:

1. Past conversations become a private, anonymised reference set of user turns (`intake logs`). With no past
   conversations, an interview of the owner builds the same set (`intake interview`, `intake from-interview`).
2. Production traces become draft specs, one block per observed user turn (`import traces`). A person writes
   each expected result and approves the drafts.
3. Code generates candidate specs from the approved map (`generate`).
4. The validity gate keeps only the blocks that can fail on a broken agent (`gate`).
5. `select` chooses the golden set from the gated specs, and a campaign runs it.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* The approved Acme map, `examples/acme/map/approved.yaml`, and its space map,
  `examples/acme/map/space.yaml`. `driftbench help recipes-test-a-chat-agent` shows how a map is proposed and
  approved from a prompt.
* A trace file. The steps use a fictional OpenTelemetry fixture,
  `packages/adapters/test/traces/fixtures/otel-semconv.json`: one conversation with the Acme assistant, two
  turns. `import traces` also reads Nexus platform traces (`--from nexus`) and recorded Claude Code sessions
  (`--from claude-code`).
* The planted faults the gate runs each block against: `examples/acme/faults`.
* Every command in a `sh` block runs with no model and no key and writes only to new paths in the folder you
  run it in. Two commands are shown as text: one reads a private log file the example does not ship, one calls
  a paid model.

## Steps

### 1. Build the reference set from past conversations

The reference set holds real user turns, each with its intent, so a simulated user can later be compared with
real users.

`intake logs` reads one conversation per line of a JSON Lines file: `id`, `turns` of `{role, text}`, and
optional `flags`, `channel` and `lang`. The flags `negative_feedback`, `incident`, `error`, `escalation` and
`complaint` mark a failure. Past conversations never enter a repository: the command refuses an output folder
inside a git work tree and writes nothing. The Acme example ships no log file for that reason, so this step is
text. On five fictional conversations, written to a private folder:

```text
driftbench intake logs "$PRIVATE/conversations.jsonl" --out "$PRIVATE/set" --map examples/acme/map/approved.yaml
```

```text
Wrote the private set to .../private/set: conversations.jsonl, reference-turns.jsonl, spot-check.yaml, intake-report.json.
  Conversations: 5 read, 0 near-duplicates dropped, 5 kept, 2 flagged as failures.
  Pass 1 (rules and checksums): 4 redacted: address 1, email 1, phone 2; 3 of them reserved fictional data.
  Pass 2 (independent rules): 0 more redacted: none.
  Residual flags: 0 conversations where the second pass found what pass 1 missed.
  Intents on flow: 5 seen, 3 from the map and 2 new.
  Discovery (Good-Turing f1 / n): f1 = 5, f2 = 0, n = 5. The chance that the next conversation shows an intent not seen yet is about 100 percent; sample coverage (Chao) about 0 percent.
  Spot check: 5 conversations drawn with seed 1; read spot-check.yaml and set clean on each.
```

* Pass 1 redacts emails, IBANs, national numbers, card numbers, phones and street addresses; each value
  becomes a placeholder such as `[EMAIL_1]`. Pass 2 (`--second-pass rules|model|both`, default `rules`)
  looks again; what it finds is a residual flag, a miss of pass 1. `model` and `both` call a paid model.
* With `--map`, each opening takes the closest intent of the map (`--intent-dimension`, default `flow`), or
  forms a new one.
* The discovery line estimates the chance that the next conversation shows an intent not seen yet: high means
  collect more conversations.
* Read `spot-check.yaml` and set `clean` on each sampled conversation. No raw text and no detected value is in
  any file or in the printed report.

### 2. No past conversations: interview the owner instead

The interview path builds the same kind of set from the owner's answers.

```sh
driftbench intake interview --map examples/acme/map/approved.yaml --out questions.yaml
```

```text
Wrote questions.yaml: the interview for acme. Answer every question in place, then run driftbench intake from-interview questions.yaml --map examples/acme/map/approved.yaml --out <folder>.
```

The owner answers in place: personas and their shares, the share of each intent, example messages per stage,
what users never do, tone, languages and channels. Writing the turns from the answers calls a paid model, one
call per cell, with `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`, read from a file:

```text
ANTHROPIC_API_KEY="$(cat ~/.secrets/anthropic.key)" driftbench intake from-interview questions.yaml \
  --map examples/acme/map/approved.yaml --out reference --turns 30
```

`--dry-run` prints the cells, their weights and the turns to request, and calls no model. The Acme example
ships a fictional owner's answers (`examples/acme/reference/answers.yaml`) and recorded writer answers
(`examples/acme/reference/recorded.yaml`); `--replay` plays them back through the same checks:

```sh
driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml \
  --out reference --replay examples/acme/reference/recorded.yaml --turns 30
driftbench intake approve reference/approval.yaml --all
```

```text
Wrote reference/reference.yaml and reference/approval.yaml: 53 turns (19 from the owner's examples, 34 from lane claude-opus-5-5 as the intake lane, by hand) in 20 cells, none approved.
  Model calls: 20. Turns refused by the checks: 0.
Next: read approval.yaml and set approved: true on the turns you accept, or run driftbench intake approve reference/approval.yaml --all.

Approved 53 turns in reference/approval.yaml; 0 were already approved.
```

Every written turn passed checks in code: no speaker label, a known source answer, no real-looking personal
data, no phrase the owner said users never use, no copy of an owner example, no near-duplicate in its cell.
`intake approve` without `--all` lists the turns not approved yet. `driftbench intake fidelity --reference
reference --candidate <turns>` later compares generated user turns with the approved ones.

### 3. Draft specs from production traces

Each traced conversation becomes a draft spec: each observed user turn is a block, and its Given is what
production observed before it (the earlier messages, the agent's replies, its tool calls with their results).

```sh
driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out drafts
driftbench import approve drafts
```

```text
Read 1 trace from 1 file (otel): 2 turns.
Wrote 1 draft spec to drafts, none approved: 2 blocks, no expect yet.
  Personal data redacted: 3 values.
Next: write each block's expect from the agent spec, then driftbench import approve drafts --all.

1 of 1 drafts are not approved yet:
  drafts/draft-otel-conv-acme-0001.yaml
```

The draft, `drafts/draft-otel-conv-acme-0001.yaml`:

```text
blocks:
  - user: Hi, do you have home internet at [ADDRESS_1], Acmeville?
  - user: Yes please, how much is it per month?
    given:
      prefix:
        - role: user
          content: Hi, do you have home internet at [ADDRESS_1], Acmeville?
        - role: assistant
          content: "Yes: Acme Fiber 300 is available at [ADDRESS_1]. Do you want the plan details?"
          tool_calls:
            - id: call_cov_1
              label: coverage.check
              ...
      origin: recorded
metadata:
  imported:
    approved: false
    ...
    observed:
      - block: 0
        reply: "Yes: Acme Fiber 300 is available at [ADDRESS_1]. Do you want the plan details?"
        ...
```

No block has an `expect`: one copied from the observed reply would pass by construction. A person writes each
expect from the agent's spec, never from `metadata.imported.observed`, then runs
`driftbench import approve drafts --all`. Personal data is redacted by default; `--no-redact` keeps it.
`--select <ids>` drafts only the named traces, and `--dataset <name> --store <file>` pushes the drafts as the
next version of a dataset.

### 4. See why a draft is not a test yet

The gate rejects a block whose Then holds no machine check. A draft without an expect is such a block:

```sh
driftbench gate drafts --reference function:acme-sales --faults examples/acme/faults --out gated-drafts --date 2026-10-14  # exit 1
```

```text
Note: ops-x1-wrong-price, ops-x4-narrates, ops-x5-skips-check, ops-d6-deletes-readme, control-ops-identity wrap a target that is not a --reference; they do not run.
Funnel (blocks):
  1. observed     in    2  rejected 2      out    0  (no-machine-then 2)
...
Accepted 0 of 2 blocks.
```

Exit 1 means no block was accepted. Once each block has an expect written from the agent's spec, run the gate
on the drafts again. The note says the faults of the ops agent did not run, since only the sales agent is a
reference here.

### 5. Generate candidates from the approved map

The map gives what the traces cannot: every allowed combination of situations, each with a Then derived by
code from the approved relations.

```sh
driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2  # exit 1
```

```text
...
Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
...
Wrote 504 files to generated.
```

Exit 1 means some specs went to `generated/incomplete/`, with the reasons in `generate-report.json`. The
complete ones are in `generated/specs/<seeder>/`.

### 6. Gate the candidates

The gate passes every block through nine stages: observed, leakage, shortcut, contrast, red_first, stability,
difficulty, label_audit, freshness. A block passes only if it reads observed state, does not leak its answer
into the Given or the When, is not passed by a trivial agent, passes on the reference agent and turns red on
at least one planted fault, and does not flip between repeats.

```sh
driftbench gate generated/specs/graph --reference function:acme-sales --faults examples/acme/faults \
  --origin examples/acme/specs --date 2026-10-14 --out gated
```

```text
Funnel (blocks):
  1. observed     in   48  rejected 0      out   48
  ...
  5. red_first    in   48  rejected 0      out   48
  6. stability    in   48  rejected 0      out   48
  ...
  8. label_audit  in   48  marked 3        out   48  (sampled 3)
  9. freshness    in   48  marked 7        out   48  (sealed-holdout 7)
Accepted 48 of 48 blocks.
Mutation score per fault class (gated suite):
  X1_local: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  ...
  control: 2 negative control(s), green
Wrote 16 files to gated.
```

* `gated/specs/` holds the gated specs: run a campaign on this folder, not on `gated/`.
* `gated/holdout/` holds specs sealed for one later scoring, listed with their hashes in `seal.json`
  (`--holdout`, default 0.2 of the specs).
* `gated/review.yaml` lists blocks that flip across `--k` repeats (default 5), for a person to decide;
  `gated/label-audit.yaml` holds a seeded sample (`--audit`, default 3 per family) for a person to read.
* `gated/gate-report.json` holds the funnel, the mutation score per fault class, and each stage's verdict for
  every block. A fault that changes no observed field of these specs is equivalent and left out of the score.
* `--origin` names the specs the candidates came from, for the 13-gram overlap check. `--route
  flow:price-sheet=process:acme-ops` with `--reference process:acme-ops` sends task specs to the code agent.

### 7. Select the golden set

`select` takes the gated specs no seal lists, finds the fewest that cover every allowed pair of the map, and
with `--k` keeps the k best: most required cells first, then most faults turned red, then most cells.

```sh
driftbench select --cover examples/acme/map/space.yaml --specs gated --out golden-graph  # exit 1
```

```text
Golden set for map acme, version 1: cells on every subset of 2 dimensions (708 allowed pairs).
Pool: 10 unsealed specs; 2 sealed specs left out; 2 gate files that are not specs skipped.
Cover: 10 conversations cover every cell the pool covers (253 of 708).
...
Required cells: 5 of 10; the pool covers 5.
  ✗ flow new-home · D8_tool_failure: no unsealed spec covers it
  ...
Wrote 11 files to golden-graph.
```

Exit 1: the graph specs alone leave five required cells uncovered. The committed gate output of every Acme
candidate, `examples/acme/gated`, covers them all:

```sh
driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --k 10 --out golden
```

```text
Pool: 200 unsealed specs; 58 sealed specs left out; 4 gate files that are not specs skipped.
Cover: 106 conversations cover every cell the pool covers (598 of 708).
k = 10 is smaller than the cover: the golden set is the 10 best, ranked by required cells, then faults turned red, then cells.
...
Cells covered: 306 of 708 allowed pairs (43.2%); the pool covers 598.
  t = 3: 794 of 4064 allowed (19.5%).
Required cells: 10 of 10; the pool covers 10.
Faults turned red: 12 of the 13 the pool turns red (13 counted faults in the gate report).
Wrote 11 files to golden.
```

`golden/specs/` holds the chosen specs, copied unchanged; `golden/golden.json` the rule, the pool, the full
cover in pick order, and what each golden spec adds. `--t` sets the cell strength (default 2, pairs).

### 8. Run the golden set

```sh
driftbench campaign run golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --store golden.db
```

```text
...
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
```

`--route` keeps the price-sheet task spec among the ten on the code agent while the rest run on the sales
assistant.

## What you have at the end

* A private reference set from past conversations (outside any repository), or `reference/` from the owner
  interview, approved.
* `drafts/`: draft specs from production traces, waiting for their expects and approval.
* `generated/`: the candidate suite; `gated/`: the blocks that passed the gate, the sealed holdout and the
  gate report.
* `golden/`: ten specs covering every required cell and 12 of 13 planted faults, and `golden.db` with their
  passing campaign.

## When a step fails

* `Refused: <folder> is inside the git work tree ...` (exit 2) from `intake logs`: choose an output folder
  outside any git work tree.
* `intake logs` exits 1: the model check of pass 2 failed on a conversation.
* `intake from-interview` exits 2 on incomplete answers or a value the map does not approve; exit 1 when the set
  is written with a failed or short cell. Without a key and without `--replay`, run it with `--dry-run`.
* `import traces` exits 2 on an existing draft without `--force`, on an id in `--select` that names no trace,
  or on `--dataset` without `--store`; nothing is written.
* `gate` exits 1: no block was accepted. Read the funnel: `no-machine-then` means the Then holds no machine
  check; `passed-by-echo` or `passed-by-constant` means a trivial agent passes it; `not-green-on-reference`
  means the reference agent fails it. Each block's verdicts are in `gate-report.json`.
* `generate` exits 1: specs went to `incomplete/`; the report names why.
* `select` exits 1: a required cell has no unsealed spec. Generate or write a spec for it, gate it, then select
  again with `--force` into the same folder.
