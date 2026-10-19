---
title: Objects, the rules of a run as files
summary: 'Write the rules driftbench scores with (check sets, value-check, blame and the other policies) as object files, extend a shipped one, and name it in `uses`, with no agent rerun.'
commands:
  - spec validate
  - spec lint
  - campaign run
  - campaign rejudge
see_also:
  - authoring-spec-format
  - authoring-blocks
  - judging-campaign-rejudge
  - judging-check-tools
  - running-store
  - core-configuration
  - core-error-codes
next:
  - judging-campaign-rejudge
---

## What it is

Every rule driftbench scores with is an object: a file with a kind, an id, an optional parent it `extends`, and a list of items. Each item is one rule. The shipped objects are the defaults; you write your own to change them.

* A `check-set` lists the machine checks, in order. Its items are the checks: item `must_not` is the `must_not` check.
* A `policy/value-check` lists the rungs that decide when a value the agent wrote is the right value.
* The other policies (`policy/blame`, `policy/placement`, `policy/links`, `policy/selection`, `policy/gating`, `policy/stats`), `judge-council` and `diagnostic` follow the same file shape.

An object is looked up by kind and id. The same id can exist at several layers; the strongest layer wins. Weakest first: `shipped`, `project`, `suite`, `spec`, `block`, `cli`.

A spec or a block names the objects it runs with in `uses` (topic authoring-spec-format, `uses`). Every kind `uses` names is scoring-only: changing an object never changes what the agent receives, so a stored run can be scored again under it with no agent call (topic judging-campaign-rejudge).

### The kinds

| Kind | `uses` key | Holds | Agent-facing |
|---|---|---|---|
| `check-set` | `check_set` | The machine checks and their order. | no |
| `policy/value-check` | `value_check` | When a value the agent wrote is the right value. | no |
| `policy/blame` | `blame` | Who a failure is attributed to, and where its fix goes. | no |
| `policy/placement` | `placement` | Where a fix goes, by how often a mistake recurs. | no |
| `policy/links` | `links` | How blocks link to prompt units, and when a link is stale. | no |
| `policy/selection` | `selection` | Which blocks a change selects. | no |
| `policy/gating` | `gating` | What `not_run`, `blocked` and `inconclusive` do to `ci`. | no |
| `policy/stats` | `stats` | Which interval is the headline. | no |
| `judge-council` | `judges` | The judges, their mode, assignment and escalation. | no |
| `diagnostic` | `diagnostics` (a list) | A procedure that runs after the checks and writes a diagnosis. Its list is `steps`, not `items`. | no |
| `prompt-template` | none | A model-facing text with named parts and a fingerprint. | no |
| `persona` | none | Who the simulated user is. | yes |
| `persona-defaults` | none | The defaults every persona extends. | yes |
| `scenario` | none | What the simulated user wants and knows. | yes |
| `run-profile` | none | The run settings: driver, model, seed, trials. | yes |
| `deviation-class` | none | A deviation the driver can inject, and its recovery window. | yes |

An agent-facing kind changes what the agent receives. It has no `uses` key, and `campaign rejudge --use` and `--set` refuse it: the agent must run again.

