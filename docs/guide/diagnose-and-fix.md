# Diagnose and fix

This part teaches you to go from a failing test to the line you change. A pass rate tells you that something broke. It does not tell you where. You make a test fail on purpose, read its address, follow the link from the failing step to a section of the prompt, see which rule decided the verdict, change that rule and score the stored runs again, and read the fix list. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for.

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

**You need.** A test of the Acme sales assistant with four blocks: the customer asks for an order, gives a name, answers "ok perfect" at the recap, and then types CONFIRM. The second block demands the phrase "phone number" in the reply, which the assistant never says. The `links` at the end are used in step 4:

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

- `driftbench campaign run`: runs every block of the test against the agent and checks each answer · `specs` is the folder of tests; `--target function:acme-sales` is the Acme sales assistant; `--store runs.db` is the file that keeps the run, which the next steps read; `--campaign bad` names the campaign · it prints one line per cell and a count, and exits 1 when a cell fails.
- `driftbench campaign status`: reads a stored campaign and prints its cells · `bad` is the campaign; `--store runs.db` is the file to read · it prints the same lines as the run, and exits 1 while a cell fails.

**You type.**

```console
$ driftbench campaign run specs --target function:acme-sales --store runs.db --campaign bad   # exit 1
✗ acme-order-guide · function:acme-sales · F · repeat 0  fail  (pending)
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
$ driftbench campaign status bad --store runs.db   # exit 1
✗ acme-order-guide · function:acme-sales · F · repeat 0  fail  (pending)
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `✗ ... fail`: the cell failed. A cell is one test run once, here in mode F, where the agent runs the whole conversation on its own answers.
- `block 1 must.3` (pending) is the address of the failure. Blocks count from 0, so block 1 is `recap`. `must.3` is the fourth entry of its `must` list: `phone number`.
- A line can name several failures. Read the lowest block number first. In mode F every later block starts from the agent's own earlier answers, so later failures often follow from the first.

**If it goes wrong.**

- `No store at runs.db: this command reads a store and does not make one.` (exit 2): the path after `--store` is wrong, or the run did not store anything. Run from the folder that holds `runs.db`.
- `The store has no campaign bad.`: the campaign name is wrong. Names are case sensitive.
- The line starts with `!` and not `✗`: the run itself broke, for example the agent crashed. That is not a wrong answer. Fix the agent first.

## 2. Read the evidence

**Why you do this.** The address says where. The evidence says what was seen. Read it before you guess a cause.

**You need.** The campaign `bad` in `runs.db`.

**Relevant commands.**

- `driftbench campaign status --json`: prints every block of every cell with every verdict · `bad` and `--store runs.db` are as in step 1; `--json` prints one JSON document in place of the lines · each verdict holds an `id`, an `outcome` (`pass` or `fail`), whether it `gating` (a gating verdict can fail the block), and its `evidence`.

**You type.**

```console
$ driftbench campaign status bad --store runs.db --json   # exit 1
(pending)
```

**How to read it.**

- (pending)

**If it goes wrong.**

- (pending)

## 3. Find the first drift block and its class

**Why you do this.** Several blocks can fail for one cause. The first failing block, and the class of its mistake, tell you which cause to look for.

**You need.** The campaign `bad`.

**Relevant commands.**

- `driftbench campaign status --detail`: adds three tables to the status · `bad` and `--store runs.db` are as before; `--detail` adds the compounding index, the succession of each run and the recovery of each perturbed run · it prints the tables.

**You type.**

```console
$ driftbench campaign status bad --store runs.db --detail   # exit 1
(pending)
```

**How to read it.**

- (pending)

**If it goes wrong.**

- (pending)

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

**Relevant commands.**

- `driftbench radius sections init`: writes a first registry from the headings of the prompt · `mini.md` is the prompt; `--id mini` is the name that links use for this prompt; `--prompt-version v1` is the version the registry describes; `--out mini.sections.yaml` is the file to write · it writes the registry, with a position and a hash for each section.
- `driftbench radius sections check`: checks that the registry still matches the prompt · `mini.sections.yaml` is the registry; `--prompt mini.md` is the prompt · it prints a line and exits 0 when they match, and 1 when the prompt has changed since the registry was written.
- `driftbench spec lint --sections`: checks that every link of a test names a section the registry holds · `specs` is the folder of tests; `--sections examples/acme/prompts/acme-sales.sections.yaml` is the registry of the real Acme prompt, which has 30 sections · it prints one line per test and exits 0 when every link is valid.

**You type.**

```console
$ driftbench radius sections init mini.md --id mini --prompt-version v1 --out mini.sections.yaml
(pending)
$ driftbench radius sections check mini.sections.yaml --prompt mini.md
(pending)
$ driftbench radius sections check examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md
(pending)
$ driftbench spec lint specs --sections examples/acme/prompts/acme-sales.sections.yaml
(pending)
```

**How to read it.**

- (pending)

**If it goes wrong.**

- (pending)

## 5. Rank the suspect sections

**Why you do this.** With links in place, the failing blocks vote. A section that links to failing blocks and to few passing ones is the first place to look.

**You need.** The campaign `bad`, the tests it ran, and the registry.

**Relevant commands.**

- `driftbench radius localize`: ranks the sections of a prompt by how closely they follow the failures · `specs` is the folder of tests that the campaign ran; `--store runs.db` and `--campaign bad` name the campaign; `--sections` names the registry · it prints a table of sections with a score from 0 to 1 and exits 0, or exits 1 when nothing failed outside inherited failures.

**You type.**

```console
$ driftbench radius localize specs --store runs.db --campaign bad --sections examples/acme/prompts/acme-sales.sections.yaml
(pending)
```

**How to read it.**

- (pending)

**If it goes wrong.**

- (pending)

## 6. Ask the fault finder

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
    atoms: [instruction.standing.tell-the-user-about-a-late]
blocks:
  - id: late
    user: My shipment NW-55020 is three days late. What do I do?
    expect:
      must: ['late']
```

```console
$ driftbench campaign run fixes --target function:acme-sales --store runs.db --campaign late   # exit 1
(pending)
$ driftbench campaign status late --store runs.db --json   # exit 1
(pending)
$ driftbench report late --store runs.db --out late.html --json
(pending)
```

## 7. Rule files

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

```console
$ cd rules
$ driftbench object show check-set/acme
(pending)
$ driftbench object explain check-set --at specs/wording.yaml
(pending)
$ driftbench campaign run specs/wording.yaml --target function:acme-sales --agent-version acme-v1 --campaign full --store runs.db   # exit 1
(pending)
$ driftbench campaign export full --store runs.db --out export-full
(pending)
$ grep -rhoE '"object": ?"check-set:[^"]*"' export-full | sed 's/@[0-9a-f]*"/"/' | sort -u
(pending)
$ driftbench campaign rejudge specs/wording.yaml --from full --campaign acme --store runs.db --use check-set/acme
(pending)
$ driftbench campaign status acme --store runs.db
(pending)
$ driftbench campaign export acme --store runs.db --out export-acme
(pending)
$ grep -rhoE '"object": ?"check-set:[^"]*"' export-acme | sed 's/@[0-9a-f]*"/"/' | sort -u
(pending)
$ driftbench object list
(pending)
```
