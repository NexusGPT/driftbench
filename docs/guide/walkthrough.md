# A walkthrough on your own agent

This is a hands-on guide. It takes one small made-up agent, the Northwind ops assistant, from its files to a list of tests (each test is one file, called a **spec**), runs a test, then changes one rule and reruns only the tests that rule can affect. Do the same on your own agent by swapping in your folder. Every command below is run by a test on GitHub, and every excerpt is real output. Nothing calls a model and nothing is paid for.

<a href="../../.github/readme/walkthrough-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/readme/walkthrough-dark.png">
    <img alt="The four steps of the walkthrough as four boxes joined by arrows. 1, turn the agent's files into tests: 116 atoms found, 1,439 tests written. 2, see which tests cover one sentence: the sentence, its id, the instruction, the tests. 3, run a test: the agent answers, each check says pass or fail. 4, after an edit, list the tests to rerun: 17 of 921." src="../../.github/readme/walkthrough-light.png" width="100%">
  </picture>
</a>

## Before you start

**Why you do this.** driftbench reads your agent's files, so they must sit in one folder that you can point it at. This part sets that up and installs the tool.


**What you need.**

- Node 22 or newer, and driftbench: `npm install --global @agent-nexus/driftbench`, which gives you the command `driftbench`. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.
- Your agent as one folder that holds every file defining it. driftbench calls that folder the **estate**. It must follow the layout of Claude Code, Anthropic's coding agent, which is the only layout the `estate` commands read today. Anything else (a function, an HTTP endpoint, a script) uses the [quickstart](quickstart.md) instead.

| File | What goes in it |
|---|---|
| `CLAUDE.md` | Your system prompt: the rules the agent follows. |
| `.claude/skills/<name>/SKILL.md` | One folder per skill. A short header, then the instructions of the skill. |
| `.claude/agents/<name>.md` | One file per helper agent. |
| `.claude/settings.json` | The model, the permissions and the guards. |

Your files can be small. This is the start of the example agent's `CLAUDE.md`:

```markdown
# Northwind ops assistant

## Rules

- **R1.** Always answer in the language of the user's latest message.
- **R7.** When a shipment is late by more than two days, tell the user and propose a supplier email.
```

And the start of one of its skills, `.claude/skills/weekly-report/SKILL.md`:

```markdown
---
name: weekly-report
description: Prepare the weekly operations report from the ledger and the shipment log.
---
Count only what the ledger and the shipment log show for the last seven days.
```

**Relevant commands.**

- `mkdir -p walk && cp -R examples/estates/fixture walk/northwind`: makes a working folder `walk` and copies the example agent into it as `northwind`, so the repository stays as it is · `-p` makes the folder if it is missing, `-R` copies a whole folder · it produces `walk/northwind`. With your own agent, copy or point at your own folder instead.
- `rm -rf walk/northwind/generated`: deletes the tests that come with the example, because step 1 writes them again · `-rf` removes a folder and what it holds without asking · it produces nothing.
- `cd walk`: goes into the working folder · no options · every later command runs from there.

```console
$ mkdir -p walk && cp -R examples/estates/fixture walk/northwind
$ rm -rf walk/northwind/generated
$ cd walk
```

## 1. Turn the agent's files into tests

**Why you do this.** Writing hundreds of tests by hand is slow, and you would not know what you missed. This step lets code write them from your own files, and tells you what they cover.


**What you have.** The folder `northwind` with the files above.

**Two words first.** A rule is called an **atom**: one thing your files tell the agent to do or to use, kept with a quote of the line it came from. driftbench finds atoms in two ways. Code reads the structured parts itself: headings, lists, tables, links, the skill folders and the settings file. A model reads the prose, such as the sentences of your prompt, and says which ones are rules. A person, you, approves what the model found. The list of all atoms is the **map**.

**Relevant commands.**

