import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkQuotes,
  countEntries,
  extractMap,
  loadProposal,
  type Proposal,
  parseProposalText,
  renderProposal,
  toSpaceMap,
  validateProposal,
} from '../../src/extract';
import { FakeModelPort } from '../../src/model';
import { GOOD_ANSWERS, INVENTORY, PROMPT, SOURCES } from './support';

async function build(): Promise<Proposal> {
  const port = new FakeModelPort(GOOD_ANSWERS);
  const result = await extractMap({ agent: 'zed', sources: SOURCES, port, now: () => new Date(0) });
  if (!result.ok) throw new Error('the fixture does not extract');
  return result.proposal;
}

const TEXTS = new Map(SOURCES.map((source) => [source.path, source.text]));

/** A deep copy to mutate. */
function copy(proposal: Proposal): Record<string, unknown> & Proposal {
  return structuredClone(proposal) as Record<string, unknown> & Proposal;
}

function codes(raw: unknown): string[] {
  const result = validateProposal(raw);
  return result.ok ? [] : result.errors.map((issue) => `${issue.path} ${issue.code}`);
}

describe('the proposal schema', () => {
  it('accepts what the extractor writes, and counts the entries a person approves', async () => {
    const proposal = await build();
    expect(validateProposal(proposal).ok).toBe(true);
    expect(checkQuotes(proposal, TEXTS)).toEqual([]);
    expect(countEntries(proposal)).toEqual({
      values: 13,
      constraints: 2,
      phrases: 2,
      total: 17,
      approved: 0,
    });
  });

  it('survives a trip through YAML, with the header and without anchors', async () => {
    const proposal = await build();
    const text = renderProposal(proposal);
    expect(
      text.startsWith("# driftbench map proposal for zed: where the agent's behaviour is specified.\n"),
    ).toBe(true);
    expect(text).not.toMatch(/[&*][a-z]\d/);
    expect(text).toContain('forbid: { behaviour: B-002, channel: email }');
    const parsed = parseProposalText(text);
    expect(parsed.ok && parsed.proposal).toEqual(proposal);
  });
});

describe('mutations a proposal must refuse', () => {
  it('refuses a value that lost its evidence', async () => {
    const mutant = copy(await build());
    const value = mutant.dimensions[0]?.values[0] as { evidence?: unknown } | undefined;
    if (value) delete value.evidence;
    expect(codes(mutant)).toEqual(['dimensions.0.values.0.evidence PROPOSAL_EVIDENCE_MISSING']);
  });

  it('refuses a constraint that lost its evidence, or its quote', async () => {
    const mutant = copy(await build());
    delete (mutant.constraints[0] as { evidence?: unknown }).evidence;
    expect(codes(mutant)).toEqual(['constraints.0.evidence PROPOSAL_EVIDENCE_MISSING']);
    const noQuote = copy(await build());
    const evidence = noQuote.constraints[0]?.evidence as { quote?: unknown } | undefined;
    if (evidence) delete evidence.quote;
    expect(codes(noQuote)).toEqual(['constraints.0.evidence.quote PROPOSAL_EVIDENCE_MISSING']);
  });

  it('refuses a blank quote', async () => {
    const mutant = copy(await build());
    const value = mutant.dimensions[1]?.values[0];
    if (value) value.evidence.quote = '  \n ';
    expect(codes(mutant)).toEqual(['dimensions.1.values.0.evidence.quote PROPOSAL_EVIDENCE_MISSING']);
  });

  it('refuses a quote edited into text its source does not hold', async () => {
    const mutant = copy(await build());
    const stage = mutant.dimensions.find((dimension) => dimension.id === 'stage');
    const value = stage?.values[1];
    if (value) value.evidence.quote = 'Always verify the customer with a selfie';
    expect(validateProposal(mutant).ok).toBe(true);
    const problems = checkQuotes(mutant, TEXTS);
    expect(problems.map((issue) => issue.code)).toEqual(['PROPOSAL_QUOTE_NOT_FOUND']);
    expect(problems[0]?.path).toMatch(/^dimensions\.\d+\.values\.1\.evidence\.quote$/);
  });

  it('refuses a missing or non-boolean approval, an unknown key and an unknown source', async () => {
    const missing = copy(await build());
    delete (missing.phrases[0] as { approved?: unknown }).approved;
    expect(codes(missing)).toEqual(['phrases.0.approved SCHEMA_INVALID_TYPE']);
    const word = copy(await build());
    (word.constraints[0] as { approved: unknown }).approved = 'yes';
    expect(codes(word)).toEqual(['constraints.0.approved SCHEMA_INVALID_TYPE']);
    const extra = copy(await build());
    (extra.dimensions[0] as Record<string, unknown>).weight = 2;
    expect(codes(extra)).toEqual(['dimensions.0 SCHEMA_UNRECOGNIZED_KEYS']);
    const elsewhere = copy(await build());
    const value = elsewhere.dimensions[0]?.values[0];
    if (value) value.evidence.source = 'notes.md';
    expect(codes(elsewhere)).toEqual(['dimensions.0.values.0.evidence.source PROPOSAL_UNKNOWN_SOURCE']);
  });

  it('refuses broken references and duplicates', async () => {
    const proposal = await build();
    const ghost = copy(proposal);
    ghost.constraints.push({
      ...structuredClone(proposal.constraints[0]),
      forbid: { behaviour: 'B-404', channel: 'chat' },
    } as never);
    expect(codes(ghost)).toEqual([
      `constraints.${proposal.constraints.length}.forbid.behaviour PROPOSAL_UNKNOWN_VALUE`,
    ]);
    const lonely = copy(proposal);
    lonely.phrases.push({ ...structuredClone(proposal.phrases[1]), dimension: 'mood' } as never);
    expect(codes(lonely)).toEqual([`phrases.${proposal.phrases.length}.value PROPOSAL_UNKNOWN_DIMENSION`]);
    const twice = copy(proposal);
    const first = twice.dimensions[0];
    if (first?.values[0]) first.values.push(structuredClone(first.values[0]));
    expect(codes(twice)).toEqual([
      `dimensions.0.values.${first ? first.values.length - 1 : 0}.id PROPOSAL_DUPLICATE`,
    ]);
    const single = copy(proposal);
    if (single.constraints[0]) single.constraints[0].forbid = { behaviour: 'B-002' };
    expect(codes(single)).toEqual(['constraints.0.forbid SCHEMA_CUSTOM']);
  });

  it('refuses another version and a file that is not a mapping', async () => {
    const later = copy(await build());
    (later as { version: unknown }).version = 2;
    const result = validateProposal(later);
    expect(result.ok ? [] : result.errors).toEqual([
      { code: 'SCHEMA_INVALID_VALUE', path: 'version', message: 'this reader knows proposal version 1' },
    ]);
    expect(codes(['a list'])).toEqual([' PROPOSAL_NOT_OBJECT']);
    expect(parseProposalText('version: [1').ok).toBe(false);
  });
});

