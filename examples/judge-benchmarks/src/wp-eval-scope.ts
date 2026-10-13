import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type WritingFreeze = {
  designSha: string;
  variant: string;
  frozenAt: string;
  sourceHashes: Record<string, string>;
  devReport: string;
};

/** TEST is authorized only for the logged frozen design; evaluation artifacts can still be written. */
export async function assertWritingTestFreeze(
  variant: string,
  sha: string | undefined,
): Promise<WritingFreeze> {
  if (!sha) throw new Error('--frozen-sha required for TEST');
  const manifest = JSON.parse(
    await readFile(new URL('../census/wp-freeze.json', import.meta.url), 'utf8'),
  ) as WritingFreeze;
  if (sha !== manifest.designSha || variant !== manifest.variant)
    throw new Error('TEST design does not match the frozen selection');
  if (Date.parse(manifest.frozenAt) > Date.parse('2026-10-13T02:30:00Z'))
    throw new Error('Freeze is after the authorized 04:30 local cutoff');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  for (const [path, hash] of Object.entries(manifest.sourceHashes)) {
    const actual = createHash('sha256')
      .update(await readFile(resolve(root, path)))
      .digest('hex');
    if (actual !== hash) throw new Error(`Source changed after freeze: ${path}`);
  }
  return manifest;
}

/** An evaluation can resume its missing identical calls, but its design and item selection cannot change. */
export async function claimWritingTestRun(
  freeze: WritingFreeze,
  out: string,
  rowKeys: readonly string[],
  replayOnly: boolean,
) {
  const path = new URL('../census/wp-test-run-state.json', import.meta.url);
  const selection = { designSha: freeze.designSha, variant: freeze.variant, out, rowKeys };
  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (existing) {
    const state = JSON.parse(existing);
    if (JSON.stringify(state.selection) !== JSON.stringify(selection))
      throw new Error('One frozen TEST selection is already registered; its design and sample cannot change');
    return;
  }
  if (!replayOnly)
    await writeFile(
      path,
      JSON.stringify({ selection, startedAt: new Date().toISOString(), pid: process.pid }, null, 2) + '\n',
      { flag: 'wx' },
    );
}
