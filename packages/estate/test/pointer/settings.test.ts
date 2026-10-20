import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  buildLabelling,
  parseLabelerSpec,
  parsePointerSettings,
  readPointerSettings,
} from '../../src/pointer';

const settingsOf = (text: string) => parsePointerSettings(parseYaml(text));

describe('the pointer settings of driftbench.estate.yaml', () => {
  it('reads the labels, the labeler, the thresholds and the ledger, and names the keys it read', () => {
    const read = settingsOf(
      'ignore: [logs/]\nlabels: labels.yaml\nlabeler: [system1:jev, system2:anthropic]\nthreshold: { labeler: 0.5, pass_at: 0.8, fail_at: 0.2, margin_cut: 0.6 }\nledger: driftbench.ledger.json\n',
    );
    expect(read).toEqual({
      ok: true,
      settings: {
        labels: { path: 'labels.yaml' },
        labeler: ['system1:jev', 'system2:anthropic'],
        threshold: { labeler: 0.5, passAt: 0.8, failAt: 0.2, marginCut: 0.6 },
        ledger: 'driftbench.ledger.json',
        keys: ['labels', 'labeler', 'threshold', 'ledger'],
      },
    });
  });

  it('takes the label sets inline, in the format of a label sets file', () => {
    const read = settingsOf(
      'labels:\n  - set: harbour\n    description: The harbour.\n    labels:\n      - name: rule\n        description: A unit that tells the reader what to do.\n',
    );
    expect(read.ok && read.settings.labels).toMatchObject({ text: expect.stringContaining('set: harbour') });
  });

  it('refuses a model in the file and names the variable that sets it', () => {
    const read = settingsOf('labeler: [system2:anthropic:claude-haiku-5-5, system1:jev:jev-latest]\n');
    expect(read).toEqual({
      ok: false,
      errors: [
        'labeler: "system2:anthropic:claude-haiku-5-5" names a model; a model is set by environment variable, ANTHROPIC_LABELER_MODEL for anthropic',
        'labeler: "system1:jev:jev-latest" names a model; a model is set by environment variable, JEV_MODEL for jev',
      ],
    });
  });

  it('refuses a key of the wrong shape instead of leaving it out', () => {
    const read = settingsOf(
      'labels: []\nlabeler: system3:x\nthreshold: { pass: 0.8, fail_at: 2 }\nledger: 4\n',
    );
    expect(read.ok).toBe(false);
    expect(read.ok ? [] : read.errors).toEqual([
      'labels: a file of label sets, or a list of sets',
      'labeler: "system3:x" starts with system1 or system2, the class of the labeler',
      'threshold: pass is not a threshold; the thresholds are labeler, pass_at, fail_at, margin_cut',
      'threshold: fail_at is a number from 0 to 1',
      'ledger: the path of the ledger file',
    ]);
  });

  it('is empty without the file, or with a file that holds none of its keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-settings-'));
    expect(await readPointerSettings(root)).toEqual({ ok: true, settings: { keys: [] } });
    await writeFile(join(root, 'driftbench.estate.yaml'), 'ignore: [logs/]\n');
    expect(await readPointerSettings(root)).toEqual({ ok: true, settings: { keys: [] } });
    await writeFile(join(root, 'driftbench.estate.yaml'), 'labels: [\n');
    expect((await readPointerSettings(root)).ok).toBe(false);
  });
});

describe('every model by environment variable', () => {
  it('sets the model of the system 2 labeler from ANTHROPIC_LABELER_MODEL, and an explicit model wins', async () => {
    const build = async (text: string, env: Record<string, string>) => {
      const spec = parseLabelerSpec(text);
      if (!spec.ok) throw new Error(spec.message);
      const built = await buildLabelling([spec.spec], { env, record: false, cwd: '.' });
      if (!built.ok) throw new Error(built.message);
      return built.labelling.members[0]?.model;
    };
    expect(await build('system2:anthropic', {})).toBe('claude-haiku-5-5');
    expect(await build('system2:anthropic', { ANTHROPIC_LABELER_MODEL: 'claude-sonnet-5-5' })).toBe(
      'claude-sonnet-5-5',
    );
    expect(
      await build('system2:anthropic:claude-opus-5-5', { ANTHROPIC_LABELER_MODEL: 'claude-sonnet-5-5' }),
    ).toBe('claude-opus-5-5');
    expect(await build('system1:jev', { JEV_MODEL: 'jev-7', JEV_API_KEY: 'k', JEV_ROUTE: 'r' })).toBe(
      'jev-7',
    );
  });
});
