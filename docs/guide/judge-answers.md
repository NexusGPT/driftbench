# Judge answers

Some things in a reply cannot be checked by code. "Is the reply polite?" has no pattern to match. This part teaches you to hand such questions to a **judge**, which is a model that reads the answer and says pass or fail. It also teaches you how to decide whether a judge deserves your trust. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for. The commands that would call a billed model are in `bash` blocks, and the page says so.

The examples use the Acme Telecom sales assistant that ships in `examples/acme`. All data is fictional. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.

## Words used in this part

| Word | Plain meaning | Example |
|---|---|---|
| Judge | A model that reads a reply and answers a question about it. | "Does the reply ask at most one question?" |
| Criterion | One question a judge answers, written as a file. | `one_question_per_turn` |
| Rubric | The text of the question. It has a yes or no answer. | "The reply asks the customer at most one question." |
| Fixture pair | Two short transcripts that come with a criterion. One must pass. One must fail. | A reply with one question, and a reply with two. |
| Gating | A gating criterion that fails makes the whole block fail. | `care_redirect` is gating. |
| Judge class | System 1 is a cheap judge that answers one short question. System 2 is a chat model that reasons. | `s1p-a` is system 1. `google-chat` is system 2. |
| Hand label | A pass or fail that a person wrote on a real block. | "Order placed with no recap: fail." |
| Cassette | A file of recorded judge answers. It lets you replay a judge with no model and no key. | `council.cassette.json` |
| Kappa | A score from below 0 to 1 for how much two raters agree, after removing luck. 1.00 means always the same answer. | A judge and a person agree on 39 of 40 blocks: kappa 0.95. |
| Calibration | Testing each judge against the fixture pairs and the hand labels. | `judge calibrate` |
| Council | Three judges of one class that vote. The majority decides. | Two pass and one fail: pass. |
| Cascade | The cheapest judge answers first. The others answer only if it is unsure. | One sure pass stops the vote. |
| Mixture of judges | A cheap judge answers every item. A costly panel answers only the items it leaves unsure. | 48 of 1,212 items go to the panel. |

## 1. Why a judge

**Why you do this.** Code checks can test a word, a tool call or a number. They cannot test tone, honesty or whether the agent kept to one question. A judge covers that gap. First see what a run does when no judge is loaded.

**You need.** The Acme plan-upgrade test, `examples/acme/specs/conversations/plan-upgrade.yaml`. Two of its criteria are judged: `one_question_per_turn` and `no_invented_data`. Its blocks name them like this:

```console
$ sed -n 40p examples/acme/specs/conversations/plan-upgrade.yaml
      criteria: [one_question_per_turn]
```

**Relevant commands.**

- `driftbench campaign run`: runs the test against the agent and prints one line per run · `examples/acme/specs/conversations/plan-upgrade.yaml` is the test; `--target function:acme` runs it on the Acme sales assistant; `--campaign judge-1` names the campaign · it prints a verdict line and a count, and exits 0 when every cell passes.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --campaign judge-1
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `Not judged`: the test names two judged criteria in 3 blocks. The run loads no judge, so they get no verdict. They count in no pass and no fail.
- `1 of them gating`: one of the two would fail the block if it failed. With no judge, it never does. A green run here does not mean those two questions are answered.
- `1 pass`: this counts the code checks only.

**If it goes wrong.**

- The `Not judged` line is missing: the test names no judged criterion, so there is nothing to judge. Add `criteria: [...]` to a block, as in step 2.
- `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` (exit 2): fix the value of `--mode`.

## 2. Write a criterion file and check it

**Why you do this.** A judge needs a precise question and two examples to be tested on. One file holds both. A mistake in the file is cheaper to find now than after a paid run.

**You need.** A folder with one YAML file per criterion. The file name is the criterion name. The folder `examples/acme/criteria` holds 12. This is the top of one of them:

```console
$ sed -n 1,6p examples/acme/criteria/one_question_per_turn.yaml
criterion:
  name: one_question_per_turn
  rubric: The reply asks the customer at most one question.
  pass: One question, or none.
  fail: Two or more questions in the same reply.
  judge_class: system1
```

The rest of the file is the **fixture pair**: a short transcript the criterion must pass, and one it must fail. The fail copy is the same reply with a second question added.

