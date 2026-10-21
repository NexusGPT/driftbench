# Prove the evaluator

A test tool can be wrong. A statistic can be off by a few points. A generated test can pass on every agent, good or bad. This part teaches you how driftbench checks itself, and how to read the result. The method is simple: plant a fault whose answer you already know, run driftbench on it, and count how often driftbench reports the truth. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for.

The examples use the Acme Telecom sales assistant that ships in `examples/acme`. All data is fictional. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.

## Words used in this part

| Word | Plain meaning | Example |
|---|---|---|
| Planted truth | A fact that code builds on purpose, so it knows the right answer before the tool runs. | A made-up population with a true pass rate of 30%. |
| Validator | Code that plants a truth, runs one part of driftbench, and compares what came back. It contains no model. | `driftbench validate stats` |
| Item | One thing a validator checks, with an id and the one source file it points at. | `scale/prompt-100000-entries` |
| Level | A group of items. All its items must pass for the level to pass. | Level 1 of stats: reference values. |
| Ladder | The levels of one validator, in order, cheapest to diagnose first. The run stops counting at the first failing level. | Stats has 8 levels. |
| Seed | A number that drives every random choice. The same seed gives the same inputs. | `--seed 1` |
| Floor | The level a ladder must reach on every seed in CI. | The stats floor is 3. |
| Fault | A copy of an agent with one thing broken on purpose. | `x3-skips-recap` never shows the recap. |
| Gate | A filter that keeps only the test blocks that can tell a good agent from a broken one. | `driftbench gate` |
| Mutation score | The share of planted faults that a test suite catches. | 2 of 2 killed. |

## 1. Why test the tester

**Why you do this.** driftbench tells you whether your agent is good. If driftbench is wrong, you ship a bad agent or block a good one, and you cannot tell. So driftbench is tested too, with a method that does not need a person to label anything.

**You need.** Nothing to install. Read the idea, then look at one planted fault.

The idea has three parts:

- **Plant a truth.** Code builds a case whose answer it knows. For example, it draws 200 results from a population with a true pass rate of 30%. It then asks driftbench for an interval. A 95% interval must contain 30% about 95 times in 100.
- **Run the part.** driftbench computes its answer from the case.
- **Count.** The validator compares the answer with the truth. It prints a ratio of two counts it can list, such as "intervals that held the truth over intervals computed".

For tests, the planted truth is a fault in the agent. The Acme example ships faults, each a copy of the real agent that does one thing wrong. This is the row for one of them:

```console
$ grep "x3-skips-recap" examples/acme/faults/README.md
| `x3-skips-recap` | X3_flow | stage, tools, guards, end_state, text | Never shows the recap: at the recap the wrapper confirms for the customer and the order goes out. |
```

A good test suite must pass on the real agent and fail on this fault. If a suite passes on both, it cannot tell them apart, and it does not protect you.

**Relevant commands.**

- `grep "x3-skips-recap" examples/acme/faults/README.md`: prints the lines of a file that hold a word · `"x3-skips-recap"` is the word, `examples/acme/faults/README.md` is the file · it prints the one line that describes the fault.

**How to read it.**

- `x3-skips-recap`: the id of the fault.
- `X3_flow`: the kind of drift it plants. The agent skips a step of its flow.
- `stage, tools, guards, end_state, text`: the parts of a reply it changes. A block that reads none of them cannot see the fault.
- The last cell says what goes wrong. The agent places the order without the recap.

**If it goes wrong.**

- The `grep` prints nothing: you are not in the repository, or the path is wrong. The path is read from the folder you are in.

## 2. Read the floors

**Why you do this.** The floors say how much self-testing has been locked in. A floor only rises. After a floor is set, no change may fall below it without CI failing.

**You need.** The repository files. The floors sit in `validators/floors.json`, and the validators read their fixtures from `packages/validators`. The command finds the repository root from the folder you are in, so run it from the root of your clone. The test that runs this page works in an empty folder instead. The three `ln` lines link the repository files into that folder. In a clone, skip them.

**Relevant commands.**