describe('loadProposal', () => {
  async function folder(sources: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-proposal-'));
    for (const [name, text] of Object.entries(sources)) await writeFile(join(dir, name), text);
    return dir;
  }

  it('checks every quote against the sources next to the proposal', async () => {
    const dir = await folder({ 'prompt.md': PROMPT, 'inventory.yaml': INVENTORY });
    await writeFile(join(dir, 'proposal.yaml'), renderProposal(await build()));
    const loaded = await loadProposal(join(dir, 'proposal.yaml'));
    expect(loaded.ok).toBe(true);
  });

  it('refuses a proposal whose source changed under it, or is gone', async () => {
    const dir = await folder({
      'prompt.md': PROMPT.replace('Never give investment advice.', 'Investment advice is fine.'),
    });
    await writeFile(join(dir, 'proposal.yaml'), renderProposal(await build()));
    const loaded = await loadProposal(join(dir, 'proposal.yaml'));
    expect(loaded.ok ? [] : loaded.errors.map((issue) => issue.code)).toEqual([
      'PROPOSAL_SOURCE_UNREADABLE',
      'PROPOSAL_QUOTE_NOT_FOUND',
    ]);
  });
});

describe('the proposal as a space map', () => {
  it('refuses a proposal the space package would refuse', async () => {
    const proposal = await build();
    const repeated = copy(proposal);
    const stage = repeated.dimensions.find((dimension) => dimension.id === 'stage');
    if (stage) repeated.dimensions.push({ ...structuredClone(stage), id: 'phase' });
    expect(codes(repeated)).toEqual([`dimensions.${proposal.dimensions.length}.kind SPACE_KIND_REPEATED`]);
    const ambiguous = copy(proposal);
    const language = ambiguous.dimensions.find((dimension) => dimension.id === 'language');
    if (language) ambiguous.dimensions.push({ ...structuredClone(language), id: 'tongue' });
    expect(codes(ambiguous)).toEqual([
      `dimensions.${proposal.dimensions.length}.values.0.id SPACE_AMBIGUOUS_VALUE`,
      `dimensions.${proposal.dimensions.length}.values.1.id SPACE_AMBIGUOUS_VALUE`,
    ]);
  });

  it('keeps only approved entries on request, and a constraint only when its values stay', async () => {
    const proposal = await build();
    const language = proposal.dimensions.find((dimension) => dimension.id === 'language');
    const english = language?.values.find((value) => value.id === 'english');
    if (english) english.approved = true;
    for (const constraint of proposal.constraints) constraint.approved = true;
    const map = toSpaceMap(proposal, { approvedOnly: true });
    expect(
      map.dimensions.map((dimension) => [dimension.id, dimension.values.map((value) => value.id)]),
    ).toEqual([
      ['deviation', ['none']],
      ['language', ['english']],
    ]);
    expect(map.constraints).toEqual([]);
    expect(toSpaceMap(proposal).constraints.map((constraint) => constraint.forbid)).toEqual([
      { behaviour: 'B-002', channel: 'email' },
      { language: 'other', channel: 'email' },
    ]);
  });
});
