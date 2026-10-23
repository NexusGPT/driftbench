# Diagnose and fix

This part teaches you to go from a failing test to the line you change. A pass rate tells you that something broke. It does not tell you where. You make a test fail on purpose and read its address. You follow the link from the failing step to a section of the prompt. You ask the fault finder where the fix goes. You see which rule decided a verdict, change that rule, and score the stored runs again. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for.

The examples use the Acme Telecom sales assistant that ships in `examples/acme`. All data is fictional. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.

## Words used in this part

| Word | Plain meaning | Example |
|---|---|---|
| Block | One message from the user, and what must be true after the agent answers. | The user says "ok perfect". |
| Check | A rule that code tests on the answer. | The reply must contain "CONFIRM". |
| Verdict id | The name of one check on one block. | `must.3` is the fourth entry of the block's `must` list. |
| Evidence | The sentence that says what was seen and what was expected. | `/phone number/ is missing`. |
| Address | The three things that name a failure: the block, the check and the evidence. | Block 1, `must.3`, `/phone number/ is missing`. |
| Drift | A block that fails. The first one is the **first drift block**. | `first drift 1`. |
| Drift class | The kind of mistake, from the family of the failing check. | `X1_local` is a wrong answer in this block. |
| Prompt section | A named part of the agent's prompt, with a stable id. | `recap`. |
| Section registry | A file that lists the sections of one prompt, with their position and a hash. | `acme-sales.sections.yaml`. |
| Link | A line in a test that says which prompt section a block tests. | Block `recap` tests section `recap`. |
| Suspect | A section that links to failing blocks. It is a place to look. It is not proof of a cause. | `recap`, with a score of 1.000. |
| Rule file | A small YAML file that sets how a check, a judge or a diagnostic works. | `driftbench/check-set/acme.yaml`. |
| Verdict stamp | The record on a verdict of which rule decided it, and which file set that rule. | `check-set:default`, layer `shipped`. |
| Re-score | Apply a changed rule to runs that are already stored. The agent is not called. | `campaign rejudge`. |
| Diagnosis | A note on a failed block that says who is at fault and where the fix goes. It never changes the verdict. | Fix the core prompt. |
| Fix list | The diagnoses of a campaign, grouped by where one change stops them, and ranked. | Rewrite one rule of the core prompt. |

## 1. Give a failure an address

**Why you do this.** "Test 7 failed" sends you hunting. A failure with an address (the block, the check, the evidence) sends you to one place. This step makes a test fail on purpose so you can read its address.

**You need.** A test of the Acme sales assistant with four blocks. The customer asks for an order, gives a name, answers "ok perfect" at the recap, and then types CONFIRM. The second block demands the phrase "phone number" in the reply. The assistant never says it. The `links` at the end are used in step 4:

```yaml
# file: specs/order.yaml
id: acme-order-guide
title: A home internet order that waits for CONFIRM
channel: chat
lang: EN
target: { adapter: function, agent: acme-sales }
ledger_seed:
  customer: new
  lang: EN
blocks:
  - id: address
    user: Hi, I'd like to order Acme Fiber 1000 for 14 Harbor Road, Acmeville.
    expect:
      tools:
        - { label: coverage.check, count: 1 }
      must: ['Acme Fiber 1000 is available', 'full name']
  - id: recap
    user: Jo Okafor, jo.okafor@example.com
    expect:
      tools:
        - { label: order.create, count: 0 }
      must: ['Jo Okafor', '14 Harbor Road', 'CONFIRM', 'phone number']
  - id: loose-yes
    user: ok perfect
    expect:
      tools:
        - { label: order.create, count: 0 }
      must: ['explicit go', 'CONFIRM']
  - id: confirm
    user: CONFIRM
    expect:
      tools:
        - { label: order.create, count: 1 }
      must: ['is placed']
metadata:
  links:
    - { block: address, to: { kind: prompt_section, prompt: acme-sales, section: home_address_first }, status: declared, created_by: author }
    - { block: recap, to: { kind: prompt_section, prompt: acme-sales, section: new_customer_details }, status: declared, created_by: author }
    - { block: recap, to: { kind: prompt_section, prompt: acme-sales, section: recap }, status: declared, created_by: author }
    - { block: loose-yes, to: { kind: prompt_section, prompt: acme-sales, section: explicit_confirm }, status: declared, created_by: author }
    - { block: confirm, to: { kind: prompt_section, prompt: acme-sales, section: explicit_confirm }, status: declared, created_by: author }
```

