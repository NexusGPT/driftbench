import { describe, expect, it } from 'vitest';
import {
  approveAll,
  checkQuotes,
  countEntries,
  NumericSetting,
  type Proposal,
  parseProposalText,
  pendingEntries,
  renderProposal,
  validateProposal,
} from '../../src/extract';

const quote = 'Channels: chat. Temperature ranges from 0 to 1.';
const evidence = { source: 'prompt.md', quote };
function proposal(approved = false): Proposal {
  return {
    version: 1,
    agent: 'zed',
    produced_by: { family: 'lane', model: 'by hand', at: '2026-10-12T00:00:00.000Z' },
    sources: [{ kind: 'prompt', path: 'prompt.md' }],
    dimensions: [
      {
        id: 'channel',
        title: 'Channel',
        kind: 'channel',
        role: 'axis',
        produced_by: 'code',
        approved: true,
        values: [{ id: 'chat', title: 'Chat', evidence: { ...evidence }, produced_by: 'code' }],
      },
    ],
    constraints: [],
    phrases: [],
    numeric_settings: [
      {
        id: 'temperature',
        min: 0,
        max: 1,
        unit: 'ratio',
        evidence: { ...evidence },
        produced_by: 'code',
        approved,
      },
    ],
  };
}

describe('approved numeric setting ranges', () => {
  it('retains bounds, integer and unit flags through the strict schema and YAML', () => {
    const input = proposal(true);
    expect(validateProposal(input).ok).toBe(true);
    expect(checkQuotes(input, new Map([['prompt.md', quote]]))).toEqual([]);
    const parsed = parseProposalText(renderProposal(input));
    expect(parsed.ok && parsed.proposal).toEqual(input);
    expect(
      NumericSetting.parse({ ...input.numeric_settings?.[0], min: 1.2, max: 3.8, integer: true }),
    ).toMatchObject({ min: 1.2, max: 3.8, integer: true });
  });

  it('counts and lists the approval decision, and --all approves it', () => {
    const input = proposal();
    expect(countEntries(input)).toMatchObject({ total: 2, approved: 1, numeric_settings: 1 });
    expect(pendingEntries(input)).toMatchObject([
      { kind: 'numeric_setting', label: 'temperature', path: 'numeric_settings.0' },
    ]);
    const all = approveAll(renderProposal(input));
    if (!all.ok) throw new Error('numeric approval failed');
    expect(all.approved).toBe(1);
    const parsed = parseProposalText(all.text);
    expect(parsed.ok && parsed.proposal.numeric_settings?.[0]?.approved).toBe(true);
  });

  it('refuses inverted, non-finite or empty integer ranges', () => {
    const setting = proposal().numeric_settings?.[0];
    for (const range of [
      { min: 2, max: 1 },
      { min: 0, max: Number.POSITIVE_INFINITY },
      { min: 0.2, max: 0.8, integer: true },
      { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
    ])
      expect(NumericSetting.safeParse({ ...setting, ...range }).success).toBe(false);
  });

  it('refuses duplicate setting ids and unknown or missing source evidence', () => {
    const duplicate = proposal();
    duplicate.numeric_settings?.push(
      duplicate.numeric_settings[0] as NonNullable<Proposal['numeric_settings']>[number],
    );
    const checked = validateProposal(duplicate);
    expect(!checked.ok && checked.errors.some((error) => error.code === 'PROPOSAL_DUPLICATE')).toBe(true);
    const missing = proposal();
    if (missing.numeric_settings?.[0]) missing.numeric_settings[0].evidence.source = 'absent.md';
    const unknown = validateProposal(missing);
    expect(!unknown.ok && unknown.errors.some((error) => error.code === 'PROPOSAL_UNKNOWN_SOURCE')).toBe(
      true,
    );
    const changed = proposal();
    if (changed.numeric_settings?.[0])
      changed.numeric_settings[0].evidence = { source: 'prompt.md', quote: 'A different numeric range.' };
    expect(checkQuotes(changed, new Map([['prompt.md', quote]]))).toMatchObject([
      { path: 'numeric_settings.0.evidence.quote', code: 'PROPOSAL_QUOTE_NOT_FOUND' },
    ]);
  });
});
