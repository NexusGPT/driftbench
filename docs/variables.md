# The variable store

The variable store is one catalogue of the variables a situation varies on. The prompt-agent map ([generating tests](generating.md#the-map-of-situations)) and the estate map ([testing an estate](estate.md#3-variables-the-interaction-space-of-an-estate)) describe the same thing in two files: dimensions with values, constraints that rule out combinations, and a prior. The store holds both, and it keeps where each part comes from.

Three sources feed it:

| Source | What it gives | What the store keeps |
|---|---|---|
| The agent's own files | a condition names a variable; its values are the two sides of the condition and the value at its limit | a quote of the file, with the ledger id of the prose it belongs to when there is one |
| Past conversations | the values they show, and how often | counts and a hash of the private set, never a line of text |
| The owner | a value that is missing, a combination that cannot occur, a weight | the owner's words and the day they said them |

Status. Built: the format, a loader that checks it, the conversion from a space map and from a map proposal, the conversion back to a space map, the check of every quote and structure entry against its file, the feed that fills a store from an estate map ([below](#from-an-estate)), a planner that builds test rows from a store (`planV2`, opt-in), an interview that fills a store from the owner ([below](#filling-a-store-from-an-interview)), and a feed that fills the weights from past conversations ([below](#weights-from-past-conversations)), and a feed that turns condition spans into values ([below](#conditions-from-an-estate)). The ledger ids come from the ledger of `estate scan --pointer` ([the pointer reader](estate.md#reading-the-prose-by-pointing-estate-scan---pointer)); the store itself checks only their shape. Not built yet: a command that passes the condition spans of a scan to the feeds; the generator reading a plan; a command for the store. The `space` commands read a space map, and `variablesToSpaceMap` makes one from a store.

## The file

A store is a YAML or JSON file, usually `variables.yaml`. Keys are snake_case. An unknown key is an error.

```text
format: 1
agent: northwind
version: '1'
prior:
  kind: declared
variables:
  - id: shipment_days_late
    ...
constraints:
  - forbid: { session_state: fresh, estate_hazard: dead_helper }
    ...
```

| Field | Required | Holds |
|---|---|---|
| `format` | yes | the version of the file format, `1` |
| `agent` | yes | the agent the store describes |
| `version` | yes | a label for this version of the store |
| `inventory` | no | the behaviour inventory, as a path relative to the file; its required flow deviations become required cells, as in a space map |
| `prior` | no | how the weights were set: `kind` is `declared` (the owner wrote them) or `fitted` (fitted from consented conversations, which needs a `source` text); default `declared` |
| `variables` | yes | the variables, at least one |
| `constraints` | no | the impossible combinations; absent or empty means every combination can occur |

## Variables

A variable is one thing a situation varies on. A condition in the agent's files names it: "late by more than two days" names how late a shipment is. A variable is a condition the agent applies; a sentence that only reports a value from the past is not a condition and names no variable.

| Field | Required | Holds |
|---|---|---|
| `id` | yes | a letter or digit, then letters, digits, dots, underscores and hyphens; unique in the store |
| `title` | yes | what the variable varies on |
| `kind` | yes | `stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`: how a spec is placed on it, as for a space map |
| `role` | yes | `axis` or `detail` |
| `scope` | no | `conversation` (the default) or `turn`: whether the variable is one fact of a whole conversation or can change from turn to turn |
| `approved` | yes | true once a person approved the variable and the values that carry no flag of their own |
| `produced_by` | no | `code` (read from structure), `model` (read from prose) or `owner` |
| `provenance` | no | where the variable comes from; for a variable a condition names, the quote of the condition |
| `values` | yes | the values, at least one |
| `boundaries` | no | the edges of the conditions that name the variable |

The scope tells a reader how to read the variable from past conversations: once per conversation, or once per turn (the mood of the person can change inside one conversation, the channel cannot). A variable with no `scope` is read per conversation, and the loader does not write the default into the store. The scope is not part of the space map: `variablesToSpaceMap` leaves it out, and a space map turned into a store states none.

The role is the one the map proposal uses. An axis is a dimension of the space map, crossed with the other axes. A detail stays out of the space map: the generator varies it inside a cell, as boundary values.

Three rules of the space map hold for the axes of a store, and a detail is exempt from them:

* At most one axis is of kind `stage`, one of kind `deviation` and one of kind `channel` (`VARIABLES_KIND_REPEATED`).
* A value id appears in one axis only among the axes of kind `behaviour`, `persona`, `data` and `task` taken together, because a spec names such a value without its variable. The value `none` is exempt (`VARIABLES_AMBIGUOUS_VALUE`).
* An axis of kind `deviation` holds `none` and the twelve deviation classes of [recovery](concepts/recovery.md), and nothing else (`VARIABLES_UNKNOWN_DEVIATION`).

## Values

| Field | Required | Holds |
|---|---|---|
| `id` | yes | the value id, unique among the values of its variable |
| `title` | yes | what the value means, in plain words |
| `weight` | no | the share of users with the value, relative to the other values of the variable |
| `required` | no | true when a test plan must include the value |
| `approved` | no | overrides the flag of the variable for this value; absent means the value inherits it |
| `produced_by` | no | `code`, `model` or `owner` |
| `provenance` | no | where the value comes from |
| `polarity`, `when`, `unless`, `limit`, `within`, `priority` | no | what a rule states, as a map proposal writes it: whether the agent must or must not act (`polarity`), the cell the rule applies in (`when`), the cell it does not hold in (`unless`), the most times it may happen in a conversation (`limit`), the minutes it has to happen in (`within`), and `first` when it comes first when rules collide (`priority`) |

A weight is relative: `0.6`, `0.15` and `0.25` mean the same as `60`, `15` and `25`. Give a weight to every value of a variable or to none (`VARIABLES_WEIGHT_INCOMPLETE`), and not all zero (`VARIABLES_WEIGHT_ZERO`). Without weights every value of a variable weighs the same. A weight stands on the provenance of its value: the counts of conversations, or the owner's words.

## Boundaries

A boundary is the edge of a condition. The condition has two sides, and the limit between them is a case of its own: it is where a wrong comparison, such as "at least" written as "more than", shows. The boundary names the three values.

```text
    boundaries:
      - holds: more_than_two_days
        fails: under_two_days
        edge: exactly_two_days
        limit: 2
        comparison: gt
        unit: days
```

| Field | Required | Holds |
|---|---|---|
| `holds` | yes | a value on the side where the condition holds |
| `fails` | yes | a value on the side where it does not; not the value of `holds` |
| `edge` | yes | the value at the limit itself: a third value, or the value of the side the limit falls on |
| `limit` | no | the limit of the condition, a number; it is not the `limit` of a rule on a value, which counts actions |
| `comparison` | with `limit` | how the quantity is compared with the limit for the condition to hold: `lt`, `le`, `gt` or `ge` |
| `unit` | no | the unit of the limit; needs a `limit` |
| `provenance` | no | where the condition comes from |

The three ids are values of the variable (`VARIABLES_UNKNOWN_VALUE`), and `holds` and `fails` are two values (`VARIABLES_BOUNDARY`). A `limit` and a `comparison` go together, and a `unit` needs a `limit`. These words give these fields:

| The agent's words | `comparison` | `limit` | The limit itself |
|---|---|---|---|
| late by more than two days | `gt` | 2 | fails |
| a draft under 120 words | `lt` | 120 | fails |
| at most one question | `le` | 1 | holds |
| a tool that fails twice in a row | `ge` | 2 | holds |

A strict comparison (`gt`, `lt`) leaves the limit itself on the failing side, so `edge` is not the value of `holds`. An inclusive one (`le`, `ge`) puts it on the side where the condition holds, so `edge` is not the value of `fails` (`VARIABLES_BOUNDARY`). A third value for the edge fits both. A condition with no number leaves out `limit` and `comparison`: the edge is then the borderline case, such as "looks fine" between an explicit yes and a request for changes.

## Provenance

Every value, boundary and constraint may list where it comes from, in `provenance`. Each entry is one of four kinds, named by `kind`.

| Kind | Fields | Holds |
|---|---|---|
| `quote` | `path`, `quote`, `ledger` (optional) | text copied from a file of the agent |
| `structure` | `path`, `pointer` or `lines`, `hash` | a place in a file that is not prose: a value of a JSON or YAML file, or a range of lines of a script |
| `conversations` | `count`, `total`, `set_hash` | how many of the conversations read show the value |
| `owner` | `words`, `date` | what the owner said, and the day |

A quote has a `path`, relative to the folder of the store file and written with forward slashes: no leading `/`, no `~`, no scheme or drive letter (`file:`, `C:`) and no backslash, so a path never names a folder outside the repository by its full name. It has a `quote` of 1 to 1,000 characters that is not blank. A `ledger` is the ledger id of the prose the quote belongs to, 10 characters from `a` to `z` and `2` to `7`. The store checks its shape. A quote is checked against its file as the evidence of a map proposal is: word for word, with runs of white space, typographic quote marks, accents written composed or decomposed, characters that print nothing and the backslash of markdown folded first; case and punctuation must match.

A `structure` entry is for what a quote cannot name: a guard, a permission or a stage that lives in `settings.json`, a steps file or a script. It has a `path` (the same rules as a quote's), a `hash`, and one of two places:

* `pointer`, for a JSON or YAML file: a JSON pointer (RFC 6901) to the value, such as `/permissions/deny/0` or `/steps/2`. `~` is written `~0` and `/` is written `~1`; the empty pointer is the whole file. The `hash` is the SHA-256 of the canonical JSON of that value (keys sorted, no white space), so a reformatted file or another order of keys is the same value. A YAML number that JSON cannot write is not turned into `null`: `.inf`, `-.inf` and `.nan` are written as the bare words `Infinity`, `-Infinity` and `NaN`, and `-0` apart from `0`, so a value that changes from `null` to `.inf` is found out.
* `lines`, for any other file: `{ start, end }`, the first and last line counted from 1. The `hash` is the SHA-256 of those lines joined by a line feed (a Windows line break reads the same).

It has no other key: a structure entry keeps no text of the file. The store checks the shape (`hash` is 64 lowercase hexadecimal characters, exactly one of `pointer` and `lines`, `end` at least `start`). `verifyVariableQuotes` reads the file and resolves the place: a pointer that names nothing, or lines past the end of the file, is `VARIABLES_POINTER_UNRESOLVED`; a place that holds something else than when the entry was written is `VARIABLES_HASH_MISMATCH`.

A `conversations` entry holds counts and a SHA-256 of the private set of conversations, 64 lowercase hexadecimal characters. `count` is a whole number from 0 to `total`, and `total` is at least 1. The entry has no other key: no text, no id and no person can enter a store through it.

An `owner` entry holds the `words`, at most 1,000 characters and not blank, and the `date` as `YYYY-MM-DD`.

A value that has a weight and a `conversations` entry should agree: the weight is the count over the total, up to the factor the weights share. The loader does not compare them.

A quote copies text of the agent's files. A store built from a private estate is private too: keep it outside the repository, as the conversations are.

## Weights from past conversations

`feedVariables` (package `@agent-nexus/driftbench-generate`) fills the `weight` of the values from a set of past conversations. A reader answers one question about each conversation for each variable, and the answers are counted:

| Variable | Question | Answer read as |
|---|---|---|
| two or more values | one choice question with an option for each value and one for "none of these" | the top option when its probability is at least 0.5, else unsure; "none of these" is absent |

A variable with two values gets the same choice question as one with more: a conversation can show neither value, and a yes or no question about the first value would count that conversation as the second. The yes or no question (`yesno`, a probability of yes, read as the first value at 0.75 or more and the second at 0.25 or less) stays a kind a reader may be asked, but the feed no longer builds one.

The questions use only the title of the variable and the titles of its values, never conversation text. The reader is a port: any object with a `read` method can stand in, and `createJevReader` is one that calls a system 1 service (one request per conversation, with the questions of all variables in the same request). The thresholds (0.75 and 0.25 for yes or no, 0.5 for a choice) are settings and the report records them.

A reader is not exact, so the shares are corrected when a calibration set is given: conversations whose value a person knows, read by the same reader. The correction estimates how the reader confuses the values (and how often it is unsure), finds the shares that explain the decisions under that confusion, and draws an interval from posterior draws of both the decisions and the confusion (a Dirichlet distribution with a half added to every cell), so a value that no conversation showed keeps an open upper bound instead of closing at zero. Without a calibration set the shares are those of the decisions, with a Wilson interval that covers sampling only; a biased reader then gives intervals that miss. The correction is measured on a fictional mix with a reader that errs 10 to 22 percent on some values: the 95 percent interval held the true share for 97.1 percent of 4,400 (value, seed) checks over 400 seeds, and 62.1 percent without the correction. At a rare share (0.99 and 0.01, 100 conversations, 100 calibration conversations per value, a perfect reader) it held the true share in 99.5 percent of 1,000 trials; a share of 0.5 with 100 conversations and a share of 0.02 with 300 gave 94.8 percent each.

What the store keeps is what the format allows. Each fitted value gets its `weight` (the share, relative to the other values of the variable) and a `conversations` entry: `count` is the conversations decided as this value, `total` the conversations read for the variable, and `set_hash` the SHA-256 of the set (sorted per-conversation hashes, so it does not depend on order). When a calibration set corrected the shares, the weight is the corrected share and so differs from `count` over `total`; the `prior.source` text says so. The store's `prior` becomes `fitted`. A quote a value already had stays; an earlier `conversations` entry is replaced. A variable with fewer than 20 decided conversations keeps its weights and is reported as skipped.

The report (`FeedReport`) holds counts, shares, intervals and settings. `privateCountsOf` / `writePrivateCounts` keep the numbers beside the private set, by default in `~/.driftbench/private/` (`DRIFTBENCH_PRIVATE_DIR` moves it). The counts file is numbers and fixed keys: a variable and a value are named by their position in the store, and the only strings are two SHA-256 digests, of the agent name and of the set, so no string the caller wrote is stored. The file is named by the first 12 characters of each digest. The writer checks its input at run time and refuses any other key or string. It resolves symlinks before it checks that the folder is outside every git repository, refuses a counts file that is a symlink, and writes a new file with mode 0600 and renames it over the old one, so every write is owner-only. No line of text, no file name and no person is in the store, the report or the counts file.

### From intake logs

`feedFromLogs` feeds `feedVariables` from the output of `intakeLogs` (the `kept` list), so the reader sees the anonymised text of a log and never the raw one. It reads a variable at the scope the store declares for it (the `scope` of the variable, `conversation` when it states none):

| Scope | The reader is asked | The reader sees | `total` and `count` in the store |
|---|---|---|---|
| `conversation` (the default) | once per conversation | the whole conversation, one line per turn, `role: text` | conversations |
| `turn` | once per turn of the roles in `turnRoles` (default: the user) | that turn's text alone | turns |

Use `turn` for a variable that can change inside one conversation, such as the mood of the person. The call can override a scope with `scopes` (a variable id to `conversation` or `turn`); `overrides` in the result lists each override that changed a scope, with the scope the store declares and the one used. The result holds one store and one report per scope that had a variable to read (`reports.conversation`, `reports.turn`); each report has its own count and set hash, so write the counts of each with `privateCountsOf` and `writePrivateCounts`. The store-level `prior` of the result names every group that was read, with its count in its own unit (conversations or turns) and its set hash. For a turn-scoped variable each turn is one draw, so turns of one conversation, which are likely to agree, make the interval narrower than a count of conversations would, and the `minDecided` floor can be met by few conversations; read it with that in mind. A calibration set is given per scope (`calibration.conversation`, `calibration.turn`): whole conversations for the first, single turns for the second. The privacy rules are those of `feedVariables`: the store and the reports hold counts and digests, no id and no line of text.

Advice. The loader reports `VARIABLES_UNSOURCED` for each value, boundary and constraint that has no provenance. It never makes a store invalid: a store converted from a space map names no source at all.

## Conditions from an estate

`feedFromConditions` (package `@agent-nexus/driftbench-generate`) turns the condition spans of an estate into values of a store. A condition span is a clause of the agent's own files that says when a situation applies: its `id`, its file (`path`), the `quote` copied word for word, and optionally the `ledger` id of its prose unit. Each span goes through two systems, in this order:

| Step | Who | What happens |
|---|---|---|
| 1 | System 1, a reader | One yes or no question per known candidate (each value of each variable of the store): does this text say when `<variable>: <value>` applies? The reader sees only the clause. A decided yes (0.75 or more) attaches the span, as a `quote` entry, to that value. |
| 2 | System 2, a proposer | Called only for a span that no candidate took, when every candidate got a decided no. It proposes one value, and a variable when none fits. Code checks the proposal and writes the value with `approved: false` and `produced_by: model`. |

A span with a yes never calls system 2. A span with a candidate the reader could not settle (an answer between 0.25 and 0.75, or none) is reported `unsure` and is not proposed over: the right candidate may be the one that is unsure.

* Every value stands on a quote. Before any question, code checks that the quote is not empty, is at most 1,000 characters and is in its file (`texts`, the text of every file by path). A span that fails is `refused`, with the reason, and nobody is called.
* A proposal is checked by code: it must not name a value that exists and was not taken, and the store with the proposal must still validate (id form included). A proposal that fails is `refused` and the store keeps what it had.
* Code reads no word of a clause. The questions are built from the titles of the store; the clause is the text the reader sees.
* A reader or proposer that throws leaves its span `failed` (the first 200 characters of the message) and the run goes on.

The report (`ConditionsReport`) holds the counts per status, `proposerCalls`, the thresholds, the reader, and one outcome per span with the `variable/value` it stands under. Spans are read one after another, so a value proposed for one span is a candidate for the next.

**A repository system-1 judge reader.** See the [round-2 measurement](https://github.com/NexusGPT/driftbench/pull/1058) for the binary candidate adapter, development evidence and the fresh blinded measurement protocol.

**A model-port reader.** `createConditionReader(port)` is an optional system 1 implementation: it asks all supplied candidate yes/no questions together and accepts only one boolean per candidate. It preserves numeric comparisons, negation and triggering context in its instructions. A missing, nonboolean or incomplete answer fails the read, rather than inventing no votes. It accepts a complete JSON object after a provider explanation and sanitizes failures before the feed records them. It does not propose values; use the separate `createModelProposer` with the feed's default `all-no` policy.

**Recorded and replayed.** `recordConditions(recording, reader, proposer)` wraps the two systems so each answer lands in `recording` (a plain JSON object, keyed by a hash of the clause and the questions). `replayConditions(recording)` answers from it with no model and no network, and a read or proposal the recording lacks fails that span, so a question that drifted is a failed run, never a silent gap.

**Measured on planted conditions.** The test plants 40 fictional clauses: 30 about a value the store has, 10 about a value and a variable it lacks. The simulated reader gives a false yes 0.2 percent of the time and misses a true one 2 percent; the simulated proposer finds the planted proposal 98 percent of the time. Over 20 seeds (800 planted clauses): 778 of 794 assigned values are the planted one (precision 0.980) and 778 of 800 planted values are found (recall 0.973); the test requires 0.95 for both. A reader that says yes to everything and a run without system 2 both fall under the bar in the same test. These numbers come from a simulated reader that errs at a rate the test sets, so they prove the plumbing and say nothing about the product: with the real systems the recall is 0.654 at the default thresholds, and the feed is not yet shown to reach 0.95.

**Measured with the real systems.** `examples/variables/conditions` holds an invented candidate store (15 values), 26 planted clauses of the three example estates (`examples/estates`; 15 distinct sentences, some repeated in several estates and files) with the value each must end under, and two recordings made by `record.ts`: system 1 is the platform judge, system 2 is Haiku (`createModelProposer`). Four conditions of the clauses have no value in the store, so system 2 must propose them; the first clause of a group is proposed and the others must take that value. The test replays both recordings with no call. A value counts as assigned for every value a clause ends under; it is correct when it is the planted one.

| Thresholds (yes at, no at) | Matched | Proposed | Unsure | Assigned | Correct | Precision | Recall |
|---|---|---|---|---|---|---|---|
| 0.75, 0.25 (the defaults) | 16 | 1 | 9 | 19 | 17 | 0.895 | 0.654 |
| 0.75, 0.5 (chosen after the first run) | 18 | 4 | 4 | 24 | 22 | 0.917 | 0.846 |

Neither reaches 0.95. What the recording shows: The platform judge answers 0.26 to 0.5 to many clauses it means as no, so the default no threshold leaves them unsure; raising it to 0.5 was chosen after the first run, on the same clauses, and is not a held-out result. A clause that names a helper dispatch got a yes for two values at once (the invoice-difference clause also dispatches an agent). The test pins these numbers; they are not a bar.

**A separate model-reader measurement (2026-10-21).** The optional reader was developed on the existing 70-clause fictional development set, without opening frozen2 expected labels. Its first recording accepted 32 correct assignments and rejected 28 reads because the provider prefixed JSON with explanations (precision 1.000, recall 0.593). A development-only one-clause recording exposed that format; after the parser regression and fix, the same clause succeeded. The reader and prompts were then frozen before measuring the 73-clause frozen2 batch.

The initial partial result was **32/36 precision (0.889), 32/60 recall (0.533)**, with 32 failed spans. An unsupported conservative price in the budget guard prematurely stopped calls; that partial recall is not a completed measurement of the reader. Token usage was repriced at the exact model's [published list price](https://platform.claude.com/docs/en/about-claude/pricing), checked **2026-10-21**: `claude-sonnet-5-5` standard/global, USD 2 per million input tokens and USD 10 per million output tokens. The earlier responses cost **USD 0.470168**, including development; no cached tokens were used.

Only the 32 failed spans were then attempted, starting from the partial store and retaining every successful first-half outcome. The reader, proposer, feed and settings hashes were verified unchanged (`model-freeze.json`); no prompts, thresholds or reader logic were tuned between halves. The completed result is **46/53 precision (0.868), 46/60 recall (0.767)**, with 15 failed reads. Those failures are response-protocol failures (the reader requires exactly one boolean per candidate). Four assignments propose conditions on distractors, and three match a neighbouring or different condition. Eleven planted values are on failed reads and three are wrongly matched. Both 0.95 targets remain unmet.

The continuation cost USD 0.163798; **total lane spend is USD 0.633966**, calculated from returned tokens at the published prices, below the revised USD 8 cap. `model-heldout-2.json`, `model-heldout-2-completed.json` and their receipts preserve both halves; `conditions-model-recorded.test.ts` replays them without calls, checks the hashes and verifies every first-half assignment quote. The existing scorer credits a NEW value by its intended variable, without independently grading the proposed value's full semantics. The scan-to-feed CLI command remains unbuilt.

**A second measurement, with tuning.** A blind writer wrote 136 more clauses with labels, split by file into a tuning half (70 clauses) and a held-out half (66), in `dev-clauses.json` and `heldout-clauses-1.json` of the same folder. A label is `none` (the clause states no condition among the variables of the store, so any value assigned or proposed is a precision error), a value of the store, or `NEW` (a case of a variable the store has that equals none of its values; correct only when proposed under that variable). Each clause is read as a line inserted in the real file of an example estate. The configuration was tuned on the first half only and then frozen: the default question and a sharper one averaged (`averageReader`), a yes at an average of 0.5, system 2 called whenever no candidate got a yes, and a proposal accepted only under a variable the store has (`newVariables: false`). Measured, from the recordings the test replays:

| Half | Clauses | Planted values | Assigned | Correct | Precision | Recall |
|---|---|---|---|---|---|---|
| Tuning (tuned on) | 70 | 54 | 54 | 52 | 0.963 | 0.963 |
| Held-out (measured once) | 66 | 57 | 57 | 53 | 0.930 | 0.930 |

The held-out result is under the 0.95 bar, so the claim that the feed finds planted conditions at 0.95 precision and recall is not shown with real systems. The errors were of three kinds: proposals that repeat an existing value (the reader scored that value just under 0.5), new cases matched to a neighbouring value, and a proposal on a clause that states no condition of the store; one planted value stayed unmatched.

**A second round and a fresh batch.** A second tuning round used the 136 clauses of both halves (the first held-out half now counts as tuning data). It froze one more configuration, `frozen2`: system 2 is shown the titles of the existing values, and system 1 reads each proposed title against them and refuses a proposal it reads as an existing value. A cross-check (put a span in doubt when system 2 sees a neighbouring case) was tried and left out: it raised precision by about 0.015 and cost 0.06 of recall. On the 136 clauses `frozen2` scored 0.945 precision and 0.937 recall (tuned on). A blind writer then wrote 73 new clauses (`heldout-clauses-2.json`) that nothing had seen, and `frozen2` was run on them once:

| Set | Clauses | Planted values | Assigned | Correct | Precision | Recall |
|---|---|---|---|---|---|---|
| First round, tuning half | 70 | 54 | 54 | 52 | 0.963 | 0.963 |
| First round, first held-out half | 66 | 57 | 57 | 53 | 0.930 | 0.930 |
| Second round, both halves (tuned on) | 136 | 111 | 110 | 104 | 0.945 | 0.937 |
| Second round, fresh batch (measured once) | 73 | 60 | 61 | 50 | 0.820 | 0.833 |

The fresh batch was written with deliberate near-misses (clauses close to an existing value, and clauses on topics next to the store's variables), so it is harder than the first held-out half; the two measurements are not on one scale.

Status: the feed does not reach 0.95 precision and recall with the real systems. The best unbiased measurement is the fresh batch, 0.820 and 0.833. Two groups of errors account for most of it: a new case of a variable that system 1 reads as a neighbouring existing value (five clauses), and a value proposed under an existing variable for a clause that states no condition of the store (five clauses). Smaller groups are an existing value that system 1 did not recognise (three clauses) and a proposal refused as equivalent to an existing value (two clauses, one of them a real new case). Tuning gains on the tuning sets did not carry to new clauses, so the open question is not a threshold. The row stays open.

Not built here: producing the spans. The pointer reader labels them: a label set may mark a label `condition: true`, and the shipped set `agent-rules` does. This feed takes the spans as plain data, and no command passes them from a scan to the feed yet, so a caller supplies them.

## Impossible combinations

A constraint says that some values never occur together. `forbid` maps variable ids to value ids. Every cell that holds all of them is impossible. A pair is the usual case; one value, or three, work as well.

```text
constraints:
  - forbid: { channel: whatsapp, follow_up: callback_form }
    reason: the callback form is part of the web chat tab only
    approved: true
    produced_by: model
    provenance:
      - kind: quote
        path: tidewater-prompt.md
        quote: Offer the callback form after two replies that did not solve the question.
```

| Field | Required | Holds |
|---|---|---|
| `forbid` | yes | variable id to value id, at least one entry |
| `reason` | yes | why the values never occur together |
| `approved` | yes | false until a person approves the combination |
| `produced_by` | no | `code`, `model` or `owner` |
| `provenance` | no | the quote, or the owner's words, behind the reason |

Each variable and value in `forbid` exists (`VARIABLES_UNKNOWN_VARIABLE`, `VARIABLES_UNKNOWN_VALUE`), `forbid` is not empty (`VARIABLES_EMPTY_CONSTRAINT`), and no combination is written twice, whatever the order of its keys (`VARIABLES_DUPLICATE`). The constraints must leave at least one cell of the axes (`VARIABLES_GRID_EMPTY`). A constraint that names a detail stays in the store and is left out of the space map.

## Approval

Nothing counts until a person approves it. A variable has one `approved` flag, which its values inherit. A value may set its own flag. Each constraint has its own. The space map of a store keeps a value whose own flag, else the flag of its variable, is true; a variable left with no value is dropped, and so is a constraint that is not approved or that names a value no longer in the map. These are the rules the map proposal applies when it writes its space map.

## Loading, checking and converting

The package `@agent-nexus/driftbench-space` loads and converts a store. The package `@agent-nexus/driftbench-generate` checks the quotes and converts a proposal.

```ts
import { verifyVariableQuotes } from '@agent-nexus/driftbench-generate';
import { loadVariableStore, variablesToSpaceMap } from '@agent-nexus/driftbench-space';

const loaded = await loadVariableStore('examples/variables/tidewater.yaml');
if (!loaded.ok) throw new Error(loaded.errors.map((issue) => `${issue.code} ${issue.path}`).join('\n'));
const quotes = await verifyVariableQuotes(loaded.store, 'examples/variables');
const space = variablesToSpaceMap(loaded.store); // a result: ok with the map, or the errors
```

`loadVariableStore(path)` reads a file, `parseVariableStoreText(text, 'yaml' | 'json')` reads text, and `validateVariableStore(value)` checks a value that is already parsed. Each returns `{ ok: true, store, warnings }` or `{ ok: false, errors }`. An issue is `{ code, path, message }`, and the path is a dotted path into the store, such as `variables.2.boundaries.0.edge`. The loader never throws on a bad input.

| Code | The store is refused when | Reported at |
|---|---|---|
| `VARIABLES_PARSE` | the file cannot be read or is not valid YAML or JSON, or repeats a key | the whole file (empty path) |
| `VARIABLES_NOT_OBJECT` | the file holds something other than one mapping | the whole file |
| `VARIABLES_DUPLICATE` | a variable id, a value id in a variable, or a combination in the constraints is written twice | the second `variables.N.id`, `variables.N.values.M.id`, or `constraints.N` |
| `VARIABLES_KIND_REPEATED` | two axes are of kind `stage`, `deviation` or `channel` | `variables.N.kind` of the second axis |
| `VARIABLES_AMBIGUOUS_VALUE` | a value id is in two axes among the kinds `behaviour`, `persona`, `data` and `task`, even when the two axes are of different kinds | `variables.N.values.M.id` of the later one |
| `VARIABLES_UNKNOWN_DEVIATION` | an axis of kind `deviation` has a value that is neither `none` nor a deviation class | `variables.N.values.M.id` |
| `VARIABLES_EMPTY_CONSTRAINT` | a constraint forbids nothing | `constraints.N.forbid` |
| `VARIABLES_UNKNOWN_VARIABLE` | a constraint or a `when` or `unless` names a variable the store lacks | `constraints.N.forbid.NAME`, or `variables.N.values.M.when.NAME` (`unless` alike) |
| `VARIABLES_UNKNOWN_VALUE` | a constraint, a `when`, an `unless` or a boundary names a value its variable lacks | `constraints.N.forbid.NAME`, `variables.N.values.M.when.NAME.K`, or `variables.N.boundaries.B.holds`, `.fails` or `.edge` |
| `VARIABLES_WEIGHT_INCOMPLETE` | a variable weighs some of its values and not all | `variables.N.values.M.weight` of the first value with no weight |
| `VARIABLES_WEIGHT_ZERO` | every weight of a variable is 0 | `variables.N.values` |
| `VARIABLES_PRIOR_SOURCE` | the prior is `fitted` and has no `source` | `prior.source` |
| `VARIABLES_GRID_EMPTY` | the constraints forbid every cell of the axes | `constraints` |
| `VARIABLES_BOUNDARY` | the two sides of a boundary are one value, or the edge is on the wrong side of a strict or an inclusive comparison | `variables.N.boundaries.B.fails` (one value on both sides) or `.edge` (wrong side) |
| `VARIABLES_SOURCE_UNREADABLE` | `verifyVariableQuotes` cannot read the file a quote names; reported once per file | `PATH.path` of the first quote that names the file |
| `VARIABLES_QUOTE_NOT_FOUND` | `verifyVariableQuotes` does not find a quote in its file | `PATH.quote` of the quote |
| `VARIABLES_POINTER_UNRESOLVED` | `verifyVariableQuotes` finds that the pointer of a `structure` entry names nothing in its file (or the file is not valid JSON or YAML), or that its lines are past the end | `PATH.pointer` or `PATH.lines` of the entry |
| `VARIABLES_HASH_MISMATCH` | the place a `structure` entry names holds something else than the entry's `hash`: the file changed since the entry was written | `PATH.hash` of the entry |
| `VARIABLES_UNSOURCED` | advice only: a value, a boundary or a constraint has no provenance | `variables.N.values.M`, `variables.N.boundaries.B` or `constraints.N` |

In these paths N, M, B and K are positions counted from 0, NAME is a key, and PATH is the path of a provenance entry, such as `variables.0.values.1.provenance.0`. A provenance entry is reached through the `provenance` list of a variable, a value, a boundary or a constraint.

The checks run in this order. A schema error stops the load: the references are not checked. Otherwise every reference error is reported together, and `VARIABLES_GRID_EMPTY` is checked only when there is none. A schema error has the code `SCHEMA_` and one of these zod codes: `INVALID_TYPE` (a missing or mistyped field, or a non-whole count), `INVALID_VALUE` (a value outside a list, such as an unknown kind or `format`), `INVALID_FORMAT` (an id, a ledger id, a hash or a date in the wrong form), `TOO_SMALL` (an empty list, a negative number, a `total` below 1), `TOO_BIG` (a quote or an owner statement over 1,000 characters), `UNRECOGNIZED_KEYS` (an unknown key), `INVALID_UNION` (a provenance with an unknown `kind`) and `CUSTOM` (a rule of this page that the schema holds: a blank quote or statement, a path that is not relative, a `count` above `total`, a `limit` without a `comparison`).

Limits of each field, exactly:

* An id (variable or value) matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`. A `title`, an `agent`, a `version`, a `reason`, a `unit` and an `inventory` are not empty.
* A `weight` is a finite number from 0 up. A value `limit` is a whole number above 0. `within.minutes` is a number above 0. `polarity` is `must` or `must_not`. `priority` is `first`.
* A boundary `limit` is a finite number, positive, zero or negative. `when` and `unless` map variable ids to lists of at least one value id.
* A blank text is one that is empty after trimming white space. A `set_hash` matches `^[0-9a-f]{64}$`. A `ledger` matches `^[a-z2-7]{10}$`; a mixed-case or capital id is refused. A `date` is a real day written `YYYY-MM-DD`, with no time.
* `forbid` keys and values are strings; they are checked against the store by the references, not by their form.

Three conversions connect the store to the two files it replaces.

* `spaceMapToVariables(map)` turns a space map into a store. Each dimension becomes an approved axis, each constraint an approved one, and no entry has provenance or an author, because a space map says neither. The weights of the prior move onto the values they weigh. The store keeps one weight per value, so the weight a value wrote itself, when the prior also weighs its dimension, is the one thing not kept; a space command never read it. Everything else a space command reads is kept: converting back gives the same map.
* `proposalToVariables(proposal)` turns the dimensions and constraints of a map proposal into a store. It keeps every field: the role, the flags, who proposed each entry (`produced_by`), the rule fields and the weight of each value, and the evidence of each entry as a `quote` with the path as the proposal wrote it, so write the store beside the proposal. The phrases, the relations and the numeric settings stay in the proposal. Rebuilding the dimensions and constraints from the store gives the proposal's own, for the approved Acme proposal and for the one nobody approved.
* `variablesToSpaceMap(store, options)` turns a store into a space map: its approved axes, their values, weights and required flags, and the constraints whose values are all in the map. It returns the result of `validateSpaceMap`, so a store with no approved axis gives the error `SCHEMA_TOO_SMALL` on `dimensions`. With `approvedOnly: false` it keeps what is not approved. It does not add the value `none` to a deviation axis; the generator adds it when it builds the cells, as it does for a proposal.

## From an estate

`estateToVariables` (in `@agent-nexus/driftbench-estate`, the `variables` namespace) turns an estate map into a store. The estate map is the estate's proposal: each atom is a place that states behaviour, with its file, its line span and its quote, and `produced_by` says whether code or a model read it and `approved` whether a person did. The feed makes two kinds of variable:

| Variable | Role | Values |
|---|---|---|
| `atoms.<kind>` for each atom kind that holds axis atoms | `axis`, kind `behaviour` | each atom |
| `details.<kind>` for each kind that holds detail atoms | `detail`, kind `data` | each atom |
| `condition.<id>` for each atom that carries a numeric condition in a field | `detail`, kind `data` | `above_N`, `at_N`, `below_N`, and the boundary between them with its `limit`, `comparison` and `unit` |

**Where a value comes from.** Every value stands on the place its atom is read from, and the kind of file decides how that place is written:

| The atom is read from | The entry is |
|---|---|
| prose (`.md`) | a `quote` with the ledger id of the pointer unit that holds it (`pointer.nextLedger`, or a committed ledger when one is given, so the ids agree with an `estate scan --pointer` of the same estate) |
| a JSON or YAML file | a `structure` entry with the JSON pointer to the value the quote is in, and the hash of that value |
| any other file, such as a script | a `structure` entry with the range of lines and the hash of those lines |

A prose quote of more than 1,000 characters is valid when the ledger resolves it: the ledger id names the whole unit, and the entry keeps the first words of the quote, the longest prefix of at most 1,000 characters that ends at a word (a prefix of text in the file is in the file). An atom is refused, named in `refused` with the reason, and left out of the store only when its place does not resolve: its quote is empty; its file was not given to the feed; its lines are past the end of the file; its quote is not at the lines it names; its JSON or YAML file does not parse or has no value at the quote; or no unit of a prose file holds the quote. Guards, tools, stages and settings, which live in JSON files, are values like any other.

**Where a condition comes from.** A numeric condition comes from a structured field and from nowhere else. The feed matches no word of a situation or a quote, so "late by more than two days" in prose makes no condition. Two fields give one:

* `fields.condition` on an atom, in the shape of a store boundary: `{ limit, comparison, unit? }`, where `comparison` is `lt`, `le`, `gt` or `ge`. A reader that finds a number in a structured file, or the labels of the pointer reader, writes it there. Anything else in the field (another comparison, a string for the limit, an extra key) makes no condition.
* The limit an invariant check measures. A check that measures a number declares it beside the check (`INVARIANT_LIMITS` in the estate scan): the check, the field of its atom that holds the limit, the comparison and the unit. The feed takes a limit from every invariant whose check is declared, and names no check itself. Today one check declares a limit: `standing_size`, whose `ceiling` caps the standing instructions in characters (`le`, `characters`). A check that measures a new limit adds its row.

**What the feed leaves out, and how it names things.**

* The fixed situation axes of every estate (`ask_class`, `session_state` and the others in the estate map) name no source, so they are not in the feed. They come from a space map (`spaceMapToVariables`) and are merged beside it, as the Northwind example does.
* A variable's id is a slug: `atoms.<kind>`, `details.<kind>`, and `condition.<slug of the atom id>` (the check id for a measured limit, such as `condition.standing_size`). A second atom with the same slug gets `_2`, `_3`. The values of a condition are `above_N`, `at_N` and `below_N`, with N the limit as written.

The result depends on the map and the files only: `renderVariableStore` writes the same bytes for the same estate. The three invented estates of `examples/estates` have their stores beside their maps: `fixture/variables.yaml`, `fixture-v2/variables.yaml` and `reader-cases/variables.yaml`. Each validates, every provenance entry resolves in its file, and no atom is refused. Each holds one condition, the size ceiling.

```ts
import { loadEstateMap, variables } from '@agent-nexus/driftbench-estate';

const loaded = await loadEstateMap('examples/estates/fixture/approved.yaml');
if (!loaded.ok) throw new Error('map refused');
const texts = new Map<string, string>(); // every file the atoms name: path to text
for (const file of new Set(loaded.map.atoms.map((atom) => atom.provenance.file))) {
  texts.set(file, await readFile(`examples/estates/fixture/${file}`, 'utf8'));
}
const { store, refused } = variables.estateToVariables(loaded.map, variables.provenanceResolver(texts), {
  agent: 'northwind',
});
await writeFile('variables.yaml', variables.renderVariableStore(store));
```

## Filling a store from an interview

`interviewVariables(store, ask, options)` in `@agent-nexus/driftbench-generate` asks the owner for what a store lacks and writes the answers into a copy of the store. It asks three kinds of question, in this order. Code checks each answer against the store being built. An answer that does not fit is asked again, with the reason, up to `maxAttempts` times (default 3). A question that is still wrong after that is given up, and the interview goes on without it.

| Question (key) | Asked | An answer | Asked again when |
|---|---|---|---|
| `values:VARIABLE` | once per variable | `{ none: true }`, or `{ values: [{ id, title, words }] }`: the values the store is missing | an id is not an id, is already a value of the variable (or twice in the answer), or has no title |
| `pair:N` | until the owner answers `{ done: true }` | `{ forbid: { VARIABLE: VALUE, ... }, reason, words }`: values that never occur together | a variable or a value is unknown, fewer than two variables are named, the reason is blank, the combination is already ruled impossible (in any key order, or contained in a constraint already there) or would leave no cell |
| `weights:VARIABLE` | once per variable | `{ skip: true }`, or `{ weights: { VALUE: number, ... }, words }` | a value is unknown or has no weight, a weight is negative, the weights do not add up to 1 (within 0.000001), or the variable already has weights and got a new value and the owner skips |

Every answer that carries `words` must carry the owner's words, not blank and at most 1,000 characters. An answer of another shape is asked again too, with the path of the problem.

What an accepted answer writes:

* A value: a value of the variable with `produced_by: owner`, `approved: true` and an `owner` provenance entry holding the words and the day.
* A pair: a constraint with `approved: true`, `produced_by: owner`, the reason, and an `owner` provenance entry.
* Weights: the `weight` of every value of the variable, and an `owner` provenance entry added to each value.

The day comes from `options.now` (default: the clock). The result is `{ ok: true, store, transcript, added }`, with a store that passes `validateVariableStore`, or `{ ok: false, reason, transcript }`. The transcript lists every ask with its outcome (`accepted`, `refused` with the reason, `gave-up` or `skipped`). The run fails when the asker throws, and when the store is invalid at the end, for instance because a variable that has weights got a new value and never got its weights.

The asker is a function. `replayAsker(recording)` gives the answers of a recording, in order, per question key, with no model and no person; a question with no recorded answer left fails the run, and `asker.unused()` names the answers never asked for. A recording is YAML: `version: 1` and `answers`, a list of `{ question, answer }`. A refused answer and its correction are two entries of one question. The folder [`examples/variables/interview`](../examples/variables/interview/start.yaml) holds an invented store (`start.yaml`) and the recording of an interview over it (`answers.yaml`) with five wrong answers, each followed by its correction.

## Planning rows from a store

`planV2` builds the rows of a test plan from a store. A row gives one value to every approved variable, axes and details alike. It is opt-in: the planner of the seeders (`generate`) is unchanged, and nothing reads a plan yet.

```ts
import { planV2, renderPlanV2 } from '@agent-nexus/driftbench-generate';
import { loadVariableStore } from '@agent-nexus/driftbench-space';

const loaded = await loadVariableStore('examples/variables/tidewater.yaml');
if (!loaded.ok) throw new Error('the store is not valid');
const plan = planV2(loaded.store, { seed: 1, budget: 20, seeds: [{ id: 'monday', values: { channel: 'email' } }] });
console.log(renderPlanV2(plan));
```

The plan uses what a person approved, as the space map does: a value counts when its own flag, else its variable's, is true, and a constraint counts when it is approved and every value it names is in the plan. `approvedOnly: false` plans everything.

### What the rows cover

The store never lists rules. The planner reads them from what the store keeps (`storeRules` lists them):

* A passage is a rule. It is named by the ledger id of its quote, else by the file and the words of the quote with white space folded. The variables of every value, boundary and constraint that quotes it belong to the rule; a constraint brings every variable it forbids.
* A value with `when` or `unless` brings the variables they name into the rule of the passages it quotes. With no quote it is a rule of its own. A value with only a `polarity`, `limit`, `within` or `priority` is a rule of its own variable.

The strength of the cover follows the rules, with a floor of 2 across the axes. The floor keeps the plan from losing a pair of axes that the pairwise cover of the space map holds (`cells` of the space package at strength 2): the plan of a store holds every pair of values of every two approved axes that some valid row can hold.

| Layer | Strength | What the rows must hold |
|---|---|---|
| `own` | 3 | for each rule that names n variables, every combination of values of every `min(3, n)` of them |
| `shared` (the floor) | 2 | every combination of values of every pair of approved axes, whether or not a rule joins them, except a pair that a group of a rule holds already; a detail never makes a pair |
| `single` | 1 | every value of the variables that no group above names: the details no rule names |

Values and pairs of approved axes are never lost; triples are covered only inside rules. A triple of axes that no rule joins is not a target, so the plan holds fewer triples than the pairwise-and-triple cover of the space map (`cells` at strength 3); `no-cell-lost.test.ts` names each such triple on the worked stores. A triple floor over all axes would multiply the rows.

A combination that no valid row can hold is not a target. That includes a combination a constraint forbids, and one that constraints together make impossible: with `tide: slack` forbidden at both lamps, no row holds `slack`. A value that no valid row can hold gets the warning `value_unreachable`, and it is the store that may be wrong. Rows are built one at a time. Each starts from the most common target still waiting, then takes for every other variable the value that covers the most waiting targets, among the values that keep the row completable to one no constraint forbids. The array is not minimal.

### Seeds, order and budget

* A seed row is a real session: `{ id, values }`, with the values of the variables the session shows. Seeds come first, in the order given, and no budget cuts them. A seed counts as covering every combination all of whose variables it sets. A seed that names a variable or a value the store does not have is kept without that entry (`seed_unknown_value`). A seed that names a value the store has but nobody approved is kept whole, entry included, and each such entry is reported (`seed_unapproved_value`); it covers nothing and adds nothing to the weight. When nothing in the store is approved, the plan is the seeds alone (`no_variables`). A seed that holds a combination the store forbids is kept (`seed_forbidden`).
* The weight of a row is the product of the shares of its values, written as a sum of logarithms (`logWeight`), so a row of hundreds of variables does not underflow. The share of a value is its weight over the weights of the approved values of its variable, or the same for all when the variable has no weights. A weight of 0 gives minus infinity, written `null` in the JSON.
* The new rows come from the most common to the rarest. Rows of equal weight are ordered by a hash of the seed and the row, so the order is stable.
* `budget` is the most rows the plan holds, seeds included. The plan keeps the first rows and cuts the rarest, and `layers` says what the cut leaves uncovered. A budget below the number of seeds keeps all the seeds and no new row.
* The same store, options and `seed` give the same text, byte for byte. The log weight is written to nine places.

### The plan

| Field | Holds |
|---|---|
| `agent`, `version`, `seed`, `budget` | the store and the options |
| `generated`, `cut` | new rows built, and new rows the budget cut |
| `layers` | per layer: `strength`, `groups`, `targets`, `infeasible`, `seeded` (targets the seeds hold), `covered` (targets the kept rows hold), `uncovered` |
| `rules` | the rules read from the store: `id`, `label`, `variables` |
| `rows` | `id` (`seed.NAME`, `row.001` ...), `source` (`seed` or `planned`), `values`, `logWeight` |
| `warnings` | `no_variables`, `value_unreachable`, `seed_unknown_value`, `seed_unapproved_value`, `seed_forbidden`, each with a message |

## Worked examples

The folder [`examples/variables`](../examples/variables/README.md) holds three stores, one for each kind of agent. Every number, date and sentence of the owner in them is invented. Their quotes are copied from files of the repository, and the tests check each one.

| File | Agent | What it shows |
|---|---|---|
| [`acme.yaml`](../examples/variables/acme.yaml) | the Acme sales assistant, a prompt | entries that follow the Acme proposal (behaviours, channels, who talks, the coverage check), with weights from conversation counts and from the owner's words, and a boundary read from the prompt: a lookup that fails again is the second failure in a row |
| [`northwind.yaml`](../examples/variables/northwind.yaml) | the Northwind operations assistant, an estate | three variables a condition names, each with its boundary and ledger ids, beside the two fixed axes of every estate, which come from a space map and name no source |
| [`tidewater.yaml`](../examples/variables/tidewater.yaml) | the Tidewater Cycles booking assistant, a prompt with one tab per channel | the channel as an axis weighted by conversation counts, a value a model proposed that nobody approved, two boundaries, and impossible pairs that come from the tabs and from the owner |

The boundary of the Northwind store, as the file writes it:

```text
  - id: shipment_days_late
    title: How many days late a shipment is
    kind: data
    role: detail
    approved: true
    produced_by: model
    values:
      - id: under_two_days
        title: Not late, or late by one day
        weight: 0.6
        provenance:
          - kind: quote
            path: ../estates/fixture/CLAUDE.md
            quote: When a shipment is late by more than two days, tell the user and propose a supplier email.
            ledger: k4jd7xq2mf
          - kind: conversations
            count: 120
            total: 200
            set_hash: 660a833739237c697a631393e183b320b543c990a12933b5216941878505d74e
      - id: exactly_two_days
        ...
      - id: more_than_two_days
        ...
    boundaries:
      - holds: more_than_two_days
        fails: under_two_days
        edge: exactly_two_days
        limit: 2
        comparison: gt
        unit: days
```

The ledger id is made up: the ledger assigns the real ones. The 200 conversations do not exist; the `set_hash` is the SHA-256 of the text `northwind-example-conversations`.

The loader reports 12 `VARIABLES_UNSOURCED` entries for this store: the values of the two fixed axes. The Acme and Tidewater stores report none.

See also: [generating tests](generating.md), [testing an estate](estate.md), [recovery](concepts/recovery.md).

## Programmatic readers and planning

This section extends the product contract to the readers, planner and counter. These are requirements for their implementation, not a claim that they are built. The format sections above are imported from the reviewed component contract at commit `64a0007fc446e84cee82ac266affa7d46c4044cf`; this bank integrates after that component. The file loader above retains its nonthrowing result interface and its warning-only treatment of missing provenance. Programmatic operations below are separate APIs: `validate` (the file loader) and `quotes` (the quote check) take a store file and return the issues of the sections above; `buildStore`, `plan`, `coverage` and `weightInterval` are the readers, the planner, the counter and the interval. Their neutral TypeScript projection is [`VariablesImpl`](../packages/validators/src/ladders/variables/interface.ts); serialized stores still use the full file schema above.

### Reader rules

* **R1: Source evidence.** A reader-produced value has at least one provenance entry from its actual source. Merging sources retains their evidence: a value known to several sources keeps one entry for each source, of that source's own kind. A converted or manually imported store may omit provenance; the file loader reports advice only. Reader outputs may be empty when no input produces a value, although an empty serialized store is invalid.
* **R2: Quote refusal.** Estate readers test findability using the normalization in Provenance, against the supplied file with the exact named path. They do not read additional files from disk. They retain the original quote and path unchanged. Each rejected value has one refusal naming it and an explanatory reason; a refused condition names its span or rule. A reason is distinct from the rejected identifier and at least eight characters. Valid sibling values remain; a variable with no accepted values is omitted. Owner and conversation evidence does not require a file quote.
* **R3: Condition witnesses.** A numeric condition produces three distinct samples below, at and above its threshold, with boundary roles consistent with its comparison. This is stricter than the file format, which lets the edge of a hand-written boundary be the value of the side the limit falls on (Boundaries): a reader always writes a third value for the edge. Each sample carries a `quote` provenance entry with the path of the file and the text of the condition span. An integer threshold uses integer samples on both sides; noninteger thresholds permit fractional samples. Equality and inequality conditions still retain all three cases, without inventing an unsupported file-format comparison. Boolean conditions produce true and false; membership conditions produce an in-list and an out-of-list sample. Neither requires a numeric boundary. Range conditions retain samples below the lower limit, at each limit, strictly inside, and above the upper limit. Decimal and negative signs, zero, thousands separators, English number words, currency signs and units preserve the numeric quantity. Mentioning a number without a current condition does not create one.
* **R4: Source identity.** Condition spans naming the same quantity merge into one variable, retaining their boundary samples without duplicates; different quantities and different tool fields remain distinct. Repeated tool-field evidence merges by field. IDs satisfy the grammar above and remain stable under source order, unrelated additions and equivalent formatting. A name or subject that is not well-formed Unicode (it holds an unpaired UTF-16 surrogate) is refused with a reason that names it: one pass over every key and value of the sources, before anything else reads them, leaves out each entry (file, rule, condition, tool value, session, owner entry) that holds one, and every refusal prints its text with U+FFFD in its place. Two such names would encode to the same replacement text and so to one id or one hash. ID normalization disambiguates collisions rather than dropping an input; JavaScript prototype names are ordinary data keys. Titles may contain Unicode. Rule membership records every variable named by that rule's conditions and tool evidence.
* **R5: Conversations and owner input.** Counts count observed values per variable; missing observations do not increase that variable's total. Unknown values of an existing variable become unapproved proposals with count provenance. Unknown variables are refused. Empty conversation input adds no counts and changes no prior. The conversation set hash is invariant to input order and changes when a session changes. Conversation text, identifiers and personal data are excluded from stored provenance. Observed variables have complete relative weights proportional to counts; unobserved variables gain no invented weights. An owner can add values, impossible pairs and weights, with words and date; references to missing variables or values are refused with a reason. Owner words are stored unchanged; blank words and unreal dates are refused. Existing values gain the additional owner provenance rather than a duplicate value. Owner weights are stored as declared and invalid weights (nonfinite, negative or not a number) are refused with a reason. Repeated or reversed impossible pairs are deduplicated. Existing owner rulings on proposed values, relative weights and common-first budget order remain in force.

### Planner rules

* **R6: Required coverage.** Plan over approved variables and approved values, applying the inheritance rule above. Each rule requires all allowed tuples of strength three over its variables; every pair of approved axes requires strength two, whether or not a rule joins them (the floor of the planner), and a detail never makes a pair; remaining variables require strength one. The older reading, that an axis is shared when at least two multi-variable rules name it, no longer decides coverage. Strength is capped at the group's size. Required tuples form a union, with duplicates counted once. A tuple is allowed only if it extends to some full valid assignment; local absence of a forbidden pair is insufficient.
* **R7: Rows and impossible spaces.** Every new row assigns exactly one listed approved value to every active variable, contains no impossible pair, and has a unique nonempty string ID. Empty active spaces produce no new rows. An unsatisfiable programmatic space produces no rows or an error naming its conflict. Duplicate or reversed pairs have the same meaning. A constraint may forbid one value, a pair or three values: no row holds all of its cells, and no tuple it makes impossible is a target. A constraint that is not approved plans nothing. A value that no valid row can hold gets the warning `value_unreachable`. A pair that names two values of one variable excludes nothing, because a row holds one value of a variable. This permits hostile programmatic inputs for diagnostics; it does not change the file loader's rejection of an empty grid.
* **R8: Seed retention and credit.** Input seed rows appear first, in input order, with unchanged assignments and `kind: seed`; they are copied rather than aliased. A seed row may carry an id (`seedIds`, in the order of the rows); a row without one is named by its position. The plan names a seed row `seed.` followed by its id (or its position from 1). Two seed rows with one id raise an Error that names the id. Partial seeds credit only allowed tuples whose variables they assign, at every strength of every group. A seed that names a variable or a value the store does not have is kept without that entry, and the plan warns `seed_unknown_value`. A seed that names a value the store has but nobody approved is kept whole, and the plan warns `seed_unapproved_value`; the entry covers nothing. A seed that holds a combination the store forbids is kept, and the plan warns `seed_forbidden`. When nothing in the store is approved, the plan is the seeds alone and warns `no_variables`. A warning is `{ code, message }` in the `warnings` of the plan. Absent and empty seed arrays are equivalent. Every later row has `kind: new`, covers a tuple the seeds miss, and repeats neither a seed nor another new row. If seeds cover everything, there are no new rows. Without a budget cut, seeds and new rows together cover all required tuples. In the thirty-percent-covered, half-covered, ninety-percent-covered and mostly-covered benchmark cases, seed credit must reduce the new-row count compared with the same unseeded plan.
* **R9: Traffic order and budget.** A row's traffic weight is the product of its values' normalized relative weights, treating variables independently. A plan row reports it as `logWeight`, the sum of the logarithms of the shares of its values, written to nine places, and `null` for minus infinity when a value has weight 0. Weights are relative: scaling every weight of a variable changes no share. A variable with no weights uses uniform shares; other variables may have complete relative weights. Partial weighting within one variable remains invalid in the file format. Compare order in log space to avoid underflow. New rows are ordered by descending traffic weight, after seeds. A budget counts seeds too, retains a prefix of the same uncut plan and cuts rare rows first. Zero budget without seeds yields no rows. A budget below the number of seeds keeps every seed and no new row.
* **R10: Programmatic errors.** Invalid numeric budgets (negative, fractional or nonfinite) raise `RangeError` naming `budget`; a nonnumeric budget may instead raise `TypeError` naming `budget`. Counter groups with unknown or duplicate variable IDs raise `RangeError` naming that ID. Nonpositive or noninteger strengths raise `RangeError` naming `strength`. These exception rules apply to programmatic planning/counting only, never to the file loader.
* **R11: Determinism and ownership.** Equal source data, options and seed produce byte-identical outputs across calls and processes, independent of timezone, locale, clock and ambient random generators. Reordering object keys does not change their meaning. Inputs may be frozen and are not mutated. Reader results share no mutable objects with their inputs or previous results. All safe integer seeds, including zero and negative values, are supported. Editing a reused object has the same effect as passing an equivalent fresh object; object-identity caches cannot return stale results.

### Counter and interval rules

* **R12: Exact coverage.** `coverage(store, rows, groups, options)` counts distinct allowed tuples and the distinct ones held by the rows, using R6's extendability rule. Overlapping groups and repeated rows never inflate either count. Partial rows credit only assignments they contain. A plan exposes a coverage report with these same exact allowed and covered counts. Counts larger than the safe integer range are exact `bigint` values. `options.uncovered`, when supplied, requests a list of distinct allowed tuples absent from all rows, of exactly the smaller of that limit and their count. A large enough limit requests all uncovered tuples. Omission does not require a list.
* **R13: Weight intervals.** `weightInterval(count, total)` returns the two-sided 95% Wilson score interval for integer `0 <= count <= total`, `total >= 1`, using `z = 1.959963984540054`. With `p = count / total`, denominator `d = 1 + z²/total`, centre `(p + z²/(2 total))/d` and half-width `z sqrt(p(1-p)/total + z²/(4 total²))/d`, return the centre minus/plus half-width, clamped to `[0,1]`. The interval is computed from counts; the store does not persist it. Validator tolerances and seeded repeated-sample coverage checks accommodate floating-point error and discrete sampling; constant `[0,1]` is not this interval.

### Product capacity requirements

* **R14: Covering-array size.** For the generated unconstrained or universally extendable benchmark spaces, let `M` be the required tuples not held by seeds, and `p` the reciprocal of the largest product of arities in a required tuple. Let `G = ceil(log(M)/-log(1-p))`, with `G=0` for `M=0` and `G=1` for `p=1, M>0`. The new-row cap is `ceil(1.25 G)+1`; no new row is needed when `M=0`. For the dense impossible-pair capacity cases the factor is four. Independent variables outside rules/axes need at most twice their maximum arity in rows (six for ternary variables). A single rule of six or eight binary, five ternary, or four quaternary variables uses fewer than 60% of its full product. These are explicit product quality targets, not a theorem about arbitrary constrained spaces.
* **R15: Processor-time capacity.** The following limits measure process CPU time on the validator host, excluding fixture generation. These targets need calibration in the pending component pilot; they are not measured performance claims about an implementation.

| Workload | Maximum CPU time |
|---|---:|
| Binary shared axes: 20/50, 100, 200, 400 | 5/5, 10, 15, 40 seconds |
| Ternary shared axes: 30, 60 | 10, 30 seconds |
| Arity-eight shared axes: 10, 20 | 10, 40 seconds |
| 20 or 100 six-variable binary rules; overlapping-rule case | 30 seconds |
| 1,000 or 5,000 independent ternary variables | 10 seconds |
| 200 arity-four variables, 30 axes, 2,000 or 20,000 impossible pairs | 30 seconds |
| One arity-200 axis and three binary axes | 10 seconds |
| 500 or 3,000 seeds over 20 shared axes | 8 seconds |
| 200, 2,000, 10,000 condition spans across 20 files | 5, 10, 30 seconds |
| 10,000 or 100,000 conversations on eight five-valued variables | 2, 5 seconds |
| Up to 2,000 quotes in a one-megabyte file; 2,000 or 10,000 owner-added values | 3 seconds |
| Closed-form count, no rows, 200 or 500 binary variables at strength three | 50 milliseconds |
| Coverage of 30 rows over 100 binary variables at strength three or 200 at strength two | 20 seconds |

### Rules by bank family

The validator bank for this page (`validators/variables/CATALOGUE.md`) has one family of items for each part of the contract. Every item names the rules it checks; the test `packages/validators/test/variables/docs-anchors.test.ts` fails when an item cites a rule outside the row of its family or a rule this page does not hold.

| Family | Rules | What the page requires |
|---|---|---|
| sources | R1, R3, R4, R5, R6, Boundaries, Provenance, Limits | what each of the three sources adds to a store, that equal quantities merge and different ones do not, and the shape of every provenance entry |
| quotes | R2, R15, Provenance | a quote is findable in its named file after the folding of Provenance, or the value is refused with a reason; the quote check reports each wrong quote and each missing file once |
| values | R4, R5, R6, R11, R15, Values, Impossible, Approval, Limits | ids follow the grammar and stay stable, owner values join existing ones, references and kinds are checked, unapproved values are not planned |
| boundaries | R1, R3, R4, Boundaries, Limits | three distinct samples for each condition, in the forms R3 lists, and the sides of a boundary against its comparison |
| impossible-pairs | R5, R6, R7, R8, Impossible, Approval | no row holds an impossible combination of any size, an unapproved one plans nothing, and an unsatisfiable space gives no rows or a named error |
| weights | R5, R9, R13, Values, Limits | weights are relative counts or the owner's words; a weight of 0 is minus infinity; the weight interval is the Wilson interval; the loader refuses bad weights |
| strength | R6, R7, R11, R12, R14 | strength 3 inside rules, 2 across approved axes, 1 elsewhere, every required tuple covered within the row cap |
| seed-rows | R7, R8, R11, R15 | seeds lead the plan as the page keeps them, new rows cover only what they miss, and irregular seeds are reported |
| budget-order | R9, R10 | new rows run most common first, a budget keeps a prefix of the uncut plan, a budget below the seed count keeps the seeds, and a bad budget raises |
| counter | R6, R8, R10, R12, R15 | exact counts of allowed and covered tuples, exact beyond the safe integers, no enumeration for closed forms |
| scale | R14, R15 | bounded rows and processor time at hundreds of variables |
| determinism | R11 | same input, same bytes, in any process, locale, zone and clock |

### Adapter projection

`StoreDoc` projects fields needed by these programmatic operations; it is not the YAML/JSON file schema. `shared` maps the axis role, and omitted approval flags in this projection mean approved. `rules`, `refused`, row `kind`, row `logWeight`, `warnings` and derived `sample` values expose reader/planner results for testing; a plan row holds `id`, `kind`, `values` and `logWeight`. `forbids` carries constraints of any size beside the pairs the readers produce. The planner reports `source` (`seed` or `planned`) where the projection says `kind` (`seed` or `new`). `validate` and `quotes` take the serialized store file of the sections above, not the projection. Numeric samples derive from boundary limits and comparison semantics; titles retain human wording. The adapter must not repair incorrect product output. The product rules above, not adapter convenience, determine behavior.
