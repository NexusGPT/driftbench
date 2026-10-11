import { loadSpaceMap, NONE, validateSpaceMap } from '@driftbench/space';
import { describe, expect, it } from 'vitest';
import {
  countEntries,
  extractMap,
  loadProposal,
  loadRecording,
  recordingPort,
  renderProposal,
  toSpaceMap,
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

  it('is a valid space map, and holds every behaviour, deviation and channel of the reference map', async () => {
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error('invalid');
    const map = toSpaceMap(loaded.proposal);
    const checked = validateSpaceMap(map, PROPOSAL);
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors, null, 2));
    expect(map.inventory).toBe('../inventory.yaml');
    expect(map.prior).toEqual({ kind: 'declared' });
    expect(map.dimensions.find((dimension) => dimension.kind === 'deviation')?.values[0]).toEqual({
      id: NONE,
      title: 'No deviation',
    });
    const reference = await loadSpaceMap(
      new URL('../../../space/test/fixtures/acme-space.yaml', import.meta.url).pathname,
    );
    if (!reference.ok) throw new Error(JSON.stringify(reference.errors));
    for (const kind of ['behaviour', 'deviation', 'channel'] as const) {
      const ours = new Set(
        map.dimensions.filter((d) => d.kind === kind).flatMap((d) => d.values.map((v) => v.id)),
      );
      const theirs = reference.map.dimensions
        .filter((d) => d.kind === kind)
        .flatMap((d) => d.values.map((v) => v.id));
      expect(
        theirs.filter((id) => !ours.has(id)),
        kind,
      ).toEqual([]);
    }
  });

  it('stays a valid space map once the owner approves everything', async () => {
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error('invalid');
    const approved = structuredClone(loaded.proposal);
    for (const dimension of approved.dimensions) for (const value of dimension.values) value.approved = true;
    for (const constraint of approved.constraints) constraint.approved = true;
    const map = toSpaceMap(approved, { approvedOnly: true });
    expect(map.dimensions).toHaveLength(approved.dimensions.length);
    expect(map.constraints).toHaveLength(approved.constraints.length);
    expect(validateSpaceMap(map).ok).toBe(true);
  });
});
