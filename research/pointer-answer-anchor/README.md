# Pointer answer anchor: the draw records

These are the records behind the draw table of the anchor change: each labelled answer entry carries an anchor, and an answer that leaves a unit out is `units-missing`.

## What is here

| File | What it holds |
|---|---|
| `fixture.cassette.jsonl` | One fresh draw of `examples/estates/fixture`: every request key and answer, no text of a unit. |
| `reader-cases.cassette.jsonl` | One fresh draw of `examples/estates/reader-cases`. |
| `summary.json` | Per draw: the cassette sha256, the spend, and what a keyless replay of the cassette gives (unlabelled units, atoms, gate atoms, out-of-step codes). It also holds the units each label set's system 2 answers cover. |

## How they were made

- **Code:** the estate regeneration stack with #1359 (gate definitions, `unstable`) and #1357 (pointer chain head) merged, plus this branch.
  - The answers were recorded at the coverage fix (030456d46a).
  - The replay that fills `summary.json` ran at f352322d2a, where a run that leaves a unit out is still heard on the units it named.
  - The request text is the same at both heads, so the replay reads every answer from the cassette: `requestsSent` is 0 for both.
- **Command,** per estate, on the Mac, with the keys read in the process:
  `driftbench estate scan examples/estates/<estate> --runtime claude-code --pointer --cassette <estate>.cassette.jsonl --record --out map.yaml`
- **Replay:** the same command without `--record` and with no key.
  - The cassettes replay only on that merged stack: on this branch alone, the label set of #1359 and the request layout of the stack are missing, so each request misses.

## What they show

| Measure | fixture | reader-cases |
|---|---|---|
| Units unlabelled | 1 | 0 |
| Atoms | 118 | 62 |
| Units the gate-forms answers cover | 729 in 60 answers | 479 in 51 answers |
| Runs out of step | 5 `anchor-slipped`, 1 `units-missing` | 2 `units-missing` |
| Spend (USD) | 0.0763 | 0.0423 |

**Fixture gate atoms:**
- `gate.standing.read-before-edit-it` (R3)
- `gate.standing.read-claude-memory-memory-md-before`
- `gate.weekly-report.read-templates-report-md-before-writing`
- `gate.standing.read-git-status-before-commit-to` (R14)
- `gate.standing.read-claude-skills-invoice-reconcile-references`
- currency-table, matching-rules and reconcile.py

**Reader-cases gate atoms:**
- `gate.parcel-claims.read-references-supplier-languages-md-before`
- `gate.parcel-claims.read-scripts-track-sh-carrier-number`
- `gate.standing.read-claude-memory-memory-md-before`

## Oracle notes, as ruled by the lead

- **shipment-tracker "Always pass the carrier code to track.sh, as in `./scripts/track.sh NWX 123`":** a rule. It orders no read before an act. An earlier draw's gate-command reading was wrong.
- **The second gate atom of the parcel-claims unit "Run `./scripts/track.sh <carrier> <number>` first":** a duplicate, titled "before Run". The unit's own gate is built, so the duplicate is dropped.
- **shipment-tracker "For a damaged parcel, the claim follows `claim-rules.md`":** a gate by the definition ("the act done from the file or following it").
  - The model reads it as a reference, 5 of 5.
  - Definition and model disagree, and the item fails until the labeller reads the follow-the-file clause.
  - The oracle keeps the gate.