- `ln -s examples/../packages packages`, and the same for `validators` and `pnpm-workspace.yaml`: makes a link to a file or folder of the repository · `-s` makes a symbolic link; the first word is the target, the second is the link · it produces the link. Skip it in a clone.
- `driftbench validate floors`: prints the floor of each validator · `floors` is a mode of the command and no validator has that name · it prints one line and exits 0.

**You type.**

```console
$ ln -s examples/../packages packages
$ ln -s examples/../validators validators
$ ln -s examples/../pnpm-workspace.yaml pnpm-workspace.yaml
$ driftbench validate floors
Floors (validators/floors.json): judges = 20 (ladder version 2), map = 8 (ladder version 2), stats = 3 (ladder version 4), system = 9 (ladder version 5).
```

**How to read it.**

- `judges = 20 (ladder version 2)`: the judges ladder has 20 levels. The floor is the top: every level must pass on every seed.
- `stats = 3 (ladder version 4)`: the statistics ladder has 8 levels. The floor is 3. Level 4 and above hold items that do not all pass yet.
- A **ladder version** names the set of items. When the items are rebuilt, the ladder gets a new version and starts a new floor. A floor belongs to one version.
- A validator that is missing from the line has no floor yet. The generator and the estate validators are in that case.

**If it goes wrong.**

- `Floors (validators/floors.json): none.`: no `validators/floors.json` above your folder. Run the command from the repository.
- `No validator is registered for "nosuch". Registered: ...` (exit 64): the name is wrong. The message lists the registered names.

## 3. Run a slice of a ladder

**Why you do this.** The judges validator checks the judging machinery of the previous part: the answer parser, the cassettes, the council and the cascade. It uses scripted judges and no model. A whole ladder takes minutes, so you run a slice of its levels.

**You need.** A seed. A seed drives every random choice of a ladder, so seed 1 always builds the same inputs. CI runs seeds 1, 2 and 3, and one hidden seed that changes with each commit. A fix that works only on the seeds you saw fails on the hidden seed.

The judges ladder has 20 levels. Level 1 holds 37 items, level 2 holds 48 and level 3 holds 21 (source: `packages/cli/help/validate-judges.md`).

**Relevant commands.**

- `driftbench validate judges --seed 1 --levels 1..3`: runs levels 1 to 3 of the judges ladder · `judges` is the validator; `--seed 1` is the seed; `--levels 1..3` computes only these levels · it prints the ladder table and exits 0, because a slice holds no level of the run.

**You type.**

```console
$ driftbench validate judges --seed 1 --levels 1..3
Validator judges (ladder version 2)
Level  Name                                                          Metric                                   Threshold  seed 1
1      the seven levels of version 1                                 items of v1 passing / 37 items           >= 1       1 pass
2      the answer contract under hostile output                      items of contract passing / 48 items     >= 1       1 pass
3      the same request, the same prompt, key and verdict            items of consistency passing / 21 items  >= 1       1 pass
4      cassettes replay what they recorded                           items of cassette passing / 21 items     >= 1       not run
Level per seed: 1 = 3
Level of the run: 3 of 20, the minimum over 1 seed.
Floor: 20. BELOW THE FLOOR.
No level failed.
```

**How to read it.**

- Each row is a level, with its name, its metric and its threshold. The last column is the observed value for seed 1: `pass`, or `FAIL (<number of failing items>)`.
- `the answer contract under hostile output` checks how the parser reads strange judge answers. `the same request, the same prompt, key and verdict` checks that one request always gives one key and one verdict.
- `1 pass`: every item of the level passed. A failing level lists its items under the table.
- `not run`: levels 4 to 20 were not asked for.
- `Level of the run: 3 of 20`: three levels passed.
- `Floor: 20. BELOW THE FLOOR.`: this compares a slice with the floor of the whole ladder. A slice cannot reach it. CI runs the whole ladder.
- The exit code is 0 for a slice. CI joins slices with `--reports` to rebuild a whole run.

