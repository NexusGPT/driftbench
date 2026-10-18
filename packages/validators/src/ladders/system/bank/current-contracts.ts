import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSpecs } from '@agent-nexus/driftbench-core';
import { designPilot, loadApprovedMap, PILOT_DEFAULTS } from '@agent-nexus/driftbench-generate';

/** Numeric examples are contracts, not snapshots of the last command we ran. */
export function goldenContract(root: string) {
  const page = readFileSync(join(root, 'examples/acme/golden/README.md'), 'utf8');
  const take = (pattern: RegExp) => {
    const match = pattern.exec(page);
    if (!match) throw new Error(`Missing golden contract: ${pattern}`);
    return match.slice(1).map(Number);
  };
  const [pool] = take(/that no gate seal lists: (\d+) specs/);
  const [sealed] = take(/The (\d+) sealed specs never enter/);
  const [cover, cells] = take(/takes (\d+) specs to cover all (\d+)/);
  const [golden, allowed] = take(/Allowed pairs covered \| (\d+) of (\d+)/);
  const [required, totalRequired] = take(/Required cells covered \| (\d+) of (\d+)/);
  return { pool, sealed, cover, cells, golden, allowed, required, totalRequired };
}

/** Gate-owned split and runnable targets, read before the holdout command writes its bundle. */
export async function gateContract(root: string) {
  const folder = join(root, 'examples/acme/gated');
  const loaded = await loadSpecs([folder]);
  if (loaded.some((entry) => !entry.ok && !/(?:review|label-audit)\.yaml$/.test(entry.path)))
    throw new Error('Invalid gated spec');
  const valid = loaded.flatMap((entry) => (entry.ok ? [entry] : []));
  const seals = (readdirSync(folder, { recursive: true }) as string[]).filter((file) =>
    file.endsWith('holdout/seal.json'),
  );
  const ids = seals.flatMap((file) => {
    const seal = JSON.parse(readFileSync(join(folder, file), 'utf8')) as {
      specs: { id: string; hash: string }[];
    };
    return seal.specs;
  });
  if (ids.length === 0) throw new Error('No gate-owned seal found');
  const sealed = ids.map((entry) => {
    const spec = valid.find((loaded) => loaded.spec.id === entry.id);
    if (!spec || spec.hash !== entry.hash) throw new Error(`Gate seal changed: ${entry.id}`);
    return spec;
  });
  const runnable = sealed.filter(
    (entry) =>
      !entry.spec.target ||
      (entry.spec.target.adapter === 'function' &&
        entry.spec.target.agent === 'acme-sales' &&
        !entry.spec.target.variant),
  ).length;
  return { sealed: sealed.length, total: valid.length, runnable };
}

export async function goldenCount(root: string) {
  const specs = await loadSpecs([join(root, 'examples/acme/golden/specs')]);
  if (specs.some((s) => !s.ok)) throw new Error('Invalid golden spec');
  return specs.length;
}

/** Recompute the documented design factors from the approved phrase bank and suite. */
export async function pilotContract(root: string) {
  const path = join(root, 'examples/acme/map/approved.yaml');
  const map = await loadApprovedMap(path);
  const suite = await loadSpecs([join(root, 'examples/acme/generated/specs')]);
  if (!map.ok || suite.some((entry) => !entry.ok)) throw new Error('Invalid pilot fixture');
  const design = designPilot(
    {
      path,
      agent: map.prepared.agent,
      hash: map.prepared.hash,
      phrasesOf: map.prepared.phrasesOf,
      binds: map.prepared.relations.binds,
    },
    suite.flatMap((entry) => (entry.ok ? [entry] : [])),
    PILOT_DEFAULTS,
  );
  const conversations = design.cells.flatMap((cell) => cell.conversations);
  const wordings = conversations.reduce((sum, c) => sum + c.variants.length, 0);
  const blocks =
    conversations.reduce((sum, c) => sum + c.blocks * c.variants.length, 0) * design.options.repeats;
  return {
    cells: design.cells.length,
    conversations: conversations.length,
    wordings,
    runs: wordings * design.options.repeats,
    blocks,
  };
}
