import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calibrate,
  calibrateCascade,
  FakeJudge,
  type LabelledBlock,
  type LoadedCriterion,
  labelRequest,
  loadLabels,
  readLabelFile,
  saveLabel,
} from '../src/index';

const criterion: LoadedCriterion = {
  path: 'test.yaml',
  def: { name: 'test', rubric: 'The reply is correct.' },
  fixtures: {
    pass: { transcript: [{ role: 'agent', text: 'fixture pass' }] },
    fail: { transcript: [{ role: 'agent', text: 'fixture fail' }] },
  },
};
const good: LabelledBlock[] = [
  {
    id: 'pass',
    label: 'pass',
    transcript: [
      { role: 'user', text: 'verified sent text' },
      { role: 'agent', text: 'pass' },
    ],
  },
  {
    id: 'fail',
    label: 'fail',
    transcript: [
      { role: 'user', text: 'verified sent text' },
      { role: 'agent', text: 'fail' },
    ],
  },
];
const unavailable: LabelledBlock = {
  id: 'unavailable',
  label: 'fail',
  flags: ['sent text not stored'],
  transcript: [{ role: 'agent', text: 'UNAVAILABLE STIMULUS RESPONSE' }],
};

describe('calibration excludes missing sent text', () => {
  it('preserves the saved flag but excludes the label from the loaded calibration set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'realized-labels-'));
    try {
      for (const block of [...good, unavailable]) await saveLabel(dir, 'test', block, 'reviewer');
      expect(await readLabelFile(dir, 'test')).toContainEqual(unavailable);
      const loaded = await loadLabels(dir);
      expect(loaded.issues).toEqual([]);
      expect(loaded.labels.get('test')).toEqual(good);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(['normal', 'cascade', 'deployable cascade'] as const)(
    'also excludes SDK labels from %s calibration',
    async (mode) => {
      const judge = new FakeJudge('test', [{ outcome: 'pass', reasoning: 'test' }]);
      const base = { criteria: [criterion], labels: new Map([['test', [...good, unavailable]]]), repeats: 1 };
      if (mode === 'normal') await calibrate({ ...base, judges: [judge] });
      else if (mode === 'cascade') await calibrateCascade({ ...base, first: judge, escalateTo: [] });
      else await calibrateCascade({ ...base, judge });
      expect(judge.requests).toHaveLength(4);
      expect(JSON.stringify(judge.requests)).not.toContain('UNAVAILABLE STIMULUS RESPONSE');
      expect(JSON.stringify(judge.requests)).toContain('verified sent text');
    },
  );

  it('refuses a direct judge request for a flagged label', () => {
    expect(() => labelRequest(criterion, unavailable)).toThrow('sent text not stored');
  });
});
