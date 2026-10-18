import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as contract from '../src/contract';
import * as main from '../src/index';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  exports: Record<string, { types: string; import: string }>;
  scripts: { build: string };
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

describe('the contract entry of the adapters package', () => {
  it('is a second export of the package, built beside the main entry', () => {
    expect(manifest.exports['./contract']).toEqual({
      types: './dist/contract.d.ts',
      import: './dist/contract.js',
    });
    expect(manifest.scripts.build).toContain('src/contract.ts');
    expect(manifest.scripts.build).toContain('--external vitest');
  });

  it('needs vitest and the checks package as optional peers only', () => {
    for (const name of ['vitest', '@agent-nexus/driftbench-checks']) {
      expect(manifest.peerDependencies[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta[name]?.optional).toBe(true);
    }
  });

  it('exports the suite, its helpers and the reference agent', async () => {
    expect(Object.keys(contract).sort()).toEqual([
      'COVERAGE_QUESTION',
      'PLAN_CHOICE',
      'UPGRADE_CONVERSATION',
      'UPGRADE_PAYLOAD',
      'acmeGiven',
      'adapterContract',
      'converse',
      'createAcmeAgent',
      'createStore',
      'expectWholeObserved',
      'replyMessage',
      'sendUser',
      'userTurn',
    ]);
    const reply = await contract
      .createAcmeAgent(contract.createStore())
      .respond([{ role: 'user', content: 'Hi' }], {});
    expect(reply.text).toContain('Acme Telecom');
  });

  it('adds nothing to the main entry', () => {
    for (const name of Object.keys(contract)) expect(Object.keys(main)).not.toContain(name);
  });
});
