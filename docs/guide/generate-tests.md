# Generate tests

This part teaches you to let driftbench write the tests for you. You do not write hundreds of specs by hand. You write down, once, the situations your agent can meet. Code then writes one spec for each combination that matters, and tells you how much of the space the specs cover. Every command below is run by a test on GitHub, and every output is real. Nothing calls a model and nothing is paid for. The example is Acme Telecom, a made-up phone company with a sales assistant that driftbench ships.

Run the commands from the root of the repository, because they read the folder `examples/acme`.

## 1. Why generate, and how to measure it

**Why you do this.** A person writes a few good tests and misses most combinations. Before you generate anything, measure what your hand-written tests already cover. The number tells you how much work generation saves.

**You need.**

- The seven hand-written Acme specs in `examples/acme/specs`. Each one is a conversation with the assistant.
- A **map of situations**, which is the list of ways one conversation can differ from another. A map has these parts:
  - A **dimension** is one way situations differ. Example: `channel`.
  - A **value** is one choice on a dimension. Example: `chat` or `whatsapp` for `channel`.
  - A **situation** is one value from each dimension. Example: a chat conversation where the user goes off topic.
  - A **constraint** is a combination that can never happen, with the reason. Example: a feature that does not exist on WhatsApp.
- The map used here is the ready-made `examples/acme/map/space.yaml`. Step 5 shows how to make one.

```yaml
# The shape of a dimension in a map (not a file you type)
dimensions:
  - id: channel
    kind: channel
    values: [chat, whatsapp]
```

**Relevant commands.**

- `driftbench space coverage`: counts how many situations a set of specs covers · `examples/acme/specs` is the folder of specs. `--map examples/acme/map/space.yaml` is the map. `--t 2` counts every pair of values from two dimensions. A pair such as (chat, off topic) is one thing to cover · it prints the cells that are covered and the required cells that are empty. It ends on a `Coverage:` line, and exits 1 when a required cell is empty.

**You type.**

```console
$ driftbench space coverage examples/acme/specs --map examples/acme/map/space.yaml --t 2   # exit 1
Map acme, version 1: 7 dimensions, 212940 cells, 380 constraints, prior uniform (no weight declared)
Dimensions
  id               kind       values  covered  not covered
  behaviour        behaviour  14      13       B-007
  deviation        deviation  13      9        D2_goal_shift, D3_contradiction, D11_pii_leak, D12_prompt_extraction
  channel          channel    2       2
  t = 2  237 of 708 allowed pairs (33.5%)
  ✗  flow new-home · D5_language_switch         no spec
  ✗  flow order · D2_goal_shift                 no spec
  ✗  flow order · D3_contradiction              no spec
Coverage: 7 of 10 required cells covered, 237 of 708 cells at t = 2 (33.5%).
```

The command prints more lines than shown here: one row per dimension, one line per required cell, and some warnings. The block keeps the lines this page explains.

**How to read it.**

- The `Dimensions` table lists each dimension, how many values it has, and which values no spec reaches. The `deviation` dimension has 13 values, and the seven specs reach 9 of them. No spec reaches `D2_goal_shift`, where the user changes what they want.
- A line marked `✗` is a **required cell**: a combination the map says you must test. One example is the flow `order` when the user changes their mind. `no spec` means no hand-written spec reaches it.
- The last line gives two numbers. 7 of the 10 required cells are covered. 237 of the 708 allowed pairs are covered, which is 33.5%.
- A low share is normal for a hand-written set. It is the reason to generate.
- Exit 1 is expected. It says a required cell is empty, so the hand-written set has a gap.
- The command also prints warnings named `FORBIDDEN_CELL`. They say a spec reaches a combination the constraints forbid. These cells are not counted.

**If it goes wrong.**

- `Unknown t "9". The map has 6 dimensions, so t is a whole number from 1 to 6.` (exit 2): `--t` is larger than the number of dimensions. Use a smaller number.
- `Cannot find nowhere.` (exit 2): the folder of specs does not exist. Fix the path.
- `The map is invalid, so coverage was not computed.` (exit 2): you passed the proposal from step 3 or 4 instead of the space map from step 5.

## 2. Propose the map with code alone

**Why you do this.** You do not write the map from scratch. Code reads your agent's files and proposes it, with a quote from your files behind every entry. This first read uses no model.

**You need.** The files that describe your agent, copied next to each other so the quotes can be found again later:

