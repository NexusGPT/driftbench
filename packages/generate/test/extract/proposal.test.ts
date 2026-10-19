import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../../tools/test-setup/temp-folders';
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
import { axisGrid } from '../../src/extract/space';
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
      dimensions: 7,
      values: 13,
      constraints: 2,
      phrases: 2,
      relations: 3,
      total: 14,
      approved: 0,
      valuesApproved: 0,
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

  it('refuses an entry that does not say who proposed it, or says someone else did', async () => {
    const mutant = copy(await build());
    const value = mutant.dimensions[0]?.values[0] as { produced_by?: unknown } | undefined;
    if (value) delete value.produced_by;
    expect(codes(mutant)).toEqual(['dimensions.0.values.0.produced_by SCHEMA_INVALID_VALUE']);
    const human = copy(await build());
    (human.constraints[0] as { produced_by: unknown }).produced_by = 'person';
    expect(codes(human)).toEqual(['constraints.0.produced_by SCHEMA_INVALID_VALUE']);
    const role = copy(await build());
    (role.dimensions[0] as { role: unknown }).role = 'axe';
    expect(codes(role)).toEqual(['dimensions.0.role SCHEMA_INVALID_VALUE']);
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
    const dir = await tempFolder('driftbench-proposal-');
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
    // Paths point into the map, which holds the axes only: the copy is its last dimension.
    const last = toSpaceMap(repeated).dimensions.length - 1;
    expect(codes(repeated)).toEqual([`dimensions.${last}.kind SPACE_KIND_REPEATED`]);
    const ambiguous = copy(proposal);
    const language = ambiguous.dimensions.find((dimension) => dimension.id === 'language');
    if (language) ambiguous.dimensions.push({ ...structuredClone(language), id: 'tongue' });
    expect(codes(ambiguous)).toEqual([
      `dimensions.${last}.values.0.id SPACE_AMBIGUOUS_VALUE`,
      `dimensions.${last}.values.1.id SPACE_AMBIGUOUS_VALUE`,
    ]);
    const tongue = ambiguous.dimensions.at(-1);
    if (tongue) tongue.role = 'detail';
    expect(codes(ambiguous)).toEqual([]);
  });

  it('keeps the axis dimensions in the map and the details out of it', async () => {
    const proposal = await build();
    expect(proposal.dimensions.filter((d) => d.role === 'detail').map((d) => d.id)).toEqual(['flow', 'rule']);
    const map = toSpaceMap(proposal);
    expect(map.dimensions.map((dimension) => dimension.id)).toEqual([
      'behaviour',
      'deviation',
      'channel',
      'stage',
      'language',
    ]);
    const flipped = copy(proposal);
    const flow = flipped.dimensions.find((dimension) => dimension.id === 'flow');
    if (flow) flow.role = 'axis';
    expect(toSpaceMap(flipped).dimensions.map((dimension) => dimension.id)).toContain('flow');
    expect(axisGrid(proposal)).toEqual({ cells: 2 * 3 * 2 * 3 * 2, limit: 250000 });
  });

  it('keeps only approved entries on request, and a constraint only when its values stay', async () => {
    const proposal = await build();
    const language = proposal.dimensions.find((dimension) => dimension.id === 'language');
    const english = language?.values.find((value) => value.id === 'english');
    if (english) english.approved = true;
    const stage = proposal.dimensions.find((dimension) => dimension.id === 'stage');
    if (stage) stage.approved = true;
    const help = stage?.values.find((value) => value.id === 'help');
    if (help) help.approved = false;
    for (const constraint of proposal.constraints) constraint.approved = true;
    const map = toSpaceMap(proposal, { approvedOnly: true });
    expect(
      map.dimensions.map((dimension) => [dimension.id, dimension.values.map((value) => value.id)]),
    ).toEqual([
      ['stage', ['greet', 'verify']],
      ['language', ['english']],
    ]);
    expect(countEntries(proposal)).toMatchObject({ approved: 3, valuesApproved: 3 });
    expect(map.constraints).toEqual([]);
    expect(toSpaceMap(proposal).constraints.map((constraint) => constraint.forbid)).toEqual([
      { behaviour: 'B-002', channel: 'email' },
      { language: 'other', channel: 'email' },
    ]);
  });
});

