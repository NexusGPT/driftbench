# The Northwind campaign

One campaign on the Northwind code-agent example (the fixture estate in `examples/estates/fixture`), run live on
Claude Code. Everything in it is fictional.

| Block feature | Where it shows |
|---|---|
| Parents | `specs/ledger-branches.yaml`: two blocks continue from one opening (`parent:`). |
| Personas | Four personas in `personas/`, each playing one spec with the answers of a recording (no simulator model, no cost on the user side). |
| Value check | `metadata.tool_schemas` gives the `Skill` tool an enum of the four skills; a wrong skill breaks the tool's stated contract. Other values compare as the value-check ladder decides. |
| Blame | Every spec lists `uses.diagnostics: [code-agent-liability]`, and `metadata.estate` names the estate map and the rules the spec tests, so a failing verdict gets a rule, a fault and a fix location. |
| Issues | The fix list of the report: the failing blocks grouped by where one change stops them. |
| Scorecard v2 | The page `driftbench report` writes. |

## Files

* `plugin.mjs` registers the `claude-code` adapter for `campaign run` (the CLI has no built-in one). It reads its
  settings from `NORTHWIND_*` variables and refuses a command that is not a stand-in unless
  `NORTHWIND_ALLOW_BILLED=1`.
* `driftbench.yaml` is the campaign: the four specs, four personas and recordings, `claude-code:northwind`, mode F,
  two repeats, a budget of 8 USD, the simulated driver.
* `specs/`, `personas/`, `personas/recordings/`.

## Commands

From the repository root. The first three make no model call.

```
pnpm driftbench --plugin examples/northwind-campaign/plugin.mjs spec validate examples/northwind-campaign/specs
pnpm driftbench campaign plan examples/northwind-campaign/specs --config examples/northwind-campaign/driftbench.yaml
pnpm driftbench campaign run --config examples/northwind-campaign/driftbench.yaml --campaign northwind-rehearsal --store out/rehearsal.db
```

The third runs on the stand-in runtime of the fixture. The live run uses the `claude` CLI, logged in, and costs
money:

```
NORTHWIND_COMMAND=claude NORTHWIND_ALLOW_BILLED=1 NORTHWIND_MODEL=claude-haiku-5-5 \
NORTHWIND_MAX_TURNS=15 NORTHWIND_MAX_BLOCK_USD=0.6 NORTHWIND_PERMISSION_MODE=acceptEdits \
pnpm driftbench campaign run --config examples/northwind-campaign/driftbench.yaml \
  --campaign northwind-live --store out/live.db --budget-usd 8
pnpm driftbench report northwind-live --store out/live.db --out out/live-scorecard.html
```

The workflow `.github/workflows/northwind-campaign.yml` does both: the rehearsal on every push to a
`train/*northwind*` branch, the live run by hand (`live: true`), after the rehearsal, capped by `spend-cap-usd`.

## What to expect

* The campaign budget (`--budget-usd`) stops new cells once the spend reaches it. Each block is also capped by
  `NORTHWIND_MAX_BLOCK_USD` and `NORTHWIND_MAX_TURNS`.
* The `ledger-auditor` helper of the fixture runs on Sonnet, so a cell that dispatches it costs more than the rest.
* The plugin turns on `branching` for the live adapter. A continuation of `ledger-branches` resumes its parent's
  turns as text (a tool call and its result are not part of a prefix) and starts from the parent's files. If the
  runtime refuses the seeded session, the continuation fails with the runtime's own error.
* The fix list of the report comes from the stored diagnoses (`report` builds it with the fix plan).
