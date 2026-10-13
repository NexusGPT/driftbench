# Blast radius

A change to one part of an agent has a blast radius: the blocks that part can affect. When you fix something related to a block, you do not need to run every test again, only the radius. driftbench computes it from what each block already says it reads.

What is built today: the agent version of a run, the dependencies of a block, the radius of a change and the read-only command `driftbench radius`. Carrying the stored results of the blocks outside the radius into a new campaign is the next step, and is not built yet. See [what comes next](#what-comes-next).

## A change

Every field of a change manifest is in the [change manifest reference](../reference/change.md).

A change manifest names the agent version before and after, and every change made between the two.

```
from: acme-v1
to: acme-v2
changes:
  - kind: stage
    id: recap
  - kind: tool
    id: coverage.check
    part: input
```

| Kind | Id | Blocks it selects |
|---|---|---|
| `stage` | a stage of the catalogue | blocks that expect the stage, and blocks whose cell or stage transition names it |
| `tool` | a tool label, with an optional `part` | see the table below |
| `rule` | `states@<stage>` | blocks at that stage that assert on the reply text |
| `rule` | `recovery:<class>` or `recovery:<class>@<flow>` | the probes of that deviation class, in that flow when one is named |
| `rule` | `uses_tool:<tool>` | the same blocks as a tool change with no part |
| `rule` | `path:<id>` | every block of the specs that walk that path of the map |
| `rule` | a spec rule: `lang_stable`, `max_calls`, `forbidden_tools`, `one_message_per_turn`, `match_case`, `custom.<name>` | every block of a spec whose `rules` carry it |
| `rule` | `reply_language` | the whole suite: the rule holds on every block |
| `deviation` | a deviation class, `D2` or `D2_goal_shift` | the blocks that carry the class |
| `prompt` | an estate atom id | the blocks of the specs whose `metadata.estate.atoms` name it, and every block that names no atoms |
| `map` | `dimension=value` | blocks whose cell holds the value, or whose user turn was phrased from it |
| `fixture` | a fixture name, a workspace file, `family:<id>`, or a literal value such as an email | blocks whose Given names it, task specs of that family, and blocks whose When, expected inputs or end state hold the value |
| `criterion` | a judged criterion | blocks whose `expect.criteria` name it |
| `model`, `agent` | none | the whole suite |

A tool change says which part of the tool changed, because a block that must not call a tool still reads the tool: a new description can make the agent start calling it.

| `part` | Blocks |
|---|---|
| `input` | blocks that expect one call or more, or assert on its input; specs whose `rules.max_calls` cap it |
| `result` | blocks that expect one call or more; blocks whose Given forces the tool's result or error; the last block of a spec whose end state reads `tool:<label>` |
| `description`, `presence`, or none | every block that lists the tool, count 0 included; specs that forbid or cap it; blocks that check it is offered |

`global: true` on any change declares that it applies everywhere: the whole suite.

## What a block depends on

Nothing new is written in a spec. `blockDependencies(spec, index)` of `@agent-nexus/driftbench-core` reads what the block already carries, whether it is a conversation exchange or a task step:

* Its Then: the tools it lists with their count, its stage, its `must` and `must_not`, its language, its criteria, its guards, skills, artifacts, workspace and execution checks, the spec rules, and the end state on the last block. These are the fields the [gate](../generating.md#the-gate) reads.
* Its Given: the tools it forces, the store keys, the fixtures and the workspace files, the spec's own and every block's up to it.
* The map, for a generated block: the cell and the phrase the generator recorded (`metadata.generated`), the path it walks, the deviation class it injects.
* The prompt, for an estate test: `metadata.estate.atoms`.
* For a task spec: its family, as the fixture `family:<id>`.

A hand-written spec has no cell and no atoms. It can declare what it depends on:

```
metadata:
  depends:
    tools: [order.create]
    stages: [recap]
    rules: [confirmation]
    atoms: [a-12]
    fixtures: [cust-001]
```

## The radius

1. Direct: every block whose dependencies name a change of the manifest.
2. Forward closure: a block whose Given was produced by a block in the radius is in the radius too. In mode F and P a block inherits the agent's own earlier replies, so every block after a direct block of the same run is in. In mode T a block starts from its canonical Given, written by the spec, so nothing follows. One exception: a task step in a sandbox keeps the workspace the step before left, until a step writes its own `given.world.workspace`. See [run modes](run-modes.md).

The unit that reruns is the cell: one spec on one target in one mode for one repeat. A cell is in the radius when one of its blocks is, and it reruns whole, from its first block. The blocks of that run before the first direct block are run again and are not counted in the radius.

## Unknown means in

The radius is conservative by default.

* A block whose dependencies are unknown is in every radius: a hand-written spec with no generator record, no estate atoms and no `metadata.depends`.
* A change the radius cannot map is the whole suite: a kind it does not know, `model`, `agent`, `global: true`, the reply language rule, a change with no id.
* A change no block declares is the whole suite: a new tool or a stage no spec names can reach any block, and nothing says which.
* A `map` or `path` change puts in every block that records no cell; a `prompt` change puts in every block that names no atoms.
* A tool change with no `part` counts every block that lists the tool, count 0 included.
* A manifest with no change between two different versions is the whole suite.

## The agent version

A carried result must say which agent produced it. `agentVersionOf(run)` reads the version from the target a run already records: the hash of the prompt `campaign run --prompt` pinned, else the target's `variant`. `campaign run --agent-version <label>` writes the variant of every target that names none. The target is part of the cell id and of the cache key, so a run under `v2` never reuses a run or a cached block of `v1`.

## The command

`driftbench radius <specs> --change <manifest>` runs nothing and writes nothing. It exits 0 when the radius is smaller than the suite, 1 when it is the whole suite, 2 on bad input. `--mode` takes the modes to plan for, `--json` prints every block with its state and its reasons.

```
$ pnpm -s driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml --mode F,T
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 298 of 861 blocks in the radius (233 direct, 65 forward), 563 out. 102 of 195 cells.
  A cell reruns whole: 601 of 861 blocks sent, 30.2% saved; 93 of 195 cells left to carry.
Mode T, teacher-forced: 233 of 861 blocks in the radius (233 direct, 0 forward), 628 out. 102 of 195 cells.
  A block runs alone in this mode: a rerun of the radius sends 233 of 861 blocks, 72.9% saved.
In the radius, mode F:
  spec                   blocks in  from                 why
  gen-boundary-063       3 of 5     b3-offer-to-recap    stage:recap
  (101 more rows)
exit 0
$ pnpm -s driftbench radius examples/acme/gated/specs --change examples/acme/radius/reply-language.yaml
Blast radius of acme-v1 to acme-v2 (manifest 0bf51ed76989): rule:reply_language.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
The radius is the whole suite: rule:reply_language: the reply language rule holds on every block. Nothing can be carried.
exit 1
```

## Measured on Acme

The Acme gated suite holds 195 specs and 861 scored blocks: 171 conversations on the sales assistant and 24 tasks on the ops agent. The manifests are in [`examples/acme/radius`](../../examples/acme/radius/README.md). Mode F; the saving is the share of blocks a rerun of the radius does not send.

| Change | Manifest | Direct | With forward closure | Cells | Blocks sent, cell unit | Saved |
|---|---|---|---|---|---|---|
| the recap stage | `stage-recap` | 233 | 298 | 102 of 195 | 601 | 30.2% |
| the input of `coverage.check` | `tool-coverage-check-input` | 86 | 316 | 86 | 413 | 52.0% |
| `coverage.check`, no part | `tool-coverage-check` | 810 | 810 | 168 | 810 | 5.9% |
| what the offer states (prices) | `states-offer` | 141 | 555 | 125 | 692 | 19.6% |
| the D2 handler | `deviation-goal-shift` | 9 | 22 | 9 | 55 | 93.6% |
| the D6 handler | `deviation-instruction-in-data` | 13 | 44 | 13 | 68 | 92.1% |
| the D8 handler | `deviation-tool-failure` | 15 | 15 | 15 | 44 | 94.9% |
| the D9 handler | `deviation-out-of-scope` | 11 | 38 | 13 | 70 | 91.9% |
| the price sheet task family | `price-sheet-family` | 35 | 35 | 24 | 35 | 95.9% |
| the reply language rule | `reply-language` | 861 | 861 | 195 | 861 | 0% |
| a tool no block names | `new-tool` | 861 | 861 | 195 | 861 | 0% |

These are counts of blocks, not seconds: the deterministic Acme agents answer in milliseconds, so a wall time would say nothing about a real agent. The share of blocks not sent is the share of agent calls, and of their cost, a rerun saves.

**No false safe.** Each scored Acme fault is a change the agent suffered. The committed gate report holds a full run of every fault on every block. `examples/acme/test/radius/contained.test.ts` takes the manifest of each change and asserts that every block the full suite turns red lies inside its radius.

| Fault | Manifest | Red blocks in the full suite | Outside the radius |
|---|---|---|---|
| `x3-skips-recap` | `stage-recap` | 237 | 0 (4 are in through the forward closure) |
| `x5-drops-coverage-check` | `tool-coverage-check-input` | 86 | 0 |
| `x1-invents-price` | `states-offer` | 125 | 0 |
| `x4-wrong-language` | `reply-language` | 826 | 0 (the whole suite) |
| `d4-order-on-loose-yes` | `confirmation-rule` | 54 | 0 (4 through the closure) |
| `d2-ignores-goal-shift` | `deviation-goal-shift` | 22 | 0 (13 through the closure) |
| `d6-obeys-instruction` | `deviation-instruction-in-data` | 13 | 0 |
| `d8-hides-tool-failure` | `deviation-tool-failure` | 15 | 0 |
| `d9-answers-out-of-scope` | `deviation-out-of-scope` | 11 | 0 |
| `ops-x1-wrong-price` | `price-sheet-family` | 33 | 0 |
| `ops-x4-narrates` | `price-sheet-family` | 35 | 0 |
| `ops-x5-skips-check` | `price-sheet-family` | 35 | 0 |
| `ops-d6-deletes-readme` | `price-sheet-family` | 16 | 0 |

The test can fail. A manifest that declares the loose confirmation fault as a change to the D4 handler alone, leaving out the recap, misses red blocks, and the test asserts that it does. Without the forward closure the recap change would miss 4 red blocks and the D2 change 13.

## When it is sound

The radius is sound for the declared change under two assumptions: a block's outcome depends only on its declared dependencies and its run history, and the manifest lists every change. It is not a proof that the new agent equals the old one outside the radius. A full run on a schedule, with no manifest, is what checks that.

Mode T figures are a projection: the fault runs behind the gate report are free-running, so the containment above is measured in mode F only.

## What comes next

Not built yet, in order:

* Carry: `campaign run --change <manifest> --from <campaign>` runs the cells in the radius and copies the stored runs of the others, each stamped with the campaign it comes from and its age. A carried result needs an agent version on both sides.
* The report says which results are fresh and which are carried. A carried result never enters a paired test: it is the baseline result copied, so it would agree with the baseline by construction.
* An audit sample: cells drawn outside the radius are run fresh and compared with their carried result, which puts an interval on what the radius misses.
* Blocks as the unit in mode T, and a judged criterion change that judges again without calling the agent.