- `name` is how a block refers to the criterion.
- `rubric` is the question. Write it so that the answer is yes or no.
- `pass` and `fail` describe in words what a passing and a failing reply look like.
- `judge_class` is `system1` or `system2`. Calibration may move the criterion to the other class (step 3).
- `gating: true` makes a fail stop the block. It is absent here, so this criterion only reports.

**Relevant commands.**

- `driftbench judge check`: reads every criterion file of a folder and reports the problems · `examples/acme/criteria` is the folder; `--json` (not used here) prints one JSON document · it prints one `ok` line per valid file and one line per issue, calls no model and writes nothing. Exit 0 means every file is valid, 1 means an issue, 2 means the folder cannot be read.

**You type.**

```console
$ driftbench judge check examples/acme/criteria
ok  care_redirect [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  holds_instructions [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  one_question_per_turn [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
12 valid criteria, 0 issue(s).
```

**How to read it.**

- `ok  one_question_per_turn [system1]`: the file is valid. `[system1]` is its class. `gating` appears in the brackets for a gating criterion.
- `pass fixture 4 line(s), fail fixture 4 line(s)`: the size of the two transcripts.
- `12 valid criteria, 0 issue(s).`: the whole folder is valid. Run this before every other `judge` command.

Now break a file on purpose. Copy a criterion under a different file name. The file name must equal the criterion name:

```console
$ mkdir bad
$ cp examples/acme/criteria/one_question_per_turn.yaml bad/ask.yaml
$ driftbench judge check bad   # exit 1
(pending)
```

**If it goes wrong.**

- A line that names a file and says its criterion name differs from the file name (exit 1): rename the file, or the `name`, so they match.
- A missing FAIL or PASS picture, or a fixture pair that is the same slice twice (exit 1): give the criterion a `pass` and a `fail` sentence, and two different transcripts.
- The folder cannot be read (exit 2): the path is wrong. The path is read from the folder you are in.

## 3. Make a judge earn its place

**Why you do this.** A judge can be wrong. A wrong judge that gates a block makes good agents fail and bad agents pass. So a judge answers a test first. It must pass that test every time. Only then is it assigned to a criterion.

**You need.**

- The criteria folder from step 2.
- A folder of **hand labels**: real blocks that a person marked pass or fail. `examples/acme/labels` holds 40 of them, one file per criterion. This is the top of one:

```console
$ sed -n 1,10p examples/acme/labels/one_question_per_turn.yaml
(pending)
```

- A cassette with the recorded answers of six judges: `examples/acme/criteria/calibration/cassette.json`. Its answers are scripted by hand to prove the mechanics. They do not measure a real model.

Calibration asks each judge two things:

- **Separation.** The judge answers the pass transcript and the fail transcript 3 times each. It must pass the first and fail the second in all 3 repeats. A result of `3/3` is full marks.
- **Agreement.** The judge answers every hand-labelled block once. Its agreement with the labels is **kappa**. The bar is 0.8.

A judge at the bar on both owns the criterion. A class needs three judges at the bar to take it. If no class has three, the criterion stays **unassigned**: it is still judged, but it never gates.

**Relevant commands.**

- `driftbench judge calibrate`: tests every judge of the cassette on every criterion and writes the assignment table · `--criteria examples/acme/criteria` is the criteria folder; `--labels examples/acme/labels` is the hand labels; `--cassette examples/acme/criteria/calibration/cassette.json` replays the recorded answers, so no model is called; `--out assignments.yaml` is the file to write · it prints one block per criterion, then the summary, and writes the table. Exit 0 means the table is written and every gating criterion is assigned.

**You type.**

```console
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --out assignments.yaml
care_redirect [gating]: owned by s1p-a (system1: s1p-a, s1p-b, openai-decisions; re-judge google-chat, openai-chat, anthropic-chat)
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    s1p-b              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    openai-decisions   system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
holds_instructions [gating]: owned by google-chat (system2: google-chat, openai-chat, anthropic-chat; re-judge s1p-a, s1p-b, openai-decisions)
    openai-decisions   system1  separation 2/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  misses: separates the fixture pair 2 of 3 times
ledger_intact: UNASSIGNED, judged but not gating: no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8
Kappa over every labelled block: s1p-a 0.90 (38/40), s1p-b 0.90 (38/40), openai-decisions 1.00 (40/40), openai-chat 1.00 (40/40), google-chat 0.95 (39/40), anthropic-chat 1.00 (40/40).
11 of 12 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8). Unassigned, judged but never gating: ledger_intact.
Wrote assignments.yaml.
```

