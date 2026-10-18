# Generator validator fixtures

The hidden specification of seed 1, rendered the way the generator validator renders every seed before it
runs `driftbench generate` on it. Fictional: every name, value and phrase is made up by code.

| File | What it is |
|---|---|
| `seed-1/approved.yaml` | the approved map the generator reads: every value quotes the line below that states it |
| `seed-1/prompt.md` | the prompt: stages, moves, tools, users and rules |
| `seed-1/inventory.yaml` | the behaviour inventory: channels, behaviours, flows and the deviations each flow requires |
| `seed-1/tools.yaml` | the tool schemas |
| `seed-1/family.yaml` | the code-task family description |
| `seed-1/oracle.mjs` | the code-task oracle, left unformatted on purpose: the test compares it byte for byte (excluded in `biome.json`) |
| `seed-1/hidden.json` | the hidden specification itself, with the intent of every phrase |

`packages/validators/test/generator/hidden.test.ts` renders seed 1 and compares it with these files byte
for byte. When the hidden specification or its rendering changes on purpose, rewrite them and commit the
diff with the reason:

```sh
pnpm exec tsx --tsconfig tsconfig.json packages/validators/fixtures/generator/refresh.ts
```

Every other seed is rendered into a temporary folder during the run and removed after it.
