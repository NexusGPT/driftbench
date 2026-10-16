---
title: Run modes T, F and P
summary: The three ways one spec runs (teacher-forced T, free-running F, perturbed P), what each block starts from in each, what each mode measures, how to ask for them with --mode, and the compounding index that compares T with F.
commands:
  - campaign run
  - campaign plan
see_also:
  - running-campaign-run
  - running-campaign-status
  - running-cells-and-repeats
  - running-simulate
  - running-smoke
  - running-change-carry
next:
  - running-cells-and-repeats
---

## What it is

Every spec, conversation or task, can run in three modes. Each answers a different question about the same blocks.

| Mode | What block k starts from | What it measures |
|---|---|---|
| `T`, teacher-forced | its canonical Given: the spec's own earlier blocks as written, never the agent's own replies. Each block opens its own session. The agent must be able to receive that history (`seedPrefix`): on `nexus` and the live Claude Code adapter every block after the first is `not_run`. | local competence: each block alone, with no earlier mistake carried in. |
| `F`, free-running (the default) | the agent's own earlier replies, in one session; the user turns come from the spec (or a simulated user) | compounding: one wrong block can poison the blocks after it. |
| `P`, perturbed | a free-running run with one deviation injected at a chosen block | recovery: whether the agent comes back, how fast, and at what cost. |

Details that change results:

* In T, the canonical history of block k is the latest `given.prefix` up to k, then for each earlier block its user messages and a canonical assistant message: empty text, carrying the tool calls the block expects with the inputs the spec pins and the results the spec's world forces. An agent that reads its own earlier replies sees blank assistant turns. An adapter that sends the history to a model sends a past call with no result the world forces with the text "Not recorded: this earlier call comes from a replayed conversation that states the call, with only the arguments it fixes, and not what it returned." as its result, never `null`; force the tool's result in `world.tools` to give the agent a real one. The checks of a T block see no earlier block. The end state is read after every block and composed. A driver that injects a block in T fails the run.
* On a sandboxed agent (a `process` target), a T step keeps the workspace the step before left, and only its history is reset; a step that writes its own `given.world.workspace` starts from exactly that.
* In P, each perturbation the spec declares makes its own cells. A perturbation with a `user` or `burst` message is sent as an extra block before block `inject_at`; one that writes only a `world` (such as a tool forced to fail) runs in place of block `inject_at`, so the run has as many blocks as the spec. The spec's end state is neither read nor compared in P. Each P run takes the F run of the same spec, target and repeat in the campaign as the reference for its recovery metrics.
* A spec that declares no perturbation makes no P cell.

The compounding index is the T pass rate minus the F pass rate, over the spec blocks both modes ran (injected blocks left out). High T with low F means the agent is right block by block and fragile across the conversation. `campaign status --detail` prints it per spec with a clustered bootstrap interval (topic running-campaign-status).

## When to use it

* `F` alone: the default, the closest to real use.
* `T,F`: to tell local mistakes from compounding ones. T is also what `--block-reruns` needs (topic running-change-carry).
* `F,P` or `T,F,P`: to measure recovery after the deviations the spec declares (topic running-campaign-status for the recovery table). Write perturbations in the spec's `perturbations:` (authoring area); to inject one deviation at a chosen block from the command line, use `driftbench perturb` (authoring area); for an adaptive attacker, `driftbench attack` (redteam area).

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--mode <modes>` | `campaign plan`, `campaign run`, `ci` | `F` | `T`, `F`, `P`, or several separated by commas such as `T,F,P`. Spaces around a mode are ignored; a mode named twice counts once; cells always come in the order T, F, P whatever order you write. |
| `modes:` | the `campaign:` key of the config | none | a list such as `[T, F]`. |
| `--repeats <n>` | `campaign plan`, `campaign run` | `1` | the repeats apply to every mode named. |

`smoke` and `simulate` always run in mode F. `campaign resume` runs the modes the campaign was created with.

## Inputs

The specs. Mode P reads each spec's `perturbations:` list (each with an `id`, a deviation `class` such as `D8_tool_failure`, an `inject_at` block, and what it injects).

## Outputs and how to read them

* Each cell line names its mode, and a P cell its perturbation: `✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks`.
* `campaign plan` prints one minimum detectable effect line per mode; in P the runs per arm count every perturbation.
* `campaign status --detail` prints the compounding index (T against F), the succession of every run, and the recovery of every P run.
* Run records carry `mode` as `T`, `F` or `P`.

## Worked example

The Acme price-sheet task in all three modes on its own target, then the plan-upgrade conversation in P and T (written in that order, run in the order T, P). No model is called.

```sh
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --mode T,F,P --campaign modes-task
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode P,T --campaign modes-chat
```

```text
✓ acme-price-sheet · process:acme-ops · T · repeat 0  pass  2 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
✓ acme-price-sheet · process:acme-ops · P · repeat 0 · instruction-in-notes  pass  2 blocks
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · order-service-down  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
```

The task's perturbation `instruction-in-notes` only changes the workspace, so its P cell has 2 blocks, like the spec. The conversation's `billing-aside` and `loose-ok` add a user block (6 blocks); `order-service-down` only forces a tool to fail (5 blocks). The second campaign has no F cells, so its P runs have no F reference run for their collateral; run `F,P` or `T,F,P` together for full recovery metrics.

## Common errors

* `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` (exit 2)
* `--block-reruns reruns blocks of independent mode T cells: it goes with --mode T.` (exit 2)
* No P cell in the plan: the spec declares no `perturbations:`.
* A T block fails where F passes on an agent that relies on its own earlier replies: T gives it blank assistant turns. That is the design: T measures each block from the scripted history alone.
* A P run whose recovery reads `not measured`: the perturbation declares no `recovery` expectation (authoring area).