**Relevant commands.**

- `driftbench campaign run`: runs every block of the test against the agent and checks each answer · `specs` is the folder of tests. `--target function:acme-sales` is the Acme sales assistant. `--store runs.db` is the file that keeps the run, which the next steps read. `--campaign bad` names the campaign · it prints one line per cell and a count, and exits 1 when a cell fails.
- `driftbench campaign status`: reads a stored campaign and prints its cells · `bad` is the campaign; `--store runs.db` is the file to read · it prints the same lines as the run, and exits 1 while a cell fails.

**You type.**

```console
$ driftbench campaign run specs --target function:acme-sales --store runs.db --campaign bad   # exit 1
✗ acme-order-guide · function:acme-sales · F · repeat 0  fail  block 1 must.3
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
$ driftbench campaign status bad --store runs.db   # exit 1
✗ acme-order-guide · function:acme-sales · F · repeat 0  fail  block 1 must.3
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

The run also prints the list of checks it loaded, and the status prints the date of the campaign. They are left out here.

**How to read it.**

- `✗ ... fail`: the cell failed. A cell is one test run once, here in mode F, where the agent runs the whole conversation on its own answers.
- `block 1 must.3` is the address of the failure. Blocks count from 0, so block 1 is `recap`. `must.3` is the fourth entry of its `must` list: `phone number`.
- A line can name several failures. Read the lowest block number first. In mode F every later block starts from the agent's own earlier answers, so later failures often follow from the first.
- `1 cell: 0 pass, 1 fail, 0 failed`: a **fail** is a cell where a check failed. A **failed** cell is one where the run itself broke.
- The status reads the store. It prints what the run printed, and runs nothing.

**If it goes wrong.**

- `No store at runs.db: this command reads a store and does not make one.` (exit 2): the path after `--store` is wrong. Run from the folder that holds `runs.db`.
- `campaign status` exits 2 when the store holds no campaign, or the campaign id is unknown: check the name after `status`. Names are case sensitive.
- The line starts with `!` and not `✗`: the run itself broke, for example the agent crashed. That is not a wrong answer. Fix the agent first.

## 2. Read the evidence

**Why you do this.** The address says where. The evidence says what the check saw. Read it before you guess a cause.

**You need.** The campaign `bad` in `runs.db`.

**Relevant commands.**

- `driftbench campaign status --json`: prints every block of every cell with every verdict · `bad` and `--store runs.db` are as in step 1; `--json` prints one JSON document in place of the lines · each verdict holds an `id`, an `outcome` (`pass` or `fail`), whether it is `gating` (a gating verdict can fail its block), and its `evidence`.

**You type.**

```console
$ driftbench campaign status bad --store runs.db --json   # exit 1
          "blockId": "recap",
          "pass": false,
              "id": "must.2",
              "outcome": "pass",
              "evidence": "/CONFIRM/ matched \"CONFIRM\" at offset 139: \"...jo.okafor@example.com). Reply CONFIRM to place the order.\""
              "id": "must.3",
              "outcome": "fail",
              "gating": true,
              "evidence": "/phone number/ is missing; closest span \"Acme Fiber\", differs by 7 characters; visible text \"Here is your order: Acme Fiber 1000, 1000 Mbps for $60 a mon...\""
