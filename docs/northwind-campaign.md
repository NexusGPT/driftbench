# The Northwind campaign

One campaign tests a code agent on the fictional Northwind estate. It runs on Claude Code and uses most of the block framework: parents, simulated users, the value check, blame and the scorecard.

The files are in [`examples/northwind-campaign`](../examples/northwind-campaign/README.md). Four tasks come from the fixture estate in `examples/estates/fixture`. Everything in the example is fictional.

Status. Built: the rehearsal on a stand-in runtime, with no model call; the live run on Claude Code, which is billed and capped; the fix list in the report.

## What it shows

| Block feature | Where it shows |
|---|---|
| Parents | `specs/ledger-branches.yaml`: two blocks continue from one opening (`parent:`) |
| Simulated users | Four personas in `personas/`. Each plays one spec with the answers of a recording, so the user side costs nothing |
| Value check | `metadata.tool_schemas` gives the `Skill` tool an enum of the four skills. A wrong skill breaks the tool's stated contract |
| Blame | Every spec lists `uses.diagnostics: [code-agent-liability]`. `metadata.estate` names the estate map and the rules the spec tests, so a failing verdict gets a rule, a fault and a fix location |
| Fix list | The report groups the failing blocks by where one change stops them |
| Scorecard | The page `driftbench report` writes |

The campaign runs four specs, two repeats each: 8 cells and 22 blocks, in mode F, on the target `claude-code:northwind`.

## The files

* `plugin.mjs` registers the `claude-code` adapter for `campaign run`, because the command line has no built-in one. It reads its settings from `NORTHWIND_*` variables. It refuses a command that is not a stand-in unless `NORTHWIND_ALLOW_BILLED=1`.
* `driftbench.yaml` is the campaign: the specs, the personas and recordings, the target, mode F, two repeats and a budget of 8 USD.
* `agent/CLAUDE.local.md` is the Northwind instruction correction. It is seeded only in the fictional sandbox.
* `rehearsal/` holds the protocol recordings that the stand-in runtime plays.

## Check the specs and plan

The commands run from the repository root and make no model call.

```
pnpm driftbench --plugin examples/northwind-campaign/plugin.mjs spec validate examples/northwind-campaign/specs
pnpm driftbench campaign plan examples/northwind-campaign/specs --config examples/northwind-campaign/driftbench.yaml
```

The output, trimmed to its verdict lines:

```text
✓ examples/northwind-campaign/specs/invoice-over.yaml  northwind-invoice-over · 3 blocks · hash 71f3598178c1
✓ examples/northwind-campaign/specs/ledger-branches.yaml  northwind-ledger-branches · 3 blocks · hash a9cefc3c5715
✓ examples/northwind-campaign/specs/shipment-late.yaml  northwind-shipment-late · 3 blocks · hash 73fc9bb2a224
✓ examples/northwind-campaign/specs/weekly-report.yaml  northwind-weekly-report · 2 blocks · hash bddbd09e46d5
Checked 4 specs: 4 valid, 0 invalid, 0 warnings.
Plan: 4 specs, 1 target, mode F, 2 repeats: 8 cells, 22 blocks.
Projected cost: $0.00 (claude-code: no unit measured). Within the budget of $8.00.
```

## Rehearse

```
pnpm driftbench campaign run --config examples/northwind-campaign/driftbench.yaml --campaign northwind-rehearsal --store out/rehearsal.db
```

The run uses the recordings in `rehearsal/`, paired with the recorded users. They include the clarification question before the invoice facts are revealed. The output, trimmed to its verdict lines:

```text
✓ northwind-invoice-over · claude-code:northwind · F · repeat 0  pass  3 blocks
✓ northwind-invoice-over · claude-code:northwind · F · repeat 1  pass  3 blocks
✓ northwind-ledger-branches · claude-code:northwind · F · repeat 0  pass  3 blocks
✓ northwind-ledger-branches · claude-code:northwind · F · repeat 1  pass  3 blocks
✓ northwind-shipment-late · claude-code:northwind · F · repeat 0  pass  3 blocks
✓ northwind-shipment-late · claude-code:northwind · F · repeat 1  pass  3 blocks
✓ northwind-weekly-report · claude-code:northwind · F · repeat 0  pass  2 blocks
✓ northwind-weekly-report · claude-code:northwind · F · repeat 1  pass  2 blocks
8 cells: 8 pass, 0 fail, 0 failed. Spent $0.00.
```

