# A CLI plugin

The smallest plugin: one adapter and one custom check, loaded into the command line.

| File | Holds |
|---|---|
| `plugin.mjs` | the plugin: the adapter `echo` (an agent that repeats the user) and the check `polite` |
| `specs/hello.yaml` | a spec whose target is `echo:demo` and whose `rules.custom` lists `polite` |
| `driftbench.yaml` | the project config: its `plugins` list names `./plugin.mjs` |

From the repository root:

```sh
pnpm -s driftbench campaign run examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs
```

In a project of your own, with `driftbench.yaml` in the working folder, no flag is needed: `driftbench campaign run specs/`.

The full page: [CLI plugins](../../docs/plugins.md).
