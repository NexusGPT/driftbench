import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acmeExample, loadAcmeExample, requireAcmeExample } from '../src/acme-example';
import { acmeOpsAgent, defaultDeps } from '../src/commands/campaign';
import { pilotDeps } from '../src/commands/pilot';

const NAME = '@agent-nexus/driftbench-example-acme';

describe('the Acme example package', () => {
  it('is found by name in a checkout, with the agents the command line needs', async () => {
    const acme = await requireAcmeExample();
    expect(Object.keys(acme).sort()).toEqual([
      'OPS_AGENT',
      'createAcmeAgent',
      'createRandomAgent',
      'createStore',
    ]);
    expect(existsSync(acme.OPS_AGENT)).toBe(true);
    expect(await acmeOpsAgent()).toBe(acme.OPS_AGENT);
    expect(await acmeExample()).toBe(acme);
  });

  it('serves the three Acme targets through the default deps', async () => {
    expect((await defaultDeps.adapterFor({ adapter: 'function', agent: 'acme-sales' }))?.id).toBe('function');
    expect((await defaultDeps.adapterFor({ adapter: 'function', agent: 'acme' }))?.id).toBe('function');
    expect((await defaultDeps.adapterFor({ adapter: 'process', agent: 'acme-ops' }))?.id).toBe('process');
    expect((await pilotDeps.adapterFor({ adapter: 'function', agent: 'acme-random' }))?.id).toBe('function');
  });

  it('an install without the package has no example, and says nothing else is wrong', async () => {
    const absent = Object.assign(new Error(`Cannot find package '${NAME}' imported from /x/cli.js`), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    expect(await loadAcmeExample(() => Promise.reject(absent))).toBeUndefined();
  });

  it('any other failure of the import is not hidden', async () => {
    const inner = Object.assign(new Error("Cannot find package 'left-pad' imported from /x/acme.js"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    await expect(loadAcmeExample(() => Promise.reject(inner))).rejects.toBe(inner);
    const broken = new SyntaxError('Unexpected token');
    await expect(loadAcmeExample(() => Promise.reject(broken))).rejects.toBe(broken);
  });

  it('the command line source names the example nowhere by a relative path', () => {
    for (const file of ['commands/campaign.ts', 'commands/pilot.ts', 'acme-example.ts']) {
      const text = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(text).not.toMatch(/import\(['"][./]+\/examples\//);
    }
  });
});
