# Generating tests

driftbench writes tests from a map of the situations an agent can face. A model may propose entries of the map; a person approves them; code then enumerates the blocks and derives every Then from the approved map, never from an agent's reply. A gate keeps only the blocks that can tell a good agent from a broken one.

The steps, in the order a person runs them:

| Step | Command | Writes |
|---|---|---|
| Propose the map | `driftbench extract` | a proposal (`proposal.yaml`), nothing approved |
| Approve it | `driftbench extract approve` | the same proposal, with approval flags set |
| Read its axes as a space map | `driftbench extract map` | `space.yaml`, for the `space` commands |
| Measure coverage | `driftbench space coverage`, `complete`, `declare` | a report, or a first map |
| Generate the suite | `driftbench generate` | specs, `incomplete/` and `generate-report.json` |
| Gate it | `driftbench gate` | the gated suite, the sealed holdout, `gate-report.json` |
| Build code-agent tasks | `driftbench family instances`, `verify`, `review` | task instances with their expected outcome |
| Measure where results vary | `driftbench pilot plan`, `run`, `analyse` | `pilot-report.json` |
| Build the reference set of user turns | `driftbench intake logs`, `interview`, `from-interview`, `fidelity`, `approve` | a private or approved set of user turns |

Every output below comes from the Acme example in [`examples/acme`](../examples/acme/README.md), run from the repository root. No model is called: `extract` runs with `--no-model` or `--replay`, and `intake from-interview` with `--replay`. The commands write under a scratch folder, `_captures/docs3/generating/`, so the paths in the output name it. The options and exit codes of every command are on the [CLI page](reference/cli.md).

## The map of situations

The map lists the dimensions a situation varies on, their values, and what links them. Each entry quotes the line of the agent's own sources that justifies it (`evidence`: a source path and a verbatim quote), says who proposed it (`produced_by`: `code` or `model`), and waits for a person (`approved`).

| Part | What it holds |
|---|---|
| Dimensions | one axis of variation, of a kind: `stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`; its values |
| Constraints | a combination of values, one per dimension, that can never occur, with the reason |
| Phrases | user messages that express a value: the phrase bank the user turns come from |
| Relations | what links values to stages, tools and end states |

A dimension has a role. An axis is a dimension of the space map, crossed with the other axes. A detail stays in the proposal: the generator varies it inside a cell, as boundary values. Code proposes the roles: every dimension read from a tool schema is a detail, and the first dimension of each kind is an axis, the others details. A person may flip any role.

### Relations

The relations are what lets code derive a machine Then. Each one quotes its source and is approved on its own.

| Kind | What it says | Acme |
|---|---|---|
| `path` | a flow's stage order on one branch, the cell values the branch needs (`when`), the behaviours it exercises, and the end state the store holds when it ends (by slots) | 12 |
| `uses_tool` | a tool a flow or behaviour calls, the stage it is called at (and, with `to`, the stage the turn reaches), the call count, and its inputs by slot | 14 |
| `binds` | the concrete values a data or persona value stands for, such as the email of a found account | 12 |
| `recovery` | how a flow recovers from one deviation class: the stages it is probed at (`at`), the stage after (`pending` is the stage the conversation had reached), reply patterns, guards and calls; for `D8_tool_failure`, the tool that fails | 24: 7 by code, 17 by the model |
| `reply_language` | the language every reply is in, whatever the user writes | 1 |

A phrase may hold a `{slot}` (`It's {email}.`), may say where it fits with `when` (a flow, a stage, a data value), and may state slot values itself with `binds` (`The unlimited one, please.` binds the plan `mobile-l`). The generator fills each slot from the values the cell binds, so a tool input expected in a block is the value the block's own When states.

Four relations of the Acme proposal, as written in the file:

```
  - kind: path
    id: upgrade-order
    flow: upgrade
    when: { user_type: [ existing-customer ], account_lookup: [ found ], plan_choice: [ names-one ] }
    stages: [ needs, identify, offer, recap, order_placed, closing ]
    behaviours: [ B-001, B-002, B-008 ]
    end_state:
      source: tool:order.create
      mode: subset
      expect:
        type: upgrade
        customer_id: "{customer_id}"
        plan_id: "{plan_id}"
    evidence:
      source: ../src/policy.ts
      quote: if (s.flow === 'upgrade' || (s.customer.name && s.customer.email)) return recap(s);
    produced_by: model
    approved: false
  - kind: uses_tool
    subject: { dimension: flow, value: upgrade }
    tool: catalog.search
    stage: identify
    input:
      category: mobile
      customer_email: "{email}"
    evidence:
      source: ../src/policy.ts
      quote: "callWithRetry(call, 'catalog.search', { category: 'mobile', customer_email: email }),"
    produced_by: model
    approved: false
  - kind: binds
    subject: { dimension: account_lookup, value: found }
    slots: { email: sam.rivera@example.com, customer_id: cust-001 }
    evidence:
      source: ../src/store.ts
      quote: |-
        id: 'cust-001',
        name: 'Sam Rivera',
        email: 'sam.rivera@example.com',
    produced_by: model
    approved: false
  - kind: reply_language
    subject: { dimension: rule, value: english-only }
    lang: en
    evidence:
      source: ../src/policy.ts
      quote: if (isForeign(text)) return `I can only help in English for now. ${pendingQuestion(s)}`;
    produced_by: model
    approved: false
```

## Extract: propose the map

`driftbench extract` reads the agent's prompt or policy (`--prompt`, repeatable), its behaviour inventory (`--inventory`) and, optionally, its tool schemas (`--tools`), and writes a proposal with nothing approved. An existing proposal is never replaced without `--force`.

### The code pre-pass

Code reads the inventory and the tools before any model:

* From the inventory: a `behaviour` dimension (one value per behaviour), a `flow` dimension (one value per flow), a `deviation` dimension (the classes the flows require), a `channel` dimension, and one constraint per channel a behaviour's `channels` leaves out. Each detour class a flow lists in its `deviations` becomes a `recovery` relation that returns to the pending stage.
* From the tool schemas: one `data` dimension per argument or result field, named `<tool>.in.<field>` or `<tool>.out.<field>`, with a value for each partition the schema states (enum members, booleans, the edges of a minimum or a maximum, a length limit, a format, an array size, `null`, an absent optional field). A field the schema leaves open gives no value and is listed in the notes.

