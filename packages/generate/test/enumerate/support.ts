import { fileURLToPath } from 'node:url';
import type { Spec } from '@agent-nexus/driftbench-core';
import type { Proposal, ProposalPhrase } from '../../src/extract/proposal';
import { type PreparedMap, prepareMap, type ToolSchema } from '../../src/seed/map';

/** The Acme example folder and its approved map. */
export const ACME = fileURLToPath(new URL('../../../../examples/acme/', import.meta.url));
export const ACME_MAP = `${ACME}map/approved.yaml`;
export const ACME_PROPOSAL = `${ACME}map/proposal.yaml`;

const evidence = { source: 'prompt.md', quote: 'Stages, in order: greet, verify, help.' };

type ValueSpec = string | { id: string; title?: string; approved?: boolean };

function values(list: ValueSpec[]) {
  return list.map((entry) => {
    const value = typeof entry === 'string' ? { id: entry } : entry;
    return {
      id: value.id,
      title: value.title ?? `the value ${value.id}`,
      evidence,
      produced_by: 'code' as const,
      ...(value.approved === undefined ? {} : { approved: value.approved }),
    };
  });
}

type Dimension = Proposal['dimensions'][number];

function dimension(
  id: string,
  kind: Dimension['kind'],
  role: Dimension['role'],
  list: ValueSpec[],
): Dimension {
  return {
    id,
    title: `the dimension ${id}`,
    kind,
    role,
    produced_by: 'code',
    approved: true,
    values: values(list),
  };
}

/**
 * A small fictional map (Zed Bank). Axes: four stages (lost is unreachable from greet), two flows, three
 * deviation classes, two channels, a persona. Details: six transitions (one names no stage pair), one tool
 * with an input and an output dimension. Two constraints, and a phrase bank with one unapproved phrase.
 */
export function zedProposal(
  overrides: { phrases?: ProposalPhrase[]; extra?: Proposal['dimensions'] } = {},
): Proposal {
  const phrase = (dimension: string, value: string, text: string, lang = 'en'): ProposalPhrase => ({
    dimension,
    value,
    text,
    lang,
    produced_by: 'model',
    approved: true,
  });
  return {
    version: 1,
    agent: 'zed',
    produced_by: { family: 'lane', model: 'by hand', at: '2026-10-11T00:00:00.000Z' },
    sources: [{ kind: 'prompt', path: 'prompt.md' }],
    dimensions: [
      dimension('stage', 'stage', 'axis', ['greet', 'verify', 'help', 'lost']),
      dimension('stage_transition', 'behaviour', 'detail', [
        'greet-to-verify',
        'verify-to-verify',
        'verify-to-help',
        'help-to-verify',
        'lost-to-help',
        'greet-to-nowhere',
      ]),
      dimension('flow', 'behaviour', 'axis', ['balance', 'card']),
      dimension('deviation', 'deviation', 'axis', ['D1_off_topic', 'D5_language_switch', 'D8_tool_failure']),
      dimension('channel', 'channel', 'axis', ['chat', 'email']),
      dimension('user', 'persona', 'axis', ['customer', 'staff']),
      dimension('lookup.in.account', 'data', 'detail', [
        'lookup.in.account.below-min-length',
        'lookup.in.account.at-min-length',
      ]),
      dimension('lookup.out.found', 'data', 'detail', ['lookup.out.found.true', 'lookup.out.found.false']),
      ...(overrides.extra ?? []),
    ],
    constraints: [
      {
        forbid: { flow: 'card', channel: 'email' },
        reason: 'cards only on chat',
        evidence,
        produced_by: 'code',
        approved: true,
      },
      {
        forbid: { flow: 'card', stage: 'help' },
        reason: 'the card flow never reaches help',
        evidence,
        produced_by: 'model',
        approved: true,
      },
    ],
    phrases: overrides.phrases ?? [
      phrase('flow', 'balance', 'What is my balance?'),
      phrase('flow', 'card', 'I lost my card.'),
      phrase('flow', 'card', 'My card is gone.'),
      phrase('stage_transition', 'greet-to-verify', 'Hi, I need help with my account.'),
      phrase('stage_transition', 'verify-to-help', 'My account number is 4.'),
      phrase('deviation', 'D1_off_topic', 'Are you open on Sunday?'),
      phrase('deviation', 'D5_language_switch', 'Hallo, kunt u mij helpen?', 'nl'),
      phrase('user', 'staff', 'This is the branch desk.'),
      { ...phrase('channel', 'email', 'Sent from my mail.'), approved: false },
    ],
  };
}

export const ZED_TOOLS: ToolSchema[] = [
  {
    name: 'lookup',
    slug: 'lookup',
    input: {
      type: 'object',
      required: ['account'],
      properties: { account: { type: 'string', minLength: 1 } },
    },
    output: {
      type: 'object',
      required: ['found'],
      properties: { found: { type: 'boolean' }, owner: { type: 'string' } },
    },
  },
];

export function zedPrepared(overrides: Parameters<typeof zedProposal>[0] = {}): PreparedMap {
  return prepareMap(zedProposal(overrides), { tools: ZED_TOOLS });
}

/** Every user text a spec sends: block turns, injections and perturbation turns. */
export function userTexts(spec: Spec): string[] {
  const out: string[] = [];
  for (const block of spec.blocks) {
    if ('user' in block.when) out.push(block.when.user);
    else if ('injection' in block.when) out.push(block.when.injection.user);
    else out.push(...block.when.burst);
  }
  for (const perturbation of spec.perturbations ?? []) {
    if (perturbation.user !== undefined) out.push(perturbation.user);
    out.push(...(perturbation.burst ?? []));
  }
  return out;
}
