# Historical judge source

These files are verbatim snapshots from the commit in `manifest.json`.
Each entry records its original repository path and SHA-256. The offline
loader checks every hash before executing any snapshot and resolves judge
imports only inside this snapshot. It uses the repository lockfile for Zod
and TypeScript, and Node for cryptographic hashing.

The source remains under the repository MIT license. Do not format or
modernize these copies: changing a snapshot invalidates the historical replay.