```

The document is long: one entry per block, and one verdict per check. Nine lines are shown. The block `recap` holds the verdicts `forbidden.order.create`, `must.0` to `must.3` and four `pii` checks.

**How to read it.**

- `"blockId": "recap"` and `"pass": false`: this block failed. The document lists the blocks in order, so look for the first `"pass": false`.
- `"id": "must.2"`, `"outcome": "pass"`: a check that held. Its evidence says what matched and where: the reply contained `CONFIRM`, at offset 139. Good evidence quotes the text it found.
- `"id": "must.3"`, `"outcome": "fail"`: the check that broke. `"gating": true` means it fails the block. A verdict with `"gating": false` is reported and never fails a block.
- `/phone number/ is missing`: the evidence names the pattern that was expected. The closest text it found, `Acme Fiber`, differs by 7 characters, so this is not a typo. The text is simply not there.
- `visible text "Here is your order: ..."`: what the agent said, cut to one line. Read it next to the expectation. Here the agent recaps the order, as it should. The fault is in the test, which demands a phrase the agent has no reason to say. A failing check can point at the agent or at the test.

**If it goes wrong.**

- The document is too long to read: pipe it to a file, then search for `"pass": false`. Each failing block holds its failing verdicts.
- `evidence` is cut with `...`: the line shows the nearest text only. The full conversation is in the scorecard (see [Read the numbers](read-the-numbers.md#4-read-the-scorecard)).

## 3. Find the first drift block and its class

**Why you do this.** Several blocks can fail for one cause. The first failing block, and the class of its mistake, tell you which cause to look for.

**You need.** The campaign `bad`.

**Relevant commands.**

- `driftbench campaign status --detail`: adds tables to the status · `bad` and `--store runs.db` are as before. `--detail` adds the compounding index (T minus F), the succession of each run and the recovery of each perturbed run · it prints the tables.

**You type.**

```console
$ driftbench campaign status bad --store runs.db --detail   # exit 1
Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec              mode  repeat  perturbation  blocks  first drift  drifts  rate   longest clean  all pass  classes
  acme-order-guide  F     0                     4       1            1       25.0%  2              no        X1_local 1
  No perturbed run.
```

The command also prints the status lines, the compounding index and the recovery table. The index needs a campaign that ran in modes T and F. The recovery table needs mode P runs. This campaign has neither, so those two tables say so.

**How to read it.**

- `first drift 1`: block 1 is the first block that fails. A **drift** is a failing block.
- `drifts 1` and `rate 25.0%`: one block of four failed. The rate is the share of failing blocks in this run.
- `longest clean 2`: the longest stretch of passing blocks in a row. Blocks 2 and 3 pass after the failure.
- `classes X1_local 1`: the class of each failing check. The class comes from the family of the check:

| Class | Checks that give it | Plain meaning |
|---|---|---|
| `X1_local` | `must`, `must_not`, `end_state`, `execution`, `workspace`, `artifacts`, `budget` | A wrong answer or action in this block. |
| `X2_contradiction` | `ledger` | A fact set earlier is contradicted. |
| `X3_flow` | `stage`, `flow` | A stage was skipped, repeated or left. |
| `X4_format` | `lang`, `cards`, `pii` | The wrong language, card or personal data. |
| `X5_tool` | `tools`, `forbidden`, `skills`, `guards`, `safety` | A tool was called wrongly or not at all. |

- One local mistake in one block, with the rest passing, often means a single wrong expectation or a single missing rule. A first drift at block 0 with every later block failing often points at the start of the conversation. The same class across many tests often points at one shared cause, such as a prompt rule.

**If it goes wrong.**

- `No spec ran in both T and F.` or `No perturbed run.` where you expected a table: the campaign did not run those modes. Run it with `--mode T,F,P`, as in the [running](../running.md#campaigns-in-t-f-and-p) page.

## 4. Link a block to a prompt section

**Why you do this.** A failing block says what the agent did wrong. A link says which part of the prompt is meant to prevent it. With links, a failure points to a section you can open.

**You need.** The prompt as a file, and a registry of its sections. A prompt in Markdown with headings is enough. This is a three-section prompt:

```markdown
# file: mini.md
## Persona
You are the Acme sales assistant. Keep replies short.

