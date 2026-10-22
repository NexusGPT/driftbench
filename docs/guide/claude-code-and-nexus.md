# Claude Code and Nexus agents

This is a hands-on guide to two agents that run outside your own code: a Claude Code folder, and an agent on the Nexus platform. It runs the Claude Code folder on a stand-in, so nothing calls a model and nothing is paid for. Then it shows the command for the real agent, what that command needs, and how to cap what it spends. The Nexus agent needs a key and a live agent, so this page shows what it needs and what happens without them. Every command below is run by a test on GitHub, and every output shown is what the command printed. The commands that call a paid model or a live platform are in `bash` blocks and marked as not run by our tests.

## Before you start

**Why you do this.** Your agent may be a folder of instructions, skills and rules for Claude Code. It may be an agent built on the Nexus platform. driftbench reaches each through an adapter, and each adapter has its own needs.

**You need.**

- Node 22 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- The folder `examples/estates/fixture` of the repository. It is a made-up Claude Code folder for Northwind Traders, a fictional wholesaler of kitchen goods.

**Six words first.**

- An **estate** is the folder of a Claude Code agent: its `CLAUDE.md`, and the `.claude` folder with its skills, helper agents and settings.
- A **runtime** is the program that runs the agent. For a Claude Code folder, the runtime is Claude Code, started with the command `claude`.
- **Headless** means the runtime runs once from the command line, with no window. It takes one message, does its work and exits.
- A **stand-in** is a script that plays recorded answers in place of the runtime. It calls no model and costs nothing.
- A **billed** command calls a paid model, so the vendor charges the account behind it.
- A **cap** is a limit on what a run may spend, in US dollars.

**Which command runs my agent?**

| Your agent is | Command | What it needs |
|---|---|---|
| A Claude Code folder | `estate run --runtime claude-code` | The folder, a test file, and a command that starts the runtime: `claude`, or a stand-in |
| An agent on the Nexus platform | `campaign run`, with a spec whose target is `nexus:<agent id>` | `NEXUS_API_KEY`, the agent id and one of its deployment ids |

## 1. Look at the folder

**Why you do this.** driftbench runs your agent in a copy of this folder. You should know what is in it before you run it.

**You need.** The fixture folder. Its `CLAUDE.md` holds the standing instructions of the agent, as numbered rules.

**Relevant commands.**

- `ls examples/estates/fixture/.claude`: lists the folder of the agent · `examples/estates/fixture/.claude` is the folder Claude Code reads next to `CLAUDE.md` · it prints one name per line.
- `grep -n "^# \|^- \*\*R[13]\." examples/estates/fixture/CLAUDE.md`: prints the title of `CLAUDE.md` and its rules R1 and R3 · `-n` adds the line number · it prints three lines.

**You type and you see.**

```console
$ ls examples/estates/fixture/.claude
agents
guards
memory
settings.json
skills
steps.json
$ grep -n "^# \|^- \*\*R[13]\." examples/estates/fixture/CLAUDE.md
1:# Northwind ops assistant
9:- **R1.** Always answer in the language of the user's latest message.
11:- **R3.** Read a file before you edit it.
```

**How to read it.**

- `skills` holds one folder for each skill: `invoice-reconcile`, `shipment-tracker`, `supplier-email` and `weekly-report`. `agents` holds the helper agents the main agent can hand work to.
- `guards` holds scripts that run around a tool call. One of them refuses an edit of a file the agent has not read. `settings.json` wires them in and lists the tools the agent may not use.
- driftbench reads this folder to write tests from it. You can also write a test by hand. The [walkthrough](walkthrough.md) builds tests from a folder, step by step.

## 2. Run a test on the stand-in

**Why you do this.** This shows what a run prints, with no model and no cost. The stand-in plays the part of `claude`.

**You need.** Two test files, both generated from the fixture folder. The first checks that an ask about an invoice loads the `invoice-reconcile` skill. The second checks that the agent never calls `WebFetch`, because the settings forbid it. The recorded answers of the stand-in include a planted fault for the second one, so it fails on purpose. Without the recorded answers, the stand-in works the answer out from the folder, and both tests pass.

**Relevant commands.**

- `driftbench estate run`: starts the agent in a throw-away copy of your folder, sends each test's message to the runtime and checks what the agent did · `examples/estates/fixture/generated/specs/live/route_positive/...1.yaml` and `.../tool_denied/...deny-webfetch.yaml` are the two test files. `--estate examples/estates/fixture` is the folder to copy. `--runtime claude-code` is the only runtime today. `--command examples/estates/fixture/live/fake/claude.mjs` is the stand-in. For the real agent it is `claude`. `--set-env "FAKE_MANIFEST=..."` hands the stand-in the file of its recorded answers, which include the planted fault. `--store estate.db` is the file where the runs are kept. `--map examples/estates/fixture/approved.yaml` checks that the copy is the folder you approved · it prints one line per test and a count, and writes the runs to `estate.db`.