Two objects ship: `check-set` `default` (every check, then the runner's own `flow` and `ledger` verdicts) and `policy/value-check` `default` (seven rungs, below). A kind with no shipped object has no default to extend: its first object is a root object.

## When to use it

* A check does not fit your agent and you want it off, or on in another order: a check set that extends `default`.
* A value comparison is wrong for your tools (a date, an id, a path): a value-check that changes one rung's params or adds a rung.
* You want the same change for a whole folder of specs: a project or suite object plus a `uses.yaml`.
* You want to try a change on stored runs before you rerun anything: write the object, then `campaign rejudge --use`.
* Not for a persona, a prompt or a tool: those change what the agent receives. Use `campaign run`.

## Commands and every option

Objects add no command of their own. These commands read them:

| Command | What it does with objects |
|---|---|
| `spec validate <paths...>`, `spec lint <paths...>` | Resolves every object a spec names. An unknown object, an unknown item, a loop, a bad order, a missing implementation or wrong params is a load error with the code of the table under Common errors. Options: `--json`, and for `lint` `--strict`, `--summaries`, `--sections` (topic authoring-spec-check). |
| `campaign run` | Scores every block under the objects its layers choose, and stamps each verdict with the object, item, implementation and layer that made it (topic running-store). |
| `campaign rejudge` | `--use <kind>/<id>` scores the stored runs under another object, and `--set <kind>[/<id>]#<item>.<param>=<value>` changes one item parameter, both with no agent call (topic judging-campaign-rejudge). |

### Where an object comes from

| Layer | Source |
|---|---|
| `shipped` | The objects driftbench carries. They cannot be redefined, only extended. |
| `project` | Files `driftbench/<kind>/<id>.yaml` beside `driftbench.yaml`, and the `objects:` key of `driftbench.yaml` (a list of inline object definitions). |
| `suite` | Files `_driftbench/<kind>/<id>.yaml` in a folder from the project folder down to the spec. A nearer folder is stronger. |
| `spec`, `block` | An inline object in the `uses` of a spec or of a block. |
| `cli` | `--use` and `--set` of `campaign rejudge`. |

The project folder is the nearest folder above the spec that holds a `driftbench.yaml`. The search stops at a folder with `.git`. A file must sit where its kind and id say: `policy/blame` `acme` is `policy/blame/acme.yaml` (or `.yml`).

A `uses.yaml` in a `driftbench/` or `_driftbench/` folder sets `uses` for the specs below it. Its keys are the keys of `uses` (topic authoring-spec-format), written at the top level of the file. A block's `uses` replaces the spec's, which replaces the suite's and the project's.

### The keys of an object file

| Key | Required | Meaning |
|---|---|---|
| `kind` | yes | The kind, from the table above. |
| `id` | yes | The id: letters, digits, dots, underscores, hyphens, and `/` groups. Unique in its kind and layer. |
| `extends` | no | The object of the same kind this one extends. `null` or absent: a root object, which lists full items. |
| `version` | no | A free label. The content hash is the identity, not this label. |
| `description` | no | What the object is for. |
| `params` | no | Object-level parameters the items share. A map: merged along the `extends` chain. |
| `order` | no | The item order: every enabled item once. Use it or `before` / `after` moves in one file, not both. |
| `items` | yes, or `steps` for a `diagnostic` | A root object lists full items. An object that extends another lists item operations. |

### The keys of an item (a root object)

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | The item id, unique in the object. A verdict cites it. |
| `title` | yes | What the rule does, in one line. |
| `impl` | yes | The implementation: `builtin:<name>` or `plugin:<name>`. |
| `enabled` | no | `false` keeps the item in the object and out of every run. Absent means `true`. |
| `when` | no | The condition, over named evidence, under which the rule fires. A map. |
| `effect` | no | What the rule does when it fires. A map. |
| `params` | no | Parameters, checked against the implementation. Unknown keys are refused. |
| `cites` | no | A source for the reader, such as a rule number. It changes no result. |
| `applies_to` | no | Where the item applies: `skills` (names), `tools` (the label of the failing call) and `units` (patterns where `*` matches any run of characters, such as `R#41/*`). The item fires only when the evidence names one of them. Absent: everywhere. |

### The keys of an item operation (an object that extends another)

| Key | Meaning |
|---|---|
| `id` | The item of the parent to change, or with `add: true` the id of a new item. |
| `add` | `true` adds a new item. It needs `title`, `when`, `effect` and `impl`. |
| `title`, `impl`, `cites` | A new value for the item. |
| `enabled` | `false` disables the item, `true` enables it again. |
| `when`, `effect` | Fields to set: maps merge, lists replace. |
| `params` | Params to set: maps merge, lists replace, `+key: [values]` appends to the list at `key`, `-key: [values]` removes those values, `-key: null` removes the key. |
| `applies_to` | Where the rule applies: maps merge, lists replace. |
| `before`, `after` | Moves the item just before or just after another item of the parent. |

## Inputs

A check set that extends the shipped one and turns a check off (`driftbench/check-set/quiet.yaml`):

```yaml
kind: check-set
id: quiet
extends: default
description: The default checks, without the must_not check.
items:
  - id: must_not
    enabled: false
```

A spec names it:

```yaml
uses:
  check_set: quiet
```

The same object can be written inline in `driftbench.yaml`, under `objects:` (a list), or inline in the `uses` of a spec as `check_set: { extends: default, items: [{ id: must_not, enabled: false }] }`.

### The implementations

| Implementation | What it is |
|---|---|
| `builtin:check/<name>` | The check of that name. A check set holds one item per check: `tools`, `tools_offered`, `forbidden`, `must`, `must_not`, `regex`, `exact`, `injection`, `length`, `markup`, `starts_with`, `finish_reason`, `json`, `tool_f1`, `refusal`, `rouge_l`, `bleu`, `sql`, `similarity`, `relevancy`, `knowledge_retention`, `lang`, `pii`, `cards`, `tool_policy`, `stage`, `skills`, `guards`, `references`, `subagents`, `execution`, `workspace`, `safety`, `artifacts`, `schema_strict`, `budget`, `end_state`, `custom` and `judge`. They take no params. |
| `builtin:runner/flow`, `builtin:runner/ledger` | The runner's own verdicts: the flow family (`flow.stage`, `flow.order`) and the ledger family. Disable the item and the verdicts are not written. They take no params. |
| `builtin:value-check/<rung>` | A rung of a value-check, below. |
| `plugin:<name>` | An implementation a plugin registered (topic running-plugins). |

A check the caller runs that no item of the check set names still runs, after the listed ones, and its verdicts are stamped from the caller.

### The rungs of the shipped value-check

The first item whose `when` holds and that settles the value decides it. A value no item settles is `inconclusive`, with the reason of every rung that could not decide. The shipped `params` of the object is `numbers_significant_digits: 12`.

| Item | Implementation | Params | Decides |
|---|---|---|---|
| `rung4_exact` | `builtin:value-check/exact` | none | An exact match, only where the block declares the format is the requirement. |
| `rung1_outcome` | `builtin:value-check/outcome` | `resolved_fields`, `distractors_required` | Asks the tool: the same result for the gold value and the agent's value. |
| `rung1_recompute` | `builtin:value-check/recompute` | `trials`, `seed`, `inputs` | Recomputes a formula or a script on the given inputs and on changed inputs. |
| `rung1_state_diff` | `builtin:value-check/state-diff` | none | The net workspace diff: expected changes present, nothing outside expected plus allowed. |
| `rung2_contract` | `builtin:value-check/contract` | none | The format the tool, the prompt, the instruction or a loaded skill states. It can only fail. |
| `rung2b_as_given` | `builtin:value-check/as-given` | `ignore` | A value the user or a workspace file gave is not changed. It can only fail. |
| `rung3_same_referent` | `builtin:value-check/judge` | `design`, `orders`, `repeats`, `max_false_acceptance`, `min_kappa_vs_labels`, `prompt_template` | A calibrated judge decides whether both values name the same thing. |

## Outputs and how to read them

* Every verdict of a block scored under objects carries `by`: the object (`kind:id@hash8`, such as `check-set:default@fd61f704`), the item, the implementation and the layer. The block carries `resolved`: the objects it was scored with and one hash over them (topic running-store). A different object content gives a different `@hash8`, so two stored runs show whether they were scored under the same rules.
* A disabled item writes no verdict: the check does not run. In the worked example, the spec with `must_not` off has no `must_not.0` verdict.
* An object problem is a load error of every spec that resolves it, with the spec, the path (`uses.check_set`), the code and a sentence naming the object, the item and the file line.
* `uses` is in the spec hash, because it is part of the spec. It is outside the block cache key and outside the compatibility hash of a re-judge.

## Worked example

A project folder with a `driftbench.yaml` that holds one inline object, a project check set in a file, and three specs of one conversation: one with the default checks, one with the project file `quiet`, one with the inline object `no-pii`. A fourth spec names an object that does not exist, to show the load error. No model is called.

```yaml file=out/authoring-objects/demo/driftbench.yaml
# Fictional data only: Acme Telecom, Acmeville.
objects:
  - kind: check-set
    id: no-pii
    extends: default
    description: The default checks, without the personal-data check.
    items:
      - id: pii
        enabled: false
```

```yaml file=out/authoring-objects/demo/driftbench/check-set/quiet.yaml
kind: check-set
id: quiet
extends: default
description: The default checks, without the must_not check.
items:
  - id: must_not
    enabled: false
```

```yaml file=out/authoring-objects/demo/specs/loud.yaml
id: objects-loud
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
blocks:
  - id: greet
    user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      must_not: ['Acme']
```

```yaml file=out/authoring-objects/demo/specs/quiet.yaml
id: objects-quiet
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
uses:
  check_set: quiet
blocks:
  - id: greet
    user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      must_not: ['Acme']
```

```yaml file=out/authoring-objects/demo/specs/no-pii.yaml
id: objects-no-pii
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
uses:
  check_set: no-pii
blocks:
  - id: greet
    user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      must_not: ['Acme']
```

```yaml file=out/authoring-objects/demo/bad/missing.yaml
id: objects-missing
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
uses:
  check_set: not-written-yet
blocks:
  - id: greet
    user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
```

```sh
driftbench spec validate out/authoring-objects/demo/specs
driftbench spec validate out/authoring-objects/demo/bad # exit 1
driftbench campaign run out/authoring-objects/demo/specs --target function:acme --mode T --store out/authoring-objects/objects.db --campaign objects-demo # exit 1
driftbench campaign status objects-demo --store out/authoring-objects/objects.db --json # exit 1
```

```text
$ driftbench spec validate out/authoring-objects/demo/specs
✓ out/authoring-objects/demo/specs/loud.yaml  objects-loud · 1 block · hash 2497578a7b74
✓ out/authoring-objects/demo/specs/no-pii.yaml  objects-no-pii · 1 block · hash 3980bb822d61
✓ out/authoring-objects/demo/specs/quiet.yaml  objects-quiet · 1 block · hash 228cb7c1a885
Checked 3 specs: 3 valid, 0 invalid, 0 warnings.
$ driftbench spec validate out/authoring-objects/demo/bad
✗ out/authoring-objects/demo/bad/missing.yaml
    uses.check_set  OBJECT_UNKNOWN  spec objects-missing: uses.check_set: unknown object check-set:not-written-yet; searched layers shipped, project, suite, spec, block, cli
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench campaign run out/authoring-objects/demo/specs --target function:acme --mode T --store out/authoring-objects/objects.db --campaign objects-demo
✗ objects-loud · function:acme · T · repeat 0  fail  block 0 must_not.0
✗ objects-no-pii · function:acme · T · repeat 0  fail  block 0 must_not.0
✓ objects-quiet · function:acme · T · repeat 0  pass  1 block
3 cells: 1 pass, 2 fail, 0 failed. Spent $0.00.
(exit 1)
```

`campaign status` exits 1 because two cells failed. Its JSON lists the verdict ids of each cell. Read them: the default spec has `must_not.0` and the four `pii.*` verdicts; `objects-no-pii` has `must_not.0` only; `objects-quiet` has the four `pii.*` verdicts only and passes. The same agent reply is scored three ways because only the objects differ. To score stored runs under another object with no agent call, use `campaign rejudge --use check-set/quiet` (topic judging-campaign-rejudge, which has a runnable example).

## Common errors

Each message names the spec, the path, the object and the file line. Fix the file it names.

| Code | Cause | Fix |
|---|---|---|
| `OBJECT_INVALID` | A malformed object: a file that does not parse or is not a mapping, an unknown key (`polcy`), an item id listed twice, a file at the wrong path, `objects:` that is not a list, or a `--use` or `--set` value of the wrong shape. | Fix the key the message names. The file for `policy/blame` `acme` is `policy/blame/acme.yaml`. |
| `OBJECT_KIND_UNKNOWN` | The `kind` is not one of the table above. The message lists the known kinds. | Use a kind from the list. |
| `OBJECT_UNKNOWN` | `uses`, `extends`, `--use` or `--set` names an object no layer defines. The message lists the layers searched. | Write the object file, or fix the id. |
| `OBJECT_DUPLICATE` | Two files of one kind and id at the same layer and level. | Keep one, or change an id. |
| `OBJECT_SHIPPED_IMMUTABLE` | A project, suite or spec object uses the id of a shipped object (`check-set` `default`). | Give it another id and write `extends: default`. |
| `OBJECT_CYCLE` | Objects extend each other in a loop. The message prints the loop. | Break the chain. |
| `OBJECT_ITEM_UNKNOWN` | An operation, a `before` or `after`, or an `order` names an item the parent does not hold. The message lists the parent's items. | Fix the item id, or add it with `add: true`. |
| `OBJECT_ITEM_EXISTS` | `add: true` on an id the parent already holds. | Drop `add: true` to change the item, or choose a new id. |
| `OBJECT_ITEM_INCOMPLETE` | A new item lacks `title`, `when`, `effect` or `impl`, or a root object lists an item without `id`, `title` or `impl`, or uses `add`, `before` or `after`. | Add the fields the message names. |
| `OBJECT_ORDER_INVALID` | The file sets `order` and also moves items; an item sets both `before` and `after`, or moves relative to itself; `order` lists an item twice or leaves out an enabled item. | Order one way: list every enabled item once. |
| `OBJECT_IMPL_UNKNOWN` | An item names an implementation no builtin or plugin provides. | Fix the name, or load the plugin (`--plugin`). |
| `OBJECT_PARAMS_INVALID` | An item's `params` do not fit its implementation (`unknown key x`). | Fix the params at the path the message names. |
