import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { Command } from 'commander';
import { afterAll, expect, it } from 'vitest';
import { echoAdapter } from '../../core/test/runner/support';
import { readAggregateConfig } from '../src/aggregate-config';
import { type CampaignDeps, registerCampaignCommands } from '../src/commands/campaign';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});
const table =
  'as_of: 2026-10-13\nmodels:\n  fictional-model:\n    input: 2\n    output: 4\n    cached_input: 0.5\n';
async function fixture(config?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-token-prices-'));
  made.push(dir);
  await writeFile(
    join(dir, 'spec.yaml'),
    'id: token-budget\nversion: "1"\ntarget:\n  adapter: echo\n  options:\n    model: fictional-model\nblocks:\n  - when:\n      user: hello\n',
  );
  if (config) await writeFile(join(dir, 'driftbench.yaml'), config);
  return dir;
}
async function cli(dir: string, flags: string[], overrides: Partial<CampaignDeps> = {}) {
  let code = 0;
  let out = '';
  let err = '';
  let calls = 0;
  const adapter = echoAdapter();
  adapter.send = async () => {
    calls++;
    return {
      segments: [{ type: 'text', text: 'ok' }],
      text: 'ok',
      toolCalls: [],
      cost: { inputTokens: 1000, outputTokens: 500 },
      latencyMs: 0,
    };
  };
  const program = new Command().exitOverride();
  registerCampaignCommands(
    program,
    {
      cwd: dir,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        err += s;
      },
    },
    (c) => {
      code = c;
    },
    {
      adapterFor: async () => adapter,
      driver: () => createScriptedDriver(),
      checks: [],
      openStore: async () => openMemoryStore(),
      now: () => new Date('2026-10-13T00:00:00Z'),
      ...overrides,
    },
  );
  await program.parseAsync(
    [
      'campaign',
      'run',
      'spec.yaml',
      '--repeats',
      '3',
      '--concurrency',
      '1',
      '--no-cache',
      '--json',
      ...flags,
    ],
    { from: 'user' },
  );
  return { code, out, err, calls };
}
it('loads prices from driftbench.yaml and stops spending at the next cell', async () => {
  const dir = await fixture(
    `prices:\n${table
      .split('\n')
      .filter(Boolean)
      .map((s) => `  ${s}`)
      .join('\n')}\n`,
  );
  const result = await cli(dir, ['--budget-usd', '0.003']);
  expect(result.calls).toBe(1);
  expect(result.code).toBe(1);
  expect(result.out).toContain('"stopped"');
  expect(await readAggregateConfig(join(dir, 'driftbench.yaml'))).toEqual({ ok: true, specs: [] });
});
it('refuses missing prices with a clear CLI error', async () => {
  const result = await cli(await fixture(), ['--budget-usd', '1']);
  expect(result.code).toBe(2);
  expect(result.err).toMatch(/fictional-model.*prices.*driftbench.yaml.*--prices/);
  expect(result.calls).toBe(0);
});
it('takes a standalone prices file over the project prices', async () => {
  const dir = await fixture('prices: invalid\n');
  await writeFile(join(dir, 'prices.yaml'), table);
  const result = await cli(dir, ['--prices', 'prices.yaml', '--budget-usd', '0.003']);
  expect(result.calls).toBe(1);
  expect(result.code).toBe(1);
});
it('leaves token-only campaigns alone without prices or a budget', async () => {
  const result = await cli(await fixture(), []);
  expect(result.code).toBe(0);
  expect(result.calls).toBe(3);
});
it('refuses invalid dated rates before calling the adapter', async () => {
  const dir = await fixture('prices:\n  as_of: not-a-date\n  models: {}\n');
  const result = await cli(dir, ['--budget-usd', '1']);
  expect(result.code).toBe(2);
  expect(result.calls).toBe(0);
  expect(result.err).toContain('as_of');
});

