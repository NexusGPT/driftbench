---
title: Section mutants and verified links
summary: Mutate the sections of a prompt, run the suite against each mutant, mark each block link verified or refuted, find untested sections, and pass the gate that lets section selection skip blocks.
commands:
  - radius mutate plan
  - radius mutate run
  - radius mutate score
see_also:
  - authoring-prompt-sections
  - authoring-blast-radius
  - results-radius
  - validate-mutants-and-rulings
  - recipes-find-untested-prompt-sections
next:
  - recipes-find-untested-prompt-sections
---

## What it is

A block link (`metadata.links`, authoring-prompt-sections) says a block is related to a section of the
prompt. It does not say the block notices when that section changes. Section mutation testing measures
that: it edits one section at a time, runs the suite against each edited prompt, and looks at which
blocks change their verdict.

**Mutants.** `radius mutate plan` makes, for every section of the registry (or the sections `--only`
names):

| Mutant | id | What it does |
|---|---|---|
| drop | `<section>__drop` | removes the section text, from its registry span |
| negate | `<section>__negate` | the section rewritten to instruct the opposite of its main rule |
| rephrase | `<section>__rephrase` | with `--rephrase` only: the same rule in other words |
| punctuation control | `<section>__control_punctuation` | removes the first comma outside a quote, or turns the last full stop into a semicolon |
| reword control | `<section>__control_reword` | two ordinary words replaced with close synonyms |
| pair | `pair__<a>__<b>` | two local sections negated at once, drawn at random with a seed |

Drop and the punctuation control are made by code. Negate, rephrase and the reword control are written
by a mutator model; `plan` reads the model's answers from a file of recorded answers (`--responses`), so a
plan is the same on every machine. A request with no recorded answer refuses its mutant: nothing is
invented. The two controls are meant to change nothing, so a block that flips under a control is noise.
A pair is refused when either of its sections has no accepted negate.

**Runs.** `radius mutate run` runs every conversation (one spec) against the baseline prompt and against
each mutant, 3 times. A block whose verdict differs from its baseline verdict (the majority of its
baseline runs) in at least 2 of the 3 runs is a candidate, and its conversation is run 3 more times. The
mutant kills the block when it flips again in at least 2 of those. Before the first conversation is sent
it prints the projected cost and refuses to send anything when that is above `--budget-usd`.

**The null model.** A block's null flip rate pools its baseline runs and the runs of every control. A
block with a flip rate above 0.2, or with no baseline verdict (a tie), is flaky: no mutant kills it and no
link of it moves.

**Link promotion.** `radius mutate score` applies these rules to every link to the mutated prompt that
names one block:
* `verified`: a single-section mutant of the linked section, not a control and not a pair, kills the block,
  and the section's controls are clean (at least one control of the section ran and none killed a block).
* new `verified` link (`created_by: mutation`): such a mutant kills a block that has no link to the
  section. The selection missed it; now it is linked.
* `refuted`: the link is `declared` or `attributed`, the section's controls are clean, at least one
  single-section mutant of the section ran, and none of them kills the block.
* unchanged: every link of a flaky block, a link with no `block` (it holds for every block), every link of
  a section whose controls killed a block or did not run, and a `verified`, `refuted` or `stale` link no
  run contradicts. A pair never moves a link: a flip under two edits names no single section.

**Untested sections.** A local section the run mutated whose mutants killed no block is untested: no block
of the suite notices when it changes, or its edits change nothing. Each is a candidate for a new block.

**The verified-link gate.** Section selection (`radius --sections`) is advisory: a `prompt_section` change
makes the radius the whole suite. It may skip blocks only with a passing gate record (`--gate-out`), given
to `radius --gate`. The gate runs section selection on the verified links alone, with forward closure (a
block with no verified link to the prompt is always selected), and counts a mutant as a violation when it
kills a block its selection leaves out. It passes when the 95% Wilson upper bound on the share of
violating mutants is at or below 5%, over every mutant that is not a control. It fails:
* when no block has a verified link: selection could skip nothing;
* when the run holds no two-section mutant: two-section faults are where declared links fail most;
* when a verified link it is scored on was verified by the same run: score the gate on a later run, such
  as a new pair draw (`--seed`) or a new mutant plan. A rerun read whole from the cache is the same run;
* when the bound is above 5%.

