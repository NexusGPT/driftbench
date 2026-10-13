# Public API

The public API of a driftbench package is the set of names its entry exports: what `import { ... } from '@agent-nexus/driftbench-<package>'` can name. Every other file of a package is internal and may change in any release.

## The frozen list

[`tools/structure/api-surface.json`](https://github.com/achammah/driftbench/blob/main/tools/structure/api-surface.json) lists every public name, per package, with its kind as the entry exports it: `value` when the name exists at run time, `type` when only the type checker sees it. A value that an entry passes on with `export type { x }` or `export { type x }` is a `type` here, because it has no run-time export. The value names of the list are exactly the run-time exports of the built packages. A test (`tools/structure/api-surface.test.mjs`) compares it with the code on every pull request:

* a name added to a package entry, or removed from it, fails the test until the list is regenerated;
* a name that changes kind fails it too: turning `export { x }` into `export { type x }` keeps the name and removes the run-time export, and the test reports it as a removed value and an added type;
* the regenerated list is part of the pull request, so the change to the API shows in the diff a reviewer reads;
* a change of the list goes with a line in `CHANGELOG.md` that names the new or removed exports.

The tool below prints the count per package; when this page was written the list held 2,306 names in 17 packages.

## Check it, change it

```sh
node tools/structure/api-surface.mjs --check
```

```text
The public API matches tools/structure/api-surface.json: 2306 exports.
```

The number is the count on the day of the run.

When a name is added or removed, the same command exits 1 and says which:

```text
The public API differs from tools/structure/api-surface.json.
  added    stats: value myNewFunction
A public name changes only on purpose. If this change is meant: run
  node tools/structure/api-surface.mjs --write
commit the file, and name the new or removed exports in CHANGELOG.md.
```

`node tools/structure/api-surface.mjs` with no flag prints one row per name with what a decision needs: where it is declared, whether it has a doc comment, whether the docs name it, which packages, tests, examples and tools import it. `--json` gives the same as one document.

## Every name is written out

A package entry names each export: `export { a, type B } from './module'`. No entry re-exports a whole module with `export *`, so a new `export` inside a file stays internal until someone adds its name to the entry, and to the frozen list. The same test enforces it.

## What is not decided yet

The list covers the names of each package's main entry. It does not cover the members of a namespace export (core's `script`) or a second entry such as `@agent-nexus/driftbench-adapters/contract`.

The list freezes the API as it is; it removes nothing. Three alias pairs in core (`Block`, `Given`, `Perturbation`), the `packageName` constant of each package and the names no package, test, example or doc uses are candidates for removal. A removal is a breaking change: it goes through a release that marks the name deprecated first.
