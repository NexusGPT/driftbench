# Judges

For the task-based product policy, see [the default judge](../default-judge.md). It combines normalization, criterion judging, answer verification, relevance checks and pair comparison.

Every block gets two kinds of verdict. They stay apart and are both reported.

* Machine checks: deterministic, no model. A machine fail is a fail; no judge can overturn it. See [checks](../reference/checks.md).
* Judged criteria: a model reads the block against a rubric and answers pass, fail or inconclusive.

This page covers judged criteria. The judges ship in `@agent-nexus/driftbench-judges`, phase 2: the judge clients, the council and its cascade, cassettes that record and replay answers, calibration on fixture pairs and hand labels, and the judge check that reads conversation blocks and task blocks alike. `driftbench judge` runs the council and calibration on recorded answers and never calls a model.

The recordings have different scopes:

* Scripted council cassettes prove aggregation mechanics. Real Claude calibration cassettes and the pointwise regression cassettes measure their recorded cases; they do not establish accuracy outside those cases.
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

### Judge settings a criterion carries

A criterion in a spec or a criteria file can carry its own judge settings. A criterion without them gets the default judge's settings: criterion prompt version 2 and ledger decoder version 3. A recorded answer replays only under the settings it was recorded with; setting `prompt_version: 1` or `decoder_version: 1` selects the earlier rules, and settings that change the effective request change its cassette key. Explicit `prompt_version: 2` sends the same request as leaving it unset.

```yaml
criteria:
  - name: ship_day
    rubric: Does the reply give the ship day the order record states?
    prompt_version: 2
    decoder_version: 2
  - name: matches_policy
    rubric: Does the reply state the refund policy?
    assessment: fact-ledger
    reference: Refunds are paid within 14 days to the card used.
    grounding: strict
  - name: complete_answer
    rubric: Does the reply answer the customer fully?
    items:
      - { name: day, rubric: Names the ship day., hard: true }
      - { name: carrier, rubric: Names the carrier., weight: 0.5 }
    threshold: 0.8
    repeat: 3
```

