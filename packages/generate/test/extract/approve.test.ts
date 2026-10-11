import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  approveAll,
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
  it('lists every unapproved value, constraint and phrase, with its evidence', async () => {
    const pending = pendingEntries(await build());
    expect(pending).toHaveLength(17);
    expect(pending[0]).toEqual({
      kind: 'value',
      path: 'dimensions.0.values.0',
      label: 'behaviour/B-001',
      detail: 'Verify the customer before any balance',
      source: 'inventory.yaml',
      quote: 'id: B-001\ntitle: Verify the customer before any balance',
    });
    expect(pending.find((entry) => entry.kind === 'constraint')).toMatchObject({
      label: 'behaviour=B-002 + channel=email',
      detail: 'B-002 applies only on chat',
    });
    expect(pending.at(-1)).toEqual({
      kind: 'phrase',
      path: 'phrases.1',
      label: 'language/other',
      detail: '"Quel est mon solde ?" (fr)',
    });
  });

  it('leaves out what a person approved', async () => {
    const proposal = await build();
    for (const value of proposal.dimensions[0]?.values ?? []) value.approved = true;
    expect(pendingEntries(proposal)).toHaveLength(15);
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
    expect(result.approved).toBe(17);
    expect(result.already).toBe(0);
    expect(result.text).toContain('# Checked with the product owner on Monday.');
    expect(result.text.split('\n')[0]).toBe(text.split('\n')[0]);
    const parsed = parseProposalText(result.text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(countEntries(parsed.proposal)).toMatchObject({ total: 17, approved: 17 });
    expect(pendingEntries(parsed.proposal)).toEqual([]);
    expect(result.text.replaceAll('approved: true', 'approved: false')).toBe(text);
  });

  it('counts the flags that were already true', async () => {
    const proposal = await build();
    if (proposal.phrases[0]) proposal.phrases[0].approved = true;
    const result = approveAll(renderProposal(proposal));
    expect(result.ok && [result.approved, result.already]).toEqual([16, 1]);
  });

  it('refuses to approve a proposal where an entry lost its evidence', async () => {
    const doc = parseDocument(renderProposal(await build()));
    doc.deleteIn(['dimensions', 0, 'values', 0, 'evidence']);
    const result = approveAll(doc.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('PROPOSAL_EVIDENCE_MISSING');
  });
});