it('does not change a campaign for an unrelated malformed default config', async () => {
  const absent = await cli(await fixture(), []);
  const unrelated = await cli(await fixture('unrelated: [invalid yaml'), []);
  expect(unrelated).toEqual(absent);
});
it.each([
  ['as_of: 2026-02-30\nmodels: {}\n', 'as_of'],
  [table.replace('input: 2', 'input: -1'), 'input'],
  [table.replace('input: 2', 'input: "2"'), 'input'],
  [table.replace('input: 2', 'input: null'), 'input'],
  [table.replace('input: 2', 'input: .nan'), 'input'],
  [table.replace('cached_input: 0.5', 'cached_input: .inf'), 'cached_input'],
  [table.replace('    cached_input: 0.5\n', ''), 'cached_input'],
])('refuses invalid price table %s before sending', async (invalid, field) => {
  const dir = await fixture();
  await writeFile(join(dir, 'prices.yaml'), invalid);
  const result = await cli(dir, ['--prices', 'prices.yaml', '--budget-usd', '1']);
  expect(result.code).toBe(2);
  expect(result.calls).toBe(0);
  expect(result.err).toContain(field);
});

it.each([false, true])('combines campaign.budget_usd and prices (explicit config: %s)', async (explicit) => {
  const config = `campaign:\n  budget_usd: 0.003\nprices:\n${table
    .split('\n')
    .filter(Boolean)
    .map((s) => `  ${s}`)
    .join('\n')}\n`;
  const dir = await fixture(explicit ? 'prices: invalid\n' : config);
  if (explicit) await writeFile(join(dir, 'named.yaml'), config);
  const result = await cli(dir, explicit ? ['--config', 'named.yaml'] : []);
  expect(result.code).toBe(1);
  expect(result.calls).toBe(1);
});

const scopeNotice =
  'The budget counts what the target adapter reports; simulated-user and judge calls are not counted.';
it('prints the budget scope on stderr with a model judge, including JSON mode', async () => {
  const dir = await fixture();
  await writeFile(join(dir, 'prices.yaml'), table);
  const result = await cli(dir, ['--budget-usd', '1', '--prices', 'prices.yaml'], {
    checks: [{ name: 'judge', applies: () => true, evaluate: () => [] }],
  });
  expect(result.code, result.err).toBe(0);
  expect(result.err).toContain(scopeNotice);
  expect(() => JSON.parse(result.out)).not.toThrow();
});
it('does not print a budget scope warning without a budget', async () => {
  const result = await cli(await fixture(), [], {
    checks: [{ name: 'judge', applies: () => true, evaluate: () => [] }],
  });
  expect(result.err).not.toContain(scopeNotice);
});

it('prints the budget scope for a simulated user before its first model call', async () => {
  const dir = await fixture();
  await writeFile(join(dir, 'prices.yaml'), table);
  await writeFile(
    join(dir, 'persona.yaml'),
    'id: fictional-user\nname: Fictional User\npersona: A concise fictional user.\ngoal: Say hello.\nfacts: {}\nreveal_when_asked: {}\nstop_token: STOP\nspec: spec.yaml\n',
  );
  const result = await cli(
    dir,
    [
      '--budget-usd',
      '1',
      '--prices',
      'prices.yaml',
      '--driver',
      'simulated',
      '--persona',
      'persona.yaml',
      '--model',
      '--agent-family',
      'none',
    ],
    {
      modelPort: () => ({ family: 'mistral', model: 'fictional-user-model', complete: async () => 'hello' }),
    },
  );
  expect(result.code, result.err).toBe(0);
  expect(result.err).toContain(scopeNotice);
  expect(result.calls).toBe(3);
});

it('checks all spec targets before any adapter call, listing each missing model', async () => {
  const dir = await fixture();
  await writeFile(
    join(dir, 'second.yaml'),
    'id: second\nversion: "1"\ntarget:\n  adapter: echo\n  options:\n    model: missing-model\nblocks:\n  - when:\n      user: hello\n',
  );
  const result = await cli(dir, ['second.yaml', '--budget-usd', '1']);
  expect(result.code).toBe(2);
  expect(result.err).toMatch(/fictional-model.*missing-model.*prices/);
  expect(result.calls).toBe(0);
});
