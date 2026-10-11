import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  approveAll,
  approveDimensions,
  countEntries,
  extractMap,
  type Proposal,
  parseProposalText,
  pendingEntries,
  renderProposal,
} from '../../src/extract';
import { FakeModelPort } from '../../src/model';
import { GOOD_ANSWERS, SOURCES } from './support';

async function build(): Promise<Proposal> {
  const result = await extractMap({ agent: 'zed', sources: SOURCES, port: new FakeModelPort(GOOD_ANSWERS) });
  if (!result.ok) throw new Error('the fixture does not extract');
  return result.proposal;
}

describe('pendingEntries', () => {
  it('lists one decision per dimension, constraint and phrase', async () => {
    const pending = pendingEntries(await build());
    expect(pending).toHaveLength(11);
    expect(pending.map((entry) => entry.kind)).toEqual([
      ...Array(7).fill('dimension'),
      'constraint',
      'constraint',
      'phrase',
      'phrase',
    ]);
    expect(pending[0]).toEqual({
      kind: 'dimension',
      path: 'dimensions.0',
      label: 'behaviour',
      detail: 'behaviour axis, by code, 2 values: The behaviours the inventory lists',
    });
    expect(pending.find((entry) => entry.label === 'rule')?.detail).toBe(
      'behaviour detail, by model, 1 value: Rules',
    );
    expect(pending.find((entry) => entry.kind === 'constraint')).toMatchObject({
      label: 'behaviour=B-002 + channel=email',
      detail: 'B-002 applies only on chat',
      source: 'inventory.yaml',
    });
    expect(pending.at(-1)).toEqual({
      kind: 'phrase',
      path: 'phrases.1',
      label: 'language/other',
      detail: '"Quel est mon solde ?" (fr)',
    });
  });

  it('leaves out an approved dimension, and names the values that set their own flag', async () => {
    const proposal = await build();
    if (proposal.dimensions[0]) proposal.dimensions[0].approved = true;
    const flow = proposal.dimensions[1]?.values[0];
    if (flow) flow.approved = true;
    const pending = pendingEntries(proposal);
    expect(pending).toHaveLength(10);
    expect(pending[0]?.detail).toBe(
      'behaviour detail, by code, 1 value, 1 set on their own: The flows the inventory lists',
    );
  });
});

describe('approveDimensions', () => {
  it('approves the named dimensions only, keeping layout, and their values inherit the flag', async () => {
    const text = renderProposal(await build());
    const result = approveDimensions(text, ['stage', 'channel']);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.approved).toEqual(['channel', 'stage']);
    const parsed = parseProposalText(result.text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.proposal.dimensions.filter((d) => d.approved).map((d) => d.id)).toEqual([
      'channel',
      'stage',
    ]);
    expect(countEntries(parsed.proposal)).toMatchObject({ approved: 2, valuesApproved: 5 });
    expect(result.text.split('\n').length).toBe(text.split('\n').length);
    const again = approveDimensions(result.text, ['stage']);
    expect(again.ok && [again.approved, again.already]).toEqual([[], ['stage']]);
  });

  it('refuses an unknown dimension and changes nothing', async () => {
    const result = approveDimensions(renderProposal(await build()), ['stage', 'mood']);
    expect(result.ok ? [] : result.errors.map((issue) => [issue.code, issue.message])).toEqual([
      ['PROPOSAL_UNKNOWN_DIMENSION', 'dimension "mood" is not in the proposal'],
    ]);
  });
});

describe('approveAll', () => {
  it('flips every flag, counts them, and keeps comments and order', async () => {
    const text = renderProposal(await build()).replace(
      'dimensions:\n',
      'dimensions:\n  # Checked with the product owner on Monday.\n',
    );
    const result = approveAll(text);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.approved).toBe(11);
    expect(result.already).toBe(0);
    expect(result.text).toContain('# Checked with the product owner on Monday.');
    expect(result.text.split('\n')[0]).toBe(text.split('\n')[0]);
    const parsed = parseProposalText(result.text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(countEntries(parsed.proposal)).toMatchObject({ total: 11, approved: 11, valuesApproved: 13 });
    expect(pendingEntries(parsed.proposal)).toEqual([]);
    expect(result.text.replaceAll('approved: true', 'approved: false')).toBe(text);
  });

  it('counts the flags that were already true', async () => {
    const proposal = await build();
    if (proposal.phrases[0]) proposal.phrases[0].approved = true;
    const result = approveAll(renderProposal(proposal));
    expect(result.ok && [result.approved, result.already]).toEqual([10, 1]);
  });

  it('refuses to approve a proposal where an entry lost its evidence', async () => {
    const doc = parseDocument(renderProposal(await build()));
    doc.deleteIn(['dimensions', 0, 'values', 0, 'evidence']);
    const result = approveAll(doc.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('PROPOSAL_EVIDENCE_MISSING');
  });
});