- `acme/src/policy.ts` and `acme/src/store.ts`: how the assistant behaves.
- `acme/README.md`: what the assistant does.
- `acme/inventory.yaml`: the **inventory**, the list of the behaviours, flows and channels you care about.
- `acme/map/tools.yaml`: the shape of the five tools, as JSON Schema.

An inventory entry looks like this:

```yaml
behaviours:
  - id: B-001
    title: Identify the customer before an upgrade
```

**Relevant commands.**

- `mkdir -p acme/map`, `cp -R examples/acme/src acme/src`, `cp -R examples/acme/families acme/families` and `cp ... acme/`: copy the inputs of the example into a working folder, so the repository stays as it is · `-p` makes missing folders, `-R` copies a folder and all it holds · they produce the folder `acme`. The folder `families` holds the recipe of the one code-agent task that the map names. Generation in step 5 reads it.
- `driftbench extract`: reads your files and writes a **proposal**, which is a map with nothing approved yet · `--prompt` is a file that describes the agent. You repeat it for each file. `--inventory` is the inventory. `--tools` is the file of tool shapes. `--no-model` stops after the code reads, so no model is called. `--out` is the proposal to write · it writes the proposal and prints its size.

**You type.**

```console
$ mkdir -p acme/map
$ cp -R examples/acme/src acme/src
$ cp -R examples/acme/families acme/families
$ cp examples/acme/README.md examples/acme/inventory.yaml acme/
$ cp examples/acme/map/tools.yaml examples/acme/map/answers.yaml acme/map/
$ driftbench extract --prompt acme/src/policy.ts --prompt acme/README.md --prompt acme/src/store.ts --inventory acme/inventory.yaml --tools acme/map/tools.yaml --no-model --out acme/map/nomodel.yaml
Wrote acme/map/nomodel.yaml: 34 dimensions, 91 values, 55 constraints, 0 phrases, 7 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 31 details; the axes make a full grid of 252 cells.
  No model call: the code pre-pass alone (--no-model).
  order.create output: no partition stated for order_id, plan_id, monthly_usd
```

**How to read it.**

- The `Wrote` line counts what code found: 34 dimensions, 91 values and 55 constraints. A **phrase** is a user message that stands for a value. A **relation** links values to the stages, tools and end states of the agent.
- `none approved` means nothing counts yet. A person must approve first.
- Code found dimensions only from the inventory and from the tool shapes. It found no phrases (`0 phrases`) because a phrase needs a model, or you.
- `Roles` says which dimensions are **axes** (crossed with each other) and which are **details**. Three axes make a grid of 252 situations.
- Each line under `Notes` says that the tool shape states no partition for a field. A **partition** is a set of values that behave alike, such as an enum or the edge of a minimum. Code cannot invent them for an open field, so it lists the gap.
- The command prints more lines than shown here. The block keeps the lines this page explains.

**If it goes wrong.**

- `error: required option '--inventory <file>' not specified` (exit 2): add `--inventory`.
- `error: --no-model and --replay cannot be used together` (exit 2): choose one.
- The output already exists (exit 2): add `--force`, which replaces the proposal and loses the approvals in it.

## 3. Add what a model reads

**Why you do this.** Code cannot read prose. The stages, the rules and the user phrases of your agent are written in sentences. On your own agent a model reads them and proposes entries. Code then checks every entry: it must quote a line that exists in your files.

**You need.** The same inputs as step 2. For your own agent, an API key. For this example, a file of recorded answers, `acme/map/answers.yaml`, so nothing is called and nothing is paid. Its `produced_by.family` says `lane`, so no one mistakes it for a model run.

**Relevant commands.**

- `driftbench extract`: as in step 2 · `--replay acme/map/answers.yaml` replays recorded answers in place of `--no-model`; the answers go through the same checks as a live answer; `--out acme/map/proposal.yaml` is the proposal to write · it writes the proposal and prints what each part added.

On your own agent you leave out `--replay` and set a key. This command calls a paid model, so the tests do not run it:

```bash
export ANTHROPIC_API_KEY=<your key>
driftbench extract --prompt policy.md --inventory inventory.yaml --tools tools.yaml --out map/proposal.yaml
```

This is the real output of that command on the Acme example, run once by hand on 2026-10-22 with `--provider anthropic`. The model was `claude-opus-5-5`. The command does not print a cost, and the tests do not run it, because it is billed. Lines are cut where marked:

```txt
Wrote acme/map/live-proposal.yaml: 50 dimensions, 208 values, 61 constraints, 66 phrases, 39 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 7 axes (behaviour, deviation, channel, stage, customer_type, tool_error, workspace_file), 43 details; the axes make a full grid of 576576 cells.
  Model anthropic claude-opus-5-5: 6 sections, 6 calls.
    stages     added 43 entries
    rules      added 29 entries
    personas   added 9 entries
    data       added 42 entries
    phrases    added 66 entries
    relations  added 32 entries
Refused, not in the proposal:
  rules  rule/no-fact-from-document  the quote is not in ../src/policy.ts: "The agent takes no fact from a document"
  ... 20 more lines
Next: driftbench extract approve acme/map/live-proposal.yaml lists the decisions; approve by --dimension <id> or --all.
(exit 1)
```

A live model gives different numbers each run, so yours will differ from the recorded answers used below. The `Refused` lines are the check working. A model entry that quotes a line that is not in your files, or that has the wrong shape, is dropped and listed. The command exits 1. The rest of the proposal is kept. Read the refusals, and approve what remains in step 4.

**You type.**

```console
$ driftbench extract --prompt acme/src/policy.ts --prompt acme/README.md --prompt acme/src/store.ts --inventory acme/inventory.yaml --tools acme/map/tools.yaml --replay acme/map/answers.yaml --out acme/map/proposal.yaml
Wrote acme/map/proposal.yaml: 51 dimensions, 184 values, 111 constraints, 55 phrases, 74 relations, none approved.
  Roles: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 44 details; the axes make a full grid of 113568 cells.
    stages     added 39 entries
    rules      added 16 entries
    personas   added 45 entries
    data       added 49 entries
    phrases    added 55 entries
    relations  added 67 entries
```

**How to read it.**

- The proposal is much bigger than in step 2: 51 dimensions instead of 34, and 55 phrases instead of none. The six lines at the end list what each model section added. They show 39 stages, 16 rules, 45 personas, 49 data values, 55 phrases and 67 relations.
- There are now 7 axes. The model part added four of them: `stage`, `user_type`, `coverage_result` and `workspace_start`.
- Every entry carries `evidence`: the file and a verbatim quote. Open `acme/map/proposal.yaml` and look at one. If a quote is wrong, code refuses the entry and lists it as `Refused, not in the proposal`.
- `none approved` is still true. You approve next.

**If it goes wrong.**

- `Refused, not in the proposal:` followed by `"../src/policy.ts" is not one of the sources` (exit 1): the recorded paths do not resolve from where you wrote the proposal. Write the proposal in the folder `acme/map`, next to `acme/src`, and run again with `--force`.
- With neither `--replay` nor `--no-model`, the command calls a model. It stops with exit 2 and writes nothing when no model key is set. Set `ANTHROPIC_API_KEY`, or choose one of the two options.

## 4. Approve the map

**Why you do this.** A map is only as good as the person who signs it. Code generates tests from approved entries only, so an invented rule never becomes a test. Approving is the human step of generation.

**You need.** The proposal from step 3.

**Relevant commands.**

- `driftbench extract approve` with no option: lists the decisions that are open and changes nothing · `acme/map/proposal.yaml` is the proposal · it prints the count of open decisions, then one line per dimension, constraint, phrase and relation, each with its quote.
- `driftbench extract approve --all`: approves every entry · `--all` sets every flag; `--dimension <id>` would approve one dimension and its values instead; `--to acme/map/approved.yaml` writes the result to a new file beside the proposal · it writes the approved map.
- `driftbench extract map`: reads the approved map and writes the **space map**, the file the `space` commands read · `acme/map/approved.yaml` is the approved map; `--to acme/map/space.yaml` is the file to write · it prints the number of axes and cells. An **axis** is a dimension that is crossed with the others. A dimension that is not an axis is a **detail**, which the generator varies inside one situation.

**You type.**

```console
$ driftbench extract approve acme/map/proposal.yaml
acme/map/proposal.yaml: 291 of 291 decisions are open (51 dimensions, 111 constraints, 55 phrases, 74 relations).
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   channel  channel axis, by code, 2 values: The channels the inventory names
$ driftbench extract approve acme/map/proposal.yaml --all --to acme/map/approved.yaml
Approved 291 flags in acme/map/approved.yaml; 0 were already set.
$ driftbench extract map acme/map/approved.yaml --to acme/map/space.yaml
Wrote acme/map/space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 380 constraints, a full grid of 212940 cells.
```

