import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { type BankItem, realProduct, runItem } from '../src/ladders/blocks/index';
import { neutralNames } from '../src/ladders/blocks/isolated/build';
import { neutralEnv, neutralProcess, withheld } from '../src/ladders/blocks/isolated/neutral';

/**
 * The isolated measure run of the blocks bank (docs/validators.md section 12.7): every item check runs as a
 * neutral program, so a product cannot learn the seed or the run from argv, execArgv, cwd or env, and the bundle
 * names no validator module.
 */

type Seen = { argv: string[]; execArgv: string[]; cwd: string; env: Record<string, string | undefined> };

function seenNow(): Seen {
  return {
    argv: [...process.argv],
    execArgv: [...process.execArgv],
    cwd: process.cwd(),
    env: { ...process.env },
  };
}

/** Sets variables a measure run carries, runs `body`, and puts the environment back as it was. */
async function withRunVariables(body: () => Promise<void>): Promise<void> {
  const planted: Record<string, string> = {
    CI: 'true',
    GITHUB_RUN_ID: '4242',
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: 'Linux',
    SEEDS: '1..1',
    BLOCKS_SEED: '1',
    HIDDEN: '--hidden',
    SHARD: '2',
    RUN_ID: '7',
    NODE_OPTIONS: '--import tsx',
    npm_lifecycle_script: 'driftbench validate blocks --seeds 1..1',
    KEEP_ME: 'yes',
  };
  const before = { ...process.env };
  Object.assign(process.env, planted);
  try {
    await body();
  } finally {
    for (const name of Object.keys(planted)) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
}

describe('the isolated blocks measure run', () => {
  it('runs a check with argv node app, no execArgv, the home folder and a neutral env, and restores them', async () => {
    await withRunVariables(async () => {
      process.argv.push('--seeds', '1..1', '--hidden');
      const outside = seenNow();
      let inside: Seen | undefined;
      const item: BankItem = {
        id: 'isolation/probe',
        family: 'isolation',
        tier: 1,
        level: 1,
        component: 'packages/validators/src/ladders/blocks/bank.ts',
        title: 'a check sees a neutral program',
        cause: 'none',
        check: async () => {
          inside = seenNow();
          return { pass: true };
        },
      };
      let after: Seen;
      try {
        const result = await runItem(item, 1, process.cwd(), process.cwd(), realProduct());
        expect(result.pass).toBe(true);
        after = seenNow();
      } finally {
        process.argv.splice(-3, 3);
      }
      expect(inside).toBeDefined();
      const seen = inside as Seen;
      expect(seen.argv).toEqual([outside.argv[0], 'app']);
      expect(seen.execArgv).toEqual([]);
      expect(seen.cwd).toBe(homedir());
      for (const name of [
        'CI',
        'GITHUB_RUN_ID',
        'GITHUB_ACTIONS',
        'RUNNER_OS',
        'SEEDS',
        'BLOCKS_SEED',
        'HIDDEN',
      ]) {
        expect(seen.env[name], name).toBeUndefined();
      }
      for (const name of ['SHARD', 'RUN_ID', 'NODE_OPTIONS', 'npm_lifecycle_script']) {
        expect(seen.env[name], name).toBeUndefined();
      }
      expect(seen.env.KEEP_ME).toBe('yes');
      expect(seen.env.PATH).toBe(outside.env.PATH);
      expect(JSON.stringify(seen)).not.toMatch(/1\.\.1|--hidden|4242/);
      // Restored afterwards: the process is again what it was before the item.
      expect(after).toEqual(outside);
    });
  });

  it('restores argv, execArgv, cwd and env when the check throws', async () => {
    await withRunVariables(async () => {
      const outside = seenNow();
      const item: BankItem = {
        id: 'isolation/throws',
        family: 'isolation',
        tier: 1,
        level: 1,
        component: 'packages/validators/src/ladders/blocks/bank.ts',
        title: 'a check that throws',
        cause: 'none',
        check: async () => {
          throw new Error(`argv ${process.argv.join(' ')}, cwd ${process.cwd()}`);
        },
      };
      const result = await runItem(item, 1, process.cwd(), process.cwd(), realProduct());
      expect(result.pass).toBe(false);
      expect(result.pass ? '' : result.detail).toContain(`cwd ${homedir()}`);
      expect(seenNow()).toEqual(outside);
    });
  });

  it('withholds the CI, runner, seed, run and shard variables and keeps the rest', () => {
    for (const name of [
      'CI',
      'GITHUB_SHA',
      'RUNNER_TEMP',
      'ACTIONS_RUNTIME_URL',
      'SEED',
      'SEEDS',
      'HIDDEN_SEED',
    ]) {
      expect(withheld(name), name).toBe(true);
    }
    for (const name of ['SHARD_INDEX', 'RUN_ID', 'TEST_RUN', 'VITEST', 'VITEST_POOL_ID', 'npm_config_argv']) {
      expect(withheld(name), name).toBe(true);
    }
    for (const name of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'RUNTIME_DIR', 'TRUNK', 'SEEDLING_DIR']) {
      expect(withheld(name), name).toBe(false);
    }
    expect(neutralEnv({ PATH: '/bin', CI: 'true', GITHUB_RUN_ID: '1' })).toEqual({ PATH: '/bin' });
  });

  it('neutralProcess hands back what the run returns', async () => {
    await expect(neutralProcess(async () => 42)).resolves.toBe(42);
  });

  it('names each lazily run module of the bundle m<n>, the same path the same name', () => {
    const text =
      'var a=__esm({"packages/validators/src/ladders/blocks/product.ts"(){}});' +
      'var b=__commonJS({"node_modules/yaml/dist/index.js"(exports){}});' +
      'var c=__esm({"packages/validators/src/ladders/blocks/product.ts"(){}});';
    const out = neutralNames(text);
    expect(out).not.toContain('validators');
    expect(out).not.toContain('node_modules');
    expect(out).toBe('var a=__esm({"m0"(){}});var b=__commonJS({"m1"(exports){}});var c=__esm({"m0"(){}});');
  });
});
