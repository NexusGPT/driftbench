# Estate runtime profiles, EstateFS and check outcomes

The estate packages read an agent setup through three seams. Each one holds what used to be assumed about a
single layout (a Claude Code project: `CLAUDE.md` plus `.claude/`). Claude Code is the first runtime profile;
every existing output is unchanged.

## RuntimeProfile

`RuntimeProfile` (package `@agent-nexus/driftbench-core`, `packages/core/src/runtime-profile/profile.ts`) says
what a runtime loads and how. All paths are relative to the estate root, written with `/`.

| Field | What it holds | claude-code |
|---|---|---|
| `name` | The name an estate map and the CLI give the runtime | `claude-code` |
| `roots` | The roots its part types are relative to, by name | `project` is `.`, `layout` is `.claude` |
| `types` | Its built-in part types, in the order a file is classified in ([the estate model](estate-model.md)) | `CLAUDE_CODE_TYPES`, listed on the [Claude Code page](adapters/claude-code.md#part-types) |
| `mapKinds` | The kind the estate map gives a file of each type; a file no mapped type locates is `other` | `CLAUDE_CODE_MAP_KINDS` |
| `shapes` | The structures its reader can test a file for, which a type's `shape` names | `step-list`, `catalogue`, `check-table` |
| `coverageRoots` | The roots whose every file counts for coverage: one no type covers is unknown ([coverage and unknown files](estate-model.md#coverage-and-unknown-files)) | `layout` |
| `layout.root` | The folder the runtime owns, walked whole | `.claude` |
| `layout.extraFiles` | Files beside the layout folder the runtime reads | `.mcp.json` |
| `standing.rootFiles`, `primary` | The standing files the reader lists by name at the root, and the main one | `CLAUDE.md`, `CLAUDE.local.md`; `CLAUDE.md` |
| `settings` | `static` files, or one `rendered` file the user names with `--settings`; a rendered copy is read as the settings file of the place `file` gives, and is refused when the estate stores a file of that place | static `.claude/settings.json`, `.claude/settings.local.json`; rendered, in the place of `.claude/settings.json` |
| `bases` | Folders a bare name is looked up in | `.claude`, `.claude/skills` |
| `routing` | How a skill is reached: `route-table`, `description`, `name` | all three |
| `pathVariables` | The variables expanded in a path: `project`, `plugin`, `working`, `home` | `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `PWD`, `HOME` |
| `policy` | The permission model: for each tool a rule can name, what it does as aspects (`acts`, `executes`, `instructs`, `delegates`) and the type of the part its argument names; and the setting that holds the default mode with the modes in which no allow rule decides anything. A runtime without one has no policy checks | `Read`, `Edit`, `Write` act; `Bash` acts and executes; `Skill` names a `skill`; `Agent` and `Task` name a `subagent`; `bypassPermissions` |
| `loadsItself(path)` | True for a file the runtime loads with no visible read: one a type of the runtime locates whose parts load `always` and `instructs` (`loadsByItself`) | every `CLAUDE.md` and `CLAUDE.local.md` |
| `copyFiles` | What a mutant copy holds by default | `CLAUDE.md`, `CLAUDE.local.md`, `.claude`, `.mcp.json` |
| `configFiles` | Where `driftbench.estate.yaml` may live | the root, then `.claude/` |
| `ignore` | Globs skipped by default | the former `DEFAULT_IGNORE` |
| `ignoreFiles` | Ignore files honoured when present | none |

`registerRuntimeProfile(profile)` adds a runtime; `runtimeProfile(name)` returns it. It refuses a profile whose
`coverageRoots` names a root `roots` does not hold: it throws a `RuntimeProfileError` whose `errors` carry the code
`unknown-coverage-root` and the path `coverageRoots[<i>]` (`profileErrors(profile)` lists them without throwing), so
a misspelt root never makes coverage count nothing. `coverageFolders(profile)` gives the folders the names stand for. A runtime's reader
registers beside it with `registerEstateReader(name, factory)` (package `@agent-nexus/driftbench-estate`).
Adding a runtime is a profile (data) plus, when its layout differs in shape, a reader: no reader or copier
changes. Where a standing file, a skill, a helper or a setting lies is its part type's, not a field of the
profile: the reader classifies every file it reads by `types` and `mapKinds`, and finds the standing files
beside the layout folder by the types located from the root.

Readers of the profile today: the Claude Code reader (`packages/estate/src/scan/claude-code.ts`), the mutant
copier (`packages/estate/src/mutants/mutate.ts`), named-path resolution (`packages/estate/src/scan/code.ts`),
code literals (`packages/estate/src/scan/code-names.ts`), the unit runner's configuration places
(`packages/estate/src/unit/run.ts`) and the adapters' `runtimeLoaded` (`packages/adapters/src/runtimes.ts`).

## EstateFS

`packages/estate/src/fs/estate-fs.ts` is the one module the estate readers, scanners and the mutant copier
read the disk through.

- `listFolder(folder)`: the entries in exact-case order (by UTF-16 code unit), empty when unreadable.
- `dedupeByRealPath(root, paths)`: one spelling per real file, the first kept.
- Link policy: `LAYOUT_LINKS` (`follow`) inside the layout folder, `BESIDE_LAYOUT_LINKS` (`inside-only`)
  beside it; `leavesRoot(root, path)` says whether a link points outside the root.
- `ignoreStack(root, profile, configured)`: the lines of the profile's ignore files present, then the profile
  globs, then the configured globs.
- `expandVariables(path, profile, { root, home })`: project and plugin variables to a root-relative path; the
  home variable and `~/` to `home` (the `--home` folder) when given.
- `rootRelative(root, path)`: the root-relative form a map stores, or undefined outside the root.
- `LEGACY_CASE_INSENSITIVE_NAMES`: the one switch for the name comparisons that fold case (a trash folder, a
  guard an adapter column names), through `comparableName` and `sameName`. It is on, as the readers were.

## CheckOutcome

`CheckOutcome` (package `@agent-nexus/driftbench-core`, `packages/core/src/outcome/check-outcome.ts`) is the
result of one lint rule, invariant or scan summary:

```ts
type CheckOutcome<F> = {
  check: string;
  status: 'pass' | 'fail' | 'not-run';
  coverage: { read: number; skipped: Array<{ what: string; reason: string }>; missing: CheckCapability[] };
  findings: F[];
  notRun?: 'missing-capability' | 'no-input';
};
```

A check declares what it requires (`model-map`, `settings`, `guards`, `execution`). `runCheck(declaration,
available, body)` returns `not-run` with `missing` when a requirement is absent, without running the body. A
check that read no input is `not-run` (`no-input`), never a pass; a finding fails it.

`lintEstate` returns one outcome per lint code (`LintResult.outcomes`), and `invariantOutcomes(raw, state)` one
per invariant. The printed lint output is unchanged with one exception: when no check had an input, lint
prints `Not run: no check had an input.` where it printed `Clean.`. The exit code is unchanged.