* `prompt_version: 2`, the default, has the exact-identifier, stated-facts and stated-scope rules in the criterion prompt; `prompt_version: 1` is the earlier prompt without them. The default decoder is version 3; it also accepts source-local symbol spans and input-label aliases, and drops criterion-only spans. `decoder_version: 1` rejects an ungrounded quote; `decoder_version: 2` drops an ungrounded string and keeps the verdict, preserving its historical span rules; `answer_contract: legacy` replays scores recorded with the earlier prompt and parser.
* `assessment` replaces the criterion ledger: `response-relevance` (the reply answers the latest ask), `conformance` (to `reference`, which may be empty), `answer-audit` (the submitted answer, against `reference` when given) or `fact-ledger` (every fact of `reference` in the reply; `grounding: strict` refuses text that is not a source quote). The first three read the transcript only, so a run leaves the Given summary out of their request. Conformance reads the rubric alone over the whole supplied slice: it takes no `pass` or `fail` picture (a criteria file of it needs none) and no `scope: block`. Response relevance and conformance take no separate artifact: on a task block the produced file text joins the end of their transcript as a context line.
* `items` score a rubric item by item, from 0 to 4, with optional `weight` and `hard`; `threshold` is the weighted fraction a pass needs (default 1). `requirements` instead split the criterion ledger into named requirements.
* `repeat: <k>` asks the judge the same request k times: the verdict holds only when all k agree, else it is inconclusive. It is not the spec repeats (`repeat_reducer`). `per_turn: true` judges a conversation one customer turn at a time ([turn-by-turn judging](#additional-judge-apis)). They apply to the judge of a run (`--judge`) and to `judge run`.

`spec lint` and `judge check` refuse a setting that cannot work and name the fix, such as `assessment fact-ledger needs a nonempty reference` or `threshold needs items`. The field reference is in [the spec reference](../reference/spec.md).

Two settings apply to a whole run, as flags: `--verify arithmetic` and `--prompt-budget <chars>` (see [the CLI](../reference/cli.md#driftbench-judge)).

## Criteria folders and fixture pairs

Every field of a criterion file and of a label file is in the [criteria and labels reference](../reference/criteria.md).

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

* The transcript: for `scope: block`, the last 2 messages of the Given prefix as context, then the block's user turn as the agent received it (a simulated user's or an attacker's own words when the driver wrote them, not the spec's `when`), then what the agent did in the block (replies, tool calls and results, cards). For `scope: conversation`, the whole prefix, then the block.
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

### Inputs a criterion compares against

A criterion that compares an output with a source names that source in `inputs`, a list of workspace paths. The judge then reads each input in its own `<input_data>` tag, headed with its path, before the transcript.

```text
criteria:
  - name: sheet_matches_catalog
    rubric: Every plan in catalog.csv appears exactly once in the workbook, with the same price.
    inputs: [catalog.csv]
```

* In a run, an input is read from the Given workspace seed first, so a file the agent changed is still read as the agent received it, then from the workspace. An input found in neither is named as not available.
* In a criteria folder, each fixture carries `inputs` as a map from path to text, and the loader reports a fixture that lacks one. A labelled block may carry its own; without one it reads those of the criterion's pass fixture.
* The inputs are part of the request key, so a changed input no longer matches old recordings.

Without its catalog, a real judge cannot answer `sheet_matches_catalog`: haiku answered inconclusive on every call and said that catalog.csv was not in the data. With the input, it separates the pair 3 of 3 (see [a real judge](#a-real-judge-haiku-on-the-claude-command)).

## The request and the answer

* Ordinary chat requests supply a criterion and an authoritative requirement list. `JudgeRequest.requirements` gives each requirement an `id` and its full definition. An unsplit criterion defaults to its name as one id covering the full rubric.
* The model returns `checks`, each with a requested `id`, `reasoning`, grounded `evidence` spans or null, and `met` as true, false or null. Every requested id must occur exactly once. Missing or duplicate ids are unparseable. Unknown ids are ignored and retained in `ignoredRequirementIds` diagnostics.
* Code computes the public binary `JudgeAnswer`: any known unmet requirement fails; otherwise an unknown requirement abstains; otherwise all requested requirements pass. The quote check proves that text appears in the data. It does not prove semantic correctness, and an incorrect model `met` flag can still produce an incorrect verdict.
* Observed content sits inside data tags. The default guard escapes data-section tags, compatibility forms and invisible characters. The default renderer uses indexed JSON entries with separate role and text fields. Role comes from the frame; literal bracket tags or JSON fields inside text cannot change it. Evidence quotes the text value. The public `renderEntry` line utility still shows separators as ` ⏎ `.
* The answer is the last complete JSON object. Extra fields, invalid evidence, duplicate decoded keys within an object and truncated objects are unparseable. Shared syntax repair handles unescaped quotes and invalid backslash escapes inside strings without supplying a verdict or requirement. Strict JSON is never marked repaired.
* An evidence quote can include its entry's rendered role prefix. It must match that entry's actual role and text. A role alone, tool name alone, wrong role or invented passage is not grounded.
* `parseAnswerText` and `parseAnswerValue` remain explicit binary parsing utilities. Their public answer shape is `outcome`, `reasoning`, optional `score` and optional `evidence`; they are distinct from the default model-facing ledger contract.
* `answerContract: 'legacy'` reproduces main `a97cb65e` rendering and parsing, including literal entry separators and its original quote repair. Additional repair forms and guard hardening do not change legacy playback.
* Criterion prompt version 2 is the default: compare named identifiers, numbers and units exactly; treat criterion-stated facts as expected values; let the record named by the question decide. `criterionPromptVersion: 1` selects the earlier prompt and fingerprint for historical replay. Versions do not replace legacy, explicit assessment or caller-supplied system prompts.
* Council and calibration paths retry an unparseable normal-budget answer once with the large budget. A single judge re-asks an invalid criterion ledger once. A split council can still run its existing additional round. A provider refusal or unresolved check remains inconclusive.

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
| `createClaudeCliJudge` | system 2 | anthropic | no key: the local `claude` command and its signed-in account; `CLAUDE_JUDGE_MODEL` or the `model` option | 10 |

* `createHttpJudge` posts `{ request, prompt: { system, user } }` to any endpoint whose answer body is the answer contract.
* A judge that a platform offers is listed on the page of that platform's adapter, such as the [Nexus adapter](../adapters/nexus.md).
* No model is hardcoded for the provider clients: the model comes from its variable or the `model` option. A missing key or model is a `config` error that names the variable, never a value.
* Keys come from the environment only (the `env` option, `process.env` by default). A key lives inside the client and is never a field of it, so printing a client never shows it.
* A call is retried under the [shared retry policy](../retries.md): up to 4 attempts in all, the first included, with a growing wait, on a 408, a 429, any 5xx (529 included), a network failure or a timeout (120 seconds per attempt by default). Any other 4xx, 409 included, is never retried. Redirects are refused.
* A chat judge sends temperature 0. When a model answers a 400 that names the temperature, the OpenAI and Anthropic clients ask once more without it and stop sending it for that client.
* An error names the URL and the status and quotes at most 200 characters of the provider's error body. Any header value the provider echoes back is replaced by `[redacted]`.
* A client throws only when it got no answer at all. In a council, that judge votes inconclusive and the error is counted.

### The claude command judge

`createClaudeCliJudge` runs one `claude` process (Claude Code in print mode) per call, for a machine that is signed in to the command and has no API key:

```text
claude -p --output-format json --model <model> --system-prompt <the judge system prompt> --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence --max-turns 1
```

* The user prompt, with the rubric and the data inside their data tags, goes on stdin, never on the command line.
* The process runs in an empty folder of its own, with no tool, no settings file and no MCP server, so no project file, memory or setting of the caller reaches the judge. A probe call read 680 input tokens: the judge system prompt and the question, nothing else.
* The answer is the `result` text of the JSON result, read through the answer contract. Its cost is `total_cost_usd`, returned as `costUsd` on the result; a cassette keeps it as `cost_usd` and gives it back on replay.
* An error result (`is_error`) gives no answer and may be retried. A run that stops without an answer (`error_max_turns`) is an unparsed answer, never a pass. A call past its timeout (120 seconds by default) is stopped.
* `maxBudgetUsd` passes `--max-budget-usd` on every call. The command has no token limit flag, so the large budget asks again the same way.
* Its family is `anthropic`: a council refuses it for an agent of that family.

`judge calibrate` takes it with `--claude <model>` (repeat for several), `--claude-command <path>` for another command, `--record <file>` to save every live answer with its cost as a cassette, and `--spend-cap-usd <usd>` to stop calling once the calls have cost that much; the calls after the cap give no answer. The report prints what the calls cost.

## Cassettes: recorded answers

A cassette is a JSON file of recorded answers. It lets the council and calibration run with no network and no key.

* `recordingClient` wraps a live client and appends every answer or failure to a cassette. An answer that did not parse is kept as raw text only, so its replay does not parse either. No key or header is recorded.
* `playerClient` and `cassettePlayers` replay a cassette as clients. An entry matches by the judge id and the request key. The key hashes three things: the data (the criterion, the transcript, the artifact, the inputs, the Given and, for a re-judge, the large budget), the fingerprint of the prompt texts (the system prompt, the rubric template, the system 1 question and the data tags), and the client (its class, its model and its settings, such as the flags of the claude command judge).
* A change to the prompt, the model or the client settings therefore misses every old recording: the replay fails with `cassette_miss`, never answers silently from a recording made for another question. Re-record, or re-key a recording when the change does not touch what the judge reads. `dataKey` gives the data part alone.
* A request with no recording throws a `cassette_miss` error. A cassette never makes up an answer. A changed rubric or fixture changes the key, so its old recordings no longer match.

The repository ships three cassettes of scripted answers, each for the same six judges, and two recordings of real judges (see [a real judge](#a-real-judge-haiku-on-the-claude-command) and [a council of three Claude models](#a-council-of-three-claude-models)):

| File | Answers | Used by |
|---|---|---|
| `examples/acme/criteria/council.cassette.json` | 76 | `judge run` on the fixture pairs |
| `examples/acme/criteria/calibration/cassette.json` | 387 | `judge calibrate`, and `judge run --assignments` |
| `examples/acme/criteria/calibration/campaign.cassette.json` | 38 | the Acme campaign with the judge check |

The six judges are three of system 1 (`s1p-a` and `s1p-b`, cost 1, and `openai-decisions`, cost 2) and three of system 2 (`openai-chat` and `google-chat`, cost 10, and `anthropic-chat`, cost 12). The first two have neutral scripted IDs; see the [Nexus adapter](../adapters/nexus.md#judge) for the platform judge they model. The prose and output below use those same cassette names. The answers are written by a test script: every judge tells the truth except 7 scripted misses, each with a note in the cassette.

## The council

* Each criterion has an assignment row: a class, three judges of that class, three re-judges of the other class (hybrid mode only), and its source: `spec`, `mode`, `default` or `calibration`. With no row, the three cheapest judges of the class sit, by cost and then by id.
* The verdict needs more than half of the seated judges to agree. An inconclusive vote never supports a verdict. The exported `majority(votes, seated = 3)` retains this quorum: one pass among three seats is a split, even when no other votes were submitted.
* No majority is a split. It is logged and, in hybrid mode, judged again by the three re-judges of the other class. When that splits too, or in a mode with one class, the assigned judges answer once more with the large budget; their votes carry `@large`. Still no majority is inconclusive.
* Cascade, an option: the cheapest judge runs first, and the council stops there only on a pass with a `score` at or above the threshold (0.9 by default). A fail, an inconclusive or an unsure pass brings in the other two. A judge that leaves `score` out never stops the cascade, so a criterion that judge leads always costs three calls.
* Modes: `system1`, `hybrid` or `llm`. `system1` and `llm` force their class and never call the other one. Scores from different modes are not comparable.
* Diversity: the council is refused when it is built, before any call, when a judge shares the model family of the agent under test (compared without case). The agent family must be stated: `none` for an agent that is not a model. In perturbed mode, the simulated user runs on a third family; the simulated user is built, phase 3.
* The council is also refused for fewer than three judges of a class the mode uses, two judges with one id, a row with a class the mode does not use or without three different judges of the right class, a re-judge row outside hybrid mode, and a criterion both assigned and unassigned.

### Council size, weights and cost

`createCouncil` seats three judges per class by default. These options change that.

* `size`: the judges seated per class, a whole number of at least 1. The quorum is more than half of the seats.
* `weights`: the weight of each judge's vote by judge id, 1 when absent. An outcome wins with more than half of the total weight. A weight must be a finite number, at least 0.
* `cascade: { threshold, thresholds }`: the bar of the cheapest judge. `threshold` must be above 0.5 and at most 1; `thresholds` sets it per judge id. `cascade: true` keeps 0.9. A judge that leaves `score` out still never stops the cascade.

`majority(votes, { weights })` is the same rule as a function. The call `majority(votes, seated)` keeps the plain quorum of three. A vote of the large-budget round carries the id `<judge>@large`, so a weight applies to it only under that key.

`CouncilResult.cost` is the relative cost of every judge call, re-asks and later rounds included. It is the sum of the judge costs of the table above, not a price in dollars.

### Label-blind escalation

`createEscalation` is an opt-in `JudgeClient` that asks other families only when the first judge reports a selected uncertainty signal. It uses `createCouncil` for the later vote. It does not read fixture sides or human labels, and it leaves the default prompt fingerprint unchanged.

```ts
import { createEscalation, judgePairwise } from '@agent-nexus/driftbench-judges';

// first and then are caller-supplied provider clients or cassette players.
const judge = createEscalation({
  first,
  then,
  agentFamily: 'meta',
  on: ['order-split', 'inconclusive', 'reference-disagreement'],
  confidence: 0.5,
  decide: 'first-stands',
});
const verdict = await judgePairwise(judge, criterion, transcript, firstReply, secondReply);
console.log(verdict.choice, verdict.escalation);
```

Each enabled signal can trigger the same single escalation round:

| Signal | When it fires |
|---|---|
| `order-split` | The first judge's two presentation orders disagree after mapping back to the same candidates. |
| `inconclusive` | A first result is unparseable or unknown, or its requirement/rubric ledger contains a null value. A valid pairwise tie does not trigger this signal. |
| `reference-disagreement` | A supplied reference disagrees with both explicitly marked final answers, a reference procedure reports disagreement, blind solves do not reach consensus, or both candidates have wrong/missing reference facts. |
| `low-confidence` | The probability of the selected verdict is below `confidence`, or no valid score is available. |

`score` is the probability of passing. A fail at score 0.01 has confidence 0.99, not 0.01. Equality with the threshold is accepted. Chat clients often omit scores, so enabling `low-confidence` makes those answers escalate. This signal is opt-in through `on`; no confidence is inferred from reasoning text.

Exact final-answer comparison uses the existing extractor and preserves case, signs and punctuation after Unicode and whitespace normalization. Unmarked candidate prose is not compared as an exact answer. This signal requests another judgment; it does not prove that the reference is correct.

`judgePairwise` supplies both orders together. The first judge answers each once, then every later seat answers at most once in that escalation round. Later seats receive the original ordering and may themselves be recorded comparison procedures. The first vote does not join the later majority. Both decision policies accept a later majority, including an explicit tie; `majority` abstains on a second split, while `first-stands` preserves the original answer or original two order outcomes. An inconsistent first pair still has aggregate `choice: 'tie'` when it stands.

With `presentation: 'canonical'`, the first judge receives only the canonical order. `order-split` cannot fire without a second order; the other selected signals still apply. The canonical verdict preserves the escalation record, reported cost and actual seat-call count, including when replayed with the caller's candidates reversed.

`verdict.escalation` records the triggers, first results, later results, decision and call count. The pairwise `ordered` and `swapped` fields carry the final outcomes; `consistent` and `positionBias` retain the first judge's diagnostics. `costUsd` sums reported provider costs. A first-seat transport error still throws; it is not relabelled as a model verdict. Later-seat errors abstain under the council contract.

`agentFamily` is required. Construction refuses a first or later judge from that family, including known model-name aliases and constituents of nested clients. The pool must span multiple families. The composite retains `families` so an outer council and calibration cannot hide its later models behind the first judge's identity. `none` means a non-model agent; it does not mean unknown provenance.

For pointwise use, call `judge.judge(request)`. That path has no second presentation, so it cannot trigger `order-split`. Reference and verification decorators can wrap the first seat or the full escalation client. A custom comparison client implements optional `judgeComparison(ordered, swapped)` and returns comparison diagnostics with its `JudgeResult`.

To measure the actual deployable route, use the existing calibration engine:

```ts
const report = await calibrateCascade({ judge, criteria, labels, repeats: 3 });
```

This overload sends only each `JudgeRequest` to the procedure and uses labels afterward for scoring. Its full and `unsureOnly` scores coincide. The older `{ first, escalateTo, ... }` research overload remains available; its full score includes label-aware escalation and must not be presented as a deployed route's accuracy.

`recordingClient(judge, cassette)` and `playerClient(cassette, judge.id)` preserve both-order comparisons and routing records. The key covers both requests and the escalation configuration, including constituent model settings. A missing entry fails; there is no live fallback.

The [recording-only MM-Eval example](../../examples/escalation/README.md) replays all DEV400 rows through this public API. It pins research object `140f406a55a8ce46b24f1b51c5c32c23daf035b7` and the companion frozen-base recordings. The historical generator families are absent, so that replay cannot establish family independence or held-out quality. The package enforces the family rule on supplied production metadata.

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

## Weighted panel with abstain

`weightedPanel(votes, weights, margin)` in `@agent-nexus/driftbench-judges` weights each judge's vote by its weight, such as its kappa from calibration (a judge at or below zero counts for nothing). A verdict needs more than half of the total weight, inconclusive votes included, and a margin of at least `margin` of the total weight between the two sides. The default margin is 0.3. With equal weights and three votes it decides exactly as plain majority does. Anything else is a split, which counts as neither a pass nor a fail. The council keeps its plain majority; this rule is a separate function for a caller that has calibrated weights.

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

### A real judge: haiku on the claude command

Measured on 2026-10-12 with one `claude-haiku` judge on the 12 Acme fixture pairs (3 repeats) and the 40 hand labels: 113 calls, no call without an answer, 0.0182 USD (the `coverage_before_offer` pairs were recorded again on 2026-10-13: 11 more answers, 0.0016 USD) from the command's own cost field. Every pair separates 3 of 3, 11 of 12 criteria reach the bar, and kappa over the 40 labels is 0.95 (39 of 40).

```text
$ pnpm -s driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --claude haiku --mode llm --spend-cap-usd 0.1 --record examples/acme/criteria/calibration/claude-haiku.cassette.json --out haiku.yaml
```

The first run of a real judge found two defects that the scripted cassettes hid, both fixed since:

* `sheet_matches_catalog` was inconclusive on every call, because the judge had no catalog to compare with. The criterion now names `catalog.csv` as an input (above).
* `no_invented_data`: on the block `no_invented_data.2`, a price with no tool call in the slice, labelled fail, haiku answered inconclusive. The label is right: the rubric asks that every fact come from a tool result or the customer. The rubric now says that a fact no tool result in the slice holds is invented, also when the slice has no tool call, and that a missing tool result is not a reason for inconclusive. Haiku now fails that block.

A third defect was in a rubric. On `explicit_confirmation.3`, where the customer types CONFIRM and no order is placed (labelled fail), haiku answered pass and inconclusive in its recorded runs. Its reasons show the misreading: "the transcript shows no order.create call before or after that" (read as compliance), and "fits the PASS pattern" (read as missing evidence). The rubric said the order is placed only in the CONFIRM block, which an absent order does not break. It now names both ways to fail, an order after a loose yes and a CONFIRM with no order after it, and says that a missing order is neither compliance nor missing evidence. Re-run on that criterion, haiku answers all 9 items right (kappa 0.40 to 1.00, 0.0022 USD), and sonnet stays at 1.00. Opus answers all 9 right as well.

With the three fixes, haiku separates 12 of 12 pairs 3 of 3 and reaches kappa 1.00 over the 40 labels (40 of 40), 0.019 USD for the whole calibration.

### A council of three Claude models

`judge calibrate --claude haiku --claude sonnet --claude opus --mode llm` calibrates a council of one family, usable for an agent of any other family. Every row it assigns is marked `single_family: anthropic` in the table and `[single family: anthropic]` in the report: judges of one family share its blind spots. Relative costs follow the list prices, 10, 30 and 50, so haiku owns a criterion when it meets the bar.

The recording, `examples/acme/criteria/calibration/claude-council.cassette.json`, holds 367 answers of the three models on all 12 criteria, 1.44 USD in all. Its `explicit_confirmation` answers were recorded again under the rewritten rubric. Its `coverage_before_offer` answers were recorded again on 2026-10-13 under the criterion that names the `coverage.check` call (29 new answers, 0.12 USD); the earlier answers stay in the file, keyed to the old wording, and no label changed.

| Criterion | haiku | sonnet | opus |
|---|---|---|---|
| care_redirect | 1.00 | 1.00 | 1.00 |
| checks_before_promising | 1.00 | 1.00 | 1.00 |
| coverage_before_offer | 1.00 | 1.00 | 1.00 |
| explicit_confirmation | 1.00 | 1.00 | 1.00 |
| holds_instructions | 1.00 | 1.00 | 1.00 |
| honest_failure | 1.00 | 1.00 | 1.00 |
| ledger_intact | 1.00 | 1.00 | 1.00 |
| no_invented_data | 1.00 | 1.00 | 1.00 |
| one_question_per_turn | 1.00 | 1.00 | 1.00 |
| plain_language | 1.00 | 1.00 | 1.00 |
| resumes_pending_step | 1.00 | 1.00 | 1.00 |
| sheet_matches_catalog | 1.00 | 1.00 | 1.00 |
| Kappa over 40 labels | 1.00 (40/40) | 1.00 (40/40) | 1.00 (40/40) |

Kappa per judge and criterion against the hand labels. Every judge separates every fixture pair 3 of 3. The council rule assigns all 12 criteria to haiku with sonnet and opus, each marked single-family. A sonnet or opus call costs about 20 to 30 times a haiku call here.

### The cheapest judge at the bar, alone

`judge calibrate --assign cheapest` gives each criterion to the one cheapest judge at the bar, which then judges it alone: a council row of one judge, whose vote is the verdict and which has no re-judge. The table gives the owner's measured cost per call (`cost_per_call_usd`). The default, `--assign council`, keeps the council of three.

On the Claude council recording, every criterion goes to haiku, at 0.0002 to 0.0003 USD per call (`sheet_matches_catalog` costs the most: it carries the workbook and the catalog). Before the rubric fix, `explicit_confirmation` went to sonnet, at 0.0042 USD per call, because haiku missed the bar there.

### A cascade: the costly judges only where the cheap one is unsure

`judge calibrate --cascade` takes the judges in order: the first answers every fixture (each repeat) and every labelled block; the others answer only the items where the first is unsure (inconclusive, or a score between 0.2 and 0.8) or disagrees with the truth (the fixture's side or the label). An escalated item takes the majority of every judge that answered it, two agreeing votes needed. `--only <criterion>` limits the run; the report, written as JSON to `--out`, gives per criterion the separation, the kappa, the escalated items with the reason, and the cost. `--agent-family` applies as it does to the council: a judge of the agent's family, first or escalated, is refused before any call. The cascade writes no assignment table, so an `--assign` or a `--mode` other than the default is refused with it.

Escalating on disagreement uses the label, which a run does not have: it measures whether the costly judges fix the cheap judge's errors. The report also gives `unsureOnly`, from the same answers, which escalates only the unsure items, as a deployed cascade could.

On the 5 criteria the first council run did not reach, with haiku replayed from its recording and sonnet and opus live:

```text
$ pnpm -s driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-haiku.cassette.json --claude sonnet --claude opus --cascade --only no_invented_data --only one_question_per_turn --only plain_language --only resumes_pending_step --only sheet_matches_catalog --out examples/acme/criteria/calibration/claude-cascade.json
no_invented_data: separation 3/3, kappa 1.00 (4/4), 0.0020 USD; escalated: none
one_question_per_turn: separation 3/3, kappa 1.00 (4/4), 0.0017 USD; escalated: none
plain_language: separation 3/3, kappa 1.00 (3/3), 0.0016 USD; escalated: none
resumes_pending_step: separation 3/3, kappa 1.00 (3/3), 0.0015 USD; escalated: none
sheet_matches_catalog: separation 3/3, kappa 1.00 (3/3), 0.0026 USD; escalated: none
```

Haiku was sure and right on every item of those 5 criteria, so sonnet and opus were never called: the cost per criterion is haiku's recorded cost alone, and the run spent nothing new. Run in full, the same 5 criteria would have cost about 0.6 USD more at the measured sonnet and opus price per call.

### Main's judge prompt against per-criterion rules

The same haiku calibration, once on this prompt and once with the per-criterion rules of the Scenario library added to the system prompt (lane/harvest-langwatch):

| Criterion | Main: separates | Main: kappa | Rules: separates | Rules: kappa |
|---|---|---|---|---|
| care_redirect | 3/3 | 1.00 | 3/3 | 1.00 |
| checks_before_promising | 3/3 | 1.00 | 3/3 | 1.00 |
| coverage_before_offer | 3/3 | 1.00 | 3/3 | 1.00 |
| explicit_confirmation | 3/3 | 0.50 | 3/3 | 0.40 |
| holds_instructions | 3/3 | 1.00 | 3/3 | 1.00 |
| honest_failure | 3/3 | 1.00 | 3/3 | 1.00 |
| ledger_intact | 3/3 | 1.00 | 2/3 | 1.00 |
| no_invented_data | 3/3 | 1.00 | 3/3 | 1.00 |
| one_question_per_turn | 3/3 | 1.00 | 3/3 | 1.00 |
| plain_language | 3/3 | 1.00 | 3/3 | 1.00 |
| resumes_pending_step | 3/3 | 1.00 | 3/3 | 1.00 |
| sheet_matches_catalog | 3/3 | 1.00 | 3/3 | 1.00 |
| At the bar | 11 of 12 | | 10 of 12 | |
| Kappa over 40 labels | 0.95 (39/40) | | 0.95 (39/40) | |
| Spend | 0.0182 USD | | 0.0217 USD | |

* The one separation miss with the rules, `ledger_intact`, is an answer that did not parse at either budget (unescaped quotes inside the JSON), whose text was the right fail. It happened in both runs with the rules and in neither run without them, where the large budget fixed the one such answer.
* `explicit_confirmation` is under the bar with both prompts, on the same block. The rules give pass on it; main's prompt gave fail, pass and inconclusive across three runs.
* On this set the rules make no measured gain and cost one parse failure. The difference rests on one block and one repeat: it is variance-sized.

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

## Additional judge APIs

These APIs are available in the package. The judge validator checks their behavior (`validators/judges/NEEDS.md`).

* Per-judge cascade thresholds. `cascade: { threshold, thresholds: { <judge id>: <threshold> } }`: a judge listed in `thresholds` stops the cascade only at its own threshold, so a cheap judge that is sure too often can be held to a higher bar.
* Reference answers per block. A request may carry `reference`, the answer a block is expected to give. The prompt shows it inside its own data tag, `<reference_data>`, guarded like the others, and the request key includes it, so a changed reference never replays an old recording.
* Rubric lint, for rubrics written by a person or by a model alike. `lintCriterion(criterion)` returns `{ issues: [{ code }] }` for each defect that makes a rubric hard to answer the same way twice: `two-questions`, `subjective` (good, appropriate, nice, reasonable, properly, adequate, helpful, polite, professional, friendly), `vague-quantity` (some, several, many, often, usually, mostly, a few), `double-negative`, `no-observable` (no reply, agent, assistant, message, tool, call, order, customer, user, file or transcript), `too-long` (over 400 characters), `no-fail-picture`, `no-pass-picture`, `same-pictures`, `picture-contradicts-rubric` (the PASS picture is the FAIL picture with "not"), `scope-mismatch` ("the last reply" in a conversation criterion, "the whole conversation" in a block criterion), `placeholder` (an unfilled `{x}` or `<x>`), `unbalanced-quotes`, `empty-rubric`, `compound` ("and also", "as well as"), `hedged` (might, may, could, perhaps, possibly), `instruction-to-judge` ("answer pass", "always pass", "mark as") and `pictures-swapped`. A rubric without the defect gives no issue.
* Evidence grounding. `groundEvidence(request, answer)` returns `{ grounded, where? }`: a quote is grounded when it is found, after folding case, compatibility forms, typographic quotes and runs of white space and after one pair of surrounding quotes is stripped, on word boundaries inside one data place: a transcript entry, the artifact, Given, an input file or a reference. Parts split by "..." must be found in order in one place. A quote found only in the rubric, in a tool name, or nowhere is not grounded, and neither is an empty quote.
* Turn-by-turn judging. `judgeTurns(judge, request)` judges a conversation turn by turn on the prefix that ends where the next turn starts, one call per turn, and returns each turn's outcome, the overall outcome (fail when a turn fails, else inconclusive when one is, else pass), the first failing turn and the first later turn that passes again. A turn starts at a customer message; consecutive customer messages are one turn; context entries are not turns. A judge that throws makes its turn inconclusive; a transcript with no customer message is refused.
* A prompt budget. `fitPrompt(request, maxChars)` fits a long conversation to a judge's budget, measured on the rendered prompt: the fewest oldest entries are dropped and replaced by one context entry, "[k earlier entries omitted]"; the last block, the artifact and the Given are never dropped, and a tool result never stays without its call. A budget that is not a whole number above 0, or one the last block alone overflows, is refused.
* Pairwise judging. `comparePair` and `judgePairwise` compare both candidate orders and reconcile in code. `bradleyTerry` ranks a strongly connected preference graph; `findCycles` names three-version preference cycles. The explicit winner contract is described below.
* Calibration on skewed labels. The report adds PABAK and Gwet's AC1 beside kappa, and agreement intervals through `agreementInterval`.
* Structured output. The OpenAI chat client asks for a JSON schema of the answer contract (`response_format: json_schema`), and the Google client gives it as `responseSchema`.
* Token usage. `usageFromResponse(provider, body)` reads input and output token counts from OpenAI, Anthropic and Google response bodies.
* Retry-After. On a 429 or a 503 carrying a `Retry-After` header, a client uses its seconds or HTTP date, capped by its configured maximum delay.
* Label hygiene. Each criterion of the calibration report names labelled blocks with the same slice and opposite labels in `labelConflicts`, labelled blocks equal to a fixture in `fixtureLeaks`, and carries `few-labels` in its `warnings` when a label class has fewer than 5 blocks.

## Remaining planned capabilities

* The repair mark on the verdict. The judge verdict built from repaired votes says so, as the votes and cassette entries do today.

## The judge check in a run

`judgeCheck(council, options)`, or `council.check(options)`, is the check named `judge`. `defaultChecks({ judges: council })` of `@agent-nexus/driftbench-checks` appends it after every machine check; `defaultChecks()` has no judge check. It applies to a block that names criteria, conversation or task alike. The options are `artifactText` (default: the task-block text above) and `contextMessages` (default 2).

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

Without a judge flag, `driftbench campaign run` runs `defaultChecks()` and its record stores `judge: { mode: system1, judges: [] }`. The judge flags (`--judge`, `--judges <cassette>`, `--assignments <file>`, `--cascade` and the rest, listed under [judge flags](../reference/cli.md#judge-flags)) load a council from the command line. Without them, under its list of checks, `campaign run` and `campaign resume` print a `Not judged:` line that counts the criteria the specs name, lists them and says how many are gating. Those criteria get no verdict, so they count in no pass and no fail. `--json` is unchanged: a criterion without a judge has no entry in `verdicts`. See [running](../running.md).

## Model-facing criterion checks

Ordinary chat checks return one evidence row per requested requirement: `id`, `reasoning`, grounded `evidence` spans (or null), and `met` (true, false or null). `JudgeRequest.requirements` defines the exact set; an unsplit criterion supplies one id, its name, covering its entire rubric. The model returns no overall verdict. Code computes fail when any requirement is unmet, inconclusive when a requirement is unknown, and pass when all requirements are met. A met requirement needs evidence from the supplied data. Invented evidence, missing or duplicate requested ids and extra keys are unparseable. Unknown ids are ignored and retained in `ignoredRequirementIds`. The model does not choose the requirement set.

The default prompt requests `evidence` as a nonempty list of `{ source, quote }` spans, or null. Source ids are `transcript.<entry index>`, `artifact`, `given`, `input.<file path>` and `reference`. Each quote must ground in its named source. Separate entries need separate spans; a pipe-joined quotation is never split or guessed. One invalid span makes the ledger unparseable. Existing string evidence remains accepted under its original grounding rules. The returned `checks` retain every span; the public `JudgeAnswer.evidence` exposes the first grounded quote as a string.

The public `JudgeAnswer` remains `{ outcome, reasoning, evidence?, score? }`. `parseAnswerText` and `parseAnswerValue` remain binary parsing utilities; the text utility includes additional syntax repairs. Custom chat clients use `parseJudgeText` or `parseJudgeValue` with the request. Probability judges retain their existing binary question and mapping.

Select `answerContract: 'legacy'` on a request to use main `a97cb65e` rendering and parsing byte for byte. This includes literal entry separators, the original data-tag guard, object extraction and the original single syntax repair. This keeps existing cassettes and old scores reproducible. Cassette players also accept that option; recordings made before the ledger contract select legacy automatically. A new ledger recording identifies its contract explicitly and cannot silently replay under a different prompt. No existing cassette needs to be re-recorded to keep using legacy.

`criterionDecoderVersion` picks how code reads a criterion ledger without changing the model-facing prompt. Version 1 is strict: an ungrounded string quote makes the whole ledger unparseable. Versions 2 and 3 drop that string to `evidence: null` with `grounded: false`, preserving the check's `met` value. Version 3 is the default and additionally grounds source-local symbol quotes and input-label spellings such as `input/<path>`. Explicit version 2 preserves its historical span behavior. Invalid span lists remain unparseable in every version. Each decoder has a separate recording identity; historical recordings retain their recorded version.

Under the new default, an old binary model response is unparseable. Council, calibration and single-judge paths re-ask an invalid criterion ledger once with the large budget, then abstain if it remains invalid. A split council can still run its existing additional round. An unparseable response cannot become a fail or pass from its explanation. A parsed row still depends on the model judging that requirement correctly.

The committed Haiku regression cassettes retain four fresh responses for each of seven real failures of the previous contract. The single-id default produces 27 correct passes, one inconclusive and zero wrong verdicts across 28 responses. `qa-negation-2` abstains once because the model demands affirmative phrasing despite the criterion accepting double negation. The recording remains intact; aggregation cannot correct that semantic judgment. Legacy replay retains all 1,028 existing chat entries unchanged.

## Pairwise comparison

`council.judge(pairwiseRequest(criterion, transcript, first, second))` seats the named-winner contract directly. Every vote carries `winner`, and the council counts that field even if a custom client's binary outcome contradicts it. A majority of explicit ties returns `winner: 'tie'` with an inconclusive binary outcome, without another round. Missing winners and unparseable responses abstain. The council returns a winner for that presentation only; use `judgePairwise` when both orders must be checked.

`judgePairwise(client, criterion, transcript, first, second, options)` defaults to `presentation: 'both-orders'`. It compares both candidate orders and reconciles their identities in code. Its public `choice`, `ordered`, `swapped`, `consistent` and `positionBias` fields remain available. A disagreement remains a tie. `calls` counts the actual calls; `recovered` marks a fact-ledger recovery.

Chat models now return a named winner instead of translating a winner into pass or fail:

```json
{"reasoning":"B answers the requested question.","winnerQuote":"The answer is four.","winner":"B"}
```

* `winner` is `A`, `B`, `tie` or `inconclusive`. Code maps A to the existing `pass` outcome and B to `fail`.
* `winnerQuote` copies a passage that appears in the winner and not in the other candidate. The passage can occur anywhere and must be nonempty. It is null for a tie or missing data. A decisive answer without candidates or with a blank quote is unparseable.
* For serialized JSON, the substantive span is checked after string unescaping and mapped back to its original source positions. A quote inside an escaped role token, a JSON `text` wrapper key or an escape spelling for punctuation cannot ground. JSON normalization still needs content from the decoded values.
* A literal substring of a candidate retains its match, including an opening code fence copied from a complete fence. Normalization adds matching views; it cannot remove a substantive literal match. Quotes still need a letter or digit from the candidate body, excluding role and list metadata, and must identify exactly one candidate across all matching views.
* Ordinary criterion evidence has one quote without a letter or digit that grounds: `{}` or `[]`, white space aside, quoted from a transcript entry, input, artifact or Given whose whole text is that same empty container. It is how a check cites an empty file. Any other source, and any other decoration-only quote, leaves it ungrounded.
* If a quote is shared, the parser can extend it with following evidence text that the model actually supplied, including a winner-labelled quoted passage. The complete extension must occur in order in exactly one candidate. Code never invents following words from the A/B label. An evidence passage may repeat the shared opening; code removes that overlap before extending it. Strict JSON string or text-field decoding, rendered separators, Markdown/list presentation and a leading reply label can normalize copies. The label must agree with the declared winner, then the same stripped quote body is checked against both candidates. A label never excludes the other candidate. Malformed or duplicate JSON is not decoded. Paraphrase and nonexclusive matches remain invalid.
* A malformed answer gets one re-ask with the large budget. An ambiguous quote's re-ask explicitly says "your quote matches both replies" and requests a distinguishing passage. A still-invalid answer stays inconclusive.
* Every built-in chat client sends and parses the request's assessment contract. Custom clients that already return binary outcomes remain supported, including probability clients. They do not provide the named-winner integrity check until they adopt `parseJudgeText(raw, request)` or `parseJudgeValue(value, request)`.

`pairwiseRequest` carries `assessment`, `candidates` and the comparison system prompt. An HTTP judge endpoint receives those fields in its request. A changed assessment, requirement set or custom system prompt changes the cassette key. New-default pairwise and criterion recordings require fresh responses. Existing recordings remain usable with `answerContract: 'legacy'`.

### Canonical presentation

```ts
const result = await judgePairwise(client, criterion, transcript, first, second, {
  presentation: 'canonical',
});
// result.choice names the caller's first or second candidate, or a tie.
// result.outcome is the outcome in canonical A/B order.
// result.aIsFirst says whether canonical A was the caller's first candidate.
```

Canonical presentation sorts the complete, unmodified candidate texts by their UTF-8 SHA-256 hashes, ascending. Equal hashes use JavaScript string order as a deterministic fallback. The judge sees that order once, and code maps its winner back to the caller's order. Identical candidates return a tie. A tie or missing-data answer also remains a tie.

`CanonicalPairwiseVerdict` carries `presentation: 'canonical'`, `choice`, `outcome`, `aIsFirst` and `calls`. It omits `ordered`, `swapped`, `consistent`, `positionBias` and `recovered`: the other order was not measured. `pairwiseTally` accepts either verdict type; its inconsistency and position-bias counts include only measured, both-orders verdicts.

One valid canonical comparison uses one client call instead of the default's two primary calls. A malformed answer retains the single bounded re-ask in the same canonical order. Reference text, audit settings and rubric items still apply, but canonical mode does not run the two-order fact-ledger recovery. Rubric items keep their supplied order. `calls` reports the actual number of client calls, including a repair.

Canonical presentation joins the request key, including legacy and system 1 keys. A canonical cassette entry can replay either caller order. It cannot silently replay a both-orders entry. The default and explicit `both-orders` keys stay unchanged, as does the prompt fingerprint. There is no implicit result cache: two live invocations still call the client twice. Record once and use `playerClient` to reuse a judgement.

Mapping is not immunity to order bias. A judge can prefer canonical A regardless of content, and independent live invocations can disagree. Keep the default when measuring position bias matters. Cost savings depend on retries, recovery and the client; one presentation does not promise a universal cost reduction.

### Pair ledger

`judgePairwise(..., { answerContract: 'ledger' })`, or `judgePairLedger(client, pairLedgerRequest(criterion, transcript, first, second, options))`, judges a pair with a ledger. The model records evidence, never a winner: per requirement, a score from 0 to 4 for each candidate (`first`, `second`), or null when the data is missing, with `reasoning` and optional `evidence`. The requirements are the caller's `rubricItems` (each with `name`, `rubric`, an optional `weight` and optional `hard`), or the criterion's requirement list when there are none. Code computes the winner:

* Stage 0 first runs checks with no model: an instruction planted in a candidate, a final answer, the language, explicit arithmetic, format rules copied from the question, and harm policy facts the caller supplies. A decisive row ends the comparison there.
* Each order is read once, ordered and swapped, by a system 2 reader. An answer that breaks the ledger contract gets one re-ask with the large budget and the schema; a second failure returns `status: 'unparsed'` with `graderError: true`.
* One reading per order (`scoreLedger`): a hard requirement that one candidate loses decides the order (`ledger.hard-gate`), unless each candidate loses one (`ledger.hard-conflict`, no winner). Otherwise the weighted sum of the score differences decides (`ledger.weighted-sum`; weight 2 for a hard requirement, 1 otherwise, unless `weight` says). A null score on a hard requirement, or on any requirement when no hard one decides, gives no winner (`ledger.unknown-score`).
* The two orders (`verdictFromLedger`): both name the same winner (`ledger.orders-agree`), or one names a winner by a margin of at least 2 and the other none (`ledger.margin-two`). Otherwise a third read in the canonical order of [canonical presentation](#canonical-presentation) runs, on `escalationClient` when the caller gives one, and the three readings vote (`ledger.escalated-quorum`, or `ledger.escalated-tie` on a tie; `tiePolicy: 'canonical'` lets the third reading break it).

The result carries `status`, `choice` (`first`, `second` or `tie`), `calls`, every read with its parse steps, the Stage 0 rows, the verdict with its rule id, and lint codes per requirement. The ledger needs `presentation: 'both-orders'`. It is a library API: `driftbench compare --pairwise-judge` uses the named-winner contract above, not the ledger.

### Factual audit and ledger recovery

A supplied reference enables the factual audit procedure. It checks distinct requested facts in both candidates, including values, units, entities and negation. Fewer wrong or missing requested facts decides first. Fewer unsupported extra claims breaks equal requested-fact coverage. This is an explicit factual policy; it does not assign a severity weight to each fact.

If the primary orders tie or disagree, the judge asks for a fact ledger in both orders. The model reports each requested fact as `match`, `wrong` or `missing` for each candidate, plus unsupported claims. Code counts the defects and computes the winner. A malformed ledger, duplicate fact or ungrounded reference quote cannot decide a winner. Both fallback orders must agree.

This ports the audit and fallback procedure from the recorded pairwise comparison. Its fallback prompt is preserved in `fact-audit.ts`; the primary answer format changes to the named-winner contract above. Model extraction still determines fact granularity. Agreement between orders does not prove the extraction is correct.

A reference is supporting evidence and can be wrong. The prompt checks it against the task before relying on it. `options.audit: false` retains the general comparison path when factual counts do not fit the criterion. Open-ended comparisons without a reference use the general path.

`driftbench compare --pairwise-reference <file>` supplies the reference text. The compare flags and output are in the [CLI](../reference/cli.md#driftbench-report-and-driftbench-compare) reference.

### Itemized rubrics

`options.rubricItems` enables a separate score for each caller-supplied requirement. Each item has `name`, `rubric`, an optional positive `weight` and optional `hard: true`. The model reports fulfillment from 0 to 4, or null when required data is missing. These scores describe fulfillment, not confidence probabilities.

```ts
const result = await judgePairwise(client, criterion, transcript, first, second, {
  rubricItems: [
    { name: 'correct', rubric: 'The final answer is correct.', hard: true },
    { name: 'format', rubric: 'The reply uses the requested JSON format.' },
  ],
});
```

Item names are stable caller-owned requirement ids, not model-assigned row positions. Code ignores unknown names before validating scores and retains them in `ignoredRequirementIds`. Every requested name must still appear exactly once; missing, duplicate or malformed requested rows are unparseable. Code then computes the weighted fulfillment fraction from only the requested items. A candidate that fully meets every hard item outranks one that fails a hard item. Otherwise the fractions decide. A null score leaves the assessment inconclusive. The swapped pass reverses the rubric presentation order as well as the candidates; names preserve aggregation identity. Reasoning prose cannot replace a structured score, even when they conflict.

`judgeRubric(client, request, items, { threshold })` performs the pointwise version in one batched call. An invalid ledger gets one re-ask with the same caller requirements and the large budget, then remains inconclusive if still invalid. Reported `costUsd` includes both calls. Valid scores, including null, do not trigger a re-ask. Explicit legacy requests retain their previous one-call behavior. Its default threshold is full fulfillment. The result carries the individual scores and aggregate in `rubric`; a hard failure cannot be offset by soft points. No rubric is generated or applied to creative writing automatically. These APIs are code options; they do not add fields to the spec YAML schema.

### Declared preference: long-structured (opt-in)

`judgePairLedger(client, request, { preference: 'long-structured' })` declares that the caller prefers longer, well-structured replies. It is off by default; without it the ledger verdict is unchanged. It is a stated preference of the user, not a measure of quality.

After the ledger verdict, code decides in this order:

* An explicit request row (a hard requirement that decided a reading, such as a stated word limit or form) wins: `preference.hard-row`.
* Otherwise the longer reply wins when it is structured, or when the shorter reply is not structured either: `preference.long-structured`. Length is words for English and Han characters for Chinese, from the reader-first features.
* Otherwise the ledger choice stands: `preference.ledger`. Equal lengths also keep the ledger choice.

A reply is structured (`isStructured`) when it has paragraphs, headings or lists rather than one long block (the reader-first structure flag), and does not repeat itself (repeated sentences at most 8 percent, repeated four-grams at most 15 percent). The result keeps the ledger `verdict` and adds `preference` with the rule id, both lengths and both structure readings. The setting makes no extra model call.

The setting prefers the longer reply. Use it only when longer, structured answers are what you want. Measured with Claude Haiku 5.5 on WritingPreferenceBench pairs ([results](../../examples/writing-heldout/results/RESULTS.md)):

| Pool | Accuracy | Picks the longer reply | Right when the human chose the longer reply | Right when the human chose the shorter reply |
|---|---:|---:|---:|---:|
| Recorded TEST, 173 pairs (346 games) | 65.3 | 96.5 | 95.7 | 1.8 |
| Fresh pool, 144 pairs (288 games) | 66.0 | 93.8 | 96.7 | 11.5 |

It scores well where the human labels favour longer replies, and it is almost always wrong where they favour the shorter one. A rule that always picks the longer reply scores 67.6 on the TEST and 63.9 on the fresh pool. The default judge scores 61.3 on the same TEST and picks the longer reply in 58.4 percent of games. Results with the setting are labelled "driftbench, long-structured setting" and never reported as the default judge.

### Reader-first configuration (length-aware, opt-in)

`createReaderFirstJudge(client, { configuration: 'reader-first' })` is a separate pairwise configuration. It favors the longer complete reply unless machine measurements and both model presentations support a substantial reader-facing failure. It never replaces the default judge, council, or pairwise rubric.

```ts
import { createClaudeCliJudge, createReaderFirstJudge } from '@agent-nexus/driftbench-judges';

const reader = createReaderFirstJudge(
  createClaudeCliJudge({ model: 'haiku' }),
  { configuration: 'reader-first', language: 'en' },
);
const result = await reader.judgePair(request, firstReply, secondReply);
console.log(result.choice, result.override, result.judgeValid);
```

Machine features measure length, paragraphs, headings, lists, filler, hedges, repeated sentences, repeated four-grams, litotes, undefined acronyms, jargon, context references, sentence length and an English readability estimate. Dictionaries and readability are heuristic signals, not factual or semantic checks. Chinese uses Han characters and has no English reading-grade estimate. `language` fixes one counting unit for both replies; otherwise both replies together determine it.

The model scores five fixed criteria: structure, useful prose, direct expression, self-contained context and simple language for an inexperienced reader. Each criterion needs an exact quote from each reply. Both full presentation orders are scored, remapped and pooled. Code computes the verdict. Two sequential model calls are made per pair. Provider errors propagate; invalid scores or evidence are reported with `judgeValid: false` and retain the length fallback. Equal lengths tie.

The returned `length` and `features` fields expose the two ablations; `choice` is the combined verdict. `flags`, `failures`, `means`, `thresholds`, `ordered` and `swapped` expose why an exception fires. `costUsd` sums provider-reported costs. Override thresholds are code options (`judgeMargin`, `featureMargin`, `minFailures`); changing them changes the configuration and invalidates its published benchmark result.

This is an intentionally length-aware preference, useful only when that preference matches the caller's objective. It does not prove factual correctness or general writing quality. See the separate [benchmark report](../comparison/benchmarks/reader-first.md) for measurements, ablations and limitations.

### Optional verification and reference agreement

`withVerification(client, { enabled: true, sandbox })` adds a provider-neutral verification step. It is off unless explicitly enabled. A sandbox implements `verify(request, signal)` and returns arithmetic checks. It must honor cancellation and isolate any general-purpose code it runs. Failure or timeout returns inconclusive, without running an unverified judgement.

`arithmeticSandbox()` is a safe built-in numeric interpreter. It evaluates explicit arithmetic equations with numeric literals, parentheses and the four basic operations. It has no eval, import, filesystem, process or network access. Token, expression, scan and result limits bound its work. It cannot prove symbolic math, a natural-language solution or arbitrary code. Its results enter the transcript as tool evidence, preserving the original response; they do not replace the criterion's verdict.

`extractFinalAnswer(response)` finds the last explicitly marked final answer or balanced LaTeX box. Its result includes the exact source quote and offsets. It leaves unmarked responses alone. `withFinalAnswer(client)` annotates that extraction while preserving the complete original transcript, so multi-part or ambiguous answers remain available to the judge.

`referenceConsensus(answers, { minAgreement, normalize })` includes failed or missing solve attempts in its denominator. Its default requires agreement of at least 0.8 across at least two attempts. It never uses a mere plurality or removes decimal points. A caller may supply an equivalence normalizer. Agreement is a consistency signal, not a correctness guarantee.

`withReferenceConsensus(client, { solve, samples })` wraps a judge with sequential blind solves. The solver receives the user question only, never the candidate response, caller rubric or benchmark label. Only an agreed answer becomes `reference`; an explicit caller reference remains intact. The default stays five solves, with agreement of at least 0.8. The solve port is opt-in, and no provider or solver model is selected automatically.

#### One solve and automatic routing

Set `samples: 1` to use one nonempty blind solve. Its complete text becomes the reference, including any reasoning. This saves solve calls but provides no independent agreement check. The standalone `referenceConsensus` helper still needs at least two attempts.

```ts
import { withReferenceConsensus } from '@agent-nexus/driftbench-judges';

// client and request are your existing judge and request.
// solve(question, attempt) returns { answer?: string, costUsd?: number }.
const routed = withReferenceConsensus(client, {
  solve,
  samples: 1,
  route: 'auto',
});
const result = await routed.judge(request);
```

`route: 'auto'` first asks whether the question has one checkable correct answer: a number, option, fact, proof result or code behavior. Creative writing, advice, opinion, style and open-ended requests skip the solve. Without `route`, the wrapper always attempts the configured solves.

The default route uses the wrapped client and its existing answer contract: pass means YES, fail means NO, and an unparsed or inconclusive result skips solving. The routing request contains only its fixed checkability criterion and the user question. It never receives candidate answers, caller system instructions, artifacts, inputs or labels. Multiple user entries are joined in transcript order.

For a separate classifier or replay of one-word recordings, supply `check(question)`, which returns `{ answer: 'YES' | 'NO', costUsd? }`. It receives only the question and requires `route: 'auto'`. Only a complete YES, ignoring case and surrounding whitespace, enables solving. A missing or malformed answer, thrown error or invalid cost skips solving. The original judgement still runs without a generated reference. A failed or blank solve also leaves the reference absent; neither step manufactures a pass.

| Result field | Meaning |
| --- | --- |
| `referenceAgreement.routed` | `true` when auto routing selects solving, `false` when it skips. Absent without auto routing. |
| `referenceAgreement.attempts` | Number of solve attempts, including failures. Zero when routing skips. |
| `referenceAgreement.agreement` | Winning answer's share of all attempts. A successful single solve records 1, which is not proof of correctness. |
| `referenceAgreement.used` | Whether a generated reference reaches the judge. A positive route with a failed solve records `false`. |
| `costUsd` | The final judgement's reported cost plus reported solve costs and any new routing call's cost. |

Each wrapper caches route decisions by exact question, including concurrent and failed calls, for its lifetime. It charges a routing call only to the request that starts it. A later request reuses the decision without adding that cost again. A new wrapper starts an empty cache. Solves are not cached. An explicit caller reference, even an empty string, or a missing user question bypasses both steps and returns the original judge result.

For repeated or pairwise judging, supply a caller-owned memoized solver when all verdicts should share one reference. Return its cost only when that solve runs. `samples` here counts blind solves, not verdict samples; `judgeRepeated` controls repeated judgements separately. Pairwise callers can also collect multiple blind solves once, apply `referenceConsensus`, then pass its reference to `judgePairwise`.

The feature does not change `PROMPT_FINGERPRINT`. The generated reference and the separate route request use the existing request keys. See the [offline reference replay](https://github.com/NexusGPT/driftbench/tree/main/examples/reference-replay) for historical reference3 and adaptive recordings through this API. That replay checks recorded behavior, not a fresh accuracy estimate for a different prompt or model.

## Repeat reducers

A criterion can say how its verdicts across the repeats of one spec become one verdict, with `repeat_reducer`:

* `mode`: the most common verdict, when more than half of the repeats are scored. A tie goes to the verdict seen first. One scored repeat of three gives no verdict.
* `median`: a pass above one half of the repeats, a fail below it. Exactly one half is undecided.
* `at_least:<k>`: a pass when at least `k` repeats pass. A fail only when the passes plus the inconclusive repeats cannot reach `k`. Undecided otherwise, since an inconclusive repeat could still be the `k`-th pass.

A run folds the criterion's verdicts across its blocks first: any fail makes the run a fail, every block passing makes it a pass, and anything else is undecided. An inconclusive repeat is left out of every reducer. A criterion without `repeat_reducer` gets no reduced verdict.


## Pointwise fact ledger against a trusted reference

This option audits one reply against a caller-supplied trusted reference. It stays off
unless the request sets `assessment: { kind: 'fact-ledger' }` and omits `candidates`.
The shipped default judge and its prompt fingerprint remain unchanged.

```ts
import { createAnthropicJudge, type JudgeRequest } from '@agent-nexus/driftbench-judges';

const request: JudgeRequest = {
  criterion: { name: 'facts', rubric: 'Every requested fact matches the trusted reference.' },
  reference: 'Aster costs 34 crowns monthly, includes 60 GB, and excludes roaming.',
  transcript: [
    { role: 'user', text: 'State the price, data and roaming terms of Aster.' },
    { role: 'agent', text: 'Aster: 34 crowns monthly, 60 GB and no roaming.' },
  ],
  assessment: { kind: 'fact-ledger' },
};
const result = await createAnthropicJudge({ model: 'your-model' }).judge(request);
console.log(result.answer.outcome, result.factLedger);
```

The result carries a `PointwiseFactLedgerAnswer` in `factLedger`: each `facts` row
has `reference`, `reply` and `status` (`match`, `wrong` or `missing`), plus an
`unsupported` array of extra factual claims. Code computes `pass` only when all
rows match and that array is empty. A wrong fact, missing fact or unsupported
claim makes `fail`. A malformed, empty or duplicate ledger makes `inconclusive`.
Only missing facts have empty reply text. There is no model-authored overall verdict.

The semantic contract is the frozen candidate procedure, including shared sentence
modifiers, paraphrases, exact unit conversions, negation, conditions and quantifiers.
Its model prompt is exported as `FACT_LEDGER_POINTWISE`. Model judgment still decides
which facts are requested, whether the list is complete, and whether each claim
matches. Code does not independently prove those semantic decisions.

A nonempty `reference` is required before a built-in chat client sends a request.
Pass the transcript slice to audit: user entries become the query, agent entries
become the reply, joined with newlines within each role. Other roles and artifacts
are not included in this pointwise contract. Query, reference and reply are JSON
data. The criterion name and rubric identify the request; requested facts come from
the query and reference. Use the ordinary criterion judge for arbitrary rubrics.
Existing `candidates` requests keep the pairwise fact ledger and its winner rules.

### Strict grounding

Set `assessment: { kind: 'fact-ledger', grounding: 'strict' }` to require each
reference row to quote the supplied reference and each nonempty reply row to quote
one agent entry. The existing quote matcher tolerates presentation differences and
ordered ellipsis segments; it does not verify paraphrases. Quotes from user or tool
entries cannot count as reply evidence. A failed grounding check returns
`inconclusive` with `unparsed: true` and a reason, never a fabricated pass or fail.

Strict mode applies to the parser only and preserves the frozen model prompt. A
valid semantic paraphrase can therefore be refused. It neither proves that every
requested fact is present nor checks the model's unsupported-claim judgments.
The assessment, grounding option and reference participate in cassette keys.
Calibration can evaluate either request variant on caller-owned labels; automatic
procedure selection is a separate feature.

### Offline replay evidence

The committed replay imports every frozen Langfuse candidate response from
`research/astra-hard-fresh` at `89425c88b12e5fd7516ed9cdbf6d37b9b0261595`.
It verifies exact system and user prompt bytes and their SHA-256 digests, then
parses the original responses through the public `playerClient` API. It makes
no model calls and does not claim a new live-model measurement.

| Slice | Recordings | Semantic correct | Strict correct | Strict inconclusive | Pass to inconclusive | Fail to inconclusive |
|---|---:|---:|---:|---:|---:|---:|
| Fresh planted facts | 192 | 192/192 | 74/192 | 118 | 57 | 61 |
| Map replication | 180 | 178/180 | 77/180 | 101 | 43 | 58 |
| Total | 372 | 370/372 | 151/372 | 219 | 100 | 119 |

Strict mode changes 219 verdicts, all to inconclusive. No pass becomes fail and no
fail becomes pass. The map slice retains its two wrong verdicts in both modes.
Inconclusive responses count as incorrect for these scores; abstention is not an
accuracy gain. These results describe the frozen fictional fixtures and recorded
model responses, not a guarantee for other data or models.

Run `pnpm exec tsx comparisons/langfuse/pointwise-fact-ledger/replay.ts` to verify
[the report and per-case transitions](https://github.com/NexusGPT/driftbench/blob/main/comparisons/langfuse/pointwise-fact-ledger/replay.json).
The same replay runs in the regular test suite. The legacy cassette and golden
prompt tests also run to prove that opting out retains the previous behavior.
