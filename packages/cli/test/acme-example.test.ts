import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acmeExample, acmeExampleInstalled, loadAcmeExample, requireAcmeExample } from '../src/acme-example';
import { acmeOpsAgent, defaultDeps, knownTargets, noAdapter } from '../src/commands/campaign';
import { pilotDeps, pilotNoAdapter } from '../src/commands/pilot';
import { BUILTIN_TARGETS_NOTE } from '../src/targets';

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

  it('in a checkout the refusals name the example targets, as before', () => {
    expect(acmeExampleInstalled()).toBe(true);
    expect(noAdapter({ adapter: 'function', agent: 'nobody' })).toBe(
      `No adapter is set up for function:nobody. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. ${BUILTIN_TARGETS_NOTE}`,
    );
    expect(pilotNoAdapter({ adapter: 'http', agent: 'zed' })).toBe(
      'No adapter is set up for http:zed. The pilot reaches function:acme (the Acme sales assistant) and function:acme-random or function:acme-random-<seed> (its seeded random control).',
    );
  });

  it('without the example the refusals say it is absent, where it lives, and only what is reachable', () => {
    const absent = () => {
      throw new Error('not found');
    };
    expect(acmeExampleInstalled(absent)).toBe(false);
    const campaign = knownTargets(false);
    expect(campaign).toBe(
      'The Acme example (function:acme-sales, function:acme, process:acme-ops and the pilot control function:acme-random) is not part of the installed CLI: it lives in the driftbench repository, in examples/acme. To run it, work from a checkout: git clone https://github.com/NexusGPT/driftbench, pnpm install, then pnpm driftbench. This install reaches a process target through --process-command: process:<name> runs the command you give.',
    );
    expect(campaign).not.toContain('The CLI reaches');
    const pilot = pilotNoAdapter({ adapter: 'function', agent: 'acme-random' }, false);
    expect(pilot).toContain('is not part of the installed CLI');
    expect(pilot).toContain('examples/acme');
    expect(pilot).not.toContain('The pilot reaches');
  });

  it('the command line source names the example nowhere by a relative path', () => {
    for (const file of ['commands/campaign.ts', 'commands/pilot.ts', 'acme-example.ts']) {
      const text = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(text).not.toMatch(/import\(['"][./]+\/examples\//);
    }
  });
});
