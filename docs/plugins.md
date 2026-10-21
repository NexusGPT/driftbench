# CLI plugins

A plugin is a module of your own code that the command line loads before it runs a command. It lets `campaign`, `smoke`, `ci`, `gate`, `pilot`, `perturb`, `simulate`, `attack`, `family` and `holdout` reach your agent, run your checks and use your judge, with no wrapper process and no fork.

A plugin registers adapters, checks and judges, and the parts of the [rule framework](reference/objects.md):

| It registers | With | Then |
|---|---|---|
| an adapter | `api.adapter(name, factory)` | every target `<name>:<agent>` reaches the adapter the factory returns |
| a custom check | `api.check(name, check)` | a spec that lists `name` under [`rules.custom`](reference/checks.md#custom-checks) runs it on every block |
| a pairwise judge | `api.pairwiseJudge(name, factory)` | `compare --pairwise-judge <name>` uses it |
| an embedder | `api.embedder(name, factory)` | `--embedder <name>` makes the similarity check score with it |
| an object kind | `api.kind(name, { summary, agentFacing, itemsKey, fields })` | `object list` and the loader know the kind |
| a rule | `api.rule(kind, name, { params, run })` | an item of that kind names it as `impl: plugin:<name>`, and its params are checked when the object loads |
| an evidence name | `api.evidence(kind, name, compute)` | a rule of that kind may read it in its `when` |
| a diagnostic step | `api.diagnosticStep(name, run)` | a `diagnostic` object names it as `plugin:<name>` |
| a prompt template | `api.promptTemplate(id, parts, contract)` | a template with named parts, identified by the hash of its parts |
| an object file | `api.object(path)` | the object joins the shipped layer; the path is relative to the plugin's folder |

With no plugin, nothing changes: the command line reads no extra file and behaves as before.

## Write one

A plugin module exports one function as its default export (or under the name `plugin`). The function receives the `api` and may be async.

```js
// plugin.mjs
export default function plugin(api) {
  api.kind('policy/routing', { summary: 'Which team a conversation goes to.' });
  api.rule('policy/routing', 'route-by-intent', { run: () => 'sales' });
  api.rule('check-set', 'acme-tone', { params: toneParams, run: () => [] });
  api.evidence('check-set', 'tone_score', () => 0.5);
  api.diagnosticStep('acme-dedup', () => ({ duplicates: 0 }));
  api.promptTemplate(
    'linker/acme',
    { system: 'You link blocks to prompt units.', rubric: 'One unit per line.' },
    (answer) => answer.split('\n'),
  );
  api.object('objects/policy-routing-intent.yaml');
  api.object('objects/check-set-acme.yaml');
  api.object('objects/diagnostic-acme-dedup.yaml');
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

## Register parts of the rule framework

A plugin may add a kind of object, the code behind a rule, and objects of its own. [`examples/plugins/rules`](https://github.com/NexusGPT/driftbench/tree/main/examples/plugins/rules) holds one of each part. The plugin:

```js
// plugin.mjs
export default function plugin(api) {
  api.kind('policy/routing', { summary: 'Which team a conversation goes to.' });
  api.rule('policy/routing', 'route-by-intent', { run: () => 'sales' });
  api.rule('check-set', 'acme-tone', { params: toneParams, run: () => [] });
  api.evidence('check-set', 'tone_score', () => 0.5);
  api.diagnosticStep('acme-dedup', () => ({ duplicates: 0 }));
  api.promptTemplate('linker/acme', { system: 'You link blocks to prompt units.' }, (answer) => answer.split('\n'));
  api.object('objects/check-set-acme.yaml');
}
```

`toneParams` (defined above `plugin` in the file) is an object with a `safeParse` method, as zod's schemas have: it refuses a `tone` that is not `plain` or `warm`. The object file `objects/check-set-acme.yaml` names the rule in an item:

```yaml
# file: objects/check-set-acme.yaml
kind: check-set
id: acme
description: The Acme tone check, from the example plugin.
items:
  - id: tone
    title: Replies keep the Acme tone
    when: { tone_score: { below: 0.4 } }
    effect: { gating: false }
    params: { tone: warm }
    impl: plugin:acme-tone
```

A spec names the object under `uses`:

```yaml
# file: specs/routed.yaml
id: routed
target: { adapter: function, agent: acme-sales }
uses: { check_set: acme, diagnostics: [acme-dedup] }
blocks:
  - id: b1
    user: I would like to change my plan.
    expect:
      must: [plan]
```

From `examples/plugins/rules`, with the plugin listed in `driftbench.yaml`:

```text
$ driftbench spec validate specs
✓ specs/routed.yaml  routed · 1 block · hash 1e0b1e482f2a
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
$ driftbench object list
check-set           acme                  shipped  f0458f5f
check-set           default               shipped  fd61f704
diagnostic          acme-dedup            shipped  e4985b87
diagnostic          argument-accuracy     shipped  c45c26ac
diagnostic          code-agent-liability  shipped  c5c80f0e
diagnostic          fix-plan              shipped  3733339c
diagnostic          flaky-block           shipped  eb0bc971
diagnostic          liability-confirm     shipped  bd538cfe
diagnostic          value-mismatch        shipped  65345513
policy/blame        default               shipped  b568c994
policy/placement    default               shipped  59475833
policy/routing      intent                shipped  36c5829b
policy/value-check  default               shipped  cf504563
```

Without the plugin, the same spec is invalid: `OBJECT_UNKNOWN  spec routed: uses.check_set: unknown object check-set:acme`.

* A plugin never replaces what driftbench ships or what another plugin registered. A kind, an implementation, an evidence name, a template id or an object `kind:id` already held is refused with exit code 2 and a line naming the plugin that registers it. For a kind, an evidence name, a template id or an object, the line also names what already holds it: the other plugin, or driftbench. For an implementation that is already registered, the line names no holder. To change a shipped object, ship an object that extends it.
* A plugin's objects join the shipped layer, and they resolve when the plugin loads.
* Everything a plugin registers is forgotten when its command ends.
* Limit. The loader registers and checks these parts. A run does not execute a rule, a step, an evidence function or a template parser a plugin registers yet: `campaign run` on the spec above runs the shipped checks only.

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
