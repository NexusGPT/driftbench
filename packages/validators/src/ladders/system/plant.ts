import type { Observed } from '@agent-nexus/driftbench-core';
import { type BlockTruth, FORBIDDEN, GUARD, LOOKUP } from './family';
import { between, type Rng } from './random';

/**
 * The hidden specification of the system validator, built by code from the seed. The plant holds the
 * truth before anything runs: which spec block carries which fault, how a perturbed run deviates and comes
 * back, and the true pass rates and correlation of the planted effect. The scripted agent reads the same
 * plant, so the answer is known by construction (docs/validators.md section 5).
 */

/** The stage catalogue of every planted flow. Block i must reach stage i. */
export const STAGES = ['open', 'identify', 'verify', 'search', 'offer', 'recap', 'confirm', 'close'] as const;

/** The stage a detour reports: in no catalogue, so the stage check fails on it. */
export const DETOUR = 'detour';

/** A spec in the raw form the loader takes. */
export type RawSpec = Record<string, unknown> & { id: string };

/** What the scripted agent does on one stimulus: the observation, given the target it runs as. */
export type Behaviour = (target: { variant?: string }) => Observed;

/** A fictional four-digit reference code, unique within one draw list. */
function codes(rng: Rng, count: number): string[] {
  const seen = new Set<string>();
  while (seen.size < count) seen.add(`R-${between(rng, 1000, 9999)}`);
  return [...seen];
}

/** The reply of the rule follower on block truth: English, the code, the stage, one lookup, the guard. */
export function followerReply(block: BlockTruth): Observed {
  const text = `Thank you. Step ${block.index + 1} of your request is recorded under reference ${block.code}, and I am ready to continue with you.`;
  const input = { email: block.email, step: block.index + 1 };
  const output = { status: 'found', step: block.index + 1 };
  return {
    segments: [
      { type: 'tool_call', id: `call-${block.index}`, label: LOOKUP, input },
      { type: 'tool_result', id: `call-${block.index}`, label: LOOKUP, output },
      { type: 'text', text },
    ],
    text,
    toolCalls: [{ id: `call-${block.index}`, label: LOOKUP, input, output }],
    runtime: { stages: [{ name: block.stage }], guards: [{ name: GUARD, verdict: 'allow' }] },
    cost: { usd: 0 },
    latencyMs: 0,
  };
}

/** One planted flow: its raw spec, the truth of each block and each block's stimulus text. */
export type Flow = { spec: RawSpec; truths: BlockTruth[]; texts: string[] };

/**
 * One planted flow of `blocks` blocks (eight by default): block i must reach stage i of the catalogue, taken
 * in a cycle past eight. Every block calls the lookup with the ledger's email, states its code, stays in
 * English and fires the policy guard; block 0 tells the agent the email changed.
 */
export function flow(
  rng: Rng,
  id: string,
  title: string,
  number: number,
  blocks: number = STAGES.length,
): Flow {
  const email = `customer${number}@example.org`;
  const oldEmail = `customer${number}.old@example.net`;
  const request = `Q-${between(rng, 100000, 999999)}`;
  const blockCodes = codes(rng, blocks);
  const truths: BlockTruth[] = Array.from({ length: blocks }, (_, index) => ({
    index,
    stages: STAGES,
    stage: STAGES[index % STAGES.length] as string,
    code: blockCodes[index] as string,
    email,
    oldEmail,
  }));
  const texts = truths.map((truth) =>
    truth.index === 0
      ? `Hello. My email changed: it was ${oldEmail} and it is now ${email}. Please start request ${request} (${id}).`
      : `Please continue with step ${truth.index + 1} of request ${request} (${id}).`,
  );
  const spec: RawSpec = {
    id,
    kind: 'conversation',
    title,
    lang: 'EN',
    stages: [...STAGES],
    given: { ledger: { email } },
    rules: { forbidden_tools: [FORBIDDEN] },
    blocks: truths.map((truth, index) => ({
      id: `b${index}`,
      when: { user: texts[index] },
      expect: {
        stage: truth.stage,
        tools: [{ label: LOOKUP, count: 1, input: { email } }],
        must: [`\\b${truth.code}\\b`],
        must_not: ['refund'],
        lang: 'EN',
        guards: [{ name: GUARD, verdict: 'allow', count: 1 }],
      },
    })),
  };
  return { spec, truths, texts };
}
