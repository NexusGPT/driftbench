# Map validator fixtures

What the map validator renders for seeds 1 and 2, written by code from the hidden specification, so a person can read what the extractor receives and what the validator expects. Every name, message and value is fictional.

| File | What it is |
|---|---|
| `prompt.md` | the agent's prompt in prose: stages, rules, personas, languages, data cases, examples, decoys |
| `inventory.yaml` | the behaviour inventory: behaviours, flows with their deviation classes, channels |
| `tools.yaml` | the tool schemas the tool pre-pass reads |
| `answers.yaml` | the perfect model's answers to the five sections, replayed through the recording port |
| `truth.yaml` | the truth: structured entries, prose atoms, constraints, declared roles, each atom's span, the decoys |

The test `packages/validators/test/map/fixtures.test.ts` renders each seed again and compares it byte for byte. After a deliberate change to the renderer or the specification, rewrite the files with

```
MAP_FIXTURES_WRITE=1 pnpm vitest run packages/validators/test/map/fixtures.test.ts
```
