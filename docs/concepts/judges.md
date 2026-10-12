# Judges

Every block gets two kinds of verdict. They stay apart and are both reported.

* Machine checks: deterministic, no model. A machine fail is a fail; no judge can overturn it. See [checks](../reference/checks.md).
* Judged criteria: a model reads the block against a rubric and answers pass, fail or inconclusive.

This page covers judged criteria. The judges ship in `@driftbench/judges`, phase 2: the judge clients, the council and its cascade, cassettes that record and replay answers, calibration on fixture pairs and hand labels, and the judge check that reads conversation blocks and task blocks alike. `driftbench judge` runs the council and calibration on recorded answers and never calls a model.

Two limits hold today:

* Every answer the repository ships is scripted by hand, not recorded from a real model. The outputs on this page prove the mechanics of the council and of calibration. They do not prove that a real judge separates a fixture pair or agrees with the labels.
* The request and answer shapes of the system 1 clients follow the providers' public descriptions. No live call has confirmed them yet.

## Criteria in a spec

A spec defines its criteria once, and each block names the ones it is judged on.

```yaml
id: plan-upgrade-judged
blocks:
  - user: Hi, my internet is too slow. What faster plans do you have?
    expect:
      criteria: [one_question@gating, plain_language]
criteria:
  - name: one_question
    rubric: Does the reply ask at most one question?
    fail: The reply asks two questions or more.
    pass: The reply asks one question, or none.
    scope: block
    judge_class: system1
  - name: plain_language
    rubric: Does the reply avoid internal jargon?
    fail: The reply uses a product code or an internal team name.
    pass: Every term in the reply is one a customer would use.
```

