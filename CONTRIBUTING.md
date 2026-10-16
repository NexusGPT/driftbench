# Contributing

Merge through a `train/<n>` pull request: `train gate` must be required in branch protection. Ordinary PRs run `pr fast` (cached install, lint, typecheck, build, CLI smoke, and tests affected by the diff); train PRs and main pushes retain the full Node 22/24, Python 3.11/3.12, viewer, replay, leak guard, and validator checks. The `pr fast` job has an eight-minute timeout; its actual duration depends on the changed tests.