The rehearsal checks the campaign, not the agent. A stand-in plays the agent, so a pass says the files, the personas and the checks fit together. The workflow `.github/workflows/northwind-campaign.yml` runs it on every push to a `train/*northwind*` branch that changes the example.

## Run it live

The live run is billed. Set the caps first.

```
export ANTHROPIC_API_KEY="$(cat "$HOME/.nexus-secrets/anthropic-driftbench.key")"
NORTHWIND_COMMAND=claude NORTHWIND_ALLOW_BILLED=1 NORTHWIND_MODEL=claude-haiku-5-5 \
NORTHWIND_MAX_TURNS=15 NORTHWIND_MAX_BLOCK_USD=0.6 NORTHWIND_PERMISSION_MODE=acceptEdits \
pnpm driftbench campaign run --config examples/northwind-campaign/driftbench.yaml \
  --campaign northwind-live --store out/live.db --budget-usd 8
pnpm driftbench report northwind-live --store out/live.db --out out/live-scorecard.html
```

`ANTHROPIC_API_KEY` is read from your own secret store. Its value is never written in a file of the repository or in a command line you share. The workflow can run the live job by hand (`live: true`) after the rehearsal, capped by its `spend-cap-usd` input. The live and probe jobs need a self-hosted runner that the repository does not provide, so run them from a developer machine.

* The campaign budget (`--budget-usd`) stops new cells when the spend reaches it. Each block is also capped by `NORTHWIND_MAX_BLOCK_USD` and `NORTHWIND_MAX_TURNS`.
* The `ledger-auditor` helper of the fixture runs on Sonnet. A cell that dispatches it costs more than the others.
* The plugin turns on `branching` for the live adapter ([Claude Code adapter](adapters/claude-code.md)). A continuation of `ledger-branches` resumes its parent's turns as text and starts from the parent's files.
* A tool call and its result are not part of a prefix. If the runtime refuses the seeded session, the continuation fails with the runtime's own error.

The output below is quoted from a real billed run, the campaign `northwind-live-mac-20261021T092359Z`. Its numbers come from the evidence file of this release, [`evidence/live-mac-2026-10-21.json`](../examples/northwind-campaign/evidence/live-mac-2026-10-21.json), and from the log of that run. It ran on macOS with Claude Code 2.1.306, Haiku 5.5 and the ledger-auditor's Sonnet 5.5, from source head `fdb00a1b13ec2b9c4b0e15764b565959c6a0f67b`. That run used a budget of 2.20 USD and one cell at a time, so its settings differ from the command above. The page does not re-run it.

```text
Campaign northwind-live-mac-20261021T092359Z: 4 cells, 1 at a time. Budget $2.20.
✓ northwind-invoice-over · claude-code:northwind · F · repeat 0  pass  3 blocks
✓ northwind-ledger-branches · claude-code:northwind · F · repeat 0  pass  3 blocks
✓ northwind-shipment-late · claude-code:northwind · F · repeat 0  pass  3 blocks
✓ northwind-weekly-report · claude-code:northwind · F · repeat 0  pass  2 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.10.
```

All four cells and eleven blocks passed, including both parent continuations, and the command exited 0. The runtime responses reported USD 0.09659879 for this campaign. The three attempts reported USD 0.256374935 together, against an authorization of 5 USD. The target was real and billed; the users played recordings.

## Read the fix list

`driftbench report` and `driftbench view` list the fixes of a campaign from its stored diagnoses. The fix plan groups the failing blocks by where one change stops them, and the scorecard ranks the fixes by the agent's failing blocks. See [scorecards](scorecards.md#two-scores).

A campaign with no failing block has no fix. The rehearsal above passes every cell, so its report lists none. The fix list appears when a block fails and its spec lists `uses.diagnostics`.

Limits: the run is one campaign on one fictional estate and one agent model. It shows that the pieces work together. It does not say how often a live agent breaks a rule.
