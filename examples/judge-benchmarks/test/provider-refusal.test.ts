import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createCaller, ProviderRefused, Recordings, SpendCapReached } from '../src/call';

it('does not retry a provider policy refusal and accounts its reported charge before the next call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mm-provider-test-'));
  const command = join(dir, 'fake-judge');
  const attempts = join(dir, 'attempts');
  await writeFile(
    command,
    `#!/usr/bin/env node\nimport fs from 'node:fs';fs.appendFileSync(${JSON.stringify(attempts)},'attempt\\n');console.log(JSON.stringify({is_error:true,result:"API Error: can't help with this. https://www.anthropic.com/legal/aup",total_cost_usd:0.0123}));\n`,
  );
  await chmod(command, 0o700);
  const caller = createCaller(
    await new Recordings(join(dir, 'records.jsonl')).load(),
    { model: 'haiku', command },
    { capUsd: 0.01 },
  );
  const prompt = { system: 'Evaluate supplied data.', user: 'Fixture.' };
  const failure = await caller.call(prompt, {}).catch((e) => e);
  expect(failure).toBeInstanceOf(ProviderRefused);
  expect(failure.costUsd).toBe(0.0123);
  expect(caller.spent()).toBe(0.0123);
  expect(caller.calls()).toBe(1);
  await expect(caller.call(prompt, {})).rejects.toBeInstanceOf(SpendCapReached);
  expect((await readFile(attempts, 'utf8')).trim().split('\n')).toHaveLength(1);
});
