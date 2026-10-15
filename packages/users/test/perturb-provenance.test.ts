import { fileURLToPath } from 'node:url';
import { Spec, type UserDriver } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { createPerturbingDriver, createScriptedDriver, loadRedteamPack } from '../src/index';

const spec = Spec.parse({
  id: 'seeded',
  kind: 'conversation',
  blocks: [{ when: { user: 'hello' } }],
  perturbations: [{ id: 'aside', class: 'D1_off_topic', inject_at: 0, user: 'aside' }],
});

it('declares a scripted perturbation deterministic for carry provenance', () => {
  expect(createPerturbingDriver({ spec, perturbation: 'aside' }).seeds).toEqual({});
});

it('preserves the base driver seeds and keeps unknown randomness unknown', () => {
  const base: UserDriver = { ...createScriptedDriver(), seeds: { user: 7 } };
  expect(createPerturbingDriver({ spec, perturbation: 'aside', base }).seeds).toEqual({ 'base:user': 7 });
  const { seeds: _seeds, ...unknown } = base;
  expect(createPerturbingDriver({ spec, perturbation: 'aside', base: unknown }).seeds).toBeUndefined();
});

it('records a pack draw seed separately from the base driver seeds', async () => {
  const pack = await loadRedteamPack(
    fileURLToPath(new URL('../../../examples/acme/redteam', import.meta.url)),
  );
  const driver = createPerturbingDriver({
    spec: { ...spec, perturbations: [] },
    base: { ...createScriptedDriver(), seeds: { perturbation: 99 } },
    perturbation: { class: 'D1_off_topic', inject_at: 0, pack, seed: 4 },
  });
  expect(driver.source).toMatchObject({ kind: 'drawn', seed: 4 });
  expect(driver.seeds).toEqual({ 'base:perturbation': 99, perturbation: 4 });
});