- `estate build`: reads your agent's files, lists what they tell the agent to do, makes a **plan** (the list of situations to test) and writes the tests, and asks you twice before it goes on · `northwind` is your agent's folder; `--out build` is the folder where every file goes; `--pointer` gives each sentence of your prompt an id that survives edits, which step 4 needs, and keeps the ids in `build/ledger.json` (your own files, `CLAUDE.md` included, are never changed); `--cassette northwind/cassette.jsonl` replays recorded answers of the model that labels the sentences, so no model is called in this example; `--yes` answers yes to both questions · it writes the map `build/map.yaml`, the approved map `build/approved.yaml`, the plan `build/plan.yaml` and the tests in `build/generated`.

**On your own agent** a model has to read your prose, so you need an Anthropic API key. This model is called a **labeler**: it reads each sentence and says whether it is a rule. Create one in your Anthropic account (console.anthropic.com, under API keys). Then set it, and name the model that reads your prose, and swap the `--cassette` option:

```bash
export ANTHROPIC_API_KEY=<your key>
export ANTHROPIC_LABELER_MODEL=claude-haiku-5-5
driftbench estate build my-agent --out build --pointer --labeler system2:anthropic --cassette my-agent.cassette.jsonl --record
```

`--labeler system2:anthropic` picks the labeler: `system2` is the careful kind, a large model that reads each sentence (a `system1` labeler is a quick, cheap one that answers yes or no), and `anthropic` is who runs it. `--cassette my-agent.cassette.jsonl` is where its answers are kept, and `--record` writes them there, so the next run is free.

**Why you do this.** The example replays recorded answers, so it needs no key. Your own prose has no recording yet, so a model must read it once, and the cassette keeps what it said.

**If it goes wrong.** A message that names `ANTHROPIC_API_KEY` as missing: export the key in the same terminal, then run again. Any other error from the model: the scan stops and keeps what it has, and running again continues without repeating the answers already recorded.

  What `estate build` runs for you, in this order:

  - `estate scan northwind --out build/map.yaml --pointer --cassette ...`: reads your files into a **map**, a list of **atoms** · the folder, `--pointer` and `--cassette` as above; an atom is one thing the files tell the agent to do or to use, with a quote of where it says so · it produces `build/map.yaml` and `build/ledger.json`, the ids of your sentences.
  - `estate approve build/map.yaml --all --to build/approved.yaml`: **first question.** You approve the atoms that a model split out of your prose, so the tests are built on them · `--all` approves every atom, `--to` names the approved copy · it produces `build/approved.yaml`. If you say no, nothing is approved and the command stops, with the files so far kept.
  - `estate map build/approved.yaml --to build/space.yaml`: lists the situations a test can vary, such as the kind of ask or the state of the session · `--to` names the file · it produces `build/space.yaml`.
  - `estate plan build/approved.yaml --space build/space.yaml --out build/plan.yaml`: chooses which situations to test, so that every pair of situations is covered at least once · `--space` is the file above, `--out` the plan · it produces `build/plan.yaml`, with one row per test.
  - `estate plan approve build/plan.yaml --all`: **second question.** You approve the planned tests · `--all` approves every row · it updates `build/plan.yaml`. If you say no, no test is written and the command stops.
  - `estate generate --map build/approved.yaml --plan build/plan.yaml --out build/generated`: writes one test file per planned test · the three paths are the inputs and the output folder · it produces `build/generated`, with the tests and a report of what each incomplete test still needs.

**Look at and decide.** Run it without `--yes`. In a terminal it asks. Here there is no terminal, so it stops at the first question and tells you what to type:

```console
$ driftbench estate build northwind --out build --pointer --cassette northwind/cassette.jsonl   # exit 1
driftbench estate build northwind, into build
1. Read the estate: 116 atoms, 49 of them split from prose by a model and waiting for approval. Wrote build/map.yaml.
   The scan reported some refused labels or failed chunks; run with --verbose to read them.
Stopped before the first approval: 49 atoms were split from prose by a model and wait for your approval. Approve all 49?
Run again with --yes to approve them all, or approve some first with driftbench estate approve build/map.yaml --kind <kind> and run estate build again.
```

