# process adapter

Status: planned, phase 1.

The process adapter runs a code-interpreter agent as a command in a sandbox. It is the adapter for task specs: the agent writes and runs code, reads and writes files in a workspace, and loads skills. Its blocks go through the same runner, checks, judges and statistics as a conversation.

## Contract as designed

* The sandbox is a docker container per run by default. When docker is absent, a local temporary folder stands in, and the run is flagged as weaker isolation.
* The sandbox starts from the spec's workspace (`given.world.workspace`). A snapshot records the file list and a hash per file.
* `send` passes the task text to the agent command. The adapter captures stdout and stderr, the commands the agent ran when the agent exposes them, and the files it produced.
* When the agent exposes its runtime events, the adapter maps them onto skills, guards and stages: for Claude Code, its skills, its hooks and the process steps its harness logs. See [runtime vocabulary](index.md#runtime-vocabulary).
* After the block, the adapter diffs the workspace against the snapshot. The diff feeds the workspace check, and the files feed the artifact readers. See [checks](../reference/checks.md).
* Reads are bounded, so a runaway command cannot exhaust the run.
* Cleanup runs even when the agent fails. A flag keeps the sandbox for inspection.
* It passes the same contract tests as every adapter. See [adapters](index.md).

## Target

```yaml
target:
  adapter: process
  agent: office-agent
```

How the command line of the agent is set is fixed when the adapter ships.
