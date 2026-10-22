# Live runs of the Northwind fixture, on a fake runtime

Everything here is fictional and written by hand. Nothing calls a model and nothing costs money.

- `fake/claude.mjs` is a stand-in for the runtime's headless command. It reads the ask from
  `-p <ask>` (or from its input with `--input-format stream-json`). By default, `fake/agent.mjs`
  derives its actions from the estate in its working folder (skills, helpers, settings and steps)
  and from the map it is handed, never from the words of a passage or of the ask. It is not a
  complete runtime or model. Its first lines carry the stand-in marker, so
  `driftbench estate run` lets it run without `--allow-billed`.
- The fake is handed the estate's structured definitions: `FAKE_MAP` names the approved map and
  `FAKE_PHRASES` the phrase bank (YAML or JSON); unset, they are the `approved.yaml` and `phrases.yaml` of this fixture, and `FAKE_MAP=none` gives the fake no map. `fake/dispatch.mjs` tells which atoms an ask sets
  off from structure only: an ask equal to a phrase of the bank sets off the atoms of its situation
  (not for `outside` and `near_miss`); an ask equal to the declared ask of an atom (`fields.ask`) sets off
  that atom. When `fake/grammar.json` exists (`FAKE_GRAMMAR` names another), an ask the generator rendered is
  matched with it exactly: one ask template of docs/estate.md section 5, each slot one act or situation
  text the grammar lists. Any other ask sets nothing off and is answered plainly.
  With `FAKE_MAP=none` nothing is set off.
- For the atoms it sets off, the fake does what they define in its copy: a route, a skill or a helper
  loads that unit; a rule written in a unit's folder loads its carrier; a reference is read; a reply
  atom gives the reply act it declares (`replyAct`, with the part it names); a guard is provoked, when
  the ask instructs the act it guards (a declared ask of the guard, or a `forced` situation), by the
  event its settings name, so that the script in the copy decides (an edit of a file not read, a reply
  longer than the length limit). An atom whose quote the copy no longer holds sets nothing off.
- A loaded skill does what its atoms in force declare (`unitPlan` in `fake/dispatch.mjs`): a reference
  is read at the path the map located, a script runs as the code span of its own line that names it,
  a `dispatches` link dispatches its helper. Actions keep the order of their lines, except where a gate
  (`ordered` evidence) puts its read or its command before the acts of a tool, or one call of a tool
  before another; a cycle stops the run as contradictory. A declared forbid case
  (`fields.unitCases`, `effect: forbid`) refuses the call it names, and one in a passage with a
  condition stops the run as unresolved. A line the map does not declare changes nothing, in any
  language.
- Set `FAKE_MANIFEST` to opt into recorded playback for protocol tests. `fake/manifest.json`
  maps asks to streams under `fake/streams/`; stream paths are relative to the manifest.
  Besides stream records, a stream holds directives the fake performs: a guard row, a step row,
  a file write or a file edit in the workspace.
- In playback mode, a manifest entry can name `unless` cases. When the estate copy no longer
  holds a quote, the case's stream plays instead. These cases require `FAKE_MANIFEST`;
  default execution derives the changed behaviour from the estate itself.
- `states/library.json` maps each session state and estate hazard of the space map to runner
  operations; `states/prefixes/` holds the recorded session prefixes they plant.

Two recorded streams are planted faults: the misroute ask loads `supplier-email` instead of
`shipment-tracker`, and the carrier page ask calls `WebFetch`, which the settings deny.

Run the recorded protocol proof from the repository root, opting into its manifest:

```
pnpm -s driftbench estate run <the 14 specs> --estate examples/estates/fixture \
  --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs \
  --set-env "FAKE_MANIFEST=$PWD/examples/estates/fixture/live/fake/manifest.json" \
  --store <db> --map examples/estates/fixture/approved.yaml \
  --states examples/estates/fixture/live/states/library.json
```

The 14 specs are listed in `packages/cli/test/estate-live.test.ts`, one complete live spec per
test type of the generated suite.

Omit `--set-env FAKE_MANIFEST=...` and leave `FAKE_MANIFEST` unset to use the default estate-derived
behaviour, and add `--set-env "FAKE_MAP=$PWD/examples/estates/fixture/approved.yaml"` and
`--set-env "FAKE_PHRASES=$PWD/examples/estates/fixture/phrases.yaml"` to give it the map and the bank.
The recorded faults and `unless` alternatives do not run in that mode.
