// Records labellers.cassette.jsonl.gz: the two audit labellers on the 20 planted items, the control that shows
// the audit can say no.
//   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... pnpm tsx packages/generate/test/fixtures/classes/planted/record-labellers.ts
import { resolve } from 'node:path';
import { classes } from '../../../../src/index';
import { createAnthropicPort, createOpenAiPort } from '../../../../src/model';
import { LABELLERS, plantedAudit } from './load';

const path = resolve(import.meta.dirname, 'labellers.cassette.jsonl.gz');
const cassette = await classes.readCassette(path);
const ports = [
  cassette.port({
    ...LABELLERS[0],
    inner: createAnthropicPort({ env: { ...process.env, ANTHROPIC_MODEL: LABELLERS[0].model } }),
  }),
  cassette.port({
    ...LABELLERS[1],
    inner: createOpenAiPort({ env: { ...process.env, OPENAI_MODEL: LABELLERS[1].model } }),
  }),
];
const result = await plantedAudit(ports);
await classes.writeCassette(path, cassette);
console.log(
  `${cassette.live} live labeller calls; ${result.invalid} of ${result.items} planted items invalid`,
);
