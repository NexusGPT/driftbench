import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type JudgeCase, nativePrompt, nativeSchema } from './judges.mts';
import { here } from './runner.mts';

const cases = JSON.parse(readFileSync(join(here, 'judges-v4.json'), 'utf8')) as JudgeCase[];
console.log(
  JSON.stringify(
    cases.map((item) => ({ id: item.id, system: nativePrompt(item), schema: nativeSchema(item.criteria) })),
  ),
);
