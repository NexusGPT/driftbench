import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nativePrompt, nativeSchema } from '../langwatch/hard/judges.mts';
import { type StructuredCase, trustedNativeUser } from '../langwatch/hard/trusted-adapter-v2.mts';
import { type Item, requestFor } from './request';

// Renders LangWatch's own default judge for each amendment case: the vendored Scenario verdict prompt, its
// per-criterion rules and its structured-output schema, through the earlier harness's own renderer
// (comparisons/langwatch/hard/judges.mts) and its trusted role-separated transcript (trusted-adapter-v2.mts).
// The one declared criterion is the rubric sentence of the shipped criterion driftbench is asked. Labels never
// enter a prompt.
const here = fileURLToPath(new URL('./', import.meta.url));
const SCENARIO = 'A customer writes to a telecom assistant. The transcript is the whole exchange.';
for (const row of ['task', 'knowledge', 'completeness']) {
  const items = JSON.parse(readFileSync(`${here}sets/langwatch-${row}.json`, 'utf8')) as Item[];
  const prompts: Record<string, { system: string; user: string; schema: unknown; criterion: string }> = {};
  for (const item of items) {
    const request = requestFor('langwatch', row, item, 'default');
    const native = {
      id: item.id,
      kind: '',
      scenario: SCENARIO,
      criteria: [request.criterion.rubric],
      transcript: '',
      truth: [],
      adapterVersion: 2,
      entries: request.transcript,
    } as StructuredCase;
    prompts[item.id] = {
      system: nativePrompt(native),
      user: trustedNativeUser(native),
      schema: nativeSchema(native.criteria),
      criterion: request.criterion.rubric,
    };
  }
  writeFileSync(`${here}prompts/langwatch-${row}-theirs.json`, `${JSON.stringify(prompts, null, 2)}\n`);
  console.log(row, Object.keys(prompts).length);
}
