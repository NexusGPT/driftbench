import { describe, expect, it } from 'vitest';
import {
  countEntries,
  extractMap,
  loadProposal,
  loadRecording,
  recordingPort,
  renderProposal,
} from '../../src/extract';
import { ACME, acmeSources } from './support';

const PROPOSAL = `${ACME}map/proposal.yaml`;

describe('the Acme map proposal', () => {
  it('validates: schema, references, and every quote found in its source', async () => {
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors, null, 2));
    expect(loaded.proposal.agent).toBe('acme');
    expect(loaded.proposal.produced_by.family).toBe('lane');
  });

  it('leaves every entry for the owner to approve', async () => {
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error('invalid');
    const counts = countEntries(loaded.proposal);
    expect(counts.approved).toBe(0);
    expect(counts.total).toBeGreaterThan(200);
  });

  it('is exactly what the extractor writes from the sources and the recorded lane answers', async () => {
    const recording = await loadRecording(`${ACME}map/answers.yaml`);
    if (!recording.ok) throw new Error(recording.message);
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error('invalid');
    const committedAt = loaded.proposal.produced_by.at;
    const result = await extractMap({
      agent: 'acme',
      sources: await acmeSources(),
      port: recordingPort(recording.recording),
      now: () => new Date(committedAt),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.refusals).toEqual([]);
    expect(result.sections.map((run) => [run.section, run.status, run.calls])).toEqual([
      ['stages', 'done', 1],
      ['rules', 'done', 1],
      ['personas', 'done', 1],
      ['data', 'done', 1],
      ['phrases', 'done', 1],
    ]);
    expect(renderProposal(result.proposal)).toBe(loaded.text);
  });

  it('holds the places the Acme agent specifies its behaviour', async () => {
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error('invalid');
    const ids = loaded.proposal.dimensions.map((dimension) => dimension.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'behaviour',
        'flow',
        'deviation',
        'channel',
        'stage',
        'stage_transition',
        'rule',
        'user_type',
        'language',
        'coverage_result',
        'port_result',
        'failing_tool',
        'workspace_start',
        'catalog.search.in.category',
        'notify_sales.in.reason',
      ]),
    );
    const kinds = new Set(loaded.proposal.dimensions.map((dimension) => dimension.kind));
    expect([...kinds].sort()).toEqual([
      'behaviour',
      'channel',
      'data',
      'deviation',
      'persona',
      'stage',
      'task',
    ]);
    const stage = loaded.proposal.dimensions.find((dimension) => dimension.id === 'stage');
    expect(stage?.values.map((value) => value.id)).toEqual([
      'needs',
      'identify',
      'address',
      'port_number',
      'offer',
      'details',
      'recap',
      'order_placed',
      'callback',
      'handover',
      'closing',
    ]);
  });
});