## Recap
Before any order, read the plan back and wait for the customer to say yes.

## Ordering
Call order.create only after the customer confirms the recap.
```

The test of step 1 already holds the links, in `metadata.links`. One line reads:

```yaml
- { block: recap, to: { kind: prompt_section, prompt: acme-sales, section: recap }, status: declared, created_by: author }
```

Find that line in the test file:

```console
$ grep -F -- "- { block: recap, to: { kind: prompt_section, prompt: acme-sales, section: recap }, status: declared, created_by: author }" specs/order.yaml
    - { block: recap, to: { kind: prompt_section, prompt: acme-sales, section: recap }, status: declared, created_by: author }
```

- `block: recap` is the block that carries the link.
- `to` names the section: `kind: prompt_section`, the prompt `acme-sales`, and the section id `recap`.
- `status: declared` says an author wrote the link. A mutation run can later mark it `verified` or `refuted`.
- `created_by: author` says who made it.

**Relevant commands.**

- `driftbench radius sections init`: writes a first registry from the headings of the prompt · `mini.md` is the prompt. `--id mini` is the name that links use for this prompt. `--prompt-version v1` is the version the registry describes. `--out mini.sections.yaml` is the file to write · it writes the registry, with a position and a hash for each section.
- `driftbench radius sections check`: checks that the registry still matches the prompt · the first argument is the registry; `--prompt` is the prompt file · it prints one line and exits 0 when they match, and 1 when the prompt has changed since the registry was written.
- `driftbench spec lint --sections`: checks that every link of a test names a section the registry holds · `specs` is the folder of tests; `--sections examples/acme/prompts/acme-sales.sections.yaml` is the registry of the real Acme prompt, which has 30 sections · it prints one line per test and a count, and exits 0 when every link is valid.

**You type.**

```console
$ driftbench radius sections init mini.md --id mini --prompt-version v1 --out mini.sections.yaml
3 sections, all global. Mark local the sections that reach only the blocks linked to them, and add references and overrides.
$ driftbench radius sections check mini.sections.yaml --prompt mini.md
mini v1: 3 sections match the prompt.
$ driftbench radius sections check examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md
acme-sales v1: 30 sections match the prompt.
$ driftbench spec lint specs --sections examples/acme/prompts/acme-sales.sections.yaml
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
```

The last command also prints a line for the test, with its name, its number of blocks and a hash of its content. It is left out here.

**How to read it.**

- `3 sections, all global`: `init` cannot know which sections are rules for one situation. A **global** section can reach every block, such as a persona or a language rule. A **local** section reaches only the blocks linked to it. Open the file and change `scope: global` to `scope: local` for the sections that fit.
- `mini v1: 3 sections match the prompt.`: the registry is true to the prompt. Run this after every edit of the prompt. If it fails, the registry is stale and its links lie.
- `acme-sales v1: 30 sections match the prompt.`: the registry that ships with the Acme example, checked the same way.
- `1 valid, 0 invalid, 0 warnings`: every link of the test names a section that the registry holds. A link to a section that does not exist is an error. A link to a section marked stale is a warning.

**If it goes wrong.**

- `radius sections check` exits 1 with one line per problem: the prompt changed after the registry was written. Re-anchor the registry on the new prompt with `radius sections reanchor`, described in the [blast radius](../concepts/blast-radius.md) page, or write a new one with `init`.
- `spec lint --sections` reports `LINK_TARGET_UNKNOWN` at `metadata.links.<i>.to`: the link names a section the registry does not hold. Fix the section id.
- `two section registries describe the prompt <id>` (exit 2): you passed two registries for one prompt. Pass one.

## 5. Rank the suspect sections

**Why you do this.** With links in place, the failing blocks vote. A section that links to failing blocks and to few passing ones is the first place to look.

**You need.** The campaign `bad`, the tests it ran, and the registry.

**Relevant commands.**

- `driftbench radius localize`: ranks the sections of a prompt by how closely they follow the failures · `specs` is the folder of tests that the campaign ran; `--store runs.db` and `--campaign bad` name the campaign; `--sections` names the registry · it prints a table of sections with a score from 0 to 1. It exits 0 with a ranking, or 1 when nothing failed outside inherited failures.

**You type.**

```console
$ driftbench radius localize specs --store runs.db --campaign bad --sections examples/acme/prompts/acme-sales.sections.yaml
Sections of acme-sales v1 by Ochiai suspiciousness, mode F, 1 suite run, grouped counting.
  4 block rows, failure weight 1.000, 0 inherited failures dropped (a passing block after a failing one stays a row).
  rank  section                  ochiai  failed  passed  blocks
  1-2   new_customer_details     1.000   1.000   0.000   1
  1-2   recap                    1.000   1.000   0.000   1
  16 more; --top 0 prints all.
  Failing roots: acme-order-guide#recap.
  Not ranked, global: identity, language, style, facts_from_tools. A global section reaches every block; only mutation can blame it.
