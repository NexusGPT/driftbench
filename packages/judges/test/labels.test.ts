import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLabels } from '../src/calibration';
import { readLabelFile, saveLabel } from '../src/labels';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-labels-'));
  made.push(dir);
  return dir;
}

const block = (id: string, label: 'pass' | 'fail', note?: string) => ({
  id,
  label,
  ...(note === undefined ? {} : { note }),
  transcript: [
    { role: 'user' as const, text: 'Is fiber available at 12 Main St?' },
    { role: 'agent' as const, text: 'Yes, Acme Fiber is available there.' },
  ],
});

describe('saveLabel', () => {
  it('writes a labels file that judge calibrate reads back, block for block', async () => {
    const dir = await folder();
    await saveLabel(dir, 'no_invented_data', block('run-1.b0', 'pass', 'Matches the tool.'), 'a reviewer');
    await saveLabel(dir, 'no_invented_data', block('run-1.b1', 'fail'), 'a reviewer');
    const loaded = await loadLabels(dir);
    expect(loaded.issues).toEqual([]);
    expect(loaded.labels.get('no_invented_data')).toEqual([
      block('run-1.b0', 'pass', 'Matches the tool.'),
      block('run-1.b1', 'fail'),
    ]);
    const text = await readFile(join(dir, 'no_invented_data.yaml'), 'utf8');
    expect(text).toContain('criterion: no_invented_data');
    expect(text).toContain('labelled_by: a reviewer');
  });

  it('replaces a block labelled again and keeps every other block and the file header', async () => {
    const dir = await folder();
    await writeFile(
      join(dir, 'tone.yaml'),
      'criterion: tone\nlabelled_by: someone, by hand\nblocks:\n  - id: old.1\n    label: fail\n    note: kept\n    transcript:\n      - { role: user, text: "hi" }\n',
    );
    await saveLabel(dir, 'tone', block('run-2.b3', 'pass'), 'a reviewer');
    await saveLabel(dir, 'tone', block('run-2.b3', 'fail', 'changed my mind'), 'a reviewer');
    const blocks = await readLabelFile(dir, 'tone');
    expect(blocks.map((entry) => `${entry.id} ${entry.label} ${entry.note ?? ''}`)).toEqual([
      'old.1 fail kept',
      'run-2.b3 fail changed my mind',
    ]);
    expect(await readFile(join(dir, 'tone.yaml'), 'utf8')).toContain('labelled_by: someone, by hand');
  });

  it('refuses a criterion name that is not a plain file name, and reads a missing file as empty', async () => {
    const dir = await folder();
    await expect(saveLabel(dir, '../escape', block('x', 'pass'), 'r')).rejects.toThrow('criterion name');
    await expect(saveLabel(dir, 'a/b', block('x', 'pass'), 'r')).rejects.toThrow('criterion name');
    expect(await readLabelFile(dir, 'nothing_yet')).toEqual([]);
  });

  it('creates the labels folder when it does not exist', async () => {
    const dir = join(await folder(), 'labels', 'nested');
    await saveLabel(dir, 'tone', block('b', 'pass'), 'r');
    expect((await readLabelFile(dir, 'tone')).map((entry) => entry.id)).toEqual(['b']);
  });
});
