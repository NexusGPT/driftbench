---
title: Utterance classes
summary: 'Measure a block over a class of user messages, not one string: a class file, a strength-2 planner with slot_surface as an axis, a gate, a frozen hashed realisation set, `when.class` on the block, a model-labeller audit, and the envelope report per cell.'
commands:
  - class plan
  - class realise
  - class audit
  - class expand
  - class envelope
see_also:
  - authoring-covering-arrays
  - authoring-spec-format
  - results-statistics
  - authoring-gate
next:
  - results-statistics
---

## What it is

A block's user message is one string. A pass on that string says little about the next customer, who writes
the same request another way. An utterance class turns the message into a class of messages that make the
same request with the same values:

- **The class file** (`classes/<name>.yaml`) holds the request (`intent`), the `seed` (the message the block
  sends when run as written), the `slots` the request carries with every spelling that stands for the same
  value (`surface_forms`, each with an `approved` flag), near values that change the request (`minimal`),
  optional style axes, the `invariants` every realisation keeps, and whole `minimal_pairs` messages that look
  like the request but change it.
- **The planner** writes a covering array over the class's axes. `slot_surface` (which approved spelling each
  slot takes, cells `s0`, `s1`, ...) is always an axis; the style axes the file declares are the others.
  Strength 2 by default: every allowed pair of axis values is in at least one row.
- **The gate** accepts a candidate only when every deterministic stage passes, then the per-axis style check,
  then the equivalence judge. The deterministic stages read the text only through containment of a declared
  value and through machine formats: `slot_presence` (an approved form of every slot), `slot_surface` (the
  planned spelling), `slot_exclusivity` (no other phone number, email address, or number when a number slot
  exists), `minimal_pair` (no minimal value, and no message close to a minimal pair), `invariants` (kept
  strings, the length limit) and `near_duplicate` (4-gram cosine above 0.8 against an accepted item). No
  stage reads a text against a list of words: a negation or a changed request is the judge's to see. The
  judge is told every listed spelling of each value, and accepts only `same: true` at confidence 0.9 or more.
  A rejected candidate is tried again with the gate's reason.
- **The frozen set** (`<name>.set.json`) holds every accepted realisation with its cell and the SHA-256 of
  its text, and one set hash over the class hash and every item. A block names it in `when.class`, beside
  its seed: `when: { user: <seed>, class: { id: <class id>, set: <set hash> } }`. The key enters the spec hash
  and the block cache key only when present. An edited item, an edited set, or a class file changed since
  the freeze (a newly approved spelling included) is refused until the set is frozen again.
- **Expansion** writes one copy of the spec per realisation of each class block. Each copy is its own spec,
  with its own hash and cache entries, and records `metadata.class`.
- **The envelope** reports a class block over its realisations: the class rate with Wilson on `n_eff`
  (realisations as clusters), MinP (the lowest cell rate), the rate per axis value, the localiser's suspects,
  and the phrasing share. Class results are their own column, never averaged with single-string blocks.
- **The audit** has two labellers of different model families label every accepted item. The union rule
  counts an item invalid when either says so. The bar: at most 1 invalid item.

## When to use it

- When a block's pass might hold only for its exact wording, or its oracle might only accept one spelling of
  a value: the envelope shows one cell at 0 even where the seed passes.
- Before you trust a pass rate on a block whose message carries a phone number, an email, an address or a
  plan name: list the spellings your users write and approve them.
- To compare two agent versions on what users actually write, run both on the same frozen set.

## Commands and every option

### driftbench class plan <class>

| Option | Meaning | Default |
|---|---|---|
| `--t <n>` | Strength of the covering array. | the file's `strength`, 2 |
| `--seed <n>` | Seed of the tie-breaks. | 1 |
| `--rows <n>` | Rows wanted: past the array's own size, rows adding the most uncovered (t+1)-way tuples, then repeats of the least used cell. | the array size |
| `--json` | Print the axes, rows and coverage as JSON. | off |

### driftbench class realise <class>

