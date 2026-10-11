# Reader cases

A small fictional estate for the Claude Code reader's tests. Each part holds one shape the reader once
missed; the README lists them. Northwind Traders and its carriers are invented.

## Rules

- **R1.** Never run `git push --force` on any branch.
- **R2.** Ask at most one question per reply.
- **R3.** Report a number only when you read it in a file or a tool result during this session.

## Routing

| When the user wants to | Load |
|---|---|
| file a claim for a damaged or missing parcel | `parcel-claims` |
| know where a shipment is | `shipment-tracker` |

## Process

A carrier claim and the month close follow their steps in `.claude/processes.json`. Read
`.claude/memory/MEMORY.md` at the start of every session.

The check registry is `guards/CHECK-REGISTRY.md`; claims follow `parcel-claims/references/claim-rules.md`.
