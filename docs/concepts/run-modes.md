# Run modes

One spec runs three ways, whether it describes a conversation or a task. Each mode answers a different question about the same blocks.

| Mode | What block k starts from | What it isolates | Status |
|---|---|---|---|
| T, teacher-forced | the spec's own earlier blocks, as written | local competence: each block alone, with no earlier error carried in | planned, phase 3 |
| F, free-running | the agent's own earlier output, with the user turns scripted | compounding: one wrong block can poison the blocks after it | planned, phase 1 |
| P, perturbed | a free-running run with a deviation injected at a chosen block | recovery: whether the agent comes back, how fast, and at what cost | planned, phase 3 |

Run records carry the mode as `T`, `F` or `P`.

## Teacher-forced

Each block opens from its canonical Given: the prefix is the spec's earlier blocks, taken as accepted. Blocks become independent samples. A block run N times from its Given gets its own pass rate, free of the blocks before it.

## Free-running

One session runs the whole conversation. The user turns come from the spec; the agent's turns are its own, and each block inherits them. An early mistake stays in the context of every later block.

## Perturbed

A free-running run with one deviation injected before a chosen block. Recovery metrics are on. See [recovery](recovery.md).

## The compounding index

Run the same spec in T and in F mode. The compounding index is the T pass rate minus the F pass rate, over the blocks both runs share. High T with low F means the agent is right block by block and fragile across the succession. Only F shows it. Planned, phase 3.

## Tasks run in the same three modes

* T: each step starts from its own Given: the workspace the spec sets for that step in `given.world.workspace`, and the earlier steps as written.
* F: each step starts from the workspace the agent itself left behind.
* P: a deviation is injected into the task, such as a workspace file that carries an instruction or a command that fails. Planned, phase 3.

## Around the modes

These parts of the runner serve every mode. All are planned, phase 1.

* Repeats: a campaign runs each spec several times in each chosen mode. One run proves nothing; [statistics](statistics.md) turns repeats into claims.
* Cache: an observed block is reused when the spec version, the block, its Given, the target and the adapter version are the same. Teacher-forced runs and judge re-runs read from it.
* Budget: a hard stop on cost. A spec whose first two free-running repeats both fail a gating machine check stops early.
* Determinism: a smoke command runs a spec three times with the cache off and reports whether the transcripts differ.
* Resume: a campaign started again with the same id reuses the runs already done.
* Retries: transport errors are retried with backoff. A run the agent fails is recorded as failed, never skipped.
