# Rerun less

After you edit your agent, you want to know if you broke something. Running every test again is slow, and with a real model it costs money. Most tests cannot be affected by one edit. This part shows how to find the tests that can, run only those, and keep the earlier result of the others. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for.

The examples use the Acme Telecom suite in `examples/acme`: 195 tests and 861 scored blocks. All data is fictional. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.

## Words used in this part

| Word | Plain meaning | Example |
|---|---|---|
| Block | One message from the user and what must be true after the agent's answer. | The user asks for a refund, and the answer must ask for an order number. |
| Cell | One test, run once, on one target, in one mode. A cell reruns whole, from its first block. | `gen-twise-003` in mode F. |
| Change file | A small file that names what you changed: a stage, a tool, a rule. | `stage-recap.yaml`. |
| Blast radius | The blocks that a change can affect. The rest cannot see it. | 22 of 861 blocks. |
| Direct, forward | A direct block names the change. A forward block comes after a direct block in the same conversation, so it inherits the agent's earlier answers. | 9 direct, 13 forward. |
| Agent version | A label for the agent that produced a run. | `acme-v1`. |
| Carry | Copy the stored result of a cell outside the radius into the new campaign, with no run. | `pass (carried from c-base)`. |
| Audit | A check of the radius: run a sample of the cells you would carry, and compare with the stored result. | `20 cells ... 0 misses`. |
| Cache | Answers of earlier runs, kept in the store. The same input reads them and does not call the agent. | `pass (replayed from the cache)`. |
| Dataset | A folder of tests kept in the store as numbered, unchangeable versions. | `acme-specs@1`. |
| Ledger id | An id of one sentence of your prompt. It stays the same when you edit the sentence. | `wrl4c7wlvb`. |

## 1. Know what rerunning less can save

**Why you do this.** Before you set up anything, see the size of the saving. It depends on the change. A change to one handler saves a lot. A change to a rule that holds everywhere saves nothing.

**What you need.** Nothing yet. The table below comes from the commands of steps 3 and 4. It is the Acme suite in mode F, which runs each conversation on the agent's own earlier answers.

| Change | Blocks in the radius | Blocks sent when each cell reruns whole | Saved |
|---|---|---|---|
| The handler of deviation D2 (a change of goal) | 22 of 861 | 55 | 93.6% |
| The input of the tool `coverage.check` | 316 of 861 | 413 | 52.0% |
| The recap stage | 298 of 861 | 601 | 30.2% |
| The reply language rule, which holds on every block | 861 of 861 | 861 | 0% |

**How to read it.**

- A smaller radius saves more. The saving is the share of blocks you do not send to the agent. It is also the share of agent calls, and of their cost, that you do not pay.
- The two columns of blocks differ because a cell reruns whole. A cell with one block in the radius reruns all its blocks. Step 3 explains this.
- A rule that holds on every block gives a radius equal to the suite. Nothing is carried, and the command says so.
- The full Acme suite also holds 24 task tests. There, the radius campaign of the recap change sends 606 of 867 blocks and carries 93 cells. The test `packages/cli/test/radius-carry.test.ts` runs it. The 867 counts 6 blocks that the gate does not score. This guide does not rerun it.

## 2. Write the change file

**Why you do this.** driftbench needs to know what you changed. You tell it in a small file. It never guesses from your agent.

**What you need.** The agent before and after, as two labels, and the list of changes between them. This is the manifest of the recap stage:

```console
$ cat examples/acme/radius/stage-recap.yaml
# A change manifest for driftbench radius. Fictional data only.
# The recap stage changed: what it says, or when the agent reaches it.
from: acme-v1
to: acme-v2
changes:
  - kind: stage
    id: recap
```

- `from` and `to` are the agent versions before and after.
- Each change has a `kind`, an `id` and, for a tool, a `part`. The kinds you will use most are `stage`, `tool`, `rule`, `deviation`, `prompt`, `model` and `fixture`.
- A tool change says which part changed. `input` reaches the blocks that call the tool or check its input. `description` and `presence` reach every block that lists the tool, even one that must not call it. A new description can make the agent call it.
- A change that cannot be mapped, such as `model`, or a change with `global: true`, is the whole suite.