describe('relations', () => {
  it('validates the relations the extractor writes, and refuses broken references in them', async () => {
    const proposal = await build();
    expect(validateProposal(proposal).ok).toBe(true);
    expect(proposal.relations?.map((relation) => [relation.kind, relation.produced_by])).toEqual([
      ['recovery', 'code'],
      ['path', 'model'],
      ['recovery', 'model'],
    ]);

    const broken = copy(proposal);
    const path = broken.relations?.[1];
    if (path?.kind !== 'path') throw new Error('the fixture has no path');
    path.stages = ['greet', 'nowhere'];
    path.flow = 'loans';
    path.when = { channel: ['fax'] };
    expect(codes(broken)).toEqual([
      'relations.1.flow PROPOSAL_UNKNOWN_VALUE',
      'relations.1.stages.1 PROPOSAL_UNKNOWN_VALUE',
      'relations.1.when.channel.0 PROPOSAL_UNKNOWN_VALUE',
    ]);

    const recovery = copy(proposal);
    const entry = recovery.relations?.[2];
    if (entry?.kind !== 'recovery') throw new Error('the fixture has no recovery');
    entry.class = 'D2_goal_shift';
    entry.stage_after = 'gone';
    entry.at = ['help', 'lost'];
    expect(codes(recovery)).toEqual([
      'relations.2.class PROPOSAL_UNKNOWN_VALUE',
      'relations.2.at.1 PROPOSAL_UNKNOWN_VALUE',
      'relations.2.stage_after PROPOSAL_UNKNOWN_VALUE',
    ]);
  });

  it('refuses a relation without evidence, of an unknown kind, or with a duplicate path id', async () => {
    const proposal = await build();
    const noEvidence = copy(proposal) as unknown as { relations: Array<Record<string, unknown>> };
    delete noEvidence.relations[1]?.evidence;
    expect(codes(noEvidence)).toEqual(['relations.1.evidence PROPOSAL_EVIDENCE_MISSING']);

    const unknown = copy(proposal) as unknown as { relations: Array<Record<string, unknown>> };
    if (unknown.relations[1]) unknown.relations[1].kind = 'guess';
    expect(codes(unknown)[0]).toMatch(/^relations\.1\.kind SCHEMA_/);

    const twice = copy(proposal);
    const first = twice.relations?.[1];
    if (first) twice.relations?.push(structuredClone(first));
    expect(codes(twice)).toEqual(['relations.3.id PROPOSAL_DUPLICATE']);
  });

  it('checks each relation quote against its source, and counts each relation as one decision', async () => {
    const proposal = await build();
    const edited = copy(proposal);
    const path = edited.relations?.[1];
    if (path) path.evidence = { source: 'prompt.md', quote: 'Stages, in order: greet, help.' };
    expect(checkQuotes(edited, TEXTS).map((entry) => `${entry.path} ${entry.code}`)).toEqual([
      'relations.1.evidence.quote PROPOSAL_QUOTE_NOT_FOUND',
    ]);
    expect(countEntries(proposal)).toMatchObject({ relations: 3, total: 14 });
  });

  it('refuses a phrase whose when names a value the map does not hold', async () => {
    const proposal = await build();
    const phrased = copy(proposal);
    const phrase = phrased.phrases[0];
    if (phrase) phrase.when = { flow: ['loans'] };
    expect(codes(phrased)).toEqual(['phrases.0.when.flow.0 PROPOSAL_UNKNOWN_VALUE']);
  });

  it('writes when, binds, subjects and stages on one line, and keeps them through YAML', async () => {
    const proposal = await build();
    const withSlots = copy(proposal);
    const phrase = withSlots.phrases[0];
    if (phrase) {
      phrase.when = { flow: ['balance'] };
      phrase.binds = { card: '1234' };
    }
    const text = renderProposal(withSlots);
    expect(text).toContain('when: { flow: [ balance ] }');
    expect(text).toContain('binds: { card: "1234" }');
    expect(text).toContain('stages: [ greet, verify, help ]');
    const back = parseProposalText(text);
    expect(back.ok && back.proposal).toEqual(withSlots);
  });
});

describe('states pattern lists', () => {
  it('accepts legacy must, forbid-only, and both lists, but refuses neither or empty lists', async () => {
    const { StatesRelation } = await import('../../src/extract/proposal');
    const base = {
      kind: 'states',
      subject: { dimension: 'flow', value: 'lookup' },
      stage: 'check',
      evidence: { source: 'prompt.md', quote: 'State only the lookup result.' },
      produced_by: 'code',
      approved: true,
    };
    for (const fields of [
      { must: ['{found}'] },
      { must_not: ['invented'] },
      { must: ['{found}'], must_not: ['invented'] },
    ]) {
      expect(StatesRelation.safeParse({ ...base, ...fields }).success).toBe(true);
    }
    for (const fields of [{}, { must: [] }, { must_not: [] }, { must: ['ok'], must_not: [] }]) {
      expect(StatesRelation.safeParse({ ...base, ...fields }).success).toBe(false);
    }
  });
});