**How to read it.**

- The first line counts the open decisions: 291, one for each dimension, constraint, phrase and relation. The list runs to hundreds of lines, so the block keeps four. Each line says who proposed the entry (`by code` or `by model`), and each constraint and relation shows its source quote. Read the list before you approve. Approve only what is true of your agent.
- The Acme map was approved with `--all` for this made-up demo. On a real agent, approve by dimension and read each one.
- `Axes: 7 of 51 dimensions` is the choice of what is crossed. The grid is the number of situations if you crossed every axis. The proposal gives 113568, and the space map gives 212940 after it adds a `none` value to some axes. Both are far too many to test one by one, which is why the next steps choose among them.
- `Approved 291 flags` says every entry is now approved. `Wrote acme/map/space.yaml` says the space map exists, with 380 constraints.

**If it goes wrong.**

- `PROPOSAL_QUOTE_NOT_FOUND  the quote is not in ../inventory.yaml: an entry stands only on text its source holds` followed by `The proposal is invalid, so nothing was approved.` (exit 1): a quote no longer matches its source, because the source or the quote was edited. Restore the text, or remove the entry.
- `--to` outside the folder of the proposal (exit 2): write the approved file beside the proposal.

## 5. Generate the specs

**Why you do this.** Now code writes the tests. Each part of the map becomes a block, and each Then (what the block expects) comes from the map, never from an agent's reply. So the tests judge the agent, and the agent never writes its own exam.

**You need.** The approved map from step 4.

**Relevant commands.**

- `driftbench generate`: enumerates specs from an approved map, with no model · `--map` is the approved map. `--out` is the folder to write (`specs` for the complete tests, `incomplete` for placeholders, and a report). `--t 2` makes the covering array of strength 2. Every pair of values meets at least once. `--seed 1` fixes every random choice. The same map and seed give the same files · it writes the files, prints a table by **seeder** and exits 1 when some specs are incomplete. A seeder is a rule that writes one family of specs, such as the stage graph, the covering array, boundary values or deviations.

First, try the proposal that nothing approved. Generation refuses it:

```console
$ driftbench generate --map acme/map/proposal.yaml --out generated   # exit 2
✗ acme/map/proposal.yaml  MAP_NOT_APPROVED
291 of 291 entries are not approved; approve them first (driftbench extract approve).
```

Then generate from the approved map:

```console
$ driftbench generate --map acme/map/approved.yaml --out generated --t 2 --seed 1   # exit 1
Seed 1, t = 2.
Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     792       153           3
boundary         85     180        13          72
deviation       137     527       137           0
metamorphic      42     188        42           0
task             67      71        67           0
cover            12      53        12           0
Stage graph: 18 of 23 edges covered in 12 paths from needs.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).
Wrote 708 files to generated.
```

**How to read it.**

- Each row is one seeder: how many specs it wrote, how many blocks they hold, and how many are complete.
- A **complete** spec has an approved phrase for every message and a machine check for every block. An **incomplete** spec waits for something, such as a phrase for a value. It sits in `generated/incomplete`, and the report says what it needs.
- Exit 1 is expected while some specs are incomplete. It is a to-do list, not a crash.
- Open one file in `generated/specs`. It is an ordinary spec, in the format of [Write tests by hand](write-tests.md). You can read it, edit it and run it.

**If it goes wrong.**

- `MAP_NOT_APPROVED` (exit 2): approve the map first, as in step 4.
- `MAP_INVALID` with `this reader knows proposal version 1` (exit 2): you passed a space map. Pass the approved proposal.
- `<report> already exists: an earlier run wrote this folder. Pass --force to replace its output.`: use `--force` or another `--out`.
- `--t must be a whole number of at least 1, got "0".` (exit 2): give `--t` a number from 1.

## 6. Check what the generated suite covers

**Why you do this.** A big suite can still be lopsided. The coverage line says what share of the allowed situations the generated specs reach. It uses the same units as step 1, so you can compare the two.

**You need.** The folder `generated/specs` and the space map `acme/map/space.yaml`.

**Relevant commands.**

- `driftbench space coverage`: as in step 1 · `generated/specs` is the folder of generated specs, and `--map acme/map/space.yaml` is the space map from step 4 · it prints the cells and ends on the `Coverage:` line.

