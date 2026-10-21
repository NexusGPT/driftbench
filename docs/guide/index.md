# The driftbench guide

This guide teaches driftbench by doing. Every part follows the same shape, so you always know where to look:

| Part of a step | What it tells you |
|---|---|
| Why | Why you do this step, in one or two sentences. |
| You need | What must exist before you start, with an example. |
| Relevant commands | One bullet per command: what it does, then each option and what you pass, then what it produces. |
| You type | The full command you can copy. |
| You see | Real output of that command, copied from a run. |
| How to read it | What each line means, and what a good result looks like. |
| If it goes wrong | The message you may see, and the exact fix. |

Every command in the guide is run by a test on GitHub, and every output shown is what the command printed. The one exception is the command that calls a billed model. It is run once by hand, its output is shown as recorded, and the page says so.

## Install

You need Node 22 or newer.

```bash
npm install @agent-nexus/driftbench
```

In your project, run the command as `npx driftbench`. In a clone of the repository, run `pnpm install`, and write `pnpm driftbench` where the guide says `driftbench`.

## Where to start

| You want to | Read |
|---|---|
| Test a small agent in two minutes, with no key | [Quickstart](quickstart.md) |
| Test your own agent from its files, run a test, change a rule, rerun only what it affects | [A walkthrough on your own agent](walkthrough.md) |
| Connect your agent, run it in three modes, repeat runs, play a simulated user and an attacker | [Run your agent](run-your-agent.md) |
| After an edit, rerun only the tests it can change, and carry the rest | [Rerun less](rerun-less.md) |

The pages below hold the detail of each area. They are the reference the guide links to. Each area gets its own guide part with the same shape:

| Area | Page |
|---|---|
| Write tests by hand | [Spec reference](../reference/spec.md), [blocks](../concepts/block.md) |
| Generate tests | [Generating tests](../generating.md) |
| Run your agent | [Running](../running.md), [adapters](../adapters/index.md) |
| Judge answers | [Judges](../concepts/judges.md) |
| Read the numbers | [Statistics](../concepts/statistics.md), [scorecards](../scorecards.md) |
| Rerun less | [Blast radius](../concepts/blast-radius.md) |
| Check driftbench itself | [Validators](../validators.md) |

## Words used in the guide

Each word is explained again where it first appears. This list is for looking one up.

| Word | Plain meaning | Example |
|---|---|---|
| Agent | A program that answers people or does a task, using a model. | A refund helper that answers "I want a refund". |
| Test, or spec | One file that holds a conversation and what you expect. | `refund.yaml`. |
| Block | One message from the user and what must be true after the agent's reply. | The user says "It is A-1042", and the agent must start the refund. |
| Given, When, Then | Where a block starts, what the user says, and what must be true after. | Given a fresh session, when the user asks for a refund, then the reply asks for an order number. |
| Check | A rule that code can test on a reply. | The reply must contain "order number". |
| Judge | A model that reads an answer when code cannot check it. | "Does the reply ask before it acts?" |
| Estate | The folder of files that define an agent: prompt, skills, helper agents, settings. | The Northwind folder. |
| Atom | One thing your files tell the agent to do or to use, kept with a quote of its line. | "Never run `git push --force`." |
| Map | The list of all atoms of an estate. | `build/map.yaml`. |
| Plan | The list of situations to test, chosen so that every pair of situations meets once. | `build/plan.yaml`. |
| Ledger id | An id of a sentence of your prompt that stays the same when you edit the sentence. | `wrl4c7wlvb`. |
| Blast radius | The tests that an edit can change. | 17 of 921 blocks. |
| Interval | The range a rate could really lie in, given how many tests you ran. | 50% with an interval of 23% to 77%. |
| Adapter | The piece that connects driftbench to your agent. | A function, a web address, a command. |