**How to read it.**

- `care_redirect [gating]: owned by s1p-a`: three system 1 judges are at the bar. The cheapest, `s1p-a`, owns the criterion. The three system 2 judges re-judge a split vote.
- `separation 3/3`: the judge told the pass transcript from the fail transcript in all 3 repeats.
- `kappa  1.00  agreement 4/4 [0.51, 1.00]`: the judge agreed with all 4 labels. The range in brackets is the 95% interval of the agreement. With only 4 labels it is wide: 0.51 to 1.00. More labels make the bar mean more.
- `misses: separates the fixture pair 2 of 3 times`: `openai-decisions` missed one repeat on `holds_instructions`. Three system 1 judges are not at the bar, so the criterion moves to system 2.
- `ledger_intact: UNASSIGNED`: two judges of each class missed the kappa bar. The criterion is judged but never gates. The fix is a new rubric, not a lower bar.
- `Kappa over every labelled block`: each judge over all 40 labels. `google-chat` agrees on 39 of 40.
- The table written to `assignments.yaml` is what a later run reads. See the entry of `holds_instructions`:

```console
$ grep -A12 "criterion: holds_instructions" assignments.yaml
(pending)
```

A real judge goes through the same test. The repository records one: a `claude-haiku` judge on the 12 pairs (3 repeats) and the 40 labels cost 0.0182 USD, and reached kappa 0.95 (39 of 40). Source: `docs/concepts/judges.md`, section "A real judge: haiku on the claude command". After three fixes to rubrics and inputs, kappa rose to 1.00 (40 of 40). To run that yourself you need the `claude` command signed in. It bills your account, so it is not run by the tests:

```bash
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --claude haiku --mode llm --spend-cap-usd 0.1 --record haiku.cassette.json --out haiku.yaml
```

`--claude haiku` adds one live judge on the local `claude` command. `--spend-cap-usd 0.1` stops the calls once they have cost 0.1 USD. `--record haiku.cassette.json` saves every answer, so the next calibration is free.

**If it goes wrong.**

- `Unassigned, judged but never gating: <criterion>` and exit 1 when that criterion is gating: no class has three judges at the bar. Read the `misses:` lines. Rewrite the rubric, or add labels. Do not lower 0.8.
- A labels file refused (exit 2): its name must equal its criterion, it needs at least one pass and one fail label, and every block id must be unique.
- A line with a judge call that "gave no answer" (exit 1): the cassette holds no recording for that request. A change to a rubric, a fixture or a prompt changes the request key, so the old recordings no longer match. Record again.
- A judge of the agent's own model family is left out, and the summary names it. Pass `--agent-family <family>` to state the family. Use `none` for an agent that is not a model.

## 4. The council and the cascade

**Why you do this.** One judge can have a bad day. Three judges that vote give a steadier answer. A cascade saves money: if the cheapest judge is sure, you skip the others.

**You need.** The criteria folder from step 2 and a cassette of council answers, `examples/acme/criteria/council.cassette.json`. It holds 76 scripted answers for six judges: three of system 1 (`s1p-a`, `s1p-b`, `openai-decisions`) and three of system 2 (`openai-chat`, `google-chat`, `anthropic-chat`).

How the council decides:

- Each criterion has three seated judges of one class. A verdict needs more than half of them to agree. Two of three is a majority.
- An inconclusive vote supports nothing.
- No majority is a **split**. In `hybrid` mode the three judges of the other class judge it again. If that splits too, the assigned judges answer once more with a larger budget.
- With a **cascade**, the cheapest judge answers first. The vote stops there if it is a pass and its score is at least 0.9. A fail, an unsure pass or an answer with no score brings in the other two.

**Relevant commands.**

- `driftbench judge run`: replays a council on a cassette over the fixture pair of every criterion · `--criteria examples/acme/criteria` is the folder; `--cassette examples/acme/criteria/council.cassette.json` holds the recorded answers; `--cascade` (second command) runs the cheapest judge first · it prints one line per criterion, `separated` when the pass transcript passes and the fail transcript fails, and a count. It never calls a model. Exit 0 means all criteria are separated, 1 means one is not or a judge gave no answer, 2 means bad input.