A whole ladder takes minutes, so the tests of this page do not run one. The statistics ladder is slower still: on the GitHub runner that runs these tests, level 1 of `validate stats` alone ran for more than 4 minutes and was stopped. This is how CI runs every ladder. It is shown for reference and it is not run here:

```bash
driftbench validate all --seeds 1..3 --hidden --check-floor
```

- `all` runs every registered ladder.
- `--seeds 1..3` runs seeds 1, 2 and 3.
- `--hidden` adds the hidden seed of the current commit.
- `--check-floor` computes each ladder only up to its floor and exits 1 when one is below it, else 0.

**If it goes wrong.**

- `Level of the run` below `Floor` on a whole run, with failing items listed: a change broke an item. Each item line has an id, a tier from 1 to 5 and the one source file to change. It then says what the oracle expected and what came back. Fix the first failing level before any other.
- `--seeds takes a..b with whole numbers a <= b, such as 1..20, not "3..1".` (exit 64): write the range low to high.
- An exit code from 2 to 63 on a plain run, without `--check-floor`: it is the level reached, not an error. Use `--check-floor` when a script needs 0 or 1.
- An `ENOENT` error that names `packages/validators/fixtures`: you are not at the root of the repository. The validators read their fixtures from there. Step 2 shows the links that the test uses.
- A level you ask for is not in the ladder: the top of the judges ladder is 20. A billed 21st level exists only when `DRIFTBENCH_BILLED_APPROVAL` is set. Never set it for an ordinary run, because it spends money.
- `--levels` goes with a plain run. It is refused with `--brief`, `--journal`, `--check-handover`, `--hardness` and `--reports`.

## 4. The validity gate of generated tests

**Why you do this.** A generated test can look fine and still be useless. It might pass on every agent, or leak its own answer in the user message. The gate runs each candidate block on agents whose behaviour you know, and keeps only the blocks that tell them apart.

**You need.**

- Candidate tests. Here, the 6 conversation specs and the price-sheet task of `examples/acme/specs`. The same command takes the tests that `generate` writes.
- Two **reference agents**, which are the correct builds: `function:acme-sales` and `process:acme-ops`.
- A **fault set**: `examples/acme/faults`, the copies of those agents with one thing broken on purpose.

The gate runs nine stages in order. A block is counted once, at the first stage that rejects it:

- **observed**: rejects a block that reads only judged criteria, or only words.
- **leakage**: rejects a block whose expected value is already in the user message or the starting state.
- **shortcut**: rejects a block that a trivial agent passes. The trivial agents send a constant reply, echo the user, or call the first tool.
- **contrast**: rejects a block that ignores an edit, or twins that disagree.
- **red first**: rejects a block that is not green on the real agent, or that targets no fault.
- **stability**: sends a block that flips between repeats to a review file.
- **difficulty**, **label audit** and **freshness** mark blocks. They do not reject.

**Relevant commands.**

- `driftbench gate`: runs the nine stages over candidate tests · `examples/acme/specs` is the folder of candidates; each `--reference` names a correct agent; `--route flow:price-sheet=process:acme-ops` sends the tests tagged `flow:price-sheet` to the ops agent; `--faults examples/acme/faults` is the fault set; `--date 2026-10-11` fixes the creation date that blocks record, so the output repeats; `--out gated` is the folder to write · it prints the funnel and the mutation score per fault class, writes the gated tests, a sealed holdout and `gate-report.json`. Exit 0 means at least one block was accepted.

**You type.**

```console
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out gated
Funnel (blocks):
  1. observed     in   28  rejected 0      out   28
  2. leakage      in   28  rejected 2      out   26  (expected-value-in-given 2)
  3. shortcut     in   26  rejected 2      out   24  (passed-by-echo 2)
  4. contrast     in   24  rejected 0      out   24
  5. red_first    in   24  rejected 0      out   24
  6. stability    in   24  rejected 0      out   24
  7. difficulty   in   24  rejected 0      out   24
  8. label_audit  in   24  marked 3        out   24  (sampled 3)
  9. freshness    in   24  marked 7        out   24  (sealed-holdout 7)
Accepted 24 of 28 blocks.
Mutation score per fault class (gated suite):
  X1_local: 2/2 killed (100%, 95% CI 34% to 100%)
  X2_contradiction: no scored fault, 1 equivalent excluded
  X3_flow: 1/1 killed (100%, 95% CI 21% to 100%)
  X4_format: 2/2 killed (100%, 95% CI 34% to 100%)
  X5_tool: 2/2 killed (100%, 95% CI 34% to 100%)
  D2_goal_shift: no scored fault, 1 equivalent excluded
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  D6_instruction_in_data: no scored fault, 2 equivalent excluded
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: no scored fault, 1 equivalent excluded
  control: 2 negative control(s), green
Wrote 11 files to gated.
```

