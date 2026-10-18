import {
  DEFAULT_MAX_CELLS,
  gridSize,
  loadSpaceMap,
  NONE,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  approveAll,
  axisGrid,
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
    expect(counts).toMatchObject({
      dimensions: 51,
      constraints: 111,
      phrases: 55,
      relations: 74,
      total: 291,
      approved: 0,
    });
    expect(counts.valuesApproved).toBe(0);
  });

  it('marks who proposed each entry and proposes one axis per kind', async () => {
    const loaded = await loadProposal(PROPOSAL);
    if (!loaded.ok) throw new Error('invalid');
    const { dimensions } = loaded.proposal;
    const axes = dimensions.filter((dimension) => dimension.role === 'axis');
    expect(axes.map((dimension) => [dimension.id, dimension.kind, dimension.produced_by])).toEqual([
      ['behaviour', 'behaviour', 'code'],
      ['deviation', 'deviation', 'code'],
      ['channel', 'channel', 'code'],
      ['stage', 'stage', 'model'],
      ['user_type', 'persona', 'model'],
      ['coverage_result', 'data', 'model'],
      ['workspace_start', 'task', 'model'],
    ]);
    const tools = dimensions.filter((dimension) => /\.(in|out)\./.test(dimension.id));
    expect(tools).toHaveLength(30);
    expect(tools.every((dimension) => dimension.role === 'detail' && dimension.produced_by === 'code')).toBe(
      true,
    );
    const deviation = dimensions.find((dimension) => dimension.id === 'deviation');
    expect(
      deviation?.values.filter((value) => value.produced_by === 'model').map((value) => value.id),
    ).toEqual(['D7_silence_or_burst', 'D9_out_of_scope', 'D11_pii_leak', 'D12_prompt_extraction']);
    expect(axisGrid(loaded.proposal)).toEqual({ cells: 113568, limit: DEFAULT_MAX_CELLS });
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
      ['relations', 'done', 1],
    ]);
    expect(renderProposal(result.proposal)).toBe(loaded.text);
  }, 20_000);

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
      'build_sheet',
      'add_summary',
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

  it('is approved in approved.yaml, which is the proposal with every flag set and nothing else changed', async () => {
    const proposal = await loadProposal(PROPOSAL);
    const approved = await loadProposal(`${ACME}map/approved.yaml`);
    if (!proposal.ok || !approved.ok) throw new Error('invalid');
    const flipped = approveAll(proposal.text);
    if (!flipped.ok) throw new Error('cannot approve');
    expect(approved.text).toBe(flipped.text);
    expect(countEntries(approved.proposal)).toMatchObject({ total: 291, approved: 291, valuesApproved: 184 });
  });

  it('gives the space commands a map of seven axes they accept, written in space.yaml', async () => {
    const approved = await loadProposal(`${ACME}map/approved.yaml`);
    if (!approved.ok) throw new Error('invalid');
    const map = toSpaceMap(approved.proposal, { approvedOnly: true });
    expect(validateSpaceMap(map).ok).toBe(true);
    // The approved map gives its data and task axes a `none`: a spec that holds none of them places there.
    expect(gridSize(map)).toBe(212940);
    expect(gridSize(map)).toBeLessThanOrEqual(DEFAULT_MAX_CELLS);
    const written = await loadSpaceMap(`${ACME}map/space.yaml`);
    if (!written.ok) throw new Error(JSON.stringify(written.errors));
    expect(written.map).toEqual(map);
  });
});
