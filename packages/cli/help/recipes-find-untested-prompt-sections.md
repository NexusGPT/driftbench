---
title: Find the prompt sections no test notices
summary: Mutate the sections of a prompt, run the suite against each mutant, list the sections no block notices, and see which declared links a mutant verifies or refutes, on Acme.
commands:
  - radius sections check
  - radius mutate plan
  - radius mutate run
  - radius mutate score
see_also:
  - validate-section-mutants
  - authoring-prompt-sections
  - recipes-rerun-what-a-change-touches
next:
  - validate-section-mutants
---

## Goal

You have a prompt with a section registry and a suite whose blocks link to its sections. You want to know
which sections no block notices when they change, so you can write blocks for them, and which declared
links hold up. Mutation testing answers both: it edits one section at a time, runs the suite against each
edit, and records which blocks flip.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* A prompt and its registry: here `examples/acme/prompts/acme-sales.md` and
  `examples/acme/prompts/acme-sales.sections.yaml` (authoring-prompt-sections).
* Specs that link their blocks to sections: here `examples/acme/prompts/linked`, copied so the links can be
  written back.
* An agent that runs with the prompt it is handed (`target.prompt`). The Acme example agent does not read
  it, so on Acme no mutant changes anything and every mutated section reads untested. A model behind
  `litellm` or `http` gives the real list with the same steps; set `--usd-per-run` to what one conversation
  costs it and `--budget-usd` to what you allow.
* For negate, rephrase and the reword control: recorded answers of a mutator model (validate-section-mutants,
  Inputs). Without them the plan holds the drops and the punctuation controls only.

## Steps

```sh setup
cp -r examples/acme/prompts/linked linked
```

```sh
# 1. Check the registry still describes the prompt.
driftbench radius sections check examples/acme/prompts/acme-sales.sections.yaml \
  --prompt examples/acme/prompts/acme-sales.md
# 2. Plan the mutants of the sections the linked specs test.
driftbench radius mutate plan --prompt examples/acme/prompts/acme-sales.md \
  --registry examples/acme/prompts/acme-sales.sections.yaml \
  --only store_hours explicit_confirm recap closing --pairs 0 --out mutants.json
# 3. Run the suite against the baseline and each mutant, under a budget, with a cache.
driftbench radius mutate run linked --prompt examples/acme/prompts/acme-sales.md \
  --registry examples/acme/prompts/acme-sales.sections.yaml --mutants mutants.json \
  --usd-per-run 0 --budget-usd 0 --cache cache.json --out run.json
# 4. Read the untested sections and write the verified and refuted links back.
driftbench radius mutate score linked --run run.json \
  --registry examples/acme/prompts/acme-sales.sections.yaml --write
```

```text
8 of 12 mutants of acme-sales v1: 4 single-section, 4 controls, 0 two-section. Written to mutants.json.
  4 refused: no recorded mutator answer.
Mutation run <id> of acme-sales v1: 3 baseline runs, 8 mutants.
  Local sections no mutant kills a block with (4): store_hours, recap, explicit_confirm, closing. ...
```

Step 4 lists each mutated local section no mutant killed a block with. For each, write a block whose
verdict depends on that section, link it, and run steps 3 and 4 again: the cache sends only the new
conversations.

## What you have at the end

* `mutants.json`: the mutants, each with its prompt text and hash.
* `run.json`: every baseline, mutant and confirmation run, and the spend.
* `cache.json`: the conversation runs by mutant prompt hash, read again on the next run.
* The copied specs with their links marked `verified` or `refuted`, and new `verified` links for flips no
  link explained.
* The list of untested sections: candidates for new blocks.

## When a step fails

* Step 1 exits 1: the prompt changed since the registry was written. Run `radius sections reanchor` and use
  the new registry.
* Step 2 refuses mutants: answer the requests (`--requests-out`) in a `--responses` file.
* Step 3 exits 1 with `nothing was sent`: the projection is above `--budget-usd`. Mutate fewer sections
  with `--only`, or raise the budget.
* Step 4 lists every section: the agent does not change with its prompt (as the Acme example agent), or the
  blocks do not reach the sections. Check that the target hands `target.prompt` to the agent.