The question counts the atoms that wait. To read them before you answer, list them:

```console
$ driftbench estate approve build/map.yaml
build/map.yaml: 49 of 116 atoms wait for approval.
  instruction: 34
    instruction.inbox-triager.you-sort-messages-into-three-folders  .claude/agents/inbox-triager.md:8  "You sort messages into three folders: invoices, shipments..."
    instruction.inbox-triager.a-message-that-fits-none-goes  .claude/agents/inbox-triager.md:8  "A message that fits none goes to "other"."
Approve a kind with --kind <kind>, an atom with --atom <id>, or every atom with --all.
```

A good answer is yes when each atom restates a sentence of your files that you want tested. If some are wrong, approve only the good ones with `estate approve build/map.yaml --kind <kind>` or `--atom <id>`, and run `estate build` again. When you are happy, run it with `--yes`. The scan is not repeated, because its inputs did not change:

```console
$ driftbench estate build northwind --out build --pointer --cassette northwind/cassette.jsonl --yes   # exit 1
driftbench estate build northwind, into build
1. Read the estate: unchanged since the last run, map.yaml kept.
2. Approve the atoms: approved all, as --yes says. Wrote build/approved.yaml.
3. Map and plan: the plan holds 1439 tests, chosen so that every pair of situations is covered at least once. Wrote build/space.yaml and build/plan.yaml.
4. Approve the plan: approved all 1439 tests, as --yes says.
5. Write the tests: 1439 tests written. 952 are complete and 487 still wait for something (the report lists what).
```

**What you get.** The folder `build`, and a count of tests:

```text
1. Read the estate: 116 atoms, 49 of them split from prose by a model and waiting for approval. Wrote build/map.yaml.
3. Map and plan: the plan holds 1439 tests, chosen so that every pair of situations is covered at least once. Wrote build/space.yaml and build/plan.yaml.
5. Write the tests: 1439 tests written. 952 are complete and 487 still wait for something (the report lists what).
```

Read it like this: the map holds 116 atoms. The **plan** is the list of situations to test, chosen so that every pair of situations (a kind of question with a kind of session, say) meets at least once. It holds 1439 tests. 952 are complete. The other 487 still wait for something, such as an answer to give or a recorded session, and the report in `build/generated` says what each one needs. The command exits 1 while tests wait. That is expected.

**If it goes wrong.**

- `Cannot find northwind.` (exit 2): the folder name is wrong, or you are not in the folder that holds it. Check with `ls`, then give the right path.
- `Stopped before the first approval` or `Stopped before the second approval` (exit 1): this is not a failure. The command found nothing to ask in a terminal and stopped on purpose. Run it with `--yes`, or approve first as the message says.
- `The scan reported some refused labels or failed chunks` (the command exits 1): the map is written and the build went on. Some sentences were not turned into atoms. Run again with `--verbose` to read which ones, and reword those sentences if you want them tested.
- A message that names `ANTHROPIC_API_KEY` as missing (your own agent): export the key as shown above, and run again. The scan will not repeat what did not change.
- `5. Write the tests` says that many tests still wait: that is normal. The report in `build/generated` lists what each one needs, such as an answer to give.

## 2. See which tests cover one sentence

**Why you do this.** Before you trust the link between a sentence and its tests, look at one chain with your own eyes. Step 4 relies on it.


**What you have.** One sentence of the weekly report skill, on line 12 of its `SKILL.md`:

```console
$ grep -n "Count only" northwind/.claude/skills/weekly-report/SKILL.md
12:Count only what the ledger and the shipment log show for the last seven days. Read
```

**Relevant commands.**

- `grep -A8 "^  links:" <test file>`: shows the **links** of one test, which say what the test is about · `-A8` prints the 8 lines after the match; `"^  links:"` is the line to find; `<test file>` is the test to read, here the obligation test of the sentence · it prints the links.

