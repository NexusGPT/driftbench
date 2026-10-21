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

- `driftbench space coverage`: counts how many situations a set of specs covers · `examples/acme/specs` is the folder of specs; `--map examples/acme/map/space.yaml` is the map; `--t 2` counts every pair of values from two dimensions, so a pair such as (chat, off topic) is one thing to cover · it prints the cells that are covered and the required cells that are empty, ends on a `Coverage:` line, and exits 1 when a required cell is empty.

**You type.**

```console
$ driftbench space coverage examples/acme/specs --map examples/acme/map/space.yaml --t 2   # exit 1
Coverage: (pending)
```

**How to read it.**

- The last line gives two numbers. The first is the **required cells** the specs cover. A required cell is a combination the map says you must test. The second is all the allowed pairs the specs cover.
- A low second number is normal for a hand-written set. It is the reason to generate.
- Exit 1 here is expected. It says a required cell is empty, so the hand-written set has a gap.

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

- `mkdir -p acme/map`, `cp -R examples/acme/src acme/src` and `cp ... acme/`: copy the inputs of the example into a working folder, so the repository stays as it is · `-p` makes missing folders, `-R` copies a folder and all it holds · they produce the folder `acme`.
- `driftbench extract`: reads your files and writes a **proposal**, which is a map with nothing approved yet · `--prompt` is a file that describes the agent, and you repeat it for each file; `--inventory` is the inventory; `--tools` is the file of tool shapes; `--no-model` stops after the code reads, so no model is called; `--out` is the proposal to write · it writes the proposal and prints its size.

**You type.**

```console
$ mkdir -p acme/map
$ cp -R examples/acme/src acme/src
$ cp examples/acme/README.md examples/acme/inventory.yaml acme/
$ cp examples/acme/map/tools.yaml examples/acme/map/answers.yaml acme/map/
$ driftbench extract --prompt acme/src/policy.ts --prompt acme/README.md --prompt acme/src/store.ts --inventory acme/inventory.yaml --tools acme/map/tools.yaml --no-model --out acme/map/nomodel.yaml
Wrote acme/map/nomodel.yaml: (pending)
```

**How to read it.**

- The `Wrote` line counts what code found: dimensions, values, constraints, phrases and relations. A **phrase** is a user message that stands for a value. A **relation** links values to the stages, tools and end states of the agent.
- `none approved` means nothing counts yet. A person must approve first.
- Code found dimensions only from the inventory and from the tool shapes. It found no phrases (`0 phrases`) because a phrase needs a model, or you.

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

**You type.**

```console
$ driftbench extract --prompt acme/src/policy.ts --prompt acme/README.md --prompt acme/src/store.ts --inventory acme/inventory.yaml --tools acme/map/tools.yaml --replay acme/map/answers.yaml --out acme/map/proposal.yaml
Wrote acme/map/proposal.yaml: (pending)
```

**How to read it.**

- The proposal is much bigger than in step 2. The model part added stages, rules, personas, data values, phrases and relations.
- Every entry carries `evidence`: the file and a verbatim quote. Open `acme/map/proposal.yaml` and look at one. If a quote is wrong, code refuses the entry and lists it as `Refused, not in the proposal`.
- `none approved` is still true. You approve next.

**If it goes wrong.**

- `Refused, not in the proposal:` followed by `"../src/policy.ts" is not one of the sources` (exit 1): the recorded paths do not resolve from where you wrote the proposal. Write the proposal in the folder `acme/map`, next to `acme/src`, and run again with `--force`.
- A key error with no `--replay` and no `--no-model` (exit 2): the command needs a model key. Set `ANTHROPIC_API_KEY`.

## 4. Approve the map

**Why you do this.** A map is only as good as the person who signs it. Code generates tests from approved entries only, so an invented rule never becomes a test. Approving is the human step of generation.

**You need.** The proposal from step 3.

**Relevant commands.**

- `driftbench extract approve` with no option: lists the decisions that are open and changes nothing · `acme/map/proposal.yaml` is the proposal · it prints the count of open decisions, then one line per dimension, constraint, phrase and relation, each with its quote.
- `driftbench extract approve --all`: approves every entry · `--all` sets every flag; `--dimension <id>` would approve one dimension and its values instead; `--to acme/map/approved.yaml` writes the result to a new file beside the proposal · it writes the approved map.
- `driftbench extract map`: reads the approved map and writes the **space map**, the file the `space` commands read · `acme/map/approved.yaml` is the approved map; `--to acme/map/space.yaml` is the file to write · it prints the number of axes and cells. An **axis** is a dimension that is crossed with the others; a dimension that is not an axis is a **detail**, which the generator varies inside one situation.

**You type.**

```console
$ driftbench extract approve acme/map/proposal.yaml
acme/map/proposal.yaml: (pending)
$ driftbench extract approve acme/map/proposal.yaml --all --to acme/map/approved.yaml
Approved (pending)
$ driftbench extract map acme/map/approved.yaml --to acme/map/space.yaml
Wrote acme/map/space.yaml: (pending)
```

**How to read it.**

- The first line counts the open decisions. Read the list before you approve. Each relation shows its source quote. Approve only what is true of your agent.
- The Acme map was approved with `--all` for this made-up demo. On a real agent, approve by dimension and read each one.
- `Axes: 7 of 51 dimensions` is the choice of what is crossed. The grid is the number of situations if you crossed every axis: the full grid is far too large to test one by one, which is why the next steps choose among them.

**If it goes wrong.**

