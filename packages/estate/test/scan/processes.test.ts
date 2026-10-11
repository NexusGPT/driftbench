import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, FIXTURE, NOW } from '../support';

describe('step lists in a processes map', () => {
  it('reads one stage catalogue per process, beside the top-level steps', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/flow.json': JSON.stringify(
        {
          steps: [{ id: 'plan', next: ['do'] }, { id: 'do' }],
          processes: {
            intake: { steps: ['ask', 'check', { name: 'file', title: 'File it' }] },
            review: {
              steps: [
                { id: 'ask', next: ['decide'] },
                { id: 'decide', next: [] },
                { id: 'note', anytime: true },
              ],
            },
            empty: { title: 'no steps' },
          },
        },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.find((file) => file.path === '.claude/flow.json')?.kind).toBe('step_list');
    expect(raw.steps.map((step) => [step.id, step.next, step.anytime, step.process ?? ''])).toEqual([
      ['plan', ['do'], false, ''],
      ['do', [], false, ''],
      ['intake/ask', ['intake/check'], false, 'intake'],
      ['intake/check', ['intake/file'], false, 'intake'],
      ['intake/file', [], false, 'intake'],
      ['review/ask', ['review/decide'], false, 'review'],
      ['review/decide', [], false, 'review'],
      ['review/note', [], true, 'review'],
    ]);
    const intakeAsk = raw.steps.find((step) => step.id === 'intake/ask');
    expect(intakeAsk?.at.quote).toBe('"ask",');
    expect(raw.steps.find((step) => step.id === 'review/ask')?.at.quote).toBe('"id": "ask",');
    expect(raw.steps.find((step) => step.id === 'intake/file')?.title).toBe('File it');
  });

  it('turns each process step into a stage atom linked to the next one of its own process', async () => {
    const { map } = await scanEstate({ root: FIXTURE, reader: new ClaudeCodeReader(), now: NOW });
    const stages = map.atoms.filter((atom) => atom.kind === 'stage');
    // Files are read in name order: processes.json comes before steps.json.
    expect(stages.map((stage) => stage.fields?.id)).toEqual([
      'claim/scan',
      'claim/photos',
      'claim/file',
      'month-close/reconcile',
      'month-close/audit',
      'month-close/report',
      'month-close/note',
      'plan',
      'do',
      'verify',
      'report',
      'note',
    ]);
    const next = map.edges
      .filter((edge) => edge.kind === 'next')
      .map((edge) => [
        stages.find((stage) => stage.id === edge.from)?.fields?.id,
        stages.find((stage) => stage.id === edge.to)?.fields?.id,
      ]);
    expect(next).toContainEqual(['claim/scan', 'claim/photos']);
    expect(next).toContainEqual(['claim/photos', 'claim/file']);
    expect(next).toContainEqual(['month-close/audit', 'month-close/report']);
    expect(next).not.toContainEqual(['month-close/audit', 'report']);
    expect(stages.find((stage) => stage.fields?.id === 'claim/file')?.evidence).toEqual([
      { type: 'stage_reached', name: 'claim/file' },
    ]);
  });
});
