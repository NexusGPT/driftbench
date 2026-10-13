# Public API

The public API is the set of names exported by each entry in a package's `exports` map. This includes `@agent-nexus/driftbench-adapters/contract`. Files outside that map are internal and may change in any release.

## The frozen list

[`tools/structure/api-surface.json`](https://github.com/achammah/driftbench/blob/main/tools/structure/api-surface.json) records names per entry: `value` for an actual JavaScript export, `type` for a declaration-only name. Main entries use package keys such as `adapters`; subpaths use keys such as `adapters/contract`.

The gate builds the packages, then imports each emitted entry in a fresh Node process and lists its actual export names. Re-exports and namespace exports are included. It never infers runtime values from source declarations. For example, changing `export const direct = 1` to `export declare const direct: number` removes a runtime value and fails the gate.

The source scanner supplies type-only names and documentation/usage information. Its type-only names must match the built `.d.ts` export names after runtime names are removed. A mismatch fails before a snapshot can be written.

* Adding or removing a value or type-only name fails the gate.
* Moving a name to another entry fails, even if the package's total names are unchanged.
* A value changed to a type-only re-export fails as a removed value and an added type.
* New export-map entries are enumerated automatically. Unsupported export conditions fail explicitly instead of being skipped.

The current map uses `types` and `import` conditions. Source entries follow the `dist/<entry>.d.ts` to `src/<entry>.ts` convention, or an explicit `source` condition. Namespace names such as core's `script` are frozen; their nested members and function signatures are not compared.

## Build freshness and CI

```sh
node tools/structure/api-surface.mjs --build --check
```

`--build` permits a build when the stamp is missing or stale. The gate runs the root build with sequential workspace builds, then records hashes of package/example inputs, root manifests, lockfile, TypeScript/build configuration and emitted package files, plus the Node version. A failed build or changed input during the build fails the gate. Build output is retained in diagnostics on failure.

```sh
node tools/structure/api-surface.mjs --check
```

Without `--build`, a missing stamp, source change or altered `dist` fails with a stale-build diagnostic. The gate never accepts a stale build. Its stamp lives in the ignored `.cache/api-surface-build.json` and is not a replacement for the committed API snapshot.

CI runs `node tools/structure/api-surface.mjs --build --check` before the test suite. The focused gate test builds or reuses that stamped build. Fixture mutation tests build their own tiny packages after each source change, including declare-only values, type-only functions, added/removed values and moves between entries.

## Change the public names

When a change is intentional:

```sh
node tools/structure/api-surface.mjs --build --write
```

Commit the regenerated list and name the added or removed exports in `CHANGELOG.md`. The snapshot diff is the review surface; the gate does not authorize a breaking change.

With no output flag the tool prints each name's declaration, documentation and repository usage. `--json` gives the same information as one document. Both require the same fresh build; add `--build` when needed.

## Every name is written out

A package entry names each export: `export { a, type B } from './module'`. Root entries do not use `export * from`, so a new internal export does not silently become public. A separate test enforces that source convention; runtime loading enforces the frozen value list.

## What is not decided yet

The list freezes the existing API and removes nothing. Core aliases (`Block`, `Given`, `Perturbation`), package-name constants and unused names remain candidates for a future deprecation release. Removing them requires that release process.