| Option | Meaning | Default |
|---|---|---|
| `--out <file>` | The frozen set to write. Required. | |
| `--realiser <provider:model>` | The model that writes candidates. Provider `anthropic`, `openai` or `gemini`. Required. | |
| `--judge <provider:model>` | The equivalence judge. Required. | |
| `--style <provider:model>` | The per-axis style check. | the judge |
| `--cassette <file>` | Recorded answers (JSON lines, `.gz` allowed): replayed; written to with `--record`. | none |
| `--record` | Ask the live models for answers the cassette lacks, and keep them. Reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (and `OPENAI_BASE_URL`) or `GEMINI_API_KEY`. | off |
| `--attempts <n>` | Attempts per planned row, the first included. | 3 |
| `--t`, `--seed`, `--rows` | As in `class plan`. | |
| `--json` | Print the set hash, the gate summary and the live call count as JSON. | off |

Give `--cassette`, `--record` or both. Without `--record` nothing reaches a provider and no key is read.

### driftbench class audit <class>

| Option | Meaning | Default |
|---|---|---|
| `--set <file>` | The frozen set to audit. Required. | |
| `--labeller <provider:model>` | A labeller. Give two, of different model families. | |
| `--cassette <file>` | Recorded answers. | none |
| `--record` | As in `class realise`. | off |
| `--out <file>` | Write the audit as JSON. | none |
| `--json` | Print the audit as JSON. | off |

### driftbench class expand <specs...>

| Option | Meaning | Default |
|---|---|---|
| `--classes <dir>` | The folder of class files and their frozen sets (`*.set.json`). Required. | |
| `--out <dir>` | The folder the copies are written into. Required. | |
| `--json` | Print what was written as JSON. | off |

### driftbench class envelope [campaignId]

| Option | Meaning | Default |
|---|---|---|
| `--store <file>` | The store that holds the runs. Required; never created. | |
| `--json` | Print the report as JSON, with every cell. | off |

The campaign defaults to the latest one of the store.

Exit codes: `plan`, `expand` and `envelope` exit 0, or 2 on bad input. `realise` exits 0 when every planned
row has an accepted realisation and the post-gate coverage is at least 95%, 1 when the set is written short
of that, 2 on bad input or a failed model call (a replay that meets a request the cassette lacks included).
`audit` exits 0 when at most 1 item is invalid, 1 when more are, 2 on bad input.

## Inputs

A class file:

```yaml
id: acme.order.fiber-address
intent: The customer asks to order the Acme Fiber 1000 plan for the address 14 Harbor Road, Acmeville.
seed: "Hi, I'd like to order Acme Fiber 1000 for 14 Harbor Road, Acmeville."
context: { last_reply: "" }          # the agent's reply before the message; empty for a first turn
slots:
  - name: plan
    format: text                     # phone, email or number also refuse a second value of that format
    surface_forms:
      - { form: "Acme Fiber 1000", approved: true }
      - { form: "the gigabit one", approved: false }   # waits for sign-off: never planned
    minimal: ["Acme Fiber 300"]
axes:                                # optional; each value with the instruction the realiser follows
  register: { formal: polite and complete, casual: informal }
exclude: []                          # value combinations never planned, such as {length: terse, distractor: aside}
invariants: { max_chars: 300, keep: [], exclusive: true }
minimal_pairs: ["Hi, is Acme Fiber 1000 available at 14 Harbor Road, Acmeville?"]
strength: 2
```

The loader refuses a slot declared twice, a slot with no approved form, a minimal value that is not distinct
from a surface form, a seed that holds no approved form of a slot, a `slot_surface` key under `axes`, an
exclusion naming an unknown value, and a kept string the seed does not hold.

## Outputs and how to read them

- `class plan`: `Strength 2: <rows> rows cover <c> of <r> 2-way tuples`, then one line per row.
- `class realise`: planned rows, candidates, accepted, rows unfilled; `Rejected by:` per first failing stage;
  `Post-gate coverage` of the accepted items; the Vendi score of the accepted texts (a report figure, never a
  gate); the frozen set hash to put in `when.class`.
- `class audit`: `<k> of <n> items invalid by the union rule (bar: at most 1)`, invalid items per labeller,
  the items the labellers disagree on, and every invalid item with the reasons.
- `class envelope`: per class block, the runs that pass over the realisations with Wilson on `n_eff` and the
  design effect; MinP, the phrasing share and the detectable drop; the rate per axis value; the three lowest
  cells; the suspects (axis values and pairs no realisation that passed every run holds, highest failure rate
  first). The last line counts the single-string blocks of the campaign apart.

## Worked example

The Acme order class, realised and audited from its recorded cassette (no model call), expanded into specs,
run on the in-process Acme agent, and reported:

```sh
driftbench class plan examples/acme/classes/order-fiber-address.yaml
driftbench class realise examples/acme/classes/order-fiber-address.yaml --rows 56 --out order.set.json \
  --realiser openai:gpt-6-luna --judge anthropic:claude-haiku-5-5 \
  --cassette examples/acme/classes/order-fiber-address.cassette.jsonl.gz # exit 1
driftbench class audit examples/acme/classes/order-fiber-address.yaml \
  --set examples/acme/classes/order-fiber-address.set.json \
  --labeller anthropic:claude-opus-5-5 --labeller openai:gpt-6.1-sol \
  --cassette examples/acme/classes/order-fiber-address.cassette.jsonl.gz
driftbench class expand examples/acme/classes/specs --classes examples/acme/classes --out out/classes
driftbench campaign run out/classes examples/acme/specs/conversations/order-loose-confirmation.yaml --store classes.db # exit 1
driftbench class envelope --store classes.db
```

```text
$ driftbench class plan examples/acme/classes/order-fiber-address.yaml
! slots.0.surface_forms  slot "plan": 1 surface form(s) wait for sign-off and are not planned
Class acme.order.fiber-address (hash f075d5ab8783): slot_surface 3, register 3, length 3, distractor 2.
Strength 2: 9 rows cover 44 of 44 2-way tuples (100.0%).
    1  slot_surface=s2|register=neutral|length=multi_sentence|distractor=aside
(8 more rows)

$ driftbench class realise ... --rows 56 --out order.set.json ...
Class acme.order.fiber-address: 56 planned rows, 101 candidates, 51 accepted, 5 rows unfilled.
Rejected by: near_duplicate 35, style 6, minimal_pair 4, equivalence 3, slot_surface 2.
Post-gate coverage: 44 of 44 2-way tuples (100.0%). Vendi 11.22 (reported, not gated).
Frozen set 2c9ce562b65c: order.set.json. Name it in a block as when.class: { id: acme.order.fiber-address, set: 2c9ce562b65c }.
(exit 1: 5 of the 56 rows have no accepted realisation after 3 attempts)

$ driftbench class audit ...
Audit of acme.order.fiber-address set 2c9ce562b65c: 0 of 51 items invalid by the union rule (bar: at most 1). Pass.
  labellers disagree on 0 items

$ driftbench class expand examples/acme/classes/specs --classes examples/acme/classes --out out/classes
51 copies of 1 specs written to out/classes.
  acme-order-loose-confirmation-class: 51 copies

$ driftbench class envelope --store classes.db
acme.order.fiber-address (set 2c9ce562b65c), block 0 of acme-order-loose-confirmation-class: 17 of 51 runs pass over 51 realisations, rate 0.333 [0.216, 0.475] (Wilson on n_eff 50.0, design effect 1.02).
  MinP 0.000; phrasing share n/a (one run per realisation); detectable drop 0.187.
  By axis value:
    slot_surface=s1  0/17  0.000
    slot_surface=s2  0/17  0.000
    ...
    slot_surface=s0  17/17  1.000
  Suspects (held by no realisation that passed every run): slot_surface=s1 1.00; slot_surface=s2 1.00; ...

Single-string blocks (never averaged with a class): 4 of 4 pass, rate 1.000, over 1 specs.
```

The seed passes every block. The class shows why that overstates the block: block 0 asserts the address with
the regex `14 Harbor Road`, so every realisation that writes `14 Harbor Rd` or `14 harbor road` (cells `s1`
and `s2`, both approved spellings) fails. The fault is the oracle, not the agent.

To make a set yourself, run `class realise` and `class audit` with `--record` and the keys in the
environment; the answers are kept in the cassette, so the same commands replay with no key.

## Common errors

- `✗ <file> is not a valid class file`, with one line per problem: fix the file; the messages name the field.
- `Give --cassette to replay recorded answers, or --record to ask the live models.`: add one of them.
- `A model call failed (exhausted): the cassette has no answer for this <family> <model> request`: the
  replay asked something the recording never saw (another seed, rows, model or class file). Record it with
  `--record`, or use the options the recording used.
- `the class file changed since the set was frozen`: a field of the class changed (a newly approved spelling
  counts). Run `class realise` again and update the block's `when.class.set`.
- `item <id> changed after the set was frozen`: a set file was edited by hand. Freeze again.
- `block <n>: names set <a> of class <id>, the set file holds <b>`: the block names another freeze. Update
  `when.class.set` to the hash `class realise` printed.
- `Give two --labeller options of different model families`: an audit needs two families.