**How to read it.**

- `Funnel (blocks)`: one line per stage. `in` counts the blocks that entered, `rejected` those the stage dropped, `out` those that went on.
- `Accepted 24 of 28 blocks`: the suite that is left. The 4 dropped are named next to their stage.
- `Mutation score per fault class`: for each kind of planted fault, how many the accepted suite catches. `2/2 killed (100%, 95% CI 34% to 100%)` is a tiny sample, so the interval is wide.
- `no scored fault, 1 equivalent excluded`: that fault changes nothing that the specs observe. It cannot be caught, so it leaves the score.
- `control: 2 negative control(s), green`: a control is the real agent in a wrapper that changes nothing. It must pass every block. A block that fails on a control is rejected.

**If it goes wrong.**

- `gate` exits 1: no block was accepted. Read the funnel for the stage that dropped them.
- Exit 2: a usage or input error, and nothing is written. Every spec must be valid, and each spec's own `target` must be one of the `--reference` agents.
- A non-empty `--out` folder from an earlier run: add `--force` to replace it, or choose a new folder.

## 5. How to read a result, and what it does not tell you

**Why you do this.** A green table is easy to over-read. This step lists what each number proves and what it cannot.

**You need.** The outputs of steps 2 to 4.

What a pass proves:

- **A level pass.** Every item of the level held on the seeds you ran. An item is one capability with one source file to change.
- **A floor.** The level every seed must reach in CI. The hidden seed changes with each commit, so a fix cannot be tuned to the visible seeds.
- **A mutation score.** The share of the planted faults that the gated suite catches, with a 95% interval. The interval is the honest size of the claim.

What it does not prove:

- A validator checks the property its items test. It says nothing about a property no item tests.
- The ladders contain no model. They do not measure how accurate a real judge is. Calibration against hand labels does that (previous part).
- Some ladders have no floor yet, such as the generator and the estate. No pass rate is quoted for a suite until it passes an independent audit (source: `docs/comparison/methods.md`).
- A statistics floor of 3 of 8 says that levels 1 to 3 hold. It does not say that the levels above do.
- A planted fault stands for a kind of mistake. A real agent can fail in a way no fault in the set plants.

To read a failing item, take the line apart. A line of the form below says which family it belongs to, how hard it is, and which file to change: `scale/prompt-100000-entries  [tier 3]  [packages/judges/src/prompt.ts]  the fastest of three runs took 9485 ms, budget 6000 ms. Fix: ...`. The text after `Fix:` is the hint of the person who built the item. `--blind` removes the hints, for an auditor. `--items` lists every item of the ladder. `--all-levels` lists every failing item of every level. Source: `packages/cli/help/validate-reading-items.md`.

**Relevant commands.**

- `driftbench validate <component> --items`: lists the whole bank of a ladder, with pass or FAIL per seed · it runs every level, also above the first failing one, so it takes as long as the whole ladder.
- `driftbench validate <component> --all-levels`: lists every failing item of every level, with its cause.
- `driftbench validate <component> --blind`: removes causes and hints.

These runs take minutes, so the tests do not run them.

**If it goes wrong.**

- You cannot tell whether a failing item is a real defect or a wrong item: read its cause and its source file. An item can be wrong. `packages/cli/help/validate-mutants-and-rulings.md` explains how a validator is tested with a planted bug, and how an item is disputed.
- The same level fails on every seed: fix the first failing level. The levels above it were not counted.