**You type and you see.**

```console
$ driftbench estate run examples/estates/fixture/generated/specs/live/route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml examples/estates/fixture/generated/specs/live/tool_denied/estate.tool_denied.tool.settings.deny-webfetch.yaml --estate examples/estates/fixture --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --set-env "FAKE_MANIFEST=$PWD/examples/estates/fixture/live/fake/manifest.json" --store estate.db --map examples/estates/fixture/approved.yaml   # exit 1
✓ estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1  (0.0000 USD)
✗ estate.tool_denied.tool.settings.deny-webfetch  (0.0000 USD)
    failing: block 0: forbidden.WebFetch
```

**How to read it.**

- A `✓` means every check of the test held. Here the agent loaded the skill the ask called for.
- A `✗` means a check failed. The `failing:` line names it. `forbidden.WebFetch` means the agent called a tool that the rules forbid.
- `(0.0000 USD)` is the cost of the run. The stand-in is a script, so it costs nothing.
- The last line counts the tests, says they ran on a stand-in and ends with a campaign id that changes at every run. The command exits 1 because one test failed.
- The command ran `examples/estates/fixture/live/fake/claude.mjs` in a copy of the folder, and your folder stays as it was. The copy is why a test can delete or edit files without harm.

**If it goes wrong.**

- `claude is not a stand-in: a live run of the real runtime is billed. Size it first, then pass --allow-billed.` (exit 2): the command you gave is not a stand-in. Step 3 shows the flag and the cap.
- A test says `?` or `inconclusive`: it needs a judge, and none was set. Add `--judge claude:claude-haiku-5-5` and `--judge-budget 1`, as step 3 shows.
- `The estate nothere is not a folder.` (exit 2): the path after `--estate` is wrong. Run from the root of the clone, or give the right path.
- `Fix the invalid specs first: nothing ran.` (exit 2): a test file is missing or malformed. The line above it names the file and the problem.

## 3. Run the real Claude Code

**Why you do this.** The stand-in proves that the test and the wiring work. Only the real runtime shows how your agent behaves.

**You need.**