```

The table has ten rows. Two are shown.

**How to read it.**

- `rank 1-2`: two sections tie for the first place. `recap` and `new_customer_details` are both linked to the block `recap` and to no other block.
- `ochiai 1.000`: the suspicion score. It is the Ochiai measure, which comes from finding faulty lines of code. It is high for a section linked to failing blocks, and low for a section linked to many passing blocks. 1.000 is the top.
- `failed 1.000`, `passed 0.000`: how much failing and passing weight the linked blocks carry. A section linked to the passing blocks `loose-yes` and `confirm`, such as `explicit_confirm`, scores 0.000.
- `4 block rows ... 0 inherited failures dropped`: all four blocks count. A failure that comes after an earlier failure of the same conversation is dropped, because the agent may have inherited it. Here there is none.
- `Failing roots: acme-order-guide#recap`: the failing block that the ranking starts from.
- `Not ranked, global`: global sections reach every block, so the links cannot tell which one failed.
- A suspect is a place to inspect. It does not prove the cause. In this test the section is innocent: the test asked for a phrase the assistant has no reason to say. Open the section and the evidence side by side, and decide.

**If it goes wrong.**

- `The store has no campaign bad.` (exit 2): the campaign name or the store is wrong.
- `Skipped run <id>: the spec <id> was not given.`: the folder after `localize` does not hold the test that the campaign ran. Pass the same folder.
- Exit 1 and every score 0: no block failed outside inherited failures. There is nothing to rank.
- Exit 2 for several modes: the campaign ran more than one mode. Add `--mode F`, for example.

## 6. Ask the fault finder

**Why you do this.** A failing check says what broke. The **fault finder** says who is at fault and where the fix goes. That can be the test, a tool, a skill or the core prompt. It reads the evidence the run stored. It runs after the checks and never changes a verdict.

**You need.** Three things:

- A test that asks for the fault finder with `uses.diagnostics`.
- The **estate map** of the agent: the list of rules its files hold, with the line of each (see step 1 of the [walkthrough](walkthrough.md)). The test names the map in `metadata.estate.map`. It names the rules it tests in `metadata.estate.atoms`.
- A failing block.

The Acme assistant is code, so it has no estate map. To stay offline, this example borrows rule R7 from the Northwind example estate. R7 reads "When a shipment is late by more than two days, tell the user and propose a supplier email". The Acme assistant sells phone plans and never mentions a late shipment. It breaks R7 as an agent that ignores the rule would. This is a demonstration of the mechanics. The path in `map` is read from the folder of the test:

```yaml
# file: fixes/late.yaml
id: northwind-r7-on-acme
title: A late shipment is reported to the user
channel: chat
lang: EN
target: { adapter: function, agent: acme-sales }
uses: { diagnostics: [code-agent-liability] }
metadata:
  estate:
    map: ../examples/estates/fixture/approved.yaml
    atoms: [instruction.standing.r7-when-a-shipment-is-late]
blocks:
  - id: late
    user: My shipment NW-55020 is three days late. What do I do?
    expect:
      must: ['late']
```

**Relevant commands.**

- `driftbench campaign run`: runs the test as in step 1 · `fixes` is the folder of this test; `--target function:acme-sales`, `--store runs.db` as before; `--campaign late` names the campaign · the run stores a diagnosis on the failing block. It calls no model.
- `driftbench report --json`: reads the campaign and prints the whole scorecard as JSON · `late` is the campaign. `--store runs.db` is the file to read. `--out late.html` is the HTML page, which also lists the fixes. `--json` prints the scorecard in place of the summary · the part `attribution.fixes` is the fix list, and each block holds its `diagnoses`.

**You type.**

```console
$ driftbench campaign run fixes --target function:acme-sales --store runs.db --campaign late   # exit 1
✗ northwind-r7-on-acme · function:acme-sales · F · repeat 0  fail  block 0 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
$ driftbench report late --store runs.db --out late.html --json
    "fixes": [
        "fixLocation": "agent.cross_skill",
        "fixTarget": "core:CLAUDE.md:15",
        "fixAction": "strengthen_rule",
        "agentBlocks": 1,
        "confidence": "static"
              "summary": "must.0: agent, agent; fix strengthen_rule at agent.cross_skill (core:CLAUDE.md:15)",
              "disposition": "agent",
              "fixForms": [
                "prose",
                "guard"
```

The JSON document is long. Eleven lines are shown, from two places: the fix list, and the diagnosis of the failing block.

**How to read it.**

- `"fixLocation": "agent.cross_skill"`: where the fix goes. `agent.cross_skill` is the core prompt of the agent, where a rule applies across skills. Other places are `test`, `env`, `tool.contract`, `skill.content`, `skill.trigger`, `skill.layout`, `agent.model`. The list is in the [blame reference](../reference/blame.md).
- `"fixTarget": "core:CLAUDE.md:15"`: the file and the line: the core prompt `CLAUDE.md`, line 15. That is the line where the Northwind estate states R7.
- `"fixAction": "strengthen_rule"`: what to do there. The agent could see the rule and broke it, so make the wording harder to miss, or enforce the rule with a guard.
- `"agentBlocks": 1`: how many of the failing blocks count against the agent. The fix list groups blocks that one change would stop, so a rule that fails in many places is one entry.
- `"disposition": "agent"`: whether the failure counts against the agent. `agent` and `shared` count. `setup`, `excluded` and `credited` do not. They cover a rule nobody wrote, an invalid test, or a result that works while the check demanded a form nobody states. A run with no rule that fits is `unassigned` and counted apart.
- `"confidence": "static"`: the diagnosis comes from the stored record alone. A confirm run, which could run the agent again to settle a doubt, is a library feature with a budget of 0 by default. The command line does not make it.
- `"fixForms": ["prose", "guard"]`: the fix can be a sentence in the prompt, or a guard in code that checks the rule.
- A diagnosis never turns a failed check into a pass. The machine verdict stays final.
- The HTML page `late.html` opens a zone named "Two scores". It shows the machine pass rate. It also shows the pass rate once failures that are not the agent's are set aside. The zone holds the ranked fix list. See [scorecards](../scorecards.md#two-scores).

**If it goes wrong.**

- The fix list is empty, or the page has no "Two scores" zone: no block failed, or the test has no `uses.diagnostics`. A campaign whose blocks hold no diagnosis has no fix list.
- The diagnosis is `unassigned`: no blame rule fits the failure. Read the evidence of step 2 and decide by hand.
- `metadata.estate.map` cannot be read: the path is read from the folder of the test, not from where you run the command. Check it with `ls`.
- A diagnosis is a place to look, not proof of the cause. Confirm it by changing the line and running the test again, as step 7 does for a rule.

