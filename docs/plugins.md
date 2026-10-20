# CLI plugins

A plugin is a module of your own code that the command line loads before it runs a command. It lets `campaign`, `smoke`, `ci`, `gate`, `pilot`, `perturb`, `simulate`, `attack`, `family` and `holdout` reach your agent, run your checks and use your judge, with no wrapper process and no fork.

A plugin registers three things:

| It registers | With | Then |
|---|---|---|
| an adapter | `api.adapter(name, factory)` | every target `<name>:<agent>` reaches the adapter the factory returns |
| a custom check | `api.check(name, check)` | a spec that lists `name` under [`rules.custom`](reference/checks.md#custom-checks) runs it on every block |
| a pairwise judge | `api.pairwiseJudge(name, factory)` | `compare --pairwise-judge <name>` uses it |

With no plugin, nothing changes: the command line reads no extra file and behaves as before.

## Write one

A plugin module exports one function as its default export (or under the name `plugin`). The function receives the `api` and may be async.

```js
// plugin.mjs
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { machineVerdict } from '@agent-nexus/driftbench-core';

function echoAgent(messages) {
  const text = `You said: ${messages.at(-1)?.content ?? ''}`;
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
}

export default function plugin(api) {
  api.adapter('echo', () => functionAdapter({ respond: echoAgent, deterministic: true }));

  api.check('polite', (ctx, options) => {
    const banned = Array.isArray(options?.banned) ? options.banned : [];
    const text = ctx.observed.text.toLowerCase();
    const hit = banned.find((word) => text.includes(String(word).toLowerCase()));
    return machineVerdict('polite', 'banned', hit === undefined ? 'pass' : 'fail',
      hit === undefined ? 'no banned word' : `the reply holds the banned word ${hit}`);
  });
}
```

The adapter factory receives the target (`{ adapter, agent, ... }`) and, in a campaign, a scope whose `tempDir()` is the campaign's temporary folder. It returns any [`AgentAdapter`](adapters/index.md): one of the built-in ones with your options (`httpAdapter`, `litellmAdapter`, `nexusAdapter`, `processAdapter`, the SDK adapters) or your own. It may return `undefined` for an agent name it does not serve.

In TypeScript, `definePlugin` from `@agent-nexus/driftbench` gives the function its types:

```ts
import { definePlugin } from '@agent-nexus/driftbench';

export default definePlugin((api) => {
  // api.adapter, api.check, api.pairwiseJudge, api.cwd
});
```

## Load it

Two places name the plugins of a run:

1. The project config, `driftbench.yaml` in the working folder or the file `--config <file>` names, under `plugins`. A path is relative to the config file; any other entry is a package name.

   ```yaml
   plugins:
     - ./plugin.mjs
     - "@my-team/driftbench-plugin"
   ```

2. The flag `--plugin <module>`, anywhere on the command line, once per module. A path is relative to the working folder.

The plugins of the config load first, then those of the flags, in the order written. Duplicate adapter, check and judge names are refused with exit code 2 and a line naming both plugins. A plugin also cannot replace a check registered by your own code through `registerCheck`, or a built-in judge named `openai`, `anthropic` or `google`. Registrations belong to one `main()` call: success, refusal and thrown errors all remove that run's adapters, checks and judges before returning. Every earlier registration keeps its name and function identity. The two Acme example targets, `function:acme-sales` and `process:acme-ops`, stay with the built-in example.

A plugin that cannot be loaded, exports no function or throws stops the command with one line on stderr and exit code 2.

## Run the example

[`examples/plugins`](https://github.com/NexusGPT/driftbench/tree/main/examples/plugins) holds the plugin above, a spec whose target is `echo:demo`, and a `driftbench.yaml` that lists the plugin. From the repository root:

```sh
pnpm -s driftbench campaign run examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs
```

```text
✓ plugins-hello · echo:demo · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

Without `--plugin`, the same command stops with `No adapter is set up for echo:demo`.

## Trust

A plugin is code. It runs in the command line's process with the rights of the person, or the CI job, that runs it, like a test file or a build config. The command line loads a plugin only from the project config and from `--plugin`; a spec file can never name one. List only modules you would run yourself, and review a change to the `plugins` list as you review code.

## From code

`main` takes the same things without a config file, and the dependencies of the commands:

```ts
import { main, processIo } from '@agent-nexus/driftbench';

await main(['campaign', 'run', 'specs/'], processIo, {
  plugins: [(api) => api.adapter('http', () => myAdapter)],
});

// Or replace what the commands run with: the adapters, the checks, the driver, the store.
await main(['smoke', 'specs/a.yaml'], processIo, {
  deps: { adapterFor: async (target) => myAdapterFor(target) },
});
```

`deps` is a partial `CampaignDeps`, laid over the defaults; campaign, smoke, family, perturb, simulate, attack, ci and monitor read it. `await campaignCommands()` gives `defaultDeps` and `campaignRunCommand(paths, options, io, deps)`, which runs one campaign without the argument parser. They load on demand, so importing the package stays as light as before.
