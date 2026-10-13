# Live runs of the Northwind fixture, on a fake runtime

Everything here is fictional and written by hand. Nothing calls a model and nothing costs money.

- `fake/claude.mjs` is a stand-in for the runtime's headless command. It reads the ask from
  `-p <ask>` (or from its input with `--input-format stream-json`) and plays the recorded stream
  that `fake/manifest.json` names for that ask. Its first lines carry the stand-in marker, so
  `driftbench estate run` lets it run without `--allow-billed`.
- `fake/agent.mjs` plays an ask the manifest names no stream for. It derives a stream by code from the
  estate copy in its working folder: it routes the ask by the words it shares with a routing row or a
  unit's description, loads the skill (reading the files its body names and dispatching the helpers it
  names, and running the command it says to run, placeholders left out) or dispatches the helper, runs a
  command the ask spells out, reads a file before editing it when a standing rule says so, edits the file the ask names, walks the step list, and runs every hook the copy's
  settings declare on its tool calls. It knows nothing of any test or mutant.
- A recorded guard row or step row plays only while the copy still runs that guard or lists that step, as a
  runtime reading the copy would.
- `fake/streams/` holds the recorded streams. Besides stream records, a stream holds directives the
  fake performs: a guard row, a step row, a file write or a file edit in the workspace.
- A manifest entry can name `unless` cases. When the estate copy no longer holds a quote, the case's
  stream plays instead: the stand-in obeys the rules it can read. That is how an estate mutant
  changes its behaviour.
- `states/library.json` maps each session state and estate hazard of the space map to runner
  operations; `states/prefixes/` holds the recorded session prefixes they plant.

Two streams are planted faults: the misroute ask loads `supplier-email` instead of
`shipment-tracker`, and the carrier page ask calls `WebFetch`, which the settings deny.

Run the proof from the repository root:

```
pnpm -s driftbench estate run <the 14 specs> --estate examples/estates/fixture \
  --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs \
  --store <db> --map examples/estates/fixture/approved.yaml \
  --states examples/estates/fixture/live/states/library.json
```

The 14 specs are listed in `packages/cli/test/estate-live.test.ts`, one complete live spec per
test type of the generated suite.