- `PROPOSAL_QUOTE_NOT_FOUND  the quote is not in ../inventory.yaml: an entry stands only on text its source holds` followed by `The proposal is invalid, so nothing was approved.` (exit 1): a quote no longer matches its source, because the source or the quote was edited. Restore the text, or remove the entry.
- `--to` outside the folder of the proposal (exit 2): write the approved file beside the proposal.

## 5. Generate the specs

**Why you do this.** Now code writes the tests. Each part of the map becomes a block, and each Then (what the block expects) comes from the map, never from an agent's reply. So the tests judge the agent, and the agent never writes its own exam.

**You need.** The approved map from step 4.

**Relevant commands.**

- `driftbench generate`: enumerates specs from an approved map, with no model · `--map` is the approved map; `--out` is the folder to write (`specs` for the complete tests, `incomplete` for placeholders, and a report); `--t 2` makes the covering array of strength 2, so every pair of values meets at least once; `--seed 1` fixes every random choice, so the same map and seed give the same files · it writes the files, prints a table by **seeder** and exits 1 when some specs are incomplete. A seeder is a rule that writes one family of specs, such as the stage graph, the covering array, boundary values or deviations.

First, try the proposal that nothing approved. Generation refuses it:

```console
$ driftbench generate --map acme/map/proposal.yaml --out generated   # exit 2
✗ acme/map/proposal.yaml  MAP_NOT_APPROVED
(pending)
```

Then generate from the approved map:

```console
$ driftbench generate --map acme/map/approved.yaml --out generated --t 2 --seed 1   # exit 1
Seeder        specs  blocks  complete  incomplete
(pending)
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

**Why you do this.** A big suite can still be lopsided. The coverage line says what share of the allowed situations the generated specs reach, in the same units as step 1, so you can compare the two.

**You need.** The folder `generated/specs` and the space map `acme/map/space.yaml`.

**Relevant commands.**

- `driftbench space coverage`: as in step 1 · `generated/specs` is the folder of generated specs, and `--map acme/map/space.yaml` is the space map from step 4 · it prints the cells and ends on the `Coverage:` line.

**You type.**

```console
$ driftbench space coverage generated/specs --map acme/map/space.yaml --t 2
Coverage: (pending)
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

- `driftbench gate`: runs every block through nine checks and keeps the blocks that pass all of them · `examples/acme/specs` is the folder of candidate specs; `--reference` names a good agent, and you repeat it; `--route flow:price-sheet=process:acme-ops` sends the specs that carry the tag `flow:price-sheet` to the ops agent; `--faults` is the fault set; `--date 2026-10-11` is the creation date written into the blocks, so the output is the same on every run; `--out gated-hand` is the folder to write · it prints the funnel, one row per stage, and the mutation score for each fault class, and writes the gated specs, a sealed holdout and `gate-report.json`.

**You type.**

```console
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out gated-hand
Funnel (blocks):
(pending)
```

**How to read it.**

- Each row of the funnel is a stage. `in` is how many blocks reached it, `rejected` how many it removed, `out` how many went on. The lines in brackets give the reason, such as `passed-by-echo`: a trivial agent that repeats the user's words passes the block, so the block proves nothing.
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

**You need.** A folder of gated specs. The repository ships one for Acme, `examples/acme/gated`. It holds 200 usable specs, and sets 58 aside as sealed.

**Relevant commands.**

- `driftbench select`: chooses a golden set · `--cover acme/map/space.yaml` is the map; `--specs examples/acme/gated` is the gated folder; `--out golden` is the folder to write; `--k 10` keeps the 10 best specs; `--t` (not used here) changes the strength, and its default is 2 · it prints the ranked table and the coverage of the chosen set, and writes the specs and `golden.json`.

**You type.**

```console
$ driftbench select --cover acme/map/space.yaml --specs examples/acme/gated --out golden --k 10
Pool: (pending)
```

**How to read it.**

- `Pool:` counts the specs it chose from. Sealed specs never count.
- `Cover:` is the fewest specs that reach every cell the pool reaches.
- With `--k` smaller than the cover, you get the ranked table. Each row says what the spec adds: cells, required cells and planted faults turned red.
- `Cells covered` is the price of a small set: 10 specs cover only part of the pool. If a required cell stays empty, the exit code is 1. Raise `--k`.

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
Candidate budget array (before the total cap), budget 20: (pending)
```

**How to read it.**

- `20 cells of N allowed` is how many conversations were chosen, out of the allowed pool.
- `pairs covered X of Y` is what the 20 reach. It is a partial cover, and that is the point: the first pick is the one that adds the most pairs, so the early picks matter most.
- `max deviation from fair share` is how uneven the values are. A low number means each value is used about as often as the others.
- The same map, seed and budget give the same suite. Change `--seed` to get another equally good suite.
- The research note [budget-bounded tests](../research/budget-bounded-tests.md) measures this on Acme. It reports that at budget 20 the selector catches 9.00 of 13 seeded faults on average, against 8.37 for random choice. It makes no claim beyond Acme.

**If it goes wrong.**

- The command exits 1 and prints `72 incomplete`: that is the to-do list from step 5, not a budget error. The budget never changes the exit code.
- `--budget` with a map that has approved numeric ranges is required, not optional: those maps refuse generation without it.

## Where to go next

- Run the generated or golden specs on your agent: [Run your agent](../running.md).
- Read the numbers of a run: [Statistics](../concepts/statistics.md) and [scorecards](../scorecards.md).
- The full detail of every option: [Generating tests](../generating.md) and the [map reference](../reference/map.md).
