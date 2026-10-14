# Fable comparison archive

The reports consume recorded result summaries. Reproduction does not require model calls or credentials.

From the repository root:

```sh
node --import tsx comparisons/inspect/hard/fable/export-recordings.mts
node --import tsx comparisons/inspect/hard/fable/export-recordings.mts --check
node --import tsx comparisons/inspect/hard/fable/report.mts heldout-480
node --import tsx comparisons/inspect/hard/fable/report.mts heldout-panel
```

The exporter restores seven call partitions and fifteen result-summary JSON files listed in [the SHA-256 manifest](recordings-manifest.json). It reads their pinned historical git blobs first. If those blobs are unavailable, as in a shallow clone, it retrieves the same commit from GitHub's public raw endpoint. Use `--remote` instead of the first command to force public retrieval. `--check` verifies already materialized files without network access or writes.

Every source and output must match its manifest byte count and SHA-256. An existing output is retained if identical; only a known, hash-verified historical source copy may receive the transport metadata migration. Any other differing file causes an error instead of an overwrite.

These exact generated paths are ignored and absent from the current tracked tree. Historical recording bytes remain in git history at `910da11f90c0bab7d525033d0010f890cc38f701`. No recording size limit is widened. Frozen case files remain tracked and byte-identical. Recorded answer fields remain unchanged. Result-summary bytes are identical to the pinned source; only previously missing call transport metadata is added. [Transport provenance](transport.md) documents attribution and unknown handling. Parity artifacts remain tracked and are not part of this export.

## Historical answer replay

`report.mts` only reads recorded summaries and frozen cases. It does not rejudge answers. Running the historical answer decoder or judge harness against today's product package is a different operation: it requires the historical judge package identified by the run's `judgeCommit` and `judgeSha256`. The product fixes used during the panel experiment are not shipped by this comparison correction. Do not interpret current-package replay differences as changes to the preserved recorded answers.
