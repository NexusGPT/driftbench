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

Every command in the guide is run by a test on GitHub, and every output shown is what the command printed. A few outputs are marked as recorded on the page, with how they were made. They are the commands that call a billed model (run once by hand), and the `validate stats` run (a GitHub runner, with its run id). A command that never ends, such as a server, is shown without output and marked as not run. So is a command that takes minutes, such as a full ladder.

## Install

You need Node 22.13 or newer, git and pnpm 10 (`corepack enable` turns pnpm on).

```bash
git clone https://github.com/NexusGPT/driftbench.git
cd driftbench
pnpm install
pnpm build
cd packages/cli && npm link && cd ../..
driftbench --version
```

- `pnpm install` fetches the code the tool needs.
- `pnpm build` compiles it. It takes a few minutes the first time.
- `npm link` makes the command `driftbench` available in every folder. The last line prints its version.

Every command in the guide starts with `driftbench`, and you type it exactly so. Run the commands that read `examples/` from the root of the clone. The npm package `@agent-nexus/driftbench` catches up at the next release. Until then, use the clone.

**If it goes wrong.**

- `pnpm: command not found`: run `corepack enable`, then open a new terminal.
- `driftbench: command not found` after `npm link`: the folder of global npm commands is not on your path. Run `npm prefix --global`. Add its `bin` folder to your `PATH`.
- `Cannot find module` when you run `driftbench`: the build did not finish. Run `pnpm build` again in the root of the clone.

## Where to start

| You want to | Read |
|---|---|
| Test a small agent in two minutes, with no key | [Quickstart](quickstart.md) |
| Test your own agent from its files, run a test, change a rule, rerun only what it affects | [A walkthrough on your own agent](walkthrough.md) |
| Write a test by hand, check it, run it, and read a failure | [Write tests by hand](write-tests.md) |
| Let driftbench write tests from a map of situations, see what they cover, and keep the useful ones | [Generate tests](generate-tests.md) |
| Connect your agent, run it in three modes, repeat runs, play a simulated user and an attacker | [Run your agent](run-your-agent.md) |
| Hand a question to a judge, and decide whether the judge deserves your trust | [Judge answers](judge-answers.md) |
| Read the pass rate with its interval, compare two versions of an agent, and gate a pull request | [Read the numbers](read-the-numbers.md) |
| Find where a failure comes from, change a rule, and score the stored runs again | [Diagnose and fix](diagnose-and-fix.md) |
| After an edit, rerun only the tests it can change, and carry the rest | [Rerun less](rerun-less.md) |
| Check that driftbench itself reports the truth | [Prove the evaluator](prove-the-evaluator.md) |
| Build a spec one field at a time, from the smallest valid file to a rich one | [Spec fields](spec-fields.md) |
| See each kind of check pass and fail on a tiny agent, and read how a failing check names itself | [Checks](checks.md) |
| Turn a table of rows into many specs, keep them as a versioned dataset, and plan the rows from a variable store | [Variables and datasets](variables-and-datasets.md) |
| Know every command family, find help, pass options and read exit codes | [The command line](command-line.md) |
| Set how driftbench reads your agent's folder, key by key, and check the file | [Estate settings](estate-settings.md) |
| Plan, run, read and resume a campaign, with repeats, budgets and retries | [Campaigns](campaigns.md) |
| Connect a function, a web endpoint or a command to driftbench | [Connect your agent](connect-adapters.md) |
| Hand an object built with an SDK to driftbench | [Adapters for SDKs](sdk-adapters.md) |
| Run a Claude Code folder or a Nexus agent, and cap what the run spends | [Claude Code and Nexus agents](claude-code-and-nexus.md) |
| Load your own check or adapter, and see the shipped red-team plugins | [Plugins](plugins.md) |
| Run specs from a Python script and from pytest, with a Python function or script as the agent | [Python](python.md) |
| Run a spec inside a vitest suite, one test per block, and compare it with `campaign run` | [Vitest](vitest.md) |
| Read what an agent did, turn a trace into a draft test, replay a session against a new rule | [Traces](traces.md) |
| Write a scorecard, browse runs in the local viewer, label a block by hand | [The viewer and scorecards](viewer.md) |

The reference pages below hold the detail of each area. Each guide part above links to them.

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
| Blast radius | The tests that an edit can change. | 16 of 1251 blocks. |
| Interval | The range a rate could really lie in, given how many tests you ran. | 50% with an interval of 23% to 77%. |
| Adapter | The piece that connects driftbench to your agent. | A function, a web address, a command. |
| Stage | A step of the conversation that your agent goes through, named in the spec. | `address`, then `offer`, then `recap`. |
| Session state | Where the conversation stands when a test starts. | `resumed`, or `after_compaction`. |
| State library | A file that tells driftbench how to put the agent in each session state. | `northwind/live/states/library.json`. |
| Prefix | The earlier messages that a block starts after. | Two messages before the block. |
| `must` and `must_not` | Phrases the reply has to contain, and phrases it must not contain. | `must: ['order number']`. |
| Campaign | One run of a set of tests, kept in a store under an id. | `estate-run-d0c1fe2d38a8`. |
| Perturbation | A surprise that driftbench injects at one step of a conversation. | `D2_goal_shift`, a user who changes the goal. |
| Stand-in | A script that plays recorded answers in place of the agent. It costs nothing. | `northwind/live/fake/claude.mjs`. |
| Labeler | A model that reads your prose and says which sentences are rules. | `system2:anthropic`. |
| Seeder | A method that writes one family of tests from a map. | `twise`, which covers every pair of values. |
| Cell | One test file run once. | 16 of 1248 cells. |
| Mode F | The agent runs the whole conversation on its own replies. | `Mode F, free-running`. |
