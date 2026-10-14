# Releasing

driftbench ships as sixteen npm packages under the `@agent-nexus` scope and one Python package. They share one version. Version 0.1.0 is prepared and not published.

| Package | What it holds |
| --- | --- |
| `@agent-nexus/driftbench` | the `driftbench` command |
| `@agent-nexus/driftbench-core` | the spec schema, the block runner, the adapter contract and coverage |
| `@agent-nexus/driftbench-checks`, `@agent-nexus/driftbench-judges` | machine checks, and judged criteria with the council |
| `@agent-nexus/driftbench-users`, `@agent-nexus/driftbench-adapters`, `@agent-nexus/driftbench-sandbox` | user drivers, agent adapters and the code-agent workspace |
| `@agent-nexus/driftbench-artifacts`, `@agent-nexus/driftbench-stats`, `@agent-nexus/driftbench-store`, `@agent-nexus/driftbench-report` | file readers, statistics, the result store and scorecards |
| `@agent-nexus/driftbench-space`, `@agent-nexus/driftbench-generate`, `@agent-nexus/driftbench-estate`, `@agent-nexus/driftbench-validators` | the map of situations, generation, estates and validators |
| `@agent-nexus/driftbench-vitest` | `describeSpec`, one vitest test per block |
| `drift-bench` on PyPI (imported as `driftbench`), not published yet | the Python runner and pytest plugin in `python/driftbench`. The name `driftbench` on PyPI belongs to another project |

`@agent-nexus/driftbench-battery` stays private until it holds code. `@agent-nexus/driftbench-example-acme`, the Acme example in `examples/acme`, is private too and is never published: the command loads it by name when it is installed beside it, as in a checkout, and the published `@agent-nexus/driftbench` does not contain it. From an install of the published command alone, `function:acme-sales`, `process:acme-ops` and `function:acme-random` have no adapter, and the refusal says so: the example is not part of the installed CLI, it lives in `examples/acme` of the repository, and how to run it from a checkout; it lists only what that install reaches. All commands use the shared target resolver, including `gate`, `generate --model` and `holdout score`. A refused holdout target spends no query. Each package has its own `README.md`, and its tarball holds only `dist`, the README and `package.json`.

## The release check

```sh
pnpm build
node tools/release/check.mjs                  # the tree as it is
node tools/release/check.mjs --expect v0.1.0  # also require this version, as the release workflow does
```

It checks four things and exits 1 with one line per problem:

* every publishable manifest: the scoped name (`@agent-nexus/driftbench` for the cli, `@agent-nexus/driftbench-<name>` for the rest), version, description, keywords, license, repository with its directory, homepage, bugs, engines, `main`, `types`, `exports` with a `types` and an `import` condition, `files`, `publishConfig.access`, the `driftbench` bin on the cli, and a README;
* one version across the packages and `python/driftbench/pyproject.toml`, and internal dependencies kept on `workspace:*`;
* a `## [x.y.z]` heading in `CHANGELOG.md`;
* `npm pack --dry-run` on each package: no test, fixture, source, environment or build-cache file.

On 0.1.0 it prints, for example:

```text
driftbench release check: version 0.1.0, 16 packages, python/driftbench 0.1.0
private, not published: @agent-nexus/driftbench-battery
@agent-nexus/driftbench-adapters        4 files     76.3 kB packed    300.7 kB unpacked
@agent-nexus/driftbench            10 files    108.8 kB packed    433.7 kB unpacked
@agent-nexus/driftbench-core            4 files     69.8 kB packed    328.0 kB unpacked
...
clean
```

## The release workflow

`.github/workflows/release.yml` runs only on a pushed `v*` tag, and every job checks the ref again.

1. `verify`: install, lint, typecheck, test, build, the release check with `--expect` set to the tag, and the Python tests when `python/driftbench` exists.
2. `npm`: builds, copies `LICENSE` into each package, and runs `pnpm -r publish`, which writes the release version in place of `workspace:*`. It uses the `NPM_TOKEN` secret, with provenance (`id-token: write`), in the `npm` environment.
3. `pypi`: builds the sdist and the wheel of `python/driftbench` and publishes them through PyPI trusted publishing, in the `pypi` environment. It runs only when the Python package exists and the repository variable `PUBLISH_PYPI` is `true`. With that variable unset, PyPI publishing is skipped. npm publishing does not depend on the PyPI job. Keep the variable unset for now: `python/driftbench/pyproject.toml` names the package `driftbench`, a name that belongs to another project on PyPI (checked on 2026-10-13), so this job cannot publish until the package has a name that is free.

## Cutting a release

1. Set the same version in every `packages/*/package.json`, in `packages/cli/src/version.ts` and in `python/driftbench/pyproject.toml`.
2. Add its section to `CHANGELOG.md` and replace `Unreleased` with the date.
3. Run `pnpm build` and `node tools/release/check.mjs --expect v<version>`.
4. Once the `NPM_TOKEN` secret is configured, push the tag `v<version>`. To publish to PyPI too, configure the trusted publisher of `drift-bench`, the name the Python package takes there, and set the repository variable `PUBLISH_PYPI` to `true`.

## Renaming on a branch

The npm packages moved to the `@agent-nexus` org. A branch cut before the move still uses the old names. After you merge `main` into it, run the codemod and then refresh the lockfile:

```sh
node tools/rename-scope.mjs
pnpm install
```

The codemod is safe to run more than once: a second run changes nothing. It keeps the `driftbench` command name and leaves the Python package, recordings and fixtures with pinned hashes unchanged. The battery package stays private as `@agent-nexus/driftbench-battery`.
