# Releasing

driftbench ships as sixteen npm packages under the `@driftbench` scope and one Python package. They share one version. Version 0.1.0 is prepared and not published.

| Package | What it holds |
| --- | --- |
| `@driftbench/cli` | the `driftbench` command |
| `@driftbench/core` | the spec schema, the block runner, the adapter contract and coverage |
| `@driftbench/checks`, `@driftbench/judges` | machine checks, and judged criteria with the council |
| `@driftbench/users`, `@driftbench/adapters`, `@driftbench/sandbox` | user drivers, agent adapters and the code-agent workspace |
| `@driftbench/artifacts`, `@driftbench/stats`, `@driftbench/store`, `@driftbench/report` | file readers, statistics, the result store and scorecards |
| `@driftbench/space`, `@driftbench/generate`, `@driftbench/estate`, `@driftbench/validators` | the map of situations, generation, estates and validators |
| `@driftbench/vitest` | `describeSpec`, one vitest test per block |
| `driftbench` on PyPI | the Python runner and pytest plugin in `python/driftbench` |

`@driftbench/battery` stays private until it holds code. Each package has its own `README.md`, and its tarball holds only `dist`, the README and `package.json`.

## The release check

```sh
pnpm build
node tools/release/check.mjs                  # the tree as it is
node tools/release/check.mjs --expect v0.1.0  # also require this version, as the release workflow does
```

It checks four things and exits 1 with one line per problem:

* every publishable manifest: the `@driftbench/` name, version, description, keywords, license, repository with its directory, homepage, bugs, engines, `main`, `types`, `exports` with a `types` and an `import` condition, `files`, `publishConfig.access`, the `driftbench` bin on the cli, and a README;
* one version across the packages and `python/driftbench/pyproject.toml`, and internal dependencies kept on `workspace:*`;
* a `## [x.y.z]` heading in `CHANGELOG.md`;
* `npm pack --dry-run` on each package: no test, fixture, source, environment or build-cache file.

On 0.1.0 it prints, for example:

```text
driftbench release check: version 0.1.0, 16 packages, python/driftbench 0.1.0
private, not published: @driftbench/battery
@driftbench/adapters        4 files     76.3 kB packed    300.7 kB unpacked
@driftbench/cli            10 files    108.8 kB packed    433.7 kB unpacked
@driftbench/core            4 files     69.8 kB packed    328.0 kB unpacked
...
clean
```

## The release workflow

`.github/workflows/release.yml` runs only on a pushed `v*` tag, and every job checks the ref again.

1. `verify`: install, lint, typecheck, test, build, the release check with `--expect` set to the tag, and the Python tests when `python/driftbench` exists.
2. `npm`: builds, copies `LICENSE` into each package, and runs `pnpm -r publish`, which writes the release version in place of `workspace:*`. It uses the `NPM_TOKEN` secret, with provenance (`id-token: write`), in the `npm` environment.
3. `pypi`: builds the sdist and the wheel of `python/driftbench` and publishes them through PyPI trusted publishing, in the `pypi` environment. It runs only when the Python package exists and the repository variable `PUBLISH_PYPI` is `true`. With that variable unset, PyPI publishing is skipped. npm publishing does not depend on the PyPI job.

## Cutting a release

1. Set the same version in every `packages/*/package.json`, in `packages/cli/src/version.ts` and in `python/driftbench/pyproject.toml`.
2. Add its section to `CHANGELOG.md` and replace `Unreleased` with the date.
3. Run `pnpm build` and `node tools/release/check.mjs --expect v<version>`.
4. Once the `NPM_TOKEN` secret is configured, push the tag `v<version>`. To publish to PyPI too, configure its trusted publisher and set the repository variable `PUBLISH_PYPI` to `true` first.