**You type.**

```console
$ driftbench space coverage generated/specs --map acme/map/space.yaml --t 2
Coverage: 10 of 10 required cells covered, 708 of 708 cells at t = 2 (100.0%).
```

**How to read it.**

- Compare this line to step 1. The same measure now counts the generated suite.
- The generated suite reaches every required cell, so the exit code is 0.
- One generated spec is a **conversation** and covers many pairs at once, which is why a few hundred specs cover 708 allowed pairs.

**If it goes wrong.**

- Exit 1 and a list of empty required cells: the map lets a cell exist that no spec can build. Read `generated/generate-report.json` under `cover.unbuilt`, which names each cell and the reason.

## 7. Keep only tests that can tell a good agent from a broken one

**Why you do this.** A generated test is only useful if it can fail. Some tests pass on any agent, even a silly one that repeats the user's words. The **gate** removes those tests, and keeps the ones that catch a planted bug.

**You need.**

- The specs to gate. Here the seven hand-written Acme specs, because they run in seconds. The same command gates a generated suite.
- A **reference agent**, an agent known to be good. Here `function:acme-sales`, and `process:acme-ops` for the one task spec.
- A **fault set**: a folder of agents with one planted bug each, such as an agent that invents a price. It is in `examples/acme/faults`.

**Relevant commands.**

- `driftbench gate`: passes every block through nine stages and keeps the blocks that no stage rejects · `examples/acme/specs` is the folder of candidate specs. `--reference` names a good agent, and you repeat it. `--route flow:price-sheet=process:acme-ops` sends the specs that carry the tag `flow:price-sheet` to the ops agent. `--faults` is the fault set. `--date 2026-10-11` is the creation date written into the blocks. The output is the same on every run. `--out gated-hand` is the folder to write · it prints the funnel, one row per stage, and the mutation score for each fault class. It writes the gated specs, a sealed holdout and `gate-report.json`.

**You type.**

```console
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out gated-hand
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
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  control: 2 negative control(s), green
Wrote 11 files to gated-hand.
```

**How to read it.**