## 7. Change a rule and score the run again

**Why you do this.** Every verdict comes from a rule, and the rule is a file you can read and change. Suppose a check is too strict for your project. You change the rule, and score the runs you already have. No agent runs, so it is fast and free, and the new score is exact for the same answers.

**You need.** A test, and a rule file that extends the shipped check set. The test asks for a phrase, "Thank you", that the assistant never says, so it fails. The project says that wording is judged another way, so its rule file turns off the `must` check. A rule file lives in `driftbench/<kind>/<id>.yaml`, beside a `driftbench.yaml`. This example puts everything in a folder `rules`:

```yaml
# file: rules/driftbench.yaml
plugins: []
```

```yaml
# file: rules/specs/wording.yaml
id: acme-wording
target: { adapter: function, agent: acme-sales }
blocks:
  - id: ask
    user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address', 'Thank you']
```

```yaml
# file: rules/driftbench/check-set/acme.yaml
kind: check-set
id: acme
extends: default
items:
  - id: must
    enabled: false
```

- `kind: check-set`: the kind of rule set. A check set lists the machine checks and their order.
- `id: acme` and `extends: default`: this set is called `acme`, and starts as a copy of the shipped set `default`.
- `items`: the changes. The item `must` is `enabled: false`. Every other check stays as the shipped set has it.

**Relevant commands.**

- `cd rules`: goes into the folder with the rule files · no options · every later command of this step runs from there.
- `driftbench object show`: prints a rule set with every item and the file that set it · `check-set/acme` is the set (`<kind>/<id>`) · it prints one line per item with its state and its layer.
- `driftbench object explain`: prints the rule set that one test uses, with the layer that set each item · `check-set` is the kind; `--at specs/wording.yaml` is the test (add `#<block>` for one block) · it prints one line per item.
- `driftbench campaign run`: runs the test under the shipped rules · `--agent-version acme-v1` labels the agent version; `--campaign full` names the campaign · it fails, because the reply lacks "Thank you".
- `driftbench campaign export`: writes a stored campaign as a folder of files · `full` is the campaign; `--out export-full` is the folder · each verdict in it carries its stamp.
- `grep -rhoE ... | sed ... | sort -u`: lists the rule set named in the stamps · `-r` reads every file of the folder. `-h` hides file names. `-o` prints only the match. `-E` reads the pattern as an extended expression. `sed` drops the content hash, which changes whenever the rule set changes. `sort -u` keeps one of each line · it prints the rule set that scored the verdicts.
- `driftbench campaign rejudge`: scores the stored runs again under another rule · `specs/wording.yaml` is the test; `--from full` is the campaign whose runs are read; `--campaign acme` names the new campaign; `--use check-set/acme` is the rule set to apply · it stores a new campaign and prints how many blocks it scored. It calls neither the agent nor a judge.

**You type.**

```console
$ cd rules
$ driftbench object show check-set/acme
  must                 disabled    project driftbench/check-set/acme.yaml:6
project driftbench/check-set/acme.yaml; extends check-set:default.
$ driftbench object explain check-set --at specs/wording.yaml
  must                 enabled     shipped
$ driftbench campaign run specs/wording.yaml --target function:acme-sales --agent-version acme-v1 --campaign full --store runs.db   # exit 1
✗ acme-wording · function:acme-sales · F · repeat 0  fail  block 0 must.1
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
$ driftbench campaign export full --store runs.db --out export-full
Exported campaign full to export-full/full: 1 runs, 1 specs, 0 sources.
$ grep -rhoE '"object": ?"check-set:[^"]*"' export-full | sed 's/@[0-9a-f]*"/"/' | sort -u
"object": "check-set:default"
$ driftbench campaign rejudge specs/wording.yaml --from full --campaign acme --store runs.db --use check-set/acme
Re-scored; observations from full.
Campaign acme: 1 blocks re-scored under check-set/acme; 0 agent calls, 0 judge calls.
$ driftbench campaign status acme --store runs.db
✓ acme-wording · function:acme-sales · F · repeat 0  pass (Re-scored; observations from full)  1 block
1 cell: 1 pass, 0 fail, 0 failed, 1 re-scored. Re-scored; observations from full. Spent $0.00.
$ driftbench campaign export acme --store runs.db --out export-acme
Exported campaign acme to export-acme/acme: 1 runs, 1 specs, 0 sources.
$ grep -rhoE '"object": ?"check-set:[^"]*"' export-acme | sed 's/@[0-9a-f]*"/"/' | sort -u
"object": "check-set:acme"
```