```console
$ grep -A8 "^  links:" build/generated/specs/live/obligation/estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and.yaml
```

**You get and how to read it.**

```text
        kind: rule
        rule: instruction.weekly-report.count-only-what-the-ledger-and
        ledger: wrl4c7wlvb
      relation: verifies
      status: declared
```

Step 1 gave the sentence an id, `wrl4c7wlvb`, that stays the same when the sentence is edited. It also made the sentence the atom `instruction.weekly-report.count-only-what-the-ledger-and`. This test says it `verifies` that atom. The file is called `obligation`, which is one of three kinds of test written for each rule: an **obligation** test checks that the agent does what the rule says, an **outside_trigger** test is a control that checks the agent does not apply the rule where it should not, and a **twin** test asks for the same thing in other words. In all, 17 tests name this sentence; step 4 lists them. When you edit the sentence, driftbench follows this chain to find them.

<details><summary>Look at the id, the atom and the test itself</summary>

The id and the text of the sentence, in the file `build/ledger.json`:

```console
$ node -e 'const l=JSON.parse(require("fs").readFileSync("build/ledger.json","utf8"));const e=l.entries.find((x)=>x.id==="wrl4c7wlvb");console.log(JSON.stringify({id:e.id,fp:e.fp,path:e.path,status:e.status,quote:e.quote},null,2))'
{
  "id": "wrl4c7wlvb",
  "fp": "731c59e8e7713e95",
  "path": ".claude/skills/weekly-report/SKILL.md",
  "status": "live",
  "quote": "Count only what the ledger and the shipment log show for the last seven days."
}
```

The atom in the map, with its quote and where it sits:

```console
$ grep -B1 -A9 "id: instruction.weekly-report.count-only-what-the-ledger-and" build/map.yaml
  - id: instruction.weekly-report.count-only-what-the-ledger-and
    kind: instruction
    title: Count only what the ledger and the shipment log show for the last seven days.
    provenance:
      file: .claude/skills/weekly-report/SKILL.md
      startLine: 12
      endLine: 12
      quote: Count only what the ledger and the shipment log show for the last seven days.
      hash: 6fed6d234ad61539420fe7e424ee64104bd3d2065701ad8f40896728bc69158c
    producedBy: model
```

`producedBy: model` says that a model, not code, found this atom in prose, so you approved it in step 1. An atom that code read from a heading, a list or a settings file says `producedBy: code`, and needs no approval. `quote` and `hash` let driftbench check later that the sentence in your file is still the one the atom quotes.

The first three of the tests that name it:

```console
$ grep -rl -- "- instruction.weekly-report.count-only-what-the-ledger-and$" build/generated/specs/live | sort | head -3
build/generated/specs/live/obligation/estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and.yaml
build/generated/specs/live/obligation/estate.pairwise.0020.yaml
build/generated/specs/live/obligation/estate.pairwise.0064.yaml
```

The part of the first test that says what to do and what to expect. A **block** is one message from the user and what must be true after it:

```console
$ sed -n '/^blocks:/,/^metadata:/p' build/generated/specs/live/obligation/estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and.yaml
blocks:
  - id: ask
    when:
      user: Please help me with the weekly report or a summary of last week.
    expect:
      skills:
        - name: weekly-report
          count:
            min: 1
      workspace:
        deleted: []
      criteria:
        - instruction.weekly-report.count-only-what-the-ledger-and
metadata:
```

</details>

**If it goes wrong.**

- The `grep -A8` prints nothing: the test file is not there, or the sentence became no atom. Check that `build/generated` exists, then read the atoms of your sentence with `grep -n "Count only" build/map.yaml`. No match means the model did not call it a rule. Write the sentence as a plain instruction, such as "Count only what the ledger shows", and run `estate build` again.
- You are on your own agent: the id `wrl4c7wlvb` belongs to the example sentence. Your sentences have their own ids, which you find in `build/ledger.json`.