**You type.**

```console
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
12 of 12 criteria separated in mode hybrid.
```

Then the same replay with a cascade:

```console
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --cascade
separated  care_redirect [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass (cascade), fail fixture fail (split, re-judged)
12 of 12 criteria separated in mode hybrid.
```

**How to read it.**

- `separated`: the pass transcript got the verdict pass and the fail transcript got fail. That is what a working judge must do.
- `[system1, gating]`: the class of the judges that decided, and whether the criterion gates.
- `(split, re-judged)` on `holds_instructions`: the three system 1 judges did not agree. The three system 2 judges judged again and decided fail. This example is scripted to show the path.
- `(cascade)`: the cheapest judge was sure of the pass and decided alone. Only one judge was paid for.
- `12 of 12 criteria separated`: good. Any `NOT separated` line is a defect. The lines under it show each round of votes.

The answers in this cassette are scripted by hand. They prove that the voting works. They do not say how accurate a real model is.

**If it goes wrong.**

- `error: required option '--cassette <file>' not specified` (exit 2): the command never calls a model, so it needs a cassette. Pass `--cassette <file>`.
- `--mode takes system1, hybrid, llm, not "fast".` (exit 2): use one of the three modes.
- `judge run: the criteria folder has <n> issue(s); run judge check first.` (exit 2): fix the files that `judge check` lists.
- `0 of 12 criteria separated in mode hybrid; 216 judge call(s) gave no answer (a cassette miss or a recorded failure).` (exit 1): the cassette was recorded for other requests. Use the cassette recorded for these fixtures, or record again.
- `judge run: judge openai-decisions is from the openai family, the family of the agent under test: refused` (exit 2): a judge shares the family you passed in `--agent-family`. Use judges of other families.

## 5. The mixture of judges

**Why you do this.** A council of three costly judges on every item is expensive. Most items are easy. A cheap judge settles those. Only the hard ones need the costly judges. That is a **mixture of judges**.

**You need.** Nothing new. This step explains the idea, shows what it was measured to do, and runs the router it is built on with recorded answers.

The design, in plain words:

- A cheap, fast judge reads every item. Each item here is a pair of replies, and the judge picks the better one.
- A router watches for signs of doubt. The two orders of the pair disagree. The answer is inconclusive. The cheap judge is under a confidence bar. Or a reference answer disagrees.
- Only a doubtful item goes on to the costly judges, which come from other model families. They vote, and the vote decides.
- Whatever the cheap judge was sure about is never sent. That is where the money is saved.

Its measured results come from a test that was sealed first: the items and the settings were fixed before any score existed, and the sealed set was used once. The numbers below are from `research/moj/RESULTS.md`, section "Sealed confirmation (run once)". Each score is the share of pairs where the judge picked the right reply, with a 95% interval in brackets. The last column is a rule that always picks the longer reply, as a floor.

| Test set | Pairs | Mixture of judges | promptfoo select-best | Always the longer reply |
|---|---|---|---|---|
| JudgeBench, strict rule | 100 | 85.0 [77, 91] | 84.0 [76, 90] | 43.0 |
| MM-Eval | 294 | 94.9 [92, 97] | 94.7 [92, 97] | 42.0 |
| Writing | 300 | 65.2 [60, 70] | 57.0 [51, 62] | 69.7 |

The cost, from `research/moj/RESULTS.md` and `docs/comparison/methods.md`, in costly (System 2) calls per 100 pairs:

| Test set | Mixture of judges | promptfoo select-best |
|---|---|---|
| JudgeBench | 57 | 200 |
| MM-Eval | 21 | 200 |
| Writing | 10 | 200 |

That is 3.5 to 19.4 times fewer costly calls (`docs/comparison/methods.md`, section "Mixture of Judges"). The mixture also makes 246 to 347 cheap calls per 100 pairs. The price of those calls is not published.

How to read the numbers:

- On JudgeBench and MM-Eval the mixture ties promptfoo. The intervals overlap, and the paired test with a Holm correction finds no difference. It is not more accurate there. It is as accurate with far fewer costly calls.
- On writing the mixture wins against promptfoo by 8.2 points (Holm p 0.047).
- On writing the rule "pick the longer reply" scores 69.7, above the mixture. `research/moj/RESULTS.md` says so, and does not count writing as a judging win.
- In this repository, on 1,212 sealed MM-Eval items, the cheap judge sent 48 to the panel. The mean item score on those 48 rose from 51.0 to 85.4. Source: `docs/assets/data/mm-eval-sealed-test.json`, as `docs/comparison/methods.md` records it.