- Claude Code, installed and logged in. The [walkthrough](walkthrough.md#3-connect-your-agent-and-run-a-test) gives the install line and the login. Those lines install third-party software, so our tests do not run them.
- Or an API key in the environment, passed on with `--pass-env ANTHROPIC_API_KEY`.
- A cap on the spend. A real run calls a model, so you add `--allow-billed` to say you accept the cost, and `--max-budget-usd` to cap what one test may spend.

Without `--allow-billed`, the command refuses a command that is not a stand-in. You can see that now, because the refusal comes before anything starts:

```console
$ driftbench estate run examples/estates/fixture/generated/specs/live/route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml --estate examples/estates/fixture --runtime claude-code --command claude --store refused.db   # exit 2
claude is not a stand-in: a live run of the real runtime is billed. Size it first, then pass --allow-billed.
```

**Relevant commands.**

- `driftbench estate run`: the same command as in step 2, with the real runtime · `--command claude` starts Claude Code. `--allow-billed` says you accept the cost. `--model claude-haiku-5-5` is the model the agent runs on. `--max-budget-usd 1` caps what each test may spend, in dollars. `--judge claude:claude-haiku-5-5` is the model that reads the answers that code cannot check. `--judge-budget 1` caps what all judge calls of the command may spend together · it prints one line per test and a count, with the cost.

**You type.** Not run by our tests, because the command is billed. Run it once by hand. It uses the cheapest model this guide recommends:

```bash
driftbench estate run examples/estates/fixture/generated/specs/live/route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml \
  --estate examples/estates/fixture --runtime claude-code --command claude --allow-billed \
  --model claude-haiku-5-5 --max-budget-usd 1 \
  --judge claude:claude-haiku-5-5 --judge-budget 1 --store real.db
```

**You see.** The output has the same shape as step 2. A real run costs money, so each `✓` or `✗` line carries a cost above zero. The last line gives the total and the part the judge spent. A live model answers differently each time, so your verdicts and numbers will differ. The [walkthrough](walkthrough.md#3-connect-your-agent-and-run-a-test) shows a real output, recorded by hand on its own example.

**How to read it.**

- `--max-budget-usd` stops one test at its cap. `--judge-budget` stops the judging at its cap. The command refuses to start a judge on a real runtime without `--judge-budget`.
- A test with a judged check and no `--judge` ends with `?`. The check has no verdict. That is not a failure of the agent.
- The runtime runs in a copy of your folder, and your files stay as they are. Tests that make the agent edit files edit the copy.
- To replay a recorded Claude Code session with no model at all, use `driftbench replay`. The [Claude Code adapter](../adapters/claude-code.md#driftbench-replay) page shows it.

**If it goes wrong.**

- `claude: command not found`: Claude Code is not installed, or not on your path. Install it, open a new terminal, and run `claude` by hand once.
- Claude Code asks for a login, or answers with an authentication error: run `claude` by hand and finish the login. Or pass an API key with `--pass-env ANTHROPIC_API_KEY`.
- `a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>` (exit 2): add `--judge-budget` with a number of dollars, such as `--judge-budget 1`.
- A `✗` that names `skills.<name>`: the agent did not load that skill. Read the skill's `description` in its `SKILL.md`. It must say when the skill applies.

## 4. Run a Nexus agent

**Why you do this.** An agent built on the Nexus platform runs on the platform's servers. The `nexus` adapter creates a test conversation there, sends each message, reads the reply and the trace, and deletes the conversation at the end.

**You need.**

- An API key of your Nexus account, in the environment variable `NEXUS_API_KEY`. The key never goes in a spec. The variable `NEXUS_BASE_URL` overrides the server, and it defaults to `https://api.nexusgpt.io`.
- The id of the agent, and the id of one of its deployments. A deployment is a channel the agent answers on.
- A stub for each tool that changes the world. The agent's tools run live when it answers, so point every such tool at a workflow that only records its inputs. The `options.stubs` setting of the target names them. This page's agent has no such tool.

This is the spec, `nexus-hello.yaml`. The ids are made up. Replace them with yours:

```yaml
# file: nexus-hello.yaml
id: nexus-hello
title: A Nexus agent greets a customer
target:
  adapter: nexus
  agent: agent-123
  deployment: dep-456
blocks:
  - user: Hi, who am I talking to?
    expect:
      must: ['Acme']
```

**Relevant commands.**

- `driftbench spec validate`: checks that the file is well formed, before anything runs · `nexus-hello.yaml` is the file to check · it prints one line per file and a count, and exits 0 when every file is valid.
- `driftbench campaign run`: runs the spec · `nexus-hello.yaml` is the spec. `--campaign nexus-1` names the campaign · it prints one verdict line per cell and a count. The target comes from the spec, so no `--target` is needed.

**You type and you see.** The spec is valid. Without a key, the run refuses to start, and nothing reaches the platform:

```console
$ driftbench spec validate nexus-hello.yaml
✓ nexus-hello.yaml  nexus-hello · 1 block · hash 0c08b2e9ada1
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
$ driftbench campaign run nexus-hello.yaml --campaign nexus-1   # exit 2
No adapter is set up for nexus:agent-123, the target of nexus-hello. A nexus target reads its key from NEXUS_API_KEY, which is not set. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec.
```

**How to read it.**

- `1 block` and `1 valid` mean the spec is well formed. They do not mean the agent exists. The platform answers that when the run starts.
- Exit 2 means a usage or input problem. The message names the missing variable, `NEXUS_API_KEY`.
- The target has more settings. The adapter page lists them. `variant` picks a prompt variant. `options.stubs` names the stub workflows. `options.keep_conversations` keeps the test conversations for you to read on the platform.

**You type with a key.** Not run by our tests. The command needs a key and a live agent, and the [Nexus adapter](../adapters/nexus.md) page says it has not yet run against a live agent. Set the key in your own terminal, with a value you do not paste into a file that git tracks:

```bash
export NEXUS_API_KEY=<your key>
driftbench campaign run nexus-hello.yaml --campaign nexus-1 --budget-usd 1 --store nexus.db
```

**Cap the spend.** `--budget-usd 1` is a hard stop: no cell starts once the campaign has spent 1 US dollar. It counts what the adapter reports for each block. If the run reports tokens and no dollars, supply a dated price table with `--prices <file>`, or the cap cannot see the spend. With a budget, driftbench refuses to start when a declared model has no price. The `driftbench help running-budget-and-prices` topic holds the format. Plan the run first with `driftbench campaign plan nexus-hello.yaml --budget-usd 1`. It prints the cells and a projected cost.

**If it goes wrong.**

- The message above, with exit 2: set `NEXUS_API_KEY` in the terminal where you run the command.
- `failed` with an `AgentFailure` that carries a code and a message from the platform: the platform refused the call. A wrong key, a wrong agent id and a deployment of another agent all end here. Check the three values.
- `failed` with an `AdapterTransportError`: no connection, a timeout, a 429 or a 5xx. driftbench retries under the shared policy, then fails the run. The [retries](../retries.md) page lists the policy.
- A block says `not_run`: a spec that starts from a recorded history, or that forces a tool result, cannot run on a `nexus` target. The platform cannot store an agent turn without generating it, and it cannot force a tool result.

## Where to go next

- The [walkthrough](walkthrough.md) builds tests from your own Claude Code folder and runs them, step by step.
- [Connect your agent](connect-adapters.md) connects a function, a web endpoint and a command.
- [Adapters for SDKs](sdk-adapters.md) connects an object built with an SDK.
- The [Claude Code adapter](../adapters/claude-code.md) and the [Nexus adapter](../adapters/nexus.md) pages list every option, and what each adapter reads from a run.