With 0 violations the bound is at or below 5% from 73 mutants on. The gate record is bound to the prompt
(id, version and text hash) and to the suite (each spec's hash and its verified links to the prompt). A
changed prompt, spec or verified link makes it stale, and a stale or failed record keeps selection
advisory.

## When to use it

* Before you trust that a section is tested: a declared link is not evidence that the block notices a
  change to the section.
* To find the sections no block tests, and write blocks for them.
* Before letting `radius --sections` skip blocks on a prompt change: only a passing gate allows it.
* On the H7 suite (the Acme stand-in prompt, 30 sections, 37 blocks, `claude-haiku-5-5`), 25 of 90
  single-section mutants killed a block (drop 7 of 30, negate 17 of 30, rephrase 1 of 30), no control did,
  and 12 of 26 local sections had no killing mutant. Rephrase is optional for that reason.
* On a live rerun of that suite, the gate scored on the links the H7 run verified fails: 4 of 110 mutants
  kill a block their selection leaves out (2 single-section, 2 of 20 new two-section mutants), an upper
  bound of 9.0%. Section selection on that suite stays advisory. Scoring that rerun writes the two
  single-section misses in as 4 verified links (`upgrade_identify` to ly1, ly2 and ly3,
  `new_customer_details` to p1). The two pair misses, both on p1, move no link and stay known gaps. Links
  that rerun verified need a later run before the gate can be scored again.

## Commands and every option

```
driftbench radius mutate plan --prompt <file> --registry <file> --out <file> [--responses <file>] [--requests-out <file>] [--rephrase] [--only <sections...>] [--pairs 20] [--seed 20261014]
driftbench radius mutate run <paths...> --prompt <file> --registry <file> --mutants <file> --usd-per-run <usd> --budget-usd <usd> --out <file> [--target <adapter[:agent]>] [--mode F] [--runs 3] [--cache <file>]
driftbench radius mutate score <paths...> --run <file> --registry <file> [--write] [--gate-out <file>] [--json]
```

`radius mutate plan`:

| Option | Default | Meaning |
|---|---|---|
| `--prompt <file>` | required | the prompt file the registry describes. Its hash must match the registry's `text_sha256` |
| `--registry <file>` | required | its section registry (`prompts/<id>.sections.yaml`) |
| `--out <file>` | required | the mutants file to write (JSON): each mutant with its sections, operator, status, text and SHA-256 |
| `--responses <file>` | none | recorded mutator answers: a JSON object from request key to the new section text |
| `--requests-out <file>` | none | write the mutator requests that have no recorded answer, each with its `key`, `op`, `section` and `body` |
| `--rephrase` | off | add the rephrase operator |
| `--only <sections...>` | every section | mutate only these section ids; pairs are drawn among their local sections |
| `--pairs <n>` | `20` | how many two-section mutants to draw |
| `--seed <n>` | `20261014` | the seed of the pair draw |

`radius mutate run`:

| Option | Default | Meaning |
|---|---|---|
| `<paths...>` | required | spec files or folders. Each spec is one conversation |
| `--prompt <file>` | required | the baseline prompt |
| `--registry <file>` | required | its section registry |
| `--mutants <file>` | required | the file `plan` wrote, for the same prompt version |
| `--usd-per-run <usd>` | required | the cost of one conversation run, for the projection. A run whose adapter reports its cost counts that cost instead |
| `--budget-usd <usd>` | required | nothing is sent when the projection (every conversation of every mutant confirmed) is above this |
| `--out <file>` | required | the mutation run to write (JSON) |
| `--target <adapter[:agent]>` | each spec's own target | the agent to run. Each run hands it the prompt as `target.prompt` |
| `--mode <mode>` | `F` | `F` free-running or `T` teacher-forced |
| `--runs <n>` | `3` | runs per mutant, and confirmation runs per candidate conversation |
| `--cache <file>` | none | a JSON file of conversation runs keyed by mutant prompt hash, conversation and repeat: read first, written after each new run |

`radius mutate score`:

| Option | Default | Meaning |
|---|---|---|
| `<paths...>` | required | the specs the run covered |
| `--run <file>` | required | the mutation run `run` wrote |
| `--registry <file>` | required | the registry of the mutated prompt |
| `--write` | off | write the promoted links into each spec file's `metadata.links`. One YAML spec per file. Links stay out of the spec hash, so no stored run, carry or cache entry changes |
| `--gate-out <file>` | none | score the verified-link gate on this run, against the links the specs hold now, and write the record |
| `--json` | off | print one JSON document: `run`, `analysis`, `promotion`, `untested` and `gate` |

`radius --gate <file>` reads the record (authoring-blast-radius).

## Inputs

* A prompt file and its section registry (authoring-prompt-sections).
* Recorded mutator answers for negate, rephrase and the reword control. Write them once with any model:
  read the requests from `--requests-out`, answer each `body` as its `op` asks, and store the answer under
  its `key`. The instructions per operator are in `MUTATOR_INSTRUCTIONS` of `@agent-nexus/driftbench-core`.
* Specs that link their blocks to the sections, and an agent that runs with the prompt it is handed
  (`target.prompt`).

## Outputs and how to read them

`plan` prints `<ok> of <n> mutants of <prompt> <version>: <s> single-section, <c> controls, <p> two-section`
and one line per refusal reason.

`run` prints the projection first: `Projected: <b> baseline and <m> mutant conversation runs, at most <c>
confirmation runs; at most <usd> USD`. Then `Mutation run <id>: ... <n> conversation runs sent, <k> from
the cache, <usd> USD`. The id is a hash of the prompt, the rules, the mutants and the runs.

`score` prints the flaky blocks, the single-section mutants that kill a block per operator, the controls
that kill a block, the link counts (`<v> verified, <r> refuted, <n> new verified links`), and the untested
sections. With `--gate-out`: `Gate: PASS` or `Gate: FAIL`, with the reason and the mean share of stable
blocks the verified links would select.

Exit codes: `plan` 0, or 2 on bad input. `run` 0, 1 when the projection is above the budget (nothing was
sent), 2 on bad input. `score` 0, 1 when the gate was scored and failed, 2 on bad input.

## Worked example

The Acme example agent does not read the prompt it is handed, so no mutant changes what it does: every
declared link of the linked specs is refuted and the gate fails. The steps are the ones a real agent runs.
With no recorded answers, the plan holds the drops and the punctuation controls only.

```sh setup
cp -r examples/acme/prompts/linked linked
```

```sh
driftbench radius mutate plan --prompt examples/acme/prompts/acme-sales.md \
  --registry examples/acme/prompts/acme-sales.sections.yaml \
  --only store_hours explicit_confirm porting_check_first porting_timing --pairs 2 \
  --out mutants.json --requests-out requests.json
driftbench radius mutate run linked --prompt examples/acme/prompts/acme-sales.md \
  --registry examples/acme/prompts/acme-sales.sections.yaml --mutants mutants.json \
  --usd-per-run 0 --budget-usd 0 --out run.json
driftbench radius mutate score linked --run run.json \
  --registry examples/acme/prompts/acme-sales.sections.yaml --write --gate-out gate.json # exit 1
```

```text
8 of 18 mutants of acme-sales v1: 4 single-section, 4 controls, 0 two-section. Written to mutants.json.
  8 refused: no recorded mutator answer.
  1 refused: no accepted negate of explicit_confirm and store_hours.
  1 refused: no accepted negate of porting_check_first and store_hours.
  8 mutator requests have no recorded answer, listed in requests.json. Answer them by key in a --responses file and plan again.
Projected: 9 baseline and 72 mutant conversation runs, at most 72 confirmation runs; at most 0.0000 USD at 0 USD a run (budget 0 USD).
Mutation run 0196cae9a80055cb: 8 mutants, 81 conversation runs sent, 0 from the cache, 0.0000 USD. Written to run.json.
Mutation run 0196cae9a80055cb of acme-sales v1: 3 baseline runs, 8 mutants.
  Flaky blocks (no link moves): none.
  Single-section mutants that kill a block: 0 of 4 (drop 0/4).
  Controls that kill a block: 0 of 4.
  Links: 0 verified, 5 refuted, 0 new verified links from flips no link explained.
  Local sections no mutant kills a block with (4): store_hours, porting_check_first, porting_timing, explicit_confirm. Each is untested by the suite, or its mutants change nothing: candidates for new blocks.
Gate: FAIL. no block has a verified link to the prompt: selection could skip nothing. Mean selection ratio 1.000. Written to gate.json.
Links written into 3 spec files.
```

## Common errors

* `the prompt does not hash as the registry of <prompt> <version> says`: the prompt file is another version
  than the registry. Re-anchor the registry (`radius sections reanchor`) first.
* `<n> refused: no recorded mutator answer`: answer the requests of `--requests-out` in a `--responses` file
  and plan again.
* `the projected cost is at most <usd> USD, above the budget of <b> USD: nothing was sent`: raise
  `--budget-usd`, or mutate fewer sections with `plan --only`.
* `Gate: FAIL. ... verified by this same run`: the links the gate reads were verified by the run it is
  scored on. Plan new mutants (`--seed`) or rerun later, and score the gate on that run.
* `Gate: FAIL. the run has no two-section mutant`: plan with `--pairs` above 0 and answers for negate.
* `--write edits one YAML spec per file`: a JSON spec or a file holding several specs is not rewritten; use
  `--json` and copy the `promotion.links` of each spec.
