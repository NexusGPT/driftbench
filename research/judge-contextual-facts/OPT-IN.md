# Contextual fact comparison

This candidate is an experiment, not the shipped default. The default decision depends on every recorded regression set.

Use the existing `JudgeRequest.system` override to select the frozen prompt in `candidate-system.txt` for an explicitly chosen evaluation. No model name, benchmark name, or case ID selects the rule.

```ts
import { readFileSync } from 'node:fs';
import { createOpenAiJudge } from '@agent-nexus/driftbench-judges';

const system = readFileSync(new URL('./candidate-system.txt', import.meta.url), 'utf8');
const judge = createOpenAiJudge({ model: 'your-configured-model' });
const result = await judge.judge({
  system,
  criterion: { name: 'facts', rubric: 'Report both fictional plan prices accurately.' },
  transcript: [{ role: 'agent', text: 'Miro costs 12 crowns, while Sola costs 15.' }],
  inputs: [{ path: 'plans.txt', text: 'Miro costs 12 crowns. Sola costs 15 crowns.' }],
});
```

This snippet illustrates the request override. Provider credentials and production transport settings remain the caller's responsibility. The experiment runner independently enforces medium reasoning and removes the temperature field for Luna.

The override changes each request key through its `system` field. Existing default recordings do not silently replay for an opted-in request. Keep default and experimental results separate.