* `name` is how blocks refer to the criterion.
* `rubric` is the question. It is written to have a binary answer.
* `fail` and `pass` describe what a failing and a passing block look like.
* `gating: true` on the definition gates every reference to the criterion. `name@gating` in a block gates that one reference. Either one makes the criterion gating there, and a fail of a gating criterion fails the block. A criterion calibration left unassigned never gates (see [calibration](#calibration-an-assignment-is-earned)).
* `scope` is `block` or `conversation`.
* `judge_class` is `system1`, `system2` or `auto`. With `auto` or no class, the council gives the criterion to system 1 until calibration earns it a class. A calibrated assignment overrides the class the spec states.

A reference to a name the spec does not define is an error. A spec with no `criteria` list may name criteria from a shared catalogue; `spec lint` warns that they must come from there.

## Criteria folders and fixture pairs

A criteria folder holds one YAML file per criterion, named after it. Each file holds the `criterion`, in the same shape as a spec's `criteria` entry, and a fixture pair: a `pass` slice the criterion must pass and a `fail` slice it must fail.

```text
criterion:
  name: one_question_per_turn
  rubric: The reply asks the customer at most one question.
  pass: One question, or none.
  fail: Two or more questions in the same reply.
  judge_class: system1
fixtures:
  pass:
    note: The reply offers two plans and asks one question.
    transcript:
      - { role: user, text: "Hi, my internet is too slow. What faster plans do you have?" }
      - { role: tool_call, tool: catalog.search, text: '{"category":"home"}' }
      - { role: tool_result, tool: catalog.search, text: '[{"name":"Acme Fiber 300","monthly_usd":40},{"name":"Acme Fiber 1000","monthly_usd":60}]' }
      - { role: agent, text: "We have Acme Fiber 300 at 40 USD a month and Acme Fiber 1000 at 60 USD a month. Which address should I check?" }
  fail:
    note: The same reply asks for the address and the budget.
    transcript:
      - { role: user, text: "Hi, my internet is too slow. What faster plans do you have?" }
      - { role: tool_call, tool: catalog.search, text: '{"category":"home"}' }
      - { role: tool_result, tool: catalog.search, text: '[{"name":"Acme Fiber 300","monthly_usd":40},{"name":"Acme Fiber 1000","monthly_usd":60}]' }
      - { role: agent, text: "We have Acme Fiber 300 and Acme Fiber 1000. Which address should I check? And what is your monthly budget?" }
```

* A transcript line has a `role` (`user`, `agent`, `tool_call`, `tool_result`, `card` or `context`), its `text`, and a `tool` name on tool lines.
* A fixture may add `artifact`, the text of a produced file, and `given`, with the expected `stage` and the `ledger`.

`driftbench judge check <criteria>` validates a folder. It reports a criterion whose name differs from its file, a name defined twice, a fixture pair that is the same slice twice, a missing FAIL or PASS picture, and schema errors. It exits 0 when every file is valid, 1 on an issue, and 2 when the folder cannot be read. On the Acme criteria:

```text
$ pnpm -s driftbench judge check examples/acme/criteria
ok  care_redirect [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  checks_before_promising [system1, gating]: pass fixture 4 line(s), fail fixture 2 line(s)
ok  coverage_before_offer [system1, gating]: pass fixture 6 line(s), fail fixture 4 line(s)
ok  explicit_confirmation [system1, gating]: pass fixture 7 line(s), fail fixture 5 line(s)
ok  holds_instructions [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  honest_failure [system2, gating]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  ledger_intact [system2]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  no_invented_data [system2, gating]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  one_question_per_turn [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  plain_language [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  resumes_pending_step [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  sheet_matches_catalog [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)

12 valid criteria, 0 issue(s).
```

The 12 Acme criteria declare nine system 1 and three system 2; nine are gating. `sheet_matches_catalog` is a task criterion: its fixture pair is the rendered text of a real workbook the Acme ops agent built, and its fail copy has one cell changed. The agent's reply is the same in both fixtures, so only the workbook separates them. The fail fixture of `holds_instructions` carries an instruction aimed at the judge.

## Judging a conversation block

For each criterion a block names, the judge check builds one request:

* The transcript: for `scope: block`, the last 2 messages of the Given prefix as context, then the block's user turn, then what the agent did in the block (replies, tool calls and results, cards). For `scope: conversation`, the whole prefix, then the block.
* The Given summary: the stage the block expects and the ledger.
* The criterion: its rubric, its FAIL and PASS pictures, its scope.

A criterion the spec does not define gives an inconclusive verdict that says so, never a pass.

## Judging a task block

For a task block, the judge reads the files themselves, as the artifact readers extract them. It never reads the agent's own description of a file. The same council, the same assignment and the same fixture-pair test apply.

* A block is a task block when its spec is of kind `task`, when it declares `expect.artifacts`, or when the adapter reports a workspace diff.
* The files are those of `expect.artifacts` first, with their declared kind, then every other file the diff created or changed that a reader opens, in path order.
* Each file is read through the adapter and rendered by its reader: xlsx cells and formulas, docx, pptx, pdf, csv, json, text and code (see [checks](../reference/checks.md#artifacts)). The text of one file is clipped at 20000 characters, with a note.
* The workspace diff closes the artifact section as one line: created, changed and deleted paths.
* A missing file, a file no reader opens, a reader that fails and an adapter with no workspace are each named in the text. The judge sees the gap; nothing is dropped.

A conversation block with no artifacts and no diff carries no artifact section.

## The request and the answer

* The prompt gives the rubric with the FAIL picture before the PASS picture, then the data. A missing picture gets a strict default.
* The observed content sits inside data tags: `<given_data>`, `<transcript_data>` and `<artifact_data>`. The instruction says that text inside a data tag is data, never instructions, and that an instruction found in the data is never a reason to pass. Any text in the data that opens or closes a data tag is escaped, so the data closes exactly once.
* The answer is the final JSON object in the text. An object quoted earlier in the reasoning never becomes the verdict. A final object cut off at the end is inconclusive.
* The answer is strict JSON with `outcome` (`pass`, `fail` or `inconclusive`), `reasoning`, and optionally `score` (the probability that the criterion passes, from 0 to 1) and `evidence` (a short quote from the data). Any other key breaks the contract.
* An answer that does not parse, breaks the contract, or stops at its token limit is inconclusive. The council asks that judge again once with the large budget (for a chat model, 4096 tokens instead of 1024). There is no silent fallback.
* A refusal by the provider is inconclusive.
* An inconclusive verdict is never counted as a pass or a fail.

## Two classes of judge

| Class | What it is | It takes |
|---|---|---|
| system 1 | a fixed binary question per criterion, one short answer, low variance, low cost; the OpenAI Decisions API is the public example | criteria whose evidence sits in the block itself: a tool used, a fact present, the language, one question per turn, the stage reached |
| system 2 | a chat model with stored reasoning, from a model family other than the agent's | criteria that read across blocks: a contradiction with the ledger, drift, recovery |

A system 1 judge answers with a probability that the criterion passes. From 0.6 it is a pass, up to 0.4 a fail, and between the two it is inconclusive. Both bounds are options of the client.

## Judge clients

Every judge is a `JudgeClient`: an `id`, a model `family`, a class `cls`, an optional `model`, a relative `cost`, and `judge(request)`. The council takes any list of clients, so a caller injects its own: a provider client, a cassette player, a test fake, or any object with that shape.

| Client | Class | Family | Reads | Default cost |
|---|---|---|---|---|
| `createOpenAiDecisionsJudge` | system 1 | openai | `OPENAI_API_KEY`, `OPENAI_DECISIONS_MODEL`, `OPENAI_BASE_URL` | 1 |
| `createOpenAiJudge` | system 2 | openai | `OPENAI_API_KEY`, `OPENAI_JUDGE_MODEL`, `OPENAI_BASE_URL` | 10 |
| `createAnthropicJudge` | system 2 | anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_JUDGE_MODEL`, `ANTHROPIC_BASE_URL` | 10 |
| `createGoogleJudge` | system 2 | google | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GOOGLE_JUDGE_MODEL`, `GOOGLE_BASE_URL` | 10 |
| `createHttpJudge` | system 2 by default, or system 1 | stated by the caller, required | an optional variable named by `keyVariable`, sent as a bearer token | 10, or 1 for system 1 |

* `createHttpJudge` posts `{ request, prompt: { system, user } }` to any endpoint whose answer body is the answer contract.
* A judge that a platform offers is listed on the page of that platform's adapter, such as the [Nexus adapter](../adapters/nexus.md).
* No model is hardcoded for the provider clients: the model comes from its variable or the `model` option. A missing key or model is a `config` error that names the variable, never a value.
* Keys come from the environment only (the `env` option, `process.env` by default). A key lives inside the client and is never a field of it, so printing a client never shows it.
* A call is retried twice, with a growing wait, on 408, 409, 429, 500, 502, 503, 504, 529, a network failure or a timeout (120 seconds per attempt by default). A 4xx the request caused is never retried. Redirects are refused.
* An error names the URL and the status and quotes at most 200 characters of the provider's error body. Any header value the provider echoes back is replaced by `[redacted]`.
* A client throws only when it got no answer at all. In a council, that judge votes inconclusive and the error is counted.

## Cassettes: recorded answers

A cassette is a JSON file of recorded answers. It lets the council and calibration run with no network and no key.

* `recordingClient` wraps a live client and appends every answer or failure to a cassette. An answer that did not parse is kept as raw text only, so its replay does not parse either. No key or header is recorded.
* `playerClient` and `cassettePlayers` replay a cassette as clients. An entry matches by the judge id and the request key, a hash of the criterion, the transcript, the artifact, the Given and, for a re-judge, the large budget.
* A request with no recording throws a `cassette_miss` error. A cassette never makes up an answer. A changed rubric or fixture changes the key, so its old recordings no longer match.

The repository ships three cassettes, each for the same six judges:

| File | Answers | Used by |
|---|---|---|
| `examples/acme/criteria/council.cassette.json` | 76 | `judge run` on the fixture pairs |
| `examples/acme/criteria/calibration/cassette.json` | 387 | `judge calibrate`, and `judge run --assignments` |
| `examples/acme/criteria/calibration/campaign.cassette.json` | 38 | the Acme campaign with the judge check |

The six judges are three of system 1 (`s1p-a` and `s1p-b`, cost 1, and `openai-decisions`, cost 2) and three of system 2 (`openai-chat` and `google-chat`, cost 10, and `anthropic-chat`, cost 12). The cassette files name the first two after the system 1 judge of the Nexus platform (see the [Nexus adapter](../adapters/nexus.md#judge)). This page shows them as `s1p-a` and `s1p-b`, in prose and in every output below; that substitution is the only change to the output. The answers are written by a test script: every judge tells the truth except 7 scripted misses, each with a note in the cassette.

## The council

* Each criterion has an assignment row: a class, three judges of that class, three re-judges of the other class (hybrid mode only), and its source: `spec`, `mode`, `default` or `calibration`. With no row, the three cheapest judges of the class sit, by cost and then by id.
* The verdict is two of three agreeing votes. An inconclusive vote never counts.
* No majority is a split. It is logged and, in hybrid mode, judged again by the three re-judges of the other class. When that splits too, or in a mode with one class, the assigned judges answer once more with the large budget; their votes carry `@large`. Still no majority is inconclusive.
* Cascade, an option: the cheapest judge runs first, and the council stops there only on a pass with a `score` at or above the threshold (0.9 by default). A fail, an inconclusive or an unsure pass brings in the other two. A judge that leaves `score` out never stops the cascade, so a criterion that judge leads always costs three calls.
* Modes: `system1`, `hybrid` or `llm`. `system1` and `llm` force their class and never call the other one. Scores from different modes are not comparable.
* Diversity: the council is refused when it is built, before any call, when a judge shares the model family of the agent under test (compared without case). The agent family must be stated: `none` for an agent that is not a model. In perturbed mode, the simulated user runs on a third family; the simulated user is planned, phase 3.
* The council is also refused for fewer than three judges of a class the mode uses, two judges with one id, a row with a class the mode does not use or without three different judges of the right class, a re-judge row outside hybrid mode, and a criterion both assigned and unassigned.

`driftbench judge run` replays a council on a cassette over every fixture pair of a criteria folder. A criterion is separated when its pass fixture passes and its fail fixture fails. It exits 0 when every criterion is separated, 1 when one is not or a judge gave no answer, and 2 on bad input or a refused council.

```text
$ pnpm -s driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass, fail fixture fail
separated  plain_language [system1]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

The cassette holds a 2 to 1 majority (the fail fixture of `one_question_per_turn`), a split that system 2 judges again (the fail fixture of `holds_instructions`), and an answer that does not parse and is asked again with the large budget. With `--cascade`, every pass fixture stops at the cheapest judge, because the system 1 answers on this cassette carry a score:

```text
$ pnpm -s driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --cascade
separated  care_redirect [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass (cascade), fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass (cascade), fail fixture fail
separated  ledger_intact [system2]: pass fixture pass (cascade), fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass (cascade), fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass (cascade), fail fixture fail
separated  plain_language [system1]: pass fixture pass (cascade), fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass (cascade), fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

`--json` prints one document with every vote and the round log of each fixture.

## Calibration: an assignment is earned

No judge is trusted before it passes its own test.

* Fixture pairs: every judge answers, on its own, the pass and fail fixture of every criterion, `--repeats` times (3 by default). Its separation is the number of repeats in which the pass fixture passed and the fail fixture failed.
* Hand labels: every judge answers every hand-labelled block once. Its agreement is Cohen's kappa against the labels, over the categories pass, fail and inconclusive, with a Wilson 95% interval on the share of blocks it agrees on. Per criterion, Krippendorff's alpha across the judges is reported, over the fixtures and the labelled blocks, with inconclusive as missing. Per judge, kappa is also pooled over every labelled block. See [statistics](statistics.md#judges).
* A judge answers as it would vote in a council: an answer that does not parse is asked again with the large budget, and one that still does not parse, or no answer at all, is inconclusive. Inconclusive never separates a pair and always disagrees with a label. A judge of the agent's family is left out, and the report names it.
* The bar: separation in every repeat, and kappa at least 0.8.
* A council votes three judges of one class, so a class takes a criterion only when three of its judges meet the bar. The criterion goes to the cheapest judge at the bar in such a class (by cost, then id), with the next two cheapest at the bar of that class. In hybrid mode, the re-judge row is three judges of the other class, those at the bar first.
* No class with three judges at the bar: the criterion stays unassigned. It is still judged, its verdict never gates, and the report says why. A criterion with no judge at the bar gets a new rubric, not a lower threshold.
* An assignment is tested again when its rubric or its fixtures change: the request key changes, the recorded answers no longer match, and the criterion is recorded and calibrated again.

`driftbench judge calibrate` runs this and writes the assignment table. It exits 0 when the table is written and every gating criterion is assigned; 1 when a gating criterion stays unassigned or a judge call gave no answer (the table is still written); 2 on bad input: a missing option, a bad repeat count or mode, issues in the criteria or the labels, labels for an unknown criterion, or a cassette that cannot be read.

On the Acme criteria, labels and calibration cassette, each criterion prints its owner, then one line per judge, then alpha. The first criterion:

```text
$ pnpm -s driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --out _captures/docs3/judges/assignments.yaml
care_redirect [gating]: owned by s1p-a (system1: s1p-a, s1p-b, openai-decisions; re-judge google-chat, openai-chat, anthropic-chat)
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    s1p-b              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    openai-decisions   system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    openai-chat        system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    google-chat        system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    anthropic-chat     system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
```

A criterion that moves to system 2, because one system 1 judge misses the bar:

```text
holds_instructions [gating]: owned by google-chat (system2: google-chat, openai-chat, anthropic-chat; re-judge s1p-a, s1p-b, openai-decisions)
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    s1p-b              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    openai-decisions   system1  separation 2/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  misses: separates the fixture pair 2 of 3 times
    openai-chat        system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    google-chat        system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    anthropic-chat     system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
```

A criterion no class can take:

```text
ledger_intact: UNASSIGNED, judged but not gating: no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    s1p-b              system1  separation 3/3  kappa  0.40  agreement 2/3 [0.21, 0.94]  misses: kappa 0.40 is under 0.8
    openai-decisions   system1  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    openai-chat        system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    google-chat        system2  separation 3/3  kappa  0.50  agreement 2/3 [0.21, 0.94]  misses: kappa 0.50 is under 0.8
    anthropic-chat     system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    alpha across judges 0.87; bar: 3/3 separation and kappa 0.8
```

The last lines of the output:

```text
Kappa over every labelled block: s1p-a 0.90 (38/40), s1p-b 0.90 (38/40), openai-decisions 1.00 (40/40), openai-chat 1.00 (40/40), google-chat 0.95 (39/40), anthropic-chat 1.00 (40/40).

11 of 12 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8). Unassigned, judged but never gating: ledger_intact.
Wrote _captures/docs3/judges/assignments.yaml.
```

It exits 0: `ledger_intact` is not declared gating. The table it writes is byte for byte the committed `examples/acme/criteria/calibration/assignments.yaml`.

Per criterion, kappa rests on 3 or 4 labelled blocks. With 3 blocks, 3 of 3 agreement has a Wilson lower bound of 0.44, as the output shows. More labels per criterion make the bar mean more.

### Labels

`examples/acme/labels` holds the hand labels: one YAML file per criterion, named after it, 40 fictional blocks in all (4 each for `care_redirect`, `holds_instructions`, `no_invented_data` and `one_question_per_turn`, 3 for each of the other 8). Each file has `criterion`, an optional `labelled_by`, and `blocks`. A block has an `id`, a `label` (`pass` or `fail`), an optional `note`, and a `transcript`, `artifact` and `given` as a fixture does.

```text
criterion: one_question_per_turn
blocks:
  - id: one_question_per_turn.1
    label: pass
    note: One question.
    transcript:
      - { role: user, text: "I want a new mobile plan." }
      - { role: agent, text: "Happy to help. How much data do you use in a month?" }
  - id: one_question_per_turn.2
    label: fail
    note: Three questions in one reply.
    transcript:
      - { role: user, text: "I want home internet." }
      - { role: agent, text: "What is your address? Do you need it this month? And what speed do you want?" }
```

A labels file is refused when its name differs from its criterion, when every block carries the same label (kappa then has nothing to measure), when a block id is used twice, or when a label is other than `pass` or `fail`.

### Anchors

A label can name the element it is about. The optional `anchor` on a block takes one of four kinds:

* `{ kind: message, index: 3 }`: the transcript line at that index, counted from 0.
* `{ kind: tool_call, tool: coverage.lookup, occurrence: 2 }`: the second call of that tool in the transcript. `occurrence` defaults to 1.
* `{ kind: field, path: order.total }`: a dot path into the block's `given.ledger`.
* `{ kind: span, span_id: a1b2c3 }`: a trace span. The transcript cannot show a span, so calibration accepts it and notes that the label stands as written.

`judge calibrate` reads the anchors when it loads the labels. A message, tool or field anchor that names nothing in its block is a labels issue, and calibrate exits 2 until it is fixed. A span anchor is never an issue. With `--json`, each block row of the calibration report carries its anchor, so a reader sees which element a label is about. The text output does not print anchors. The judge still reads the whole block: an anchor records what the human looked at, it does not narrow the request.

### The assignment table

The table has `version: 1`, the `mode`, the `repeats`, `kappa_min`, and one entry per criterion. An assigned entry names its `owner`, `class`, `judges`, `rejudge`, and the owner's `separation` and `kappa`. An unassigned entry gives its `reason`. Two entries of the committed table:

```text
  - criterion: holds_instructions
    status: assigned
    owner: google-chat
    class: system2
    judges:
      - google-chat
      - openai-chat
      - anthropic-chat
    rejudge:
      - s1p-a
      - s1p-b
      - openai-decisions
    separation: 3 of 3
    kappa: 1
  - criterion: ledger_intact
    status: unassigned
    reason: "no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8"
```

Who owns each Acme criterion, from the committed table:

| Criterion | Gating | Class | Owner |
|---|---|---|---|
| `care_redirect` | yes | system 1 | `s1p-a` |
| `checks_before_promising` | yes | system 1 | `s1p-a` |
| `coverage_before_offer` | yes | system 1 | `s1p-a` |
| `explicit_confirmation` | yes | system 1 | `s1p-a` |
| `holds_instructions` | yes | system 2 | `google-chat` |
| `honest_failure` | yes | system 2 | `google-chat` |
| `ledger_intact` | no, unassigned | none | none |
| `no_invented_data` | yes | system 2 | `google-chat` |
| `one_question_per_turn` | no | system 1 | `s1p-a` |
| `plain_language` | no | system 2 | `google-chat` |
| `resumes_pending_step` | yes | system 1 | `s1p-a` |
| `sheet_matches_catalog` | yes | system 1 | `s1p-a` |

`holds_instructions` and `plain_language` declare system 1; calibration gives them to system 2. `loadAssignmentTable` reads a table, and `councilAssignment` turns it into council rows with source `calibration` plus the unassigned criteria. `judge run --assignments <file>` uses it; the table's mode must be the run's mode. An unassigned row prints `unassigned: not gating`:

```text
$ pnpm -s driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/calibration/cassette.json --assignments examples/acme/criteria/calibration/assignments.yaml
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system2, gating]: pass fixture pass, fail fixture fail
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2, unassigned: not gating]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass, fail fixture fail
separated  plain_language [system2]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

## The judge check in a run

`judgeCheck(council, options)`, or `council.check(options)`, is the check named `judge`. `defaultChecks({ judges: council })` of `@driftbench/checks` appends it after every machine check; `defaultChecks()` has no judge check. It applies to a block that names criteria, conversation or task alike. The options are `artifactText` (default: the task-block text above) and `contextMessages` (default 2).

Each criterion a block names gives one verdict `judge.<name>`, of kind `judge`, with the deciding class and every vote, the round log as its evidence, and the reasoning of the first vote that agrees with the outcome. Its `score` is the mean score of the agreeing votes that carry one. The check ids are on the [checks](../reference/checks.md#judged-criteria) page.

Judge verdicts sit beside the machine verdicts and never replace one. A block passes only when every gating verdict passes, so a judge pass never turns a machine fail into a pass. `combineVerdicts(machine, judged)` states the same rule for a caller that merges the two lists itself: it refuses a judge verdict of kind `machine` or one that reuses a machine verdict's id. A failing gating judge verdict carries drift class X1 (see [drift](drift.md#how-a-class-is-assigned)).

The Acme campaign, the six conversation specs and the price-sheet task, runs with `defaultChecks({ judges: council })`: the council built from the committed assignment table with the cascade on, the judges replaying `calibration/campaign.cassette.json`. It gives 22 judge verdicts, all pass. Four of them:

| Verdict id | Spec | Gating | Votes | Evidence |
|---|---|---|---|---|
| `judge.one_question_per_turn` | `acme-number-porting` | no | `s1p-a pass` | `system1: s1p-a pass; pass, the cheapest judge was sure` |
| `judge.no_invented_data` | `acme-order-loose-confirmation` | yes | `google-chat pass`, `openai-chat pass`, `anthropic-chat pass` | `system2: google-chat pass, openai-chat pass, anthropic-chat pass; pass` |
| `judge.ledger_intact` | `acme-off-topic-return` | no | `google-chat pass`, `openai-chat pass`, `anthropic-chat pass` | `unassigned by calibration, not gating: no class has 3 judges at the bar (...) \| system2: google-chat pass, openai-chat pass, anthropic-chat pass; pass` |
| `judge.sheet_matches_catalog` | `acme-price-sheet` | yes | `s1p-a pass` | `system1: s1p-a pass; pass, the cheapest judge was sure` |

* The cascade stops `one_question_per_turn` at the cheapest system 1 judge, whose answer carries a score.
* `no_invented_data` shows three votes: its owner, `google-chat`, leaves `score` out, so the cascade never stops early.
* For `sheet_matches_catalog`, the judge reads the workbook the ops agent wrote, rendered by the xlsx reader, with the workspace diff.

`driftbench campaign run` cannot load a council yet: it runs `defaultChecks()` and its record stores `judge: { mode: system1, judges: [] }`. A caller that wants judged criteria in a campaign passes `defaultChecks({ judges: council })` as the campaign's checks from code. A command line option to load a cassette and an assignment table is not built yet. See [running](../running.md).

## Pairwise comparison

A pairwise call judges two candidate replies to the same block on one criterion: which reply better meets it. `pairwiseRequest` shows both replies as labelled lines, Reply A and Reply B, under the block's transcript, and asks the judge for one of the two. `judgePairwise` runs the question twice, once with each reply in position A, and reads a choice only when both orders name the same reply. A judge that always answers pass, whatever the reply, is recorded as a position bias and its call is a tie.

`driftbench compare --pairwise` applies it to every block two campaigns both ran. The flags and the printed line are in the [CLI](../reference/cli.md#driftbench-report-and-driftbench-compare) reference.

## Repeat reducers

A criterion can say how its verdicts across the repeats of one spec become one verdict, with `repeat_reducer`:

* `mode`: the most common verdict. A tie goes to the verdict seen first.
* `median`: a pass above one half of the repeats, a fail below it. Exactly one half is undecided.
* `at_least:<k>`: a pass when at least `k` repeats pass. Undecided when fewer than `k` repeats are scored.

A run folds the criterion's verdicts across its blocks first: any fail makes the run a fail, every block passing makes it a pass, and anything else is undecided. An inconclusive repeat is left out of every reducer. A criterion without `repeat_reducer` gets no reduced verdict.