Every field is in the [change manifest reference](../reference/change.md). The Acme folder `examples/acme/radius` holds 14 manifests, one for each kind of change.

**If it goes wrong.**

- A manifest with no change between two different versions is the whole suite. List at least one change.
- A change that no block declares is also the whole suite. Driftbench does not know which block the new tool or the new stage can reach.

## 3. Compute the blast radius

**Why you do this.** The radius lists the blocks a change can affect. It runs nothing and writes nothing, so it is free.

**What you need.** The folder of tests, and the change file from step 2.

**Relevant commands.**

- `driftbench radius`: reads the tests and the change file, and lists the blocks the change can reach · `examples/acme/gated/specs` is the folder of tests; `--change examples/acme/radius/deviation-goal-shift.yaml` is the change file; `--mode` (not used here) picks the run modes to plan for, `F` by default · it prints the counts and the list of tests. It exits 0 when the radius is smaller than the suite, 1 when it is the whole suite, and 2 on bad input.

**You type.** First a small change, the handler of deviation D2:

```console
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
In the radius, mode F:
  spec           blocks in  from              why
  gen-twise-003  3 of 6     b4-D2_goal_shift  deviation:D2
  gen-twise-014  3 of 6     b4-D2_goal_shift  deviation:D2
```

**How to read it.**

- `manifest a393cc307eff` is a short id of the change file. `deviation:D2` is the change, as the radius read it.
- `22 of 861 blocks in the radius (9 direct, 13 forward)`: 9 blocks inject a D2 deviation. 13 more come after them in the same conversation, so the agent's earlier answers reach them.
- `A cell reruns whole`: a cell is a whole conversation. If one block of a cell is in the radius, all its blocks run again. That is why 55 blocks are sent, not 22. The saving is 93.6%.
- `186 of 195 cells left to carry`: those cells keep their last result (step 4).
- Each row of the list is one test: how many of its blocks are in the radius, the block the change enters from, and why.

A larger change, and the one that reaches everything:

```console
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
Mode F, free-running: 298 of 861 blocks in the radius (233 direct, 65 forward), 563 out. 102 of 195 cells.
  A cell reruns whole: 601 of 861 blocks sent, 30.2% saved; 93 of 195 cells left to carry.
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/tool-coverage-check-input.yaml
Blast radius of acme-v1 to acme-v2 (manifest c09d178d893f): tool:coverage.check:input.
Mode F, free-running: 316 of 861 blocks in the radius (86 direct, 230 forward), 545 out. 86 of 195 cells.
  A cell reruns whole: 413 of 861 blocks sent, 52.0% saved; 109 of 195 cells left to carry.
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/reply-language.yaml   # exit 1
Blast radius of acme-v1 to acme-v2 (manifest 0bf51ed76989): rule:reply_language.
The radius is the whole suite: rule:reply_language: the reply language rule holds on every block. Nothing can be carried.
```

- The recap stage is reached by 102 of 195 cells. The agent passes through it in many conversations.
- 86 blocks expect a call of `coverage.check` or check its input. Their conversations run on, so 230 more blocks are forward. The saving is 52.0%.
- The reply language rule holds on every block. The radius is the whole suite and the command exits 1. Nothing can be carried.

**If it goes wrong.**