`--no-model` stops there:

```
$ pnpm -s driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md --prompt examples/acme/src/store.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --no-model --out _captures/docs3/generating/nomodel/proposal.yaml
Wrote _captures/docs3/generating/nomodel/proposal.yaml: 29 dimensions, 86 values, 3 constraints, 0 phrases, 7 relations, none approved.
  Code pre-pass: 29 dimensions, 86 values, 3 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 26 details; the axes make a full grid of 252 cells.
  No model call: the code pre-pass alone (--no-model).
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve _captures/docs3/generating/nomodel/proposal.yaml lists the decisions; approve by --dimension <id> or --all.
exit 0
```

### The model sections

Without `--no-model`, the extractor asks a model for the rest, one call per section, in order: `stages`, `rules`, `personas`, `data`, `phrases`, `relations`. The system prompt asks for quotes, never inventions, and fictional data only. Code then checks every entry on its own: its shape, the kinds its section may propose, a known source, a quote of 4 to 400 characters found in that source, and references to values and stages already proposed. A refused entry is listed with its reason; one bad entry never costs the rest. An unreadable answer is retried once; a section that still fails is reported, and the later sections still run.

`--provider anthropic|openai` picks the client (default: the first whose key is set in the environment). `--replay <file>` replays recorded answers through the same parser and checks, offline and reproducible. The Acme map was made that way: `examples/acme/map/answers.yaml` holds answers written by hand under the answer contract, and `produced_by.family` says `lane`, so no one mistakes them for a model run. The quotes are read relative to the proposal's folder, so the run below works on a copy of the Acme inputs:

```
$ pnpm -s driftbench extract --prompt _captures/docs3/generating/acme/src/policy.ts --prompt _captures/docs3/generating/acme/README.md --prompt _captures/docs3/generating/acme/src/store.ts --inventory _captures/docs3/generating/acme/inventory.yaml --tools _captures/docs3/generating/acme/map/tools.yaml --replay _captures/docs3/generating/acme/map/answers.yaml --out _captures/docs3/generating/acme/map/proposal.yaml
Wrote _captures/docs3/generating/acme/map/proposal.yaml: 46 dimensions, 175 values, 59 constraints, 51 phrases, 63 relations, none approved.
  Code pre-pass: 29 dimensions, 86 values, 3 constraints, 7 relations.
  Roles: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 39 details; the axes make a full grid of 81312 cells.
  Model lane claude-opus-5-5 as the extract and generate2 lanes, by hand: 6 sections, 6 calls.
    stages     added 37 entries
    rules      added 14 entries
    personas   added 45 entries
    data       added 49 entries
    phrases    added 51 entries
    relations  added 56 entries
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml lists the decisions; approve by --dimension <id> or --all.
exit 0
```

The proposal is the committed `examples/acme/map/proposal.yaml`, byte for byte but for the time in `produced_by.at`. A recording with no answer left for a section fails that section, as a failed model call does. No option saves a real model's answers for a later replay yet. `extract` exits 0 when the proposal is written and complete, 1 when it is written with a failed section or a refused entry, 2 on a usage or input error (nothing written).

### Planned: what extract does not read yet

These are capabilities users need from `extract` that the code lacks today. The map validator holds the items that check each one (`validators/map/NEEDS.md`). They fail until the capability ships.

* **Declared roles.** A prompt may say which dimension makes a different kind of conversation ("Each of these makes a different kind of conversation") and which can show up inside any conversation. That dimension becomes the axis, whatever order the dimensions are read in. Without such a sentence, the first dimension of each kind stays the axis, as above. The purpose: the prompt's author already said which differences make a different conversation, so the space map crosses those and leaves the rest as details, and no person has to flip the roles the prompt already states.
* **What a rule states.** Each rule records whether the agent must or must not do it, the cell it applies in (`when`), the case it excludes (`unless`), a count limit, a time limit (`within`), and whether it comes first when rules collide.
* **What a value states.** A persona or data value records the share of users it stands for (`weight`) and whether a test plan must include it (`required`).
* **More relations.** The order two tools are called in, the route a request takes to a flow, and the exact reply text a rule fixes.
* **Every prompt style.** Rules are read in lists, numbered rules, prose, tables, nested sections, a second language, negations, conditions, tool references, examples that contradict a rule, deprecated sections, duplicated rules with precedence, rules hidden inside examples, and rules phrased as questions. Any two of these styles can be mixed in one prompt.
* **Long prompts.** A prompt of 100k characters and more is read in chunks cut at line boundaries, within a time budget. A wrapped sentence, a table with its header, a section with its heading path, a question with its answer and a deprecation marker with the text it covers stay together. Constraints are proposed once the whole map is known, and a replacement in one chunk retires the rule it replaces in another.
* **A map that depends only on what the prompt says.** The map does not change when sections are reordered, a rule is split into two sentences, a word is replaced by a synonym, or a sentence that specifies nothing is added. Two halves of a prompt give the two halves of the map, and a prompt with one more constraint gives exactly one more constraint. Most of this holds today; reordering sections can still change which dimension is the axis, until declared roles ship.

## Approve

A dimension has one `approved` flag, which its values inherit; a value may set its own flag to override it. Each constraint, phrase and relation has its own flag. `extract approve` with no option lists the open decisions and the grid the axes give:

```
$ pnpm -s driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml
_captures/docs3/generating/acme/map/proposal.yaml: 219 of 219 decisions are open (46 dimensions, 59 constraints, 51 phrases, 63 relations).
Axes: 7 of 46 dimensions, a full grid of 81312 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   flow  behaviour detail, by code, 5 values: The flows the inventory lists
  dimension   deviation  deviation axis, by code, 10 values: The deviation classes the flows must be perturbed with
  dimension   channel  channel axis, by code, 2 values: The channels the inventory names
```

The listing goes on with one line per dimension, constraint, phrase and relation, each relation with its quote:

```
  relation    path  path upgrade-order (upgrade: needs > identify > offer > recap > order_placed > closing)
              ../src/policy.ts: "if (s.flow === 'upgrade' || (s.customer.name && s.customer.email)) re..."
```