The full mixture runs from the research harness in `research/moj`. The router it is built on is part of the package, and the command line has it as `--judge-route escalation`. **Relevant commands.**

- `driftbench smoke`: runs a test 3 times and judges each judged block · `examples/acme/specs/conversations/tool-failure.yaml` is the test; `--judges examples/acme/criteria/calibration/campaign.cassette.json` replays six recorded judges, so no model is called; `--judge-route escalation` sends each call through the router; `--route-first openai-chat` is the judge that answers first; each `--route-then` is a judge asked only when a doubt sign fires · it prints the runs, the judged verdicts and the cost of the judges.

**You type.**

```console
$ driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --judge-route escalation --route-first openai-chat --route-then google-chat --route-then anthropic-chat
Smoke: acme-tool-failure on function:acme-sales, 3 runs, cache off.
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
Judge escalation openai-chat then google-chat, anthropic-chat, 0.0000 USD.
```

**How to read it.**

- `judged honest_failure (block 0): pass`: the verdict of the criterion on block 0.
- `Judge escalation openai-chat then google-chat, anthropic-chat`: the first judge and the judges held back.
- `0.0000 USD`: replayed answers cost nothing. With live judges this line is the real cost.

**If it goes wrong.**

- A route with no first judge, an agent family that matches a judge of the cassette, or `--judge-route` with `--panel-weights` (all exit 2): the command refuses before any run. State a `--route-first`, change `--agent-family`, and use only one way to decide.
- `--route-then` judges must come from more than one model family together with the first judge. A pool of one family is refused.

## 6. The default judge

**Why you do this.** You do not have to build a judge procedure yourself. driftbench ships one policy for every model provider. It is the judge that `estate run`, `replay`, live `judge calibrate` calls and `compare --pairwise` use.

**You need.** A provider and a model. You choose them. The policy never changes because of a model name, a vendor, a model size or the length of an answer. This is the call from `docs/default-judge.md`:

```ts
import { createDefaultJudge } from '@agent-nexus/driftbench-judges';

const judge = createDefaultJudge({
  provider: 'claude-cli',
  model: 'haiku',
  maxBudgetUsd: 0.10,
  spendCapUsd: 5,
});
```

- `provider` and `model` pick the model that answers.
- `maxBudgetUsd` is the most one call may cost.
- `spendCapUsd` is the most all calls together may cost. The client refuses another call once the balance is gone.

The policy reads the kind of task first, then picks a procedure. The list below is from `docs/default-judge.md`:

- An ordinary criterion uses a fact ledger: the judge lists each requirement and the evidence for it, and code computes pass or fail.
- A question with one checkable answer gets three blind solutions, an answer match and a comparison with the criterion.
- A pair of replies is compared in both orders, and code reconciles them.
- A pair of writing samples is judged on the request and on quality, with no preference for length.

It keeps your inputs authoritative. An instruction written inside the data is neither a reason to pass nor a reason to fail.

**Relevant commands.**

- `driftbench campaign run ... --judge claude:haiku --judge-budget 0.1`: runs a test and judges its criteria with a real model · `--judge claude:haiku` is the judge, in the form `<kind>:<model>` · `--judge-budget 0.1` stops judging once 0.1 USD is spent · it prints the run with a verdict for each judged criterion, and the cost. It calls a billed model, so it is not run by the tests.

```bash
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --judge claude:haiku --judge-budget 0.1
```

**If it goes wrong.**

- A billed `claude` judge with no `--judge-budget`: the command asks for one. Add the option.
- A key or model missing for a provider judge: the error names the variable to set. Keys come from the environment only.
- A cassette that no longer matches (`cassette_miss`): you changed the prompt, the model or a setting. Old recordings are history. Record again.

## 7. Hand labels and the viewer

**Why you do this.** Calibration is only as good as its labels. A person must read real blocks and mark them. The viewer and the review queue make that work easy and keep two people from labelling the same block.

**You need.** A stored campaign. A store is a file that keeps runs. This command runs the plan-upgrade test and keeps it in `acme.db`:

**Relevant commands.**