- `The radius is the whole suite` for a change that should be small: the change file names something the radius cannot map, or no block declares it. Change the `kind` or the `id`, or accept that this edit needs a full run.
- Exit 2: the change file or a folder cannot be read. Check the paths.
- A block with unknown dependencies is in every radius. This is a hand-written test with no generator record and no `metadata.depends`. To keep it out of unrelated radii, declare what it depends on, as the [blast radius](../concepts/blast-radius.md#what-a-block-depends-on) page shows.

## 4. Run the radius and carry the rest

**Why you do this.** The radius is only a list. This step runs it: the cells in the radius run on the new agent, and the stored results of the other cells are copied into the new campaign. You keep one full set of results and pay for a part.

**What you need.** A first campaign that ran the whole suite on the old agent, and kept in a store. The agent version is a label you choose. It must be the `from` of the change file.

**Relevant commands.**

- `driftbench campaign run` (the baseline): runs the whole suite on the old agent and keeps it · the six folders are the conversations of the Acme suite; `--target function:acme-sales` is the Acme sales assistant; `--agent-version acme-v1` labels the agent, so a later run knows which agent produced each result; `--campaign c-base` names the campaign; `--store acme.db` is the file that keeps it · it prints one line per cell.
- `driftbench campaign run --change ... --from c-base` (the new agent): runs the radius and carries the rest · `--agent-version acme-v2` is the new label, the `to` of the change file; `--change` is the change file; `--from c-base` is the campaign the carried results are read from; `--audit 20` runs 20 of the cells it would carry and compares them with their stored result (step 5); `--campaign c-v2` and `--store acme.db` as before · it prints the radius, the audit, one line per cell and the saving.
- `driftbench campaign status`: reads the new campaign back · `c-v2` is the campaign; `--store acme.db` the file · it prints the cells with a mark on each carried cell, and the count.

**You type.**

```console
$ driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v1 --campaign c-base --store acme.db
171 cells: 171 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v2 --campaign c-v2 --store acme.db --change examples/acme/radius/deviation-goal-shift.yaml --from c-base --audit 20
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
Audit: 20 cells drawn from the 162 outside the radius (seed 1) and run fresh: 0 misses. At 95% confidence, under 13.9% of the carried cells would disagree.
9 of 171 cells in the radius. 29 cells run fresh, 142 carried from c-base.
  20 cells outside the radius run fresh: drawn for the audit.
✓ gen-boundary-063 · function:acme-sales · F · repeat 0  pass (carried from c-base, age 1 campaign)  5 blocks
✓ gen-twise-003 · function:acme-sales · F · repeat 0  pass  6 blocks
171 cells: 171 pass, 0 fail, 0 failed, 20 reused, 142 carried. Spent $0.00.
Fresh: 29 cells, 160 blocks sent to the agent. Carried from c-base: 142 cells, 672 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 672 of 832 blocks, 80.8%. The pass and fail counts above merge fresh and carried results.
$ driftbench campaign status c-v2 --store acme.db
✓ gen-boundary-063 · function:acme-sales · F · repeat 0  pass (carried from c-base, age 1 campaign)  5 blocks
171 cells: 171 pass, 0 fail, 0 failed, 142 carried. Spent $0.00.
```

The output is trimmed to the lines that matter. The Acme agents here are the correct ones, so every cell passes. No agent changed: this shows the mechanics, with no model call.

**How to read it.**

- `9 of 171 cells in the radius. 29 cells run fresh, 142 carried`: the 9 cells of the radius ran, plus 20 audit cells. The other 142 cells were copied.
- `pass (carried from c-base, age 1 campaign)`: this result was not measured on the new agent. It is the stored result of `acme-v1`, copied.
- `Fresh: 29 cells, 160 blocks sent`: this is what the agent really received. `Carried ... 672 blocks not sent` is what you saved.
- `Saved: 672 of 832 blocks, 80.8%`: 832 is every block of the 171 cells. The counts of pass and fail merge fresh and carried results, and the line says so.
- A carried result is one old measure. Two limits bring it back into the run: `--max-carry <n>` (the most campaigns in a row a result is carried, default 5) and `--max-age <days>` (the most days since it was measured, default 7). Run the whole suite on a schedule, such as every night, so every result is fresh again.
- A carried cell is not a new sample of the new agent. `compare` and `ci --change` pair only fresh cells, so a carried cell never narrows an interval.

**If it goes wrong.**

- Nothing is carried and every cell runs. The cause is one of four: the campaign has no `--agent-version`; the version is not the `to` of the change file; the `--from` campaign holds no run of the `from` version; the radius is the whole suite. The first lines of the output say which.
- A cell outside the radius runs fresh: the `--from` campaign holds no finished run of it, or the run was made on another agent version.
- A carry needs `--from`, `--store` and an agent version. Without the store file of the baseline, there is nothing to carry from.
- The id is refused: a store never takes two campaigns with one id. Pick a new `--campaign` value.

## 5. Check the radius with an audit

**Why you do this.** The radius is right only if your change file lists every change. A cell you carry may hide a change you forgot. The audit tests that claim on a sample, before anything is carried.

**What you need.** The command of step 4, with `--audit <n>`. It draws `n` of the cells about to be carried, runs them fresh, and compares each with its stored result: the status, every gating check of every block, and the end state. `--audit-seed <n>` changes the draw (default 1).

**How to read it.**

- `0 misses` in step 4: none of the 20 cells differed. At 95% confidence, fewer than 13.9% of the carried cells would disagree. The bound is `1 - 0.05^(1/n)`: under 13.9% for 20 audits, under 5% for 59.
- One cell that differs is a **radius miss**: the change reaches a block the change file left out. The gate fails closed. Nothing is carried, every cell runs, the output names the cell and what differed, and the command exits 1. The output then reads `RADIUS MISS: the change reaches cells the manifest left out of the radius. The gate fails closed.`
- The [blast radius](../concepts/blast-radius.md#the-audit-sample) page shows it on an agent that orders on a loose "yes". Its change file names only the D4 handler.
- The audited cells are fresh runs of the campaign, listed as `drawn for the audit`.
- An audit is a sample. If the missed change touches 11 of the 157 cells outside the radius, 20 audits find it about four times in five. A full run on a schedule finds the rest.

**If it goes wrong.**

- `RADIUS MISS` and exit 1: every cell has already run, so you hold a full result. Add the missing change to the change file before the next carry.
- The audit costs fresh runs. With a real model, size `--audit` against the saving, and plan first with `campaign plan`, as in [Run your agent](run-your-agent.md).

## 6. Use the cache and replay

**Why you do this.** The cache and the carry both avoid a run, in different cases. The carry skips cells outside the radius of a change. The cache replays a run whose input is exactly the same.

**What you need.** A store. The store is the cache.

**Relevant commands.**

- `driftbench campaign run --repeats 2 --store cache.db`: runs the Acme conversations twice each and keeps the runs and the answers · `--repeats 2` runs each test twice; `--store cache.db` is the file; `--campaign cache-1` names the campaign · it prints one line per cell.
- The same command under `--campaign cache-2` replays every run from the cache.
- The same command with `--no-cache` neither reads nor writes the cache, so the agent is called again.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --campaign cache-1 --store cache.db
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --campaign cache-2 --store cache.db
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --campaign cache-3 --store cache.db --no-cache
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

The output is trimmed to the first cell and the count.

**How to read it.**

- `replayed from the cache`: the agent was not called. A replayed run costs nothing against a budget.
- The cache key of a block holds the test hash, the repeat, the block position, the starting state, the user's message, the target and the adapter version. Change any of them and the block runs again.
- The cache cannot see an edit of your agent behind the same target. After an edit, pass `--agent-version <label>` with a new label, which is part of the key. Or pass `--no-cache` for one command. `--cache-suite <name>` starts a new, empty cache under a name and leaves the others in the store.
- A run on an adapter that makes sandboxes, such as `process`, is never cached or replayed.

**If it goes wrong.**

- You edited the agent and the run replayed the old answers: you gave no new `--agent-version`. Add one, or use `--no-cache`.
- You wanted a new sample of a model that answers differently each time, and got the same answer: the cache replayed it. Use `--no-cache`.

## 7. Keep versions of your tests

**Why you do this.** A result means little if you cannot say which tests produced it. A dataset keeps a folder of tests as numbered versions that never change, and a campaign records the version it ran.

**What you need.** A folder of tests, and a store. A prompt can be kept the same way, with `driftbench prompt`, which takes the same commands.

**Relevant commands.**

- `driftbench dataset push`: loads every test of the folder, refuses the push if one is invalid, and stores the files as a new version · `acme-specs` is the name of the dataset; the folder is the tests to keep; `--store versions.db` is the file; `--note` is a free note on the version · it prints the version number and a hash of its content. Pushing content the name already holds adds nothing and prints `Unchanged`.
- `cp -R` and `printf ... >> file`: copy the folder and add a comment line to one test, to make a second version · `-R` copies a whole folder; `>>` appends · they produce `edited`.
- `driftbench dataset diff`: compares a version with the one before it · `acme-specs@2` is the version; `--store versions.db` is the file · it marks each file `A` added, `D` removed or `M` changed, shows the changed lines, and exits 1 when the two differ.
- `driftbench campaign run --dataset`: runs the tests of a dataset version, restored byte for byte · `acme-specs@1` is the version to run; `--target function:acme` is the agent; `--campaign` and `--store` as before · it prints one line per cell, and the campaign records the version by name, number and hash.

**You type.**

```console
$ driftbench dataset push acme-specs examples/acme/specs/conversations --store versions.db --note 'first push'
Pushed dataset acme-specs@1 (hash 74ce682f7438): 6 files from examples/acme/specs/conversations.
$ driftbench dataset push acme-specs examples/acme/specs/conversations --store versions.db
Unchanged: dataset acme-specs@1 already holds these 6 files.
$ cp -R examples/acme/specs/conversations edited
$ printf '# edited\n' >> edited/plan-upgrade.yaml
$ driftbench dataset push acme-specs edited --store versions.db
Pushed dataset acme-specs@2 (hash 21906203cbb5): 6 files from edited.
$ driftbench dataset diff acme-specs@2 --store versions.db   # exit 1
M plan-upgrade.yaml
    +# edited
1 file differs between acme-specs@1 and acme-specs@2.
$ driftbench campaign run --dataset acme-specs@1 --target function:acme --campaign ds-1 --store versions.db
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- A version name is `name@number`. `name@latest` and a bare name mean the latest version.
- `Unchanged`: a version never changes. The same content gives back the same version.
- The diff shows the one line added. The exit code 1 only says that the two versions differ.
- `campaign run --dataset` needs `--store`. Its campaign keeps `acme-specs@1` and its hash, so a later reader knows which tests produced the runs.
- `campaign export` and `campaign import` carry a campaign, with its versions, to another store. See [datasets](../datasets.md#run-a-campaign-again-elsewhere).

**If it goes wrong.**

- `dataset push` exits 1: one test of the folder is invalid. Run `driftbench spec validate <folder>` and fix the key it names.
- `dataset restore` stops and writes nothing: a file in the target folder differs from the version. Pass `--force` to write over it. See [datasets](../datasets.md#the-registry).

## 8. Find the tests of one sentence of your prompt

**Why you do this.** For an agent defined by files, you edit a sentence of the prompt. You want the tests of that sentence, without writing a change file by hand. The ledger id gives you that.

**What you need.** An estate built with `estate build --pointer` (a Claude Code agent's folder). Each sentence of its prompt has a ledger id that stays the same when you edit the sentence. Each generated test block carries the id of the rule it checks.

**Relevant commands.**

- `driftbench radius ledger`: reads the map and the ledger of the last scan, compares them with your files as they are now, and writes a change file · `build/map.yaml` is the map; `--ledger build/ledger.json` is the file of sentence ids; `--out change.yaml` is where the change file goes · it prints how many sentences changed. It calls no model.
- `driftbench radius`: reads the change file and the links of every test, as in step 3.

This route is run end to end, with its output, in step 4 of the [walkthrough](walkthrough.md#4-change-a-rule-and-rerun-only-what-it-can-affect). In that example, one edited sentence puts 17 of 921 blocks in the radius and saves 98.2%. The page [From a rule to its tests](../rule-links.md) shows how to prove each link by deleting the instruction.

**If it goes wrong.**

- `Units: ... 0 changed`: the edit changed no sentence the ledger knows. Check that you edited a file under the estate folder and saved it.
- The radius is the whole suite: the edited sentence holds no atom. Reword it as an instruction, then run `estate build` and `radius` again.
- Your agent has no ledger: you left `--pointer` out of `estate build`. Run it again with `--pointer`.

## 9. When rerunning less is not safe

- The radius is sound for the change you declare, under two assumptions: a block's result depends only on what it declares and on its history, and the change file lists every change. It does not prove that the new agent equals the old one outside the radius.
- Unknown means in. Three things give a larger radius, up to the whole suite: a block with unknown dependencies, a change the radius cannot map, and a change no block declares.
- Run the whole suite on a schedule. It is the check that needs no change file, and it makes every carried result fresh again.
- Gate a pull request with `driftbench ci --change`, which uses the same radius. See [gate a pull request](../recipes.md#gate-a-pull-request).

Next: [Run your agent](run-your-agent.md), or the [blast radius](../concepts/blast-radius.md) page for the section links and the rerun marks.
