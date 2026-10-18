# An agent behind a URL

The command line reaches an agent behind an HTTP endpoint from the spec alone: the target names the `http` adapter and gives the URL in `target.options`. No code, no plugin.

| File | Holds |
|---|---|
| `server.mjs` | a stand-in agent: it answers each request with a chat completion that repeats the user |
| `specs/hello.yaml` | a spec whose target is `http:echo` with `options.url` |

From the repository root, in two terminals:

```sh
node examples/http-target/server.mjs
```

```sh
pnpm -s driftbench campaign run examples/http-target/specs/hello.yaml
```

```text
✓ http-target-hello · http:echo · F · repeat 0  pass  1 block
```

To run specs that name another target on the same endpoint, give the address in the environment: `DRIFTBENCH_HTTP_URL=http://127.0.0.1:8787/turn pnpm -s driftbench smoke <spec> --target http:echo`.

The settings of the `http`, `litellm` and `nexus` targets are on the [running](../../docs/running.md#targets-from-settings) page.