- `driftbench campaign run`: as in step 1, plus `--store acme.db` to keep the run in a store file, and `--campaign upgrade-demo` to name the campaign · it prints the run and writes `acme.db`.
- `driftbench queue create`: lists the blocks that still need a label · `--store acme.db` is the store; `--campaign upgrade-demo` is the campaign whose blocks are queued; `--labels labels` is the labels folder, made if it is missing · it queues each block once per criterion of its spec, skipping labelled blocks, and prints how many it queued.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store acme.db --campaign upgrade-demo
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench queue create --store acme.db --campaign upgrade-demo --labels labels
(pending)
$ ls labels
queue.json
```

**How to read it.**

- `Queued 10 items in labels.`: the plan-upgrade test has 5 blocks, and 2 judged criteria. That makes 10 items, each one block and one criterion.
- `queue.json` is the queue, kept beside the labels.

Now open the viewer. It serves the store as a local website at an address printed at startup. The command runs until you stop it with Ctrl+C, so the tests do not run it:

```bash
driftbench view --store acme.db --labels labels --labelled-by "your name"
```

- `--store acme.db` is the store to read.
- `--labels labels` is the folder labels are written to, the same folder `judge calibrate --labels` reads.
- `--labelled-by "your name"` is written in a new label file as `labelled_by`.

In the page of a run, a form under each block lets you pick a criterion, choose pass or fail, write why, and save. A saved label is one block of `labels/<criterion>.yaml`, the format `judge calibrate` reads. `judge calibrate` needs at least one pass and one fail label per criterion. A second person can record a view with `driftbench queue vote`, and `driftbench queue agreement` prints how often the two agree, with kappa. If two people rarely agree, the rubric is unclear. Fix it before you ask a judge to agree with them. The viewer listens on `127.0.0.1` only (source: `docs/viewer.md`).

**If it goes wrong.**

- `queue create` exits 2 with an unknown campaign: the id does not exist in that store. Check the name you gave `--campaign`.
- `view` exits 2: the store is missing, the port is not a number, or the port cannot be opened. Check `--store` and `--port`.
- A form is refused with HTTP 403 after a restart: the form token changes at each start. Reload the page.

## 8. Put a judge in a run

**Why you do this.** Everything above prepared the judge. Now a run uses it. There are three ways in, and the first needs no model.

**You need.** One of: a cassette of recorded answers, a live judge on the `claude` command or a provider, or a council built in code.

**Relevant commands.**

- `--judges <cassette>`: an option of `smoke`, `campaign run`, `ci` and other commands that adds every judge of a recording as a player · the value is the cassette file · no call, no cost.
- `--judge <kind>:<model>`: adds a live judge · repeat it for a council; the kinds include `claude`, `openai`, `anthropic` and `google` · paid calls.
- `--cascade`: the council runs its cheapest judge first and stops on a sure pass.
- `--assignments <file>`: seats the judges as `judge calibrate` assigned them.
- `defaultChecks({ judges })`: the same, from code.

**You type.**

```console
$ driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --cascade
Smoke: acme-tool-failure on function:acme-sales, 3 runs, cache off.
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
Judge s1p-a, s1p-b, openai-decisions, openai-chat, google-chat, anthropic-chat, 0.0000 USD.
```

From code, the same council goes into the run through the checks:

```ts
import { defaultChecks } from '@agent-nexus/driftbench-checks';

// council: a council of your judges, for example one seated from the assignment table.
const checks = defaultChecks({ judges: council });
```

`defaultChecks()` with no judge has no judge check. With a council, a block that names criteria gets one verdict per criterion, named `judge.<criterion>`.

**How to read it.**

- `judged honest_failure (block 0): pass`: one line for each judged block.
- `Judge s1p-a, s1p-b, ...`: the six judges that were loaded, and the cost. The answers are replayed, so the cost is zero.
- A judge verdict sits beside the machine verdicts and never replaces one. A block passes only when every gating verdict passes. A judge pass never turns a machine fail into a pass.

**If it goes wrong.**

- `--cascade` or `--assignments` with no judge: those options need a judge to act on. Add `--judges` or `--judge`.
- `--agent-family google` with a cassette that holds a google judge (exit 2): the judge is refused before any run. State the real family of your agent.
- A criterion that stays `inconclusive`: no judge answered it. Check that a loaded judge has a recorded or live answer for it.
