# Check registry

One row per guard: the script, the event it runs on, the rules it enforces and the verdict it gives.

| Id | Guard | Event | Enforces | Verdict |
|---|---|---|---|---|
| G1 | block-force-push.sh | PreToolUse | R1 | deny |

## Checks by id

A guard may run several checks. Each check has its own id; the adapter is the part of the estate that
runs it, and the fires-when column quotes the rule it watches or names it by its id.

| Id | Adapter | Event | Fires when | Rollout |
|---|---|---|---|---|
| W1 | `block-force-push.sh` | PreToolUse | a command force-pushes, the R1 case | enforce |
| W2 | the push hook | PreToolUse | a command force-pushes a branch: "Never run `git push --force` on any branch" | observe |
| C2 | the reply judge | Stop | a reply asks more than one question, against R2 | observe |
| W3 | `claim-window.py` | Stop | a reply promises a refund: "Never promise the user a refund date" | enforce |
| `W4` `W5` | `claim-window.py` | Stop | a reply names a refund date: "Never promise the user a refund date" | observe |
| HANDBACK` / `STOP-WAKE | the reply judge | Stop | a reply hands back with more than one question, against R2 | observe |
| W6 | claim-window | Stop | a reply sets a refund date: "Never promise the user a refund date" | observe |
| W7 | force-push | PreToolUse | a force push, the R1 case | enforce |
| `W8` / `W9` hold | the reply judge | Stop | a reply holds two questions, against R2 | observe |