## 3. Connect your agent and run a test

**Why you do this.** A test only means something when it runs against an agent. This step shows what you must give driftbench to run your agent, and what a verdict looks like.


**What you have.** The test file from step 2. It starts a fresh session and says: "Please help me with the weekly report or a summary of last week." The agent must load the `weekly-report` skill, delete no file, and obey the rule.

**What you must provide.** A command that runs your agent **headless**, which means once, from the command line, with no window: it takes the question as input, does its work, and exits. You have three choices:

- A **stand-in**: a script that plays recorded answers in place of the agent. It calls no model and costs nothing. The example folder has one, and this walkthrough uses it.
- Your real agent: the command `claude`, which is Claude Code. Install it with `npm install --global @anthropic-ai/claude-code`, run `claude` once in your terminal and log in as it asks ([Claude Code setup](https://docs.claude.com/en/docs/claude-code/overview)). If `claude --version` prints a version, it works. It calls a model and costs money, so you add `--allow-billed` to say you accept that, and `--max-budget-usd` to cap what one test may spend. This is the whole command, with a real model name:

  ```bash
  driftbench estate run build/generated/specs/live/obligation/estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and.yaml --estate my-agent --runtime claude-code --command claude --allow-billed --model claude-haiku-5-5 --judge claude:haiku --judge-budget 1 --max-budget-usd 1 --store runs.db
  ```

  `--model claude-haiku-5-5` is the model your agent runs on, `--judge claude:haiku` is the model that reads the answers that code cannot check, `--judge-budget 1` caps what the judge may spend in dollars (the command refuses to start without it), and `--store runs.db` is the file where the run is kept. This is the real output of that command, run once on the example agent (the folder `northwind` in place of `my-agent`). It is not run by the tests, because it is billed:

  ```txt
  note: the estate copy is not pinned to a map hash; pass --map to pin it
  ✓ estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and  (0.0048 USD)
      judged instruction.weekly-report.count-only-what-the-ledger-and: pass
  1 spec run live: 1 pass, 0 fail. Cost 0.0048 USD over 1 run that report one, judge claude:haiku 0.0007 USD of it. Campaign estate-run-28387ff5fd82.
  ```

  The real agent passes where the stand-in failed. The run cost 0.0048 US dollars, of which 0.0007 was the judge. The `note` line is only a reminder that `--map` was left out. You do not need `--map` or `--states`. `--map` is only a safety check that the folder is the one you approved. `--states` is only for tests that start from a resumed session or another prepared state, and the example needs it only because its stand-in plays those.
- Not a Claude Code agent: use the [quickstart](quickstart.md), which connects a command, a function or an HTTP endpoint.

**Find a test file for your agent.** `estate run` takes the path of one test file. To list some from your own build, type this; it prints one path per line:

```bash
find build/generated/specs/live -name '*.yaml' | sort | head -5
```

The folder `obligation` holds one test per rule of your files, named after the rule. Pick one and give its path to `estate run`.

**Relevant commands.**

- `estate run`: starts the agent in a throw-away copy of your folder, sends the test's message and checks what the agent did · `<test file>` is the test to run; `--estate northwind` is your agent's folder, copied for the run; `--runtime claude-code` is the only runtime today; `--command northwind/live/fake/claude.mjs` is the program that stands in for the agent (for your agent it is `claude`); `--set-env "FAKE_MANIFEST=$PWD/northwind/live/fake/manifest.json"` hands the stand-in the file of its recorded answers; `--store original.db` is the file where the run is kept; `--map build/approved.yaml` checks that the copy is the folder you approved; `--states northwind/live/states/library.json` is a file of session states the stand-in plays · it prints one line per test and writes the run to `original.db`.

```console
$ driftbench estate run build/generated/specs/live/obligation/estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and.yaml --estate northwind --runtime claude-code --command northwind/live/fake/claude.mjs --set-env "FAKE_MANIFEST=$PWD/northwind/live/fake/manifest.json" --store original.db --map build/approved.yaml --states northwind/live/states/library.json   # exit 1
```

**You get and how to read it.**

```text
✗ estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and  (0.0000 USD)
    failing: block 0: skills.weekly-report, block 0: judge.instruction.weekly-report.count-only-what-the-ledger-and (inconclusive)
```

A ✗ means the test failed. The `failing:` line names each check that failed. Here the stand-in has no recorded answer for this question, so the agent never loaded the weekly report skill, and no judge was set to read its answer, so that check is **inconclusive**, which means it has no verdict. That is why this example fails. Nothing was spent, because the stand-in is a script. With your real agent you would use `--command claude --allow-billed --judge claude:<model>`.

**If it goes wrong.**

- `claude: command not found`: Claude Code is not installed, or not on your path. Run the install line above, open a new terminal, and check `claude --version`.
- `claude` asks you to log in, or answers with an authentication error: run `claude` by hand once and finish the login, then run the test again.
- `claude is not a stand-in: a live run of the real runtime is billed. Size it first, then pass --allow-billed.` (exit 2): you asked for a real agent. Add `--allow-billed` once you accept the cost, or use a stand-in.
- `a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>` (exit 2): add `--judge-budget` with a number of dollars, such as `--judge-budget 1`.
- Every test says `?` or `inconclusive`: no judge was set, so the checks that need one have no verdict. Add `--judge claude:haiku` and `--judge-budget 1`.
- A `✗` with `skills.weekly-report` in the `failing:` line: the agent did not load that skill. Read the skill's `description` in its `SKILL.md`: it must say when the skill applies.
- The run is slow or expensive: add `--max-budget-usd` to cap each test, and run one test first, as here.

## 4. Change a rule, and rerun only what it can affect

**Why you do this.** After an edit you want to know whether you broke something. Rerunning every test is slow and costs money. Rerunning only the tests the edit can reach is fast, and the saving is measured.


**What you have.** You edit one sentence of your prompt, from seven days to fourteen days:

```console
$ sed -i.bak 's/for the last seven days/for the last fourteen days/' northwind/.claude/skills/weekly-report/SKILL.md
$ grep -n "Count only" northwind/.claude/skills/weekly-report/SKILL.md
12:Count only what the ledger and the shipment log show for the last fourteen days. Read
```

**Relevant commands.**

- `radius ledger`: finds what you changed by the ids of step 1 and writes a **change file** · `build/map.yaml` is the map from step 1; `--ledger build/ledger.json` is the file of sentence ids; `--out change.yaml` is where the change file goes · it prints how many sentences changed and writes `change.yaml`.
- `radius`: reads the change file and the links of every test, and lists the tests the change can reach. That list is the **blast radius** · `build/generated/specs/live` is the folder of tests to look through; `--change change.yaml` is the change file · it prints the count and the list, and runs nothing.

```console
$ driftbench radius ledger build/map.yaml --ledger build/ledger.json --out change.yaml
$ driftbench radius build/generated/specs/live --change change.yaml
```

**You get and how to read it.** The output uses four words. A **block** is one test message with its checks. A **cell** is one test file run once. **Mode F** means the agent runs the whole conversation on its own replies. The **manifest** is a short id of the change file. First the count, then the list:

```text
Blast radius of 75b17123d007 to working (manifest 5bc3a5708b09): prompt:instruction.weekly-report.count-only-what-the-ledger-and.
918 specs, 921 blocks.
Mode F, free-running: 17 of 921 blocks in the radius (17 direct, 0 forward), 904 out. 17 of 918 cells.
  A cell reruns whole: 17 of 921 blocks sent, 98.2% saved; 901 of 918 cells left to carry.
```

Of 921 blocks, 17 can be reached by that sentence. The other 904 keep their last result, which saves 98.2%. Each test file here holds one block, so 17 blocks are 17 test files. The change file is the small file `change.yaml` that names what you changed. The list:

```text
In the radius, mode F:
  spec                                                                             blocks in  from  why
  estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and       1 of 1     ask   prompt:instruction.weekly-report.count-only-what-the-ledger-and
  estate.pairwise.0020                                                             1 of 1     ask   prompt:instruction.weekly-report.count-only-what-the-ledger-and
  estate.pairwise.0064                                                             1 of 1     ask   prompt:instruction.weekly-report.count-only-what-the-ledger-and
```

Read each row as one test file: its name, how many of its blocks are in the radius, and why. The `why` is the same for all of them: they name the sentence you changed. Three are named after the rule, the obligation, outside_trigger and twin tests of step 2. The other 14 are called `pairwise`: they are tests of the plan that cross this sentence with other situations. So the 17 blocks are 17 files, 3 named for the rule and 14 from the plan.

**Rerun them.** Write the 17 names into a file, count them, and run exactly those with the same `estate run` as in step 3. `--order` takes the file of names. `--map` is left out because the files changed since the map was written:

```console
$ grep -rl -- "- instruction.weekly-report.count-only-what-the-ledger-and$" build/generated/specs/live | sort > rerun.txt
$ wc -l rerun.txt
17 rerun.txt
$ driftbench estate run --order rerun.txt --estate northwind --runtime claude-code --command northwind/live/fake/claude.mjs --set-env "FAKE_MANIFEST=$PWD/northwind/live/fake/manifest.json" --store edited.db --states northwind/live/states/library.json   # exit 1
note: the estate copy is not pinned to a map hash; pass --map to pin it
✗ estate.obligation.instruction.weekly-report.count-only-what-the-ledger-and  (0.0000 USD)
    failing: block 0: skills.weekly-report, block 0: judge.instruction.weekly-report.count-only-what-the-ledger-and (inconclusive)
? estate.pairwise.0020  (0.0000 USD)
    failing: block 0: judge.instruction.weekly-report.count-only-what-the-ledger-and (inconclusive)
```

The summary says 17 ran, none passed, and 15 are undecided. A `✗` is a test that failed on a check, as in step 3. A `?` is a test that could not be decided, because it needs a judge and none was set. With the real agent and `--judge`, they would get a verdict. The other 904 blocks keep their last result. The [rule links walkthrough](../rule-links.md) shows how to prove each link by deleting the instruction.

**Rerun them on your own agent.** The same list, with the real agent and a judge, as in step 3. It is billed, so the judge cap and the test cap stay:

```bash
driftbench estate run --order rerun.txt --estate my-agent --runtime claude-code --command claude --allow-billed --model claude-haiku-5-5 --judge claude:haiku --judge-budget 1 --max-budget-usd 1 --store edited.db
```

**Why you do this.** A rerun without `--judge` leaves every judged check undecided (`?`), so the edit would look unproven. `--allow-billed` and `--judge-budget` are required for a real agent, as in step 3.

**If it goes wrong.**

- Every line of the rerun shows `?` or `inconclusive`: you left `--judge claude:haiku --judge-budget 1` out. Add both and run again.
- A refusal that names `--allow-billed` or `--judge-budget` (exit 2): add the one it names.
- `Units: ... 0 changed`: the edit did not change any sentence that the ledger knows. Check that you edited a file under the estate folder and saved it.
- `The radius is the whole suite` and `unit selection is advisory`: your edit hit a sentence that holds no atom, so driftbench cannot tell which tests it affects and keeps the whole suite. Nothing is skipped. Reword the sentence as an instruction so that it becomes an atom, then run `estate build` and `radius` again.
- The count in `rerun.txt` is not the count in the radius: the radius is the authority. Use the names of its list, and check that you ran the `grep` from the folder that holds `build`.
- Your own agent has no ledger: you left `--pointer` out of `estate build`. Run it again with `--pointer`, since step 4 needs the ids.