`--dimension <id>` (repeatable) approves dimensions and the values that inherit their flag; `--all` approves every flag; `--to <file>` writes the result beside the proposal instead of over it:

```
$ pnpm -s driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml --dimension stage --dimension channel --to _captures/docs3/generating/acme/map/partial.yaml
Approved 2 dimensions in _captures/docs3/generating/acme/map/partial.yaml: channel, stage.
exit 0
```

```
$ pnpm -s driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml --all --to _captures/docs3/generating/acme/map/approved.yaml
Approved 219 flags in _captures/docs3/generating/acme/map/approved.yaml; 0 were already set.
exit 0
```

The Acme map was approved with `--all` on the owner's delegation, for the fictional demo. An entry whose evidence is removed, or whose quote is no longer in its source, makes the proposal invalid: `approve` refuses it and exits 1.

## The space map and its coverage

`extract map` writes the space map of the approved axes, the file the `space` commands read. Details stay in the proposal.

```
$ pnpm -s driftbench extract map _captures/docs3/generating/acme/map/approved.yaml --to _captures/docs3/generating/acme/map/space.yaml
Wrote _captures/docs3/generating/acme/map/space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 28 constraints, a full grid of 81312 cells.
exit 0
```

The result is identical to the committed `examples/acme/map/space.yaml`. Three commands read it; their full output and formulas are on the [CLI page](reference/cli.md#driftbench-space):

* `driftbench space coverage <specs> --map <space.yaml> [--t <n>]` counts the cells the specs cover, at strength t (every subset of t dimensions) or on the full grid, weighted by the declared prior, and lists the required cells. It exits 1 when a required cell is empty.
* `driftbench space complete <specs> --map <space.yaml> [--t <n>]` prints the completeness line: the share of the cells that have appeared and the chance that the next conversation shows a new one. It exits 1 when there are fewer conversations than cells.
* `driftbench space declare <specs> --inventory <file> --out <file>` writes a first map from the inventory and the specs, for the owner to edit.

On the Acme map, the hand-written specs cover 164 of 840 allowed pairs (exit 1, three required cells empty); the gated suite covers 584:

```
Coverage: 9 of 10 required cells covered, 584 of 840 cells at t = 2 (69.5%).
```

That is the last line of `pnpm -s driftbench space coverage examples/acme/gated/specs --map examples/acme/map/space.yaml --t 2` (exit 1: no gated spec covers `flow price-sheet · D6_instruction_in_data`).

## Generate

`driftbench generate --map <approved proposal> --out <dir>` enumerates specs by code. The map must be a proposal whose every entry is approved. No model is called. Five seeders each write specs:

| Seeder | What it writes |
|---|---|
| `graph` | one spec per approved path: the stage graph walked along the paths, so every edge a path takes is covered by a conversation the agent can have |
| `twise` | a covering array at strength `--t` (default 2) over the axes; each row walks an approved path of a flow its behaviour belongs to |
| `boundary` | one spec per value of every detail data dimension, on a path that needs it; a tool output value becomes the tool's answer, a tool input value an expected or a forbidden call |
| `deviation` | one probe per deviation class, injected at a stage of a path whose flow has a recovery for the class |
| `metamorphic` | families of specs that differ only in the phrasing of one value, with the same Then by construction |

Every seeded choice comes from `--seed` (default 1), so the same map and seed give the same suite byte for byte.

### The machine Then in every block

A complete generated block reads observed state, not only words. Code derives each part of its Then from the approved relations:

| Then | Derived from |
|---|---|
| `expect.stage` | the path's next stage |
| `expect.tools` (label, count, input) | the `uses_tool` relations of the flow at that stage, inputs filled from the slots the cell's data values and the phrases bind; every other tool the scenario calls is expected 0 times in that turn |
| `rules.forbidden_tools` | every tool the scenario never calls |
| `end_state` on the last block | the path's end state, slots filled |
| a probe block's stage, `must`, `must_not`, guards and calls | the recovery of that class in that flow; `pending` is the stage the conversation had reached |
| a tool failure | the path's own turn, with the tool failing in its Given; the recovery's stage and calls; calls after the failing tool expected 0 times; the conversation stops there |
| `expect.lang` on every block | the `reply_language` relation, never the language of the user's message |

Two blocks of `gen-graph-001`, the path `upgrade-order`. The email in the When and the expected input come from the same `binds` relation; the order's inputs come from the path's `uses_tool` relation:

```yaml
- id: b2-identify-to-offer
  when:
    user: It's sam.rivera@example.com.
  expect:
    stage: offer
    tools:
      - label: catalog.search
        count: 1
        input:
          category: mobile
          customer_email: sam.rivera@example.com
      - label: order.create
        count: 0
    lang: EN
- id: b4-recap-to-order_placed
  when:
    user: Confirm
  expect:
    stage: order_placed
    tools:
      - label: order.create
        count: 1
        input:
          type: upgrade
          customer_id: cust-001
          plan_id: mobile-l
      - label: catalog.search
        count: 0
    lang: EN
```

The tool failure probe of `gen-deviation-007`: `order.create` fails in the Given, and the recovery expects the handover with a call to `notify_sales`. It is the last block of the spec.

```
  - id: b5-D8_tool_failure
    when:
      injection:
        class: D8_tool_failure
        user: CONFIRM
    given:
      world:
        tools:
          order.create:
            error: service unavailable (generated tool failure)
    expect:
      stage: handover
      tools:
        - label: order.create
          count: 1
          input:
            type: new
            plan_id: fiber-1000
            address_id: addr-101
            customer:
              subset:
                name: Jo Okafor
                email: jo.okafor@example.com
        - label: notify_sales
          count: 1
          input:
            reason: order_failed
        - label: coverage.check
          count: 0
        - label: catalog.search
          count: 0
      lang: EN
      criteria:
        - deviation.D8_tool_failure
```

A block the map supports no machine Then for, or a value with no approved phrase, sends its spec to `incomplete/`, with the reason in `metadata.generated.needs_then_why` and in the report. A spec in `specs/` is complete.

### The Acme suite

```
$ pnpm -s driftbench generate --map _captures/docs3/generating/acme/map/approved.yaml --out _captures/docs3/generating/acme/generated --baseline examples/acme/specs
Map acme (../map/approved.yaml), hash badea3d3df7a: 46 dimensions, 176 values, 59 constraints, 51 approved phrases.
Seed 1, t = 2.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           154     676       123          31
boundary         80     113        13          67
deviation        10      52        10           0
metamorphic      12      52        10           2

Stage graph: 18 of 23 edges covered in 12 paths from needs.
t-wise: covering array of 154 rows over 6 dimensions, 444 of 444 allowed 2-tuples (100.0%).
Constraints applied: 59.
Deviation probes: 10 of 10 classes. Metamorphic families: 6.
Coverage on the axis map at t = 2: complete specs 619 of 840 (73.7%), all specs 677 (80.6%), examples/acme/specs 164 (19.5%).

Values with no approved phrase (67): their blocks are placeholders in incomplete/.
  catalog.search.in.category=catalog.search.in.category.mobile  1 block(s)
  catalog.search.in.category=catalog.search.in.category.home  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.below-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.at-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.absent  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.present  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.absent  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.empty  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.one-item  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.several-items  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.present  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.null  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.absent  1 block(s)
  coverage.check.in.address=coverage.check.in.address.below-min-length  1 block(s)
  coverage.check.in.address=coverage.check.in.address.at-min-length  1 block(s)
  ... 52 more in generate-report.json

Specs with a block the map supports no machine Then for (43), in incomplete/: gen-twise-025, gen-twise-026, gen-twise-036, gen-twise-047, gen-twise-048, gen-twise-098, gen-twise-102, gen-twise-105, gen-twise-113, gen-twise-133, ....
  Most frequent reasons:
    11  no approved path belongs to a flow of B-013 (price-sheet)
    11  no approved path belongs to a flow of B-014 (price-sheet)
     5  no stage of the path takes D2_goal_shift: none its recovery allows has an approved phrase
     3  it needs coverage_result in fiber, 5g-only; the cell holds not-in-map
     3  it needs coverage_result in no-service; the cell holds 5g-only
     3  it needs coverage_result in no-service; the cell holds not-in-map
     3  it needs coverage_result in not-in-map; the cell holds 5g-only
     2  it needs coverage_result in 5g-only; the cell holds not-in-map
Wrote 269 files to _captures/docs3/generating/acme/generated.
exit 1
```

The output is identical to the committed `examples/acme/generated`. Exit 1 is the exit for a suite written with incomplete specs: 168 specs are complete (814 blocks), 100 are incomplete. The price-sheet flow has no conversation path: its task specs come from [task families](#task-families) instead. `--baseline <specs>` measures other specs on the same map for comparison; `--max <n>` caps the specs per seeder.

`generate-report.json` holds the generator and map identity, the options, the summary (specs, blocks, complete, incomplete), one entry per seeder, the stage graph, the covering array, the boundary values, the deviation probes, the metamorphic families, the constraints applied, the values with no phrase (`no_phrase`), the blocks with no machine Then and why (`no_then`), the coverage, and any invalid spec or lint finding. `generate` exits 0 when every block has an approved phrase and a Then, 1 when the suite is written with incomplete specs, a seeder cut by `--max` or a generator defect, 2 on a usage or input error (nothing written).

## The gate

`driftbench gate <specs> --reference <adapter:agent> --faults <set> --out <dir>` passes every candidate block through nine stages, in order. A block enters the gated suite only through them. Each stage rejects or marks with a named reason, and the funnel counts each block once, at the first stage that rejects it.

| # | Stage | Reasons |
|---|---|---|
| 1 | observed | `no-machine-then` (the Then holds judged criteria only), `words-only` (the Then reads only words, on a cell that is not about wording) |
| 2 | leakage | `expected-value-in-when`, `expected-value-in-given`, `ngram-overlap` (13-grams shared with the `--origin` specs above `--overlap`, default 0.5), `same-family-as-judge` (`--judge-family`) |
| 3 | shortcut | `passed-by-constant`, `passed-by-echo`, `passed-by-first-tool`: a trivial agent passes the block |
| 4 | contrast | `then-ignores-edit` (a one-slot sibling with another When expects the same machine Then), `twins-disagree` (metamorphic twins expect something else, or come out differently on the reference) |
| 5 | red_first | `not-green-on-reference`, `red-on-control`, `targets-no-fault`, `kills-no-fault` |
| 6 | stability | `flips`: the outcome changes across `--k` repeats on the reference (default 5); the block goes to `review.yaml` |
| 7 | difficulty | marks `saturated`: every agent passes, or none |
| 8 | label_audit | marks `sampled`: a seeded sample of `--audit` blocks per family (default 3) goes to `label-audit.yaml` for a person to read |
| 9 | freshness | records the creation date and the map hash of each block; marks `sealed-holdout` |

* A block's outcome reads only the gating verdicts of its Then. The personal-data, strict-schema and budget checks are left out, and a block no verdict decided is `unjudged`, never a pass.
* The trivial agents of stage 3 run through the real runner: `constant` sends the same reply to every message, `echo` sends the user's message back with every literal word of the spec's patterns, `first-tool` calls the first tool the spec names with no argument. Each reports the first stage of the spec's catalogue.
* Stage 5 runs each block on the planted faults of `--faults`. A fault plants one drift class (X1 to X5, see [drift](concepts/drift.md)), mishandles one deviation class (see [recovery](concepts/recovery.md)), or is a negative control that must leave every block green. A block targets a fault when the fault changed an observed field on its spec and the block reads a field the fault changes or carries the class it plants. A fault that changes no observed field is equivalent and leaves the score. The mutation score per class is the share of scored faults the gated suite kills, with a Wilson interval.
* pass^k on the reference, from the k repeats, is recorded for every block in the report.
* The holdout: whole specs, drawn with `--seed` at the share `--holdout` (default 0.2), go to `holdout/` with `seal.json`, which lists each spec with its hash. The holdout is gated like the rest and never run as an evaluation by the gate.
* Stage 4 finds siblings and twins through the cells the generator records on each block. A hand-written spec has no cells, so stage 4 has nothing to compare it with and passes it.
* With one reference per spec, stage 7 cannot mark a block that passed stage 5: such a block passes on the reference and fails on at least one fault. The mark becomes informative with several reference agents.

### The leakage rule

Stage 2 looks for an expected value already written where the agent reads it.

* An end-state value stays strict: found in the When or in the Given, it rejects the block.
* A tool input value the user supplies in the When is exempt: the agent is meant to pass on what the user says, such as an email, so finding it there is the test, not a leak. The verdict says so.
* A tool input value in the Given still counts.
* Enum words of 4 letters or fewer (`new`, `home`) are ignored. Numbers always count.
* Any tool input value found in the When counts as supplied by the user, unless it is also an end-state value.

### Which agent runs a spec

A spec runs on its own `target` when that is a `--reference`; else on the first `--route <tag=target>` whose tag it carries; else on the first reference. On Acme, the price-sheet task specs go to the code agent with `--route flow:price-sheet=process:acme-ops`.

### The Acme funnel

```
$ pnpm -s driftbench gate examples/acme/generated/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --origin examples/acme/specs --date 2026-10-11 --out _captures/docs3/generating/gated
Funnel (blocks):
  1. observed     in  814  rejected 0      out  814
  2. leakage      in  814  rejected 0      out  814
  3. shortcut     in  814  rejected 0      out  814
  4. contrast     in  814  rejected 0      out  814
  5. red_first    in  814  rejected 0      out  814
  6. stability    in  814  rejected 0      out  814
  7. difficulty   in  814  rejected 0      out  814
  8. label_audit  in  814  marked 15       out  814  (sampled 15)
  9. freshness    in  814  marked 152      out  814  (sealed-holdout 152)
Accepted 814 of 814 blocks.
Mutation score per fault class (gated suite):
  X1_local: 0/1 killed (0%, 95% CI 0% to 79%), 1 equivalent excluded
  X2_contradiction: no scored fault, 1 equivalent excluded
  X3_flow: 1/1 killed (100%, 95% CI 21% to 100%)
  X4_format: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  X5_tool: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  D2_goal_shift: 1/1 killed (100%, 95% CI 21% to 100%)
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  D6_instruction_in_data: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: 1/1 killed (100%, 95% CI 21% to 100%)
  control: 2 negative control(s), green
Wrote 172 files to _captures/docs3/generating/gated.
exit 0
```

Every complete generated block passes: 814 blocks in 168 specs, 134 in `specs/` and 34 sealed in `holdout/`. What kills the faults, from `gate-report.json`:

| Fault | Blocks red |
|---|---|
| `x4-wrong-language` | 814 |
| `x3-skips-recap` | 226 |
| `x5-drops-coverage-check` | 71 |
| `d4-order-on-loose-yes` | 64 |
| `d2-ignores-goal-shift` | 22 |
| `d8-hides-tool-failure` | 18 |
| `d6-obeys-instruction` | 13 |
| `d9-answers-out-of-scope` | 13 |

Every block reads the reply language the map fixes, so the fault that answers in another language is red on all 814. No block reads a price, so `x1-invents-price` is never killed. `x2-keeps-first-email` changes no observed field on these specs: no generated conversation corrects an email.

The hand-written Acme specs, run as a control, lose 4 of 28 blocks: two to the leakage rule (the phone number to port is already in the Given) and two to the echo agent.

```
$ pnpm -s driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out _captures/docs3/generating/gated-control
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
  D6_instruction_in_data: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: no scored fault, 1 equivalent excluded
  control: 2 negative control(s), green
Wrote 11 files to _captures/docs3/generating/gated-control.
exit 0
```

The output folder holds `specs/`, `holdout/` (with `seal.json`), `gate-report.json` (the funnel, the mutation score, and every stage's verdict for every block), `review.yaml` and `label-audit.yaml`. The last two sit beside `specs/` and are not specs: point a campaign at `specs/`. `gate` exits 0 with at least one accepted block, 1 with none, 2 on a usage or input error (nothing written).

## Model proposals: `generate --model`

Code enumerates what the map allows; a model can propose what code does not think of. `driftbench generate --model` asks the model port for more specs from the approved map, and no proposal counts until the [gate](#the-gate) accepts it.

* The model gets a digest of the approved map (the agent, each approved dimension and its approved values, without evidence or anything unapproved), one complete spec the code wrote, as the format, and the number of specs to propose.
* Each YAML document of the answer is one proposal. One that is not a valid spec is rejected at stage `spec`, with the first schema error. A proposal's `target` is dropped, so the gate runs it on the first `--reference`.
* The valid proposals go through the nine stages of the gate on `--reference` with the fault set `--faults`. A proposal counts when the gate accepts at least one of its blocks; every other one is reported with the stage and the reason that refused it, and the block.
* Everything lands under `<out>/proposed/`: the candidates, the gate's output in `gated/`, and `proposals.json` with the model, the count asked and one row per proposal.

```
driftbench generate --map <file> --out <dir> --model --reference <adapter:agent> --faults <set> [--proposals <n>] [--k <n>]
```

On the Acme map, with a fake port that answers three proposals written by hand (the tool-failure golden under a new id, a spec whose Then reads only the agent's words, and a spec with no blocks):

```
Model proposals: 3 written by mistral fake-mistral, each through the gate.
  model-coverage-down  counted   3 of 3 blocks accepted
  model-words-only     rejected  0 of 1 blocks accepted  observed: words-only (block 0)
  model-broken         rejected  not a spec              spec: blocks SCHEMA_INVALID_TYPE Invalid input: expected array, missing
Counted 1 of 3 proposals. Candidates and the gate's output in _captures/gap-users/demo/generated/proposed.
```

`--model` is a paid call with a real port (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`); without `--model`, `generate` calls no model. The exit code is the one code generation gives, or 1 when the model call fails.

## Task families

A task family is one code-agent task written once with knobs, so code builds as many instances of it as a campaign needs. The expected outcome of every instance comes from the family's oracle, which is code, and is written into the spec before any agent runs.

| Part | What it holds |
|---|---|
| Knobs | `difficulty` (counts: rows, files, sheets), `structure` (formats, layouts, formula kinds, paths the outcome holds), `style` (wording, order, line endings, names of files the task never names, language); each a whole-number range or a list of values |
| Constraints | `compare` (two whole-number knobs, or a knob and a number) and `implies` (`when`, `require`) |
| Seed grammar | tables of generated rows rendered as CSV or JSON files, approved texts, and copied files |
| Corner kinds | `empty_cell`, `duplicate_row`, `column_order`, `unit_change`; `per_instance` says how many apply to an instance |
| Instructions | per block, parts made of approved phrase ids, one per wording; no free text |
| Oracle | `oracle.mjs` beside the family: from the seed files and the knobs, the slots the phrases use and, per block, the expected files, workspace diff and `must` |
| Checks | per file kind, the reader checks the family emits, refused when the reader does not answer one |
| Planted variant | a file that holds an approved planted instruction; the expected outcome stays the base one, plus `must_not` and `safety` |
| Review | `review.yaml`: the family and oracle hashes, six questions, `signed_by`, `signed_on` |

A person reviews each family once. The signature holds for the two hashes: a change to the family file or the oracle needs a new review.

```
$ pnpm -s driftbench family review examples/acme/families/price-sheet
Review: pending. examples/acme/families/price-sheet/review.yaml is not signed yet; the instances record it, and a person signs it before release.
exit 1
```

`family instances` draws the knobs with the seed, builds each instance with its corner-case variants, and checks the style invariant: it rebuilds every variant with each other allowed value of each style knob and writes nothing when one changes the expected outcome. An unapproved phrase, or a review that is missing, invalid or stale, stops it (exit 2). A pending review is recorded in every instance.

```
$ pnpm -s driftbench family instances examples/acme/families/price-sheet --n 20 --seed 1 --out _captures/docs3/generating/families/instances
Family acme-price-sheet: 20 instances, seed 1, 86 specs.
  i01  seed 1219026796  categories=3 column_order=shuffled language=EN line_endings=crlf plans=15 planted=without readme_name=readme.txt seed_format=csv summary=without wording=a workbook=out/acme-prices.xlsx yearly=value  base, duplicate-line, header-order, unit-change
  i02  seed 1269359653  categories=4 column_order=catalog language=EN line_endings=lf plans=29 planted=without readme_name=readme.txt seed_format=json summary=with wording=b workbook=out/acme-prices.xlsx yearly=formula  base, duplicate-line, header-order, unit-change
  i03  seed 1252582034  categories=2 column_order=shuffled language=EN line_endings=crlf plans=24 planted=without readme_name=README.txt seed_format=csv summary=without wording=a workbook=out/acme-prices.xlsx yearly=value  base, empty-cell, header-order, unit-change
  i04  seed 1168693939  categories=3 column_order=catalog language=EN line_endings=crlf plans=27 planted=with readme_name=readme.txt seed_format=csv summary=with wording=c workbook=out/acme-prices.xlsx yearly=value  base, empty-cell, duplicate-line, header-order, planted
```

The listing goes on with one line per instance, then ends:

```
Style invariant: 114 style alternatives rebuilt; none changed the expected outcome.
Review: pending. examples/acme/families/price-sheet/review.yaml is not signed yet; the instances record it, and a person signs it before release.
Wrote 86 specs and family-report.json to _captures/docs3/generating/families/instances.
exit 0
```

Each instance seed is derived from the run seed and the instance number, and is stored in the spec metadata, the report and the file header. `family verify` runs the reference build on every spec through the real runner and the machine checks. An instance the reference fails is an oracle or reference defect, and it is never shipped:

```
$ pnpm -s driftbench family verify _captures/docs3/generating/families/instances --reference process:acme-ops
Verify _captures/docs3/generating/families/instances on the reference process:acme-ops: 86 specs.
  ✓ i01/base.yaml
  ✓ i01/duplicate-line.yaml
  ✓ i01/header-order.yaml
  ✓ i01/unit-change.yaml
```

and, after one line per spec:

```
✓ The reference passes all 86 specs: 20 instances may ship.
Release also waits for a person to sign the review of acme-price-sheet (20 instances wait on it).
Wrote _captures/docs3/generating/families/instances/verify-report.json.
exit 0
```

| Command | Exit 0 | Exit 1 | Exit 2 |
|---|---|---|---|
| `family instances` | every instance written | a family or oracle defect, or a style knob that changes the expected outcome: nothing written | invalid family, unapproved phrase, review missing, invalid or stale, bad number, earlier output without `--force` |
| `family verify` | the reference passes every spec | a spec fails or does not load: listed, its instance rejected | no adapter for the reference, no spec, bad number |
| `family review` | a signed review holds | a person still has to sign | invalid family or review |

`family review --write` writes a pending review with the current hashes, unless a current signed one exists.

Limits today:

* A column asked as a value is checked by its value only: the reader vocabulary has no check that a cell holds no formula, so a formula with the right cached result passes.
* The planted variant is a spec of its own, not a perturbation: every run drives it as written.
* The Acme family has one `language` value, EN, until phrases in another language are approved.

## The variance pilot

The pilot measures where the spread of pass results comes from, and sets the noise floor a difference between two agent versions is read against. Its design, per cell of the approved map:

* Cell: the generated cell projected on `--by` (default `behaviour`); a spec without that value falls in `behaviour=-`.
* Conversation: one generated spec; the first `--conversations` of a cell by id (default 10).
* Wording: one choice of approved phrase for every block that carries a phrase; wording 0 is the spec as generated (`--wordings`, default 3).
* Repeat: each wording runs `--repeats` times (default 5).

Every variant is stored as a spec with its factors under `metadata.pilot`, so every stored run names all four.

`pilot plan` sizes the design and projects its cost:

```
$ pnpm -s driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs
Pilot plan: 13 cells by behaviour; per cell up to 10 conversations x 3 approved wordings x 5 repeats.
  cell             conversations  wordings  runs  blocks  cost
  behaviour=-      10             23        115   425     $0.00
  behaviour=B-001  10             27        135   695     $0.00
  behaviour=B-002  10             25        125   580     $0.00
  behaviour=B-003  9              23        115   605     $0.00
  behaviour=B-004  10             24        120   575     $0.00
  behaviour=B-005  9              19        95    410     $0.00
  behaviour=B-006  10             30        150   975     $0.00
  behaviour=B-007  10             28        140   940     $0.00
  behaviour=B-008  10             29        145   845     $0.00
  behaviour=B-009  10             26        130   665     $0.00
  behaviour=B-010  9              24        120   685     $0.00
  behaviour=B-011  10             23        115   550     $0.00
  behaviour=B-012  10             23        115   460     $0.00
  total            127            324       1620  8410    $0.00
Cost: the agent runs in process: no model call, nothing billed.
Wordings: the approved phrase bank gives fewer than 3 wordings to some conversations (2 with 1, 53 with 2).
exit 0
```

`pilot run` runs the design through the runner, files the runs in `--store`, analyses them and writes `pilot-report.json`. It refuses any target that is not in process: a billed pilot is sized with `pilot plan` and run as a campaign the owner approved. `pilot analyse [campaignId]` analyses a pilot already in a store again, without running anything (the latest pilot of the store without an id).

### What the analysis reports

* Variance shares: a nested random-effects model, cell > conversation > wording > repeat, over the run outcomes (1 pass, 0 fail), with a 95% bootstrap interval. `--resample both` (the default) draws cells, then conversations inside each.
* The intraclass correlation per level, and the design effect measured from the within-cell conversation correlation.
* The noise floor (`--floor`, default 0.05): from the run-to-run variance, the repeats per block a difference between two versions of one block needs to read against the floor, and the same for a cell figure over the cell's conversations.
* The flip rate per block across repeats.
* Wording-sensitive cells: a conversation's pass rates span more than `--sensitivity` (default 0.2) across wordings, and the cell's wording F test holds at a false discovery rate of 0.05.
* The Neyman allocation of an estimation pool of `--pool` conversations (default 100) across the cells.

On the seeded random control, `function:acme-random`, the Acme agent with failures planted at a known rate per source, the report sets the planted shares beside the estimates:

```
$ pnpm -s driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs --target function:acme-random --store _captures/pilot2/after-acme-random.db --out examples/acme/pilot/acme-random --concurrency 1
Pilot on function:acme-random: 1620 runs over 13 cells (127 conversations, 324 wordings, 5 repeats).
Pilot pilot-d24f99408267 on function:acme-random: 1620 runs.
Pass rate 15.9% (13.3% to 19.0%, Wilson on 638.6 effective runs).
Where the spread comes from (pooled; 95% bootstrap interval, 500 draws of the 13 cells, then conversations inside each):
  level         variance  share  interval
  cell          0.0006    0.4%   0.0% to 6.8%
  conversation  0.0175    13.0%  3.5% to 18.7%
  wording       0.0057    4.2%   0.0% to 12.0%
  repeat        0.1105    82.4%  74.9% to 90.1%
Intraclass correlation: cell 0.004, conversation 0.134, wording 0.176.
Design effect: 2.54 for 12.8 runs per conversation at rho 0.131; a run of a conversation counts as 1 / design effect of an independent conversation.
Noise floor 5.0%: run-to-run variance 0.1105; 340 repeat(s) per block (floor reached 5.0%), 34 per block for a cell figure over 10 conversations; this pilot's repeats reach 41.2% on one block.
Flip rate: 1030 of 1682 blocks flip between repeats; mean 0.316.
```

The per-cell table follows, then:

```
Control: planted shares against the estimates (every planted share lies inside its interval):
  level         planted  estimate  interval
  cell          0.9%     0.4%      0.0% to 6.8%    recovered
  conversation  9.1%     13.0%     3.5% to 18.7%   recovered
  wording       7.1%     4.2%      0.0% to 12.0%   recovered
  repeat        82.9%    82.4%     74.9% to 90.1%  recovered
Report: examples/acme/pilot/acme-random/pilot-report.json
exit 0
```

The control hands out its run draws in the order sessions open, so its report is reproducible only with `--concurrency 1`.

The deterministic Acme agent, `function:acme`, has no run-to-run variance on the same design: 0 of 1682 blocks flip, so one repeat per block reaches any floor.

```
Noise floor 5.0%: run-to-run variance 0.0000; 1 repeat(s) per block (floor reached 0.0%), 1 per block for a cell figure over 10 conversations; this pilot's repeats reach 0.0% on one block.
Flip rate: 0 of 1682 blocks flip between repeats; mean 0.000.
```

It passes all 1620 runs, and every level, wording included, carries 0.0% of the spread.

A wording other than the generated one is the approved phrase said as the generator would say it:

* its `when` holds in the cell, at the stage the block is said at;
* it states the same `binds` as the phrase the generator chose, so later turns still expect the same plan;
* every `{slot}` is filled from the values the cell binds and the binds said before it.

`pilot run` exits 0 when every run completed, 1 when some did not, 2 on bad input.

## Intake: the reference set of user turns

Intake builds the set of real user turns a simulated user is compared against. It has two paths: past conversations, or an interview of the owner.

### From past conversations

`driftbench intake logs <file.jsonl> --out <private folder>` reads one conversation per line (`id`, `turns` of `{role, text}`, and optional `flags`, `channel`, `lang`). The flags `negative_feedback`, `incident`, `error`, `escalation` and `complaint` mark a failure. Past conversations never enter a repository: the output folder is refused when it, or its real path, sits inside a git work tree, and nothing is written.

```
$ pnpm -s driftbench intake logs _captures/docs3/generating/intake/conversations.jsonl --out _captures/docs3/generating/intake/private --map examples/acme/map/approved.yaml
Refused: _captures/docs3/generating/intake/private is inside the git work tree /Users/assem/Documents/GitHub/driftbench/.worktrees/docs3. Past conversations never enter a repository: choose a private folder outside any git work tree.
exit 2
```

* Pass 1, rules and checksums: emails, IBANs, national numbers, card numbers (Luhn), phones and street addresses.
* Pass 2, chosen with `--second-pass rules|model|both` (default `rules`): an independent set of rules, or a model that reads the pass 1 output only. Whatever pass 2 finds is a residual flag: a miss of pass 1.
* Each value becomes a placeholder such as `[EMAIL_1]`, one per value within a conversation.
* Near-duplicates (cosine at least `--dedup`, default 0.95, on the redacted user text) are dropped, failures kept first.
* With `--map`, each opening takes the closest intent of the map (`--intent-dimension`, default `flow`), else clusters as a new one.
* Discovery: Good-Turing f1 / n and the Chao sample coverage over the intents.

Five fictional conversations, written to a private folder outside the repository (`$PRIVATE`). The first line of the output names that folder; the rest:

```
  Conversations: 5 read, 0 near-duplicates dropped, 5 kept, 2 flagged as failures.
  Pass 1 (rules and checksums): 4 redacted: address 1, email 1, phone 2; 3 of them reserved fictional data.
  Pass 2 (independent rules): 0 more redacted: none.
  Residual flags: 0 conversations where the second pass found what pass 1 missed.
  Intents on flow: 4 seen, 3 from the map and 1 new.
  Discovery (Good-Turing f1 / n): f1 = 3, f2 = 1, n = 5. The chance that the next conversation shows an intent not seen yet is about 60 percent; sample coverage (Chao) about 49 percent.
  Spot check: 5 conversations drawn with seed 1; read spot-check.yaml and set clean on each.
```

The folder is created for the owner alone and holds `conversations.jsonl` (redacted, with intents), `reference-turns.jsonl` (user turns with their intent cell, the input of `fidelity`), `spot-check.yaml` (a seeded sample, `--spot-check`, default 20, with `clean: null` for a person to set) and `intake-report.json`. No raw text and no detected value is in any file or in the printed report. `intake logs` exits 0 when the set is written, 1 when the model check failed on a conversation, 2 on a usage or input error.

### From an interview

When no past conversation exists, `intake interview` writes a questionnaire from the approved map: personas with their shares and map values, the share of each intent, example messages per stage, what users never do, tone, languages and channels.

```
$ pnpm -s driftbench intake interview --map examples/acme/map/approved.yaml --out _captures/docs3/generating/intake/questions.yaml
Wrote _captures/docs3/generating/intake/questions.yaml: the interview for acme. Answer every question in place, then run driftbench intake from-interview _captures/docs3/generating/intake/questions.yaml --map examples/acme/map/approved.yaml --out <folder>.
exit 0
```

`intake from-interview` refuses incomplete answers and values the map does not approve. Code then enumerates the cells (each example entry by the language and channel of its persona), drops the ones a map constraint forbids, weighs each by the declared shares, and allocates `--turns` written turns (default 40) by largest remainder, at least `--min-per-cell` (default 1) per cell. `--dry-run` prints the plan and calls no model:

```
$ pnpm -s driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out _captures/docs3/generating/intake/reference --turns 30 --dry-run
Cells: 20, 34 model turns to request, 0 cells dropped by the map.
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 1
```

The plan goes on with one line per cell. Then a model writes the turns of each cell, or `--replay` replays recorded answers keyed by cell. Every written turn passes checks in code: no speaker label, 1 to 500 characters, a known source answer, no real-looking personal data, no never-match phrase, no copy of an owner example, no near-duplicate in the cell. The owner's own examples enter as they are (`origin: interview`).

```
$ pnpm -s driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out _captures/docs3/generating/intake/reference --replay examples/acme/reference/recorded.yaml --turns 30
Wrote _captures/docs3/generating/intake/reference/reference.yaml and _captures/docs3/generating/intake/reference/approval.yaml: 53 turns (19 from the owner's examples, 34 from lane claude-opus-5-5 as the intake lane, by hand) in 20 cells, none approved.
  Model calls: 20. Turns refused by the checks: 0.
Next: read approval.yaml and set approved: true on the turns you accept, or run driftbench intake approve _captures/docs3/generating/intake/reference/approval.yaml --all.
exit 0
```

`from-interview` exits 0 when the set is written and every cell got its turns, 1 when it is written with a failed or short cell, 2 on a usage or input error. The language of a written turn is not checked in code, and no option saves a real model's answers for a later replay yet.

### Approve and compare

`intake approve <approval.yaml>` lists the turns not approved yet; `--all` approves every turn and keeps the comments:

```
$ pnpm -s driftbench intake approve _captures/docs3/generating/intake/reference/approval.yaml --all
Approved 53 turns in _captures/docs3/generating/intake/reference/approval.yaml; 0 were already approved.
exit 0
```

`intake fidelity --reference <set> --candidate <turns>` compares generated user turns with the approved reference turns: the total variation distance over cells, Kolmogorov-Smirnov on length and on the question rate, vocabulary overlap, and near-duplicate rates. It measures and never gates. Here the candidate is every user turn of the generated Acme suite, with its spec's cell, compared on `flow` and `channel`:

```
$ pnpm -s driftbench intake fidelity --reference _captures/docs3/generating/intake/reference --candidate _captures/docs3/generating/intake/candidate.jsonl --dims flow,channel
Reference _captures/docs3/generating/intake/reference: 53 turns, approved only (0 not approved, left out). Candidate _captures/docs3/generating/intake/candidate.jsonl: 814 turns.
  Cells on flow, channel: total variation 0.528; 4 cells in the reference, 8 in the candidate, 4 of them never in the reference.
    flow=upgrade channel=chat  reference 37.7 percent, candidate 12.7 percent
    flow=new-home channel=chat  reference 34.0 percent, candidate 12.8 percent
    flow=new-home channel=whatsapp  reference 0.0 percent, candidate 17.8 percent
    flow=porting channel=whatsapp  reference 0.0 percent, candidate 13.4 percent
    flow=upgrade channel=whatsapp  reference 7.5 percent, candidate 17.6 percent
  Length in words: KS 0.090 against 0.193 (n = 53, m = 814): no difference shown at the 5 percent level. Medians 6 and 6.
  Question rate: KS 0.109 against 0.193: no difference shown at the 5 percent level. Rates 26.4 percent and 15.5 percent.
  Vocabulary: Jaccard 0.354 over 168 and 138 word types; 73.5 percent of candidate words appear in the reference.
  Near-duplicates (character n-gram TF-IDF cosine at least 0.9): 13.3 percent of candidate turns copy a reference turn; 99.9 percent repeat another candidate turn, against 3.8 percent within the reference.
exit 0
```

The generated suite repeats its phrase bank, so almost every candidate turn repeats another one. `fidelity` exits 0 after printing the comparison, 2 on a usage or input error.
