# Declare an agent setup and inspect it

`driftbench doctor <folder>` inspects a folder without running its scripts or calling a model. It uses the
registered estate readers. Each detected claim has a confidence and file evidence. A draft records the
runtime, sources, policies and content fingerprints; unknown files and skipped inputs remain visible.

```sh
pnpm driftbench doctor examples/estates/fixture --json
pnpm driftbench doctor examples/estates/fixture --write driftbench.setup.yaml
pnpm driftbench doctor examples/estates/fixture --check
```

The second command creates a private draft exclusively: it refuses to overwrite any file. Review it before
using it as your declaration. The third command compares the folder with that saved baseline and exits 1
when a file was added, removed or changed. Changing content at the same path is drift too. Relocating the
whole folder or adding ignored junk does not change the baseline. Exit 2 means invalid input or an
unavailable file. Inspection alone exits 0 even when it discovers unknowns: read the coverage status.

## The setup file

`driftbench.setup.yaml` is YAML or JSON, version 1. Every section below is required except `types`,
`bindings`, `budget.pricing` and `drift`. Unknown keys, duplicate YAML keys and contradictory policies fail
validation. This example uses only fictional paths and roles.

```yaml setup
version: 1
runtime: claude-code
sources:
  - id: project
    path: .
    kind: project
    reader: claude-code
roles:
  reviewer:
    aspects: [guards, informs]
types:
  audit-script:
    extends: script
    locate: checks/*.py
scope:
  include: ['**']
  exclude: []
execute:
  policy: never
  commands: []
budget:
  usd: 0
  modelCalls: 0
privacy:
  model: deny
  exports: metadata
  exclude: ['private/**']
```

`runtime` names a registered host profile. A draft with no runtime evidence says `runtime: null` and
`reader: unknown`; choose a reader before treating its coverage as complete. Multiple detected runtimes
need an explicit declaration. `roles` declares aspect sets by role name; doctor never guesses a role from
prose. See the [estate model](estate-model.md) for the fixed aspects and all part-type fields.

`sources[].types` goes through the existing `parseTypes` loader against that source reader's built-in
types and source-relative roots. Top-level `types` is shorthand for the project source only. Names are
scoped by `(source id, type name)`: an `.agents` source's `skill` never inherits Claude Code's
`.claude`-relative locator. `extends`, contained types, structured field reads and validation errors retain
the standalone loader's semantics. Coverage uses each source's own resolved set. An unknown reader has
empty built-ins, never the host profile's types. A type-covered file the runtime reader
cannot read is explicitly skipped; declaring a type alone never claims the reader read it.

## Sources and deployments

Each source has a unique `id`, a `path`, a `kind` (`project`, `home`, `directory`) and a registered `reader`
id, such as `claude-code`, `agents-folder` or `python-agent`. Source paths resolve from the setup file's
folder. Absolute paths explicitly map an external source. `~` is literal, including in quoted YAML; no
shell or process home expansion occurs. There can be at most one project and one home source. The ids
`project` and `home` are reserved for their corresponding kinds.

An optional `bindings` list belongs to its source. Each item declares `runtime`, `deployedRoot`,
`deployedPath`, and `method` (`link` or `copy`). `deployedRoot` is `project`, `home`, or another source id;
it must be mapped. `deployedPath` is relative to that root and cannot traverse parents. A Python source
may have no deployment. The resolved source passed to the reader holds absolute roots, its own resolved part types, and
setup-file provenance. A reader supplies immutable `setupTypes: TypesOptions` metadata; the CLI passes
a reader-id resolver to the setup parser and doctor, without changing the frozen scanner interface.

```yaml setup-source
# Additional source entry inside sources:
- id: shared
  path: .agents
  kind: directory
  reader: agents-folder
  bindings:
    - runtime: claude-code
      deployedRoot: project
      deployedPath: .claude/skills
      method: link
```

Doctor reports link evidence only for symlinks whose target stays inside a declared source. When a link
points at another declared source, its binding is drafted with confidence 1. A directory deployment without
a separate source mapping gets an inferred source with reader `unknown`; choose its registered reader
before evaluating it. Copy intent must be declared;
equal bytes are insufficient evidence. Escaping links are skipped. Doctor never reads an implicit home
from the legacy estate configuration: it records `home not mapped`. Explicit home sources are read
separately. A reader that is not installed is skipped and coverage cannot be clean. Its in-scope files still enter the
drift baseline, so an unchanged draft can agree with its folder while reader coverage remains incomplete.

## Scope, execution, money and privacy

`scope.include`, `scope.exclude`, and `privacy.exclude` use the estate model's root-relative glob grammar.
Directory matches include their descendants. Privacy exclusions take precedence over scope. Runtime
profile ignores still apply. Doctor reads a temporary filtered snapshot so runtime readers cannot load
excluded files or follow a legacy home configuration. All declared sources have filtered snapshots before any reader starts. Readers receive `snapshotRoots`
by source id; cross-source links resolve there. Original roots are provenance, never read authorization.
Snapshots are removed after inspection.

`execute.policy: never` requires an empty `commands` list. `allow` declares specific commands; doctor
still executes none. `privacy.model: deny` blocks model-assisted next steps. `privacy.exports` declares
whether a later export may include content; doctor's report always contains metadata, hashes and paths,
never file bodies. Excluded paths appear in skipped coverage, without their contents or fingerprints.

Every next step has a USD price or an explicit unknown-price reason. Local review and drift checking cost
$0. No live prices are guessed. To price model-assisted evaluation, optionally declare
`budget.pricing: { inputUsdPerMillion, outputUsdPerMillion, inputTokensPerCall, outputTokensPerCall }`.
Doctor multiplies these declared limits by `budget.modelCalls`; the next step is blocked unless model
privacy permits it, call count is positive, and the estimate fits `budget.usd`. This is advice, not a
payment authorization or an execution engine.

## Coverage and drift

`coverage.read` counts reader inputs; `covered` counts files located by declared types. `unknown` lists
files no type covers. `skipped` lists every excluded input and reader limitation. Zero reader inputs means
`not-run`. Any unknown or substantive skip makes coverage incomplete; doctor never prints Clean.

`drift.files` holds `{ source, path, sha256 }` for each in-scope file, including unknown files. Symlink
entries also fingerprint their mapped targets, so an empty link or a same-content target change is drift. The setup file
itself and ignored/private paths are excluded. `--check` needs this saved baseline and never rewrites it.
Review changes and write a fresh draft at a new path to deliberately accept a new baseline. Removed,
changed and added files are reported separately. A missing source that removes baseline files fails the
guard. The baseline is a reviewable declaration, not a signature against deliberate edits to the setup.

Read [the doctor help topic](../packages/cli/help/core-setup-doctor.md) for every flag. Runtime profile
semantics are documented in [estate runtime profiles](estate-runtime-profiles.md).

## Detection boundary during the scanner migration

The current reader registry can dispatch a declared id but cannot enumerate readers or ask each reader for
its own detection confidence. Doctor uses the registered runtime profiles for host detection. An inferred
linked directory therefore keeps `reader: unknown`, together with the link evidence and incomplete
coverage, until its owner declares the reader. There is no reader-name guessing list. After the scanner
freeze, the scan-to-model step will add enumeration and reader-declared detection; doctor will use that
contract for richer detection.