The `show` and `explain` commands print one line for each of the 41 items, with a header that holds a content hash. Only the lines that matter are shown.

**How to read it.**

- `must  disabled  project driftbench/check-set/acme.yaml:6`: the item `must` is off in the set `acme`, and the line says which file and line turned it off. `project` is the layer.
- `must  enabled  shipped` in `explain`: the test `wording.yaml` does not name the set `acme`, so it uses the shipped one. A rule file does nothing until a test, a block, the project or the command line picks it. Layers go from weak to strong: shipped, project, suite, spec, block, command line. A stronger layer wins, item by item.
- `fail  block 0 must.1`: under the shipped rules, the second `must` entry, `Thank you`, is missing.
- `"object": "check-set:default"`: the **stamp** of the stored verdicts. Each verdict records the rule set that scored it, the item, the implementation and the layer. The stored run says it was scored by the shipped set `default`.
- `Campaign acme: 1 blocks re-scored under check-set/acme; 0 agent calls, 0 judge calls`: the answers were read from storage. The checks ran again under the new rule. Nothing else ran.
- `pass (Re-scored; observations from full)`: the same answers now pass. The label says the result is a re-score of the campaign `full`, so nobody mistakes it for a fresh run.
- `"object": "check-set:acme"`: the new stamp. The verdicts of the re-scored campaign name the set that scored them.
- The two campaigns sit side by side in the store. The first one is untouched.

A rule change can move verdicts you did not aim at. One override in a study changed 36 aggregate verdicts outside its target. Read the whole re-scored campaign, not only the block you changed. The page [rule files](../innovations.md#rule-files-change-the-rule-and-score-the-run-again) gives the study.

**If it goes wrong.**

- `object show check-set/acme` does not list your set: the command looks for `driftbench/` beside the `driftbench.yaml` of the working folder. Run it from the folder that holds `driftbench.yaml`, here `rules`.
- `--use run-profile/fast` and similar (exit 2): the rule changes what the agent receives, such as a persona or a run profile. A re-score cannot do that. Run the agent again.
- The re-scored block still fails: the rule you changed is not the one that decided the verdict. Read the stamp of the failing verdict and change that item.
- You are unsure that a rule file is valid: `driftbench object validate` checks the object files of the folder. It refuses an unknown item id and lists the items of the parent set.

## 8. Where next

- Two ideas help you reproduce a failure. [Parent blocks](../innovations.md#parent-blocks-share-the-start-and-count-the-cause-once) start a block from the end state of another. [Personas](../innovations.md#personas-play-one-test-as-different-customers) play one test as different customers.
- The fault finder reads 46 named pieces of evidence and ships its blame and placement rules as files. The [blame reference](../reference/blame.md) lists them all, and the [Northwind campaign](../northwind-campaign.md) runs the fault finder on a code agent.
- After a fix, rerun only the tests that the change can reach: [blast radius](../concepts/blast-radius.md).

## What you have at the end

- `runs.db` in the working folder: the campaigns `bad` and `late`. `rules/runs.db`: the campaigns `full` and `acme`.
- `mini.sections.yaml`: a section registry written from a prompt.
- `late.html`: a scorecard with the fix list.
- An address for a failure: block, check and evidence. A list of suspect sections. A diagnosis with a fix line. A rule change scored again with no agent call.
