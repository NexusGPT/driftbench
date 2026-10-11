# Check registry

One row per guard: the script, the event it runs on, the rules it enforces and the verdict it gives.

| Id | Guard | Event | Enforces | Verdict |
|---|---|---|---|---|
| G1 | block-force-push.sh | PreToolUse | R6 | deny |
| G2 | read-before-edit.py | PreToolUse | R3, R5 | deny |
| G3 | ledger-guard.py | PostToolUse | R4 | warn |
| G4 | stop-word.sh | UserPromptSubmit | R10 | nudge |
| G5 | check-carrier.sh | PreToolUse | "Always pass the carrier code to track.sh" | deny |
| G6 | supplier-send-guard.py | PreToolUse | R2 | deny |

## Checks by id

A guard may run several checks. Each check has its own id; the adapter is the part of the estate that
runs it, and the fires-when column quotes the rule it watches or names it by its id.

| Id | Adapter | Event | Fires when | Rollout |
|---|---|---|---|---|
| W1 | `stop-word.sh` | UserPromptSubmit | the prompt is one stop word, the R10 case | enforce |
| W2 | the ledger hook | PostToolUse | a command removes a ledger file: "move it to `ledger/archive/` instead" | observe |
