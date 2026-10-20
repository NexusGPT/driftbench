import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { classes } from '../../../../src/index';

export type PlantedItem = { id: string; type: string; class: string; text: string };

/** The ten H4 classes by id, and the 20 planted items. */
export async function loadPlanted(): Promise<{
  byId: Map<string, classes.UtteranceClass>;
  items: PlantedItem[];
}> {
  const here = import.meta.dirname;
  const byId = new Map<string, classes.UtteranceClass>();
  for (const file of (await readdir(here)).filter((f) => f.endsWith('.yaml')).sort()) {
    const loaded = await classes.loadClassFile(resolve(here, file));
    if (!loaded.ok) throw new Error(`${file}: ${JSON.stringify(loaded.errors)}`);
    byId.set(loaded.class.id, loaded.class);
  }
  const { items } = JSON.parse(await readFile(resolve(here, 'planted.json'), 'utf8')) as {
    items: PlantedItem[];
  };
  return { byId, items };
}

/** The two audit labellers, as the example class's audit ran them. */
export const LABELLERS = [
  { family: 'anthropic', model: 'claude-opus-5-5' },
  { family: 'openai', model: 'gpt-6.1-sol' },
] as const;

/** The audit run on the planted items, each audited against its own class. */
export async function plantedAudit(
  labellers: readonly import('../../../../src/model').ModelPort[],
): Promise<{ items: number; invalid: number; caught: string[] }> {
  const { byId, items } = await loadPlanted();
  const caught: string[] = [];
  for (const item of items) {
    const cls = byId.get(item.class) as classes.UtteranceClass;
    const result = await classes.auditItems(
      cls,
      { set: 'planted', items: [{ id: item.id, cell: {}, text: item.text, sha: '' }] },
      labellers,
    );
    if (result.invalid === 1) caught.push(item.id);
  }
  return { items: items.length, invalid: caught.length, caught };
}
