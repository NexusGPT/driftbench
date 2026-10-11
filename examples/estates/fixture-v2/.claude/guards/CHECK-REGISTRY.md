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
