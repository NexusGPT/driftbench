import { readFile, readdir } from 'node:fs/promises';

/** Reconcile successful recordings and separately reported provider-error charges. */
export async function priorMMSpend(recording: string, results: string) {
  const rows = (await readFile(recording, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const recorded = rows
    .filter((r) => String(r.contestant).startsWith('driftbench-mm-'))
    .reduce((sum, r) => sum + r.costUsd, 0);
  let providerErrors = 0;
  const seen = new Set<string>();
  for (const file of await readdir(results)) {
    if (!file.endsWith('-provider-refusals.jsonl')) continue;
    for (const text of (await readFile(`${results}/${file}`, 'utf8')).trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(text);
      const key = String(row.error);
      if (!seen.has(key)) {
        seen.add(key);
        providerErrors += row.reportedCostUsd ?? 0;
      }
    }
  }
  return { recorded, providerErrors, total: recorded + providerErrors };
}

export async function knownProviderRefusals(results: string) {
  const rows = new Map<string, { reportedCostUsd: number; error: string }>();
  for (const file of await readdir(results)) {
    if (!file.endsWith('-provider-refusals.jsonl')) continue;
    for (const text of (await readFile(`${results}/${file}`, 'utf8')).trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(text);
      if (!rows.has(row.id)) rows.set(row.id, { reportedCostUsd: row.reportedCostUsd, error: row.error });
    }
  }
  return rows;
}