- Each row of the funnel is a stage. `in` is how many blocks reached it, `rejected` how many it removed, `out` how many went on. The lines in brackets give the reason. One example is `passed-by-echo`: a trivial agent that repeats the user's words passes the block, so the block proves nothing.
- `Accepted 24 of 28 blocks.` is the result: the blocks that remain.
- `Mutation score per fault class` says how many planted bugs the kept blocks catch. `2/2 killed` means both bugs of that class made at least one kept block fail. A class with no scored fault is skipped.
- The gate also seals part of the specs in a **holdout** folder and never runs them. You keep them to check your agent later on tests it never saw.
- The generated Acme suite goes through the same gate in [Generating tests](../generating.md#the-acme-funnel), with its own numbers.

**If it goes wrong.**

- `These specs name a target that is not a --reference: acme-price-sheet (process:acme-ops).` (exit 2): add that target as a `--reference`.
- `<path> already exists: an earlier run wrote this folder. Pass --force to replace its output.` (exit 2): use `--force`, or another `--out`.
- `Accepted 0 of <n> blocks.` (exit 1): every block was rejected. Read the reasons in the funnel and in `gate-report.json`.
- `Cannot load the fault set <path>: ...` (exit 2): the path to `--faults` is wrong.

## 8. Choose a small golden set

**Why you do this.** You do not run hundreds of specs on every change. `select` picks the fewest tests that still cover everything the set can cover, then keeps the best few. This small set is the one you run often.

**You need.** A folder of gated specs. After `gate`, you pass the folder `<out>/specs` it wrote. The repository ships a gated Acme suite, `examples/acme/gated`, so this step does not wait for a long gate run. It holds 200 usable specs, and sets 58 aside as sealed.

**Relevant commands.**

- `driftbench select`: chooses a golden set · `--cover acme/map/space.yaml` is the map. `--specs examples/acme/gated` is the gated folder. `--out golden` is the folder to write. `--k 10` keeps the 10 best specs. `--t` (not used here) changes the strength. Its default is 2 · it prints the ranked table and the coverage of the chosen set, and writes the specs and `golden.json`.

**You type.**

```console
$ driftbench select --cover acme/map/space.yaml --specs examples/acme/gated --out golden --k 10
Golden set for map acme, version 1: cells on every subset of 2 dimensions (708 allowed pairs).
Pool: 200 unsealed specs; 58 sealed specs left out; 4 gate files that are not specs skipped.
Cover: 106 conversations cover every cell the pool covers (598 of 708).
k = 10 is smaller than the cover: the golden set is the 10 best, ranked by required cells, then faults turned red, then cells.
  1   acme-order-loose-confirmation  60          60 of 708   flow new-home · D8_tool_failure; flow order · D4_loose_confirmation; flow order · D8_tool_failure  d4-order-on-loose-yes, x1-invents-price, x3-skips-recap, x4-wrong-language, x5-drops-coverage-check
  2   acme-new-customer-coverage     53          113 of 708  flow new-home · D1_off_topic; flow new-home · D6_instruction_in_data                               -
  10  gen-twise-074                  13          306 of 708  -                                                                                                  d8-hides-tool-failure
Cells covered: 306 of 708 allowed pairs (43.2%); the pool covers 598.
  t = 3: 794 of 4064 allowed (19.5%).
Required cells: 10 of 10; the pool covers 10.
Faults turned red: 12 of the 13 the pool turns red (13 counted faults in the gate report).
Wrote 11 files to golden.
```

**How to read it.**

- `Pool:` counts the specs it chose from. Sealed specs never count.
- `Cover:` is the fewest specs that reach every cell the pool reaches.
- With `--k` smaller than the cover, you get the ranked table. Each row says what the spec adds: cells, required cells and planted faults turned red.
- `Cells covered: 306 of 708` is the price of a small set. 10 specs cover 43.2% of the allowed pairs, while the whole pool covers 598. The set still holds 10 of 10 required cells.
- If a required cell stays empty, the exit code is 1. Raise `--k`.

**If it goes wrong.**

- `golden/golden.json already exists: an earlier run wrote this folder. Pass --force to replace it.` (exit 2): add `--force`, or choose another `--out`.
- `--out and --specs overlap: write the golden set to a folder of its own.` (exit 2): choose a different `--out`.
- Exit 1: a required cell is empty. Raise `--k`, or generate specs for that cell.

## 9. Generate within a budget

**Why you do this.** Sometimes you can afford only a fixed number of conversations, for example because each one calls a paid model. `--budget N` picks exactly N conversations, chosen to cover the most new pairs first, and then to balance the values.

**You need.** The approved map from step 4, and the number of conversations you can afford.

**Relevant commands.**

- `driftbench generate`: as in step 5 · `--budget 20` replaces the covering-array rows with 20 chosen conversations; `--out budget-20` is a new folder · it prints the budget line and writes the suite. The other seeders still run, so the whole suite can be larger than 20.

**You type.**

```console
$ driftbench generate --map acme/map/approved.yaml --out budget-20 --t 2 --seed 1 --budget 20   # exit 1
Candidate budget array (before the total cap), budget 20: 20 cells of 901 allowed, pairs covered 155 of 356 (43.5%), max deviation from fair share 2.00.
Seeder        specs  blocks  complete  incomplete
twise            20     105        20           0
boundary         85     183        13          72
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).
```

**How to read it.**

- `20 cells of N allowed` is how many conversations were chosen, out of the allowed pool.
- `pairs covered X of Y` is what the 20 reach. It is a partial cover, and that is the point. The first pick is the one that adds the most pairs, so the early picks matter most.
- `max deviation from fair share` is how uneven the values are. A low number means each value is used about as often as the others.
- The same map, seed and budget give the same suite. Change `--seed` to get another equally good suite.
- The research note [budget-bounded tests](../research/budget-bounded-tests.md) measures this on Acme. It reports that at budget 20 the selector catches 9.00 of 13 seeded faults on average, against 8.37 for random choice. It makes no claim beyond Acme.

**If it goes wrong.**

- The command exits 1 and the table shows 72 incomplete specs. They are the to-do list from step 5. The budget never changes the exit code.
- A map with approved numeric ranges, such as a temperature from 0 to 1, refuses generation without `--budget`. Add the option.

## Where to go next

- Run the generated or golden specs on your agent: [Run your agent](../running.md).
- Read the numbers of a run: [Statistics](../concepts/statistics.md) and [scorecards](../scorecards.md).
- The full detail of every option: [Generating tests](../generating.md) and the [map reference](../reference/map.md).
