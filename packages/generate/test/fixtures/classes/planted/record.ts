// Records judge.cassette.jsonl: the equivalence judge's answers for the 20 planted items and the 10 seeds.
//   ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-haiku-5-5 pnpm tsx packages/generate/test/fixtures/classes/planted/record.ts
import { resolve } from 'node:path';
import { classes } from '../../../../src/index';
import { createAnthropicPort } from '../../../../src/model';
import { loadPlanted } from './load';

const here = import.meta.dirname;
const path = resolve(here, 'judge.cassette.jsonl');
const cassette = await classes.readCassette(path);
const live = createAnthropicPort();
const judge = cassette.port({ family: live.family, model: live.model ?? 'unknown', inner: live });
const { byId, items } = await loadPlanted();
for (const cls of byId.values()) await classes.gateCandidate(cls, cls.seed, null, [], { judge });
for (const item of items)
  await classes.gateCandidate(byId.get(item.class) as never, item.text, null, [], { judge });
await classes.writeCassette(path, cassette);
console.log(`${cassette.live} live judge calls, ${cassette.list().length} entries`);
