import {
  type ExtractResult,
  extractMap,
  type ModelPort,
  type Proposal,
  Recording,
  recordingPort,
  type SourceText,
} from '@agent-nexus/driftbench-generate';
import { oracleRecording } from './oracle';
import { INVENTORY_PATH, PROMPT_PATH, type Rendered, type RenderOptions, render, TOOLS_PATH } from './render';
import type { HiddenSpec } from './spec';
import { fold, forbidKey } from './truth';

/**
 * One run of the extraction pipeline on a rendered specification: the three artefacts as sources, the
 * perfect model's recording replayed through the recording port, and the extractor's answer. The extractor
 * is the code under test; the validator only reads what it returns.
 */

export type Extract = typeof extractMap;

/** Who answers the five model sections: the recording of the perfect model by default. */
export type Answerer = (spec: HiddenSpec, rendered: Rendered) => Recording | ModelPort;

export type PipelineDeps = {
  extract?: Extract;
  answerer?: Answerer;
};

export type MapRun = {
  spec: HiddenSpec;
  rendered: Rendered;
  result: ExtractResult;
};

/** A fixed clock: two runs of one seed give the same proposal. */
const NOW = () => new Date('2026-10-11T00:00:00.000Z');

export function sourcesOf(rendered: Rendered): SourceText[] {
  return [
    { kind: 'prompt', path: PROMPT_PATH, text: rendered.prompt },
    { kind: 'inventory', path: INVENTORY_PATH, text: rendered.inventory },
    { kind: 'tools', path: TOOLS_PATH, text: rendered.tools },
  ];
}

export async function runPipeline(
  spec: HiddenSpec,
  options: RenderOptions,
  deps: PipelineDeps = {},
): Promise<MapRun> {
  const rendered = render(spec, options);
  const answer = (deps.answerer ?? oracleRecording)(spec, rendered);
  const port = 'complete' in answer ? answer : recordingPort(Recording.parse(answer));
  const result = await (deps.extract ?? extractMap)({
    agent: spec.agent,
    sources: sourcesOf(rendered),
    port,
    now: NOW,
  });
  return { spec, rendered, result };
}

/**
 * A map as a set of facts, for comparing two maps up to quotes and titles: each dimension with its kind,
 * each value, each constraint, each phrase, and, when asked, each role and the order of the stages.
 */
export function mapFacts(proposal: Proposal, options: { roles: boolean; order: boolean }): Set<string> {
  const facts = new Set<string>();
  for (const dimension of proposal.dimensions) {
    facts.add(`dimension ${dimension.id} (${dimension.kind})`);
    if (options.roles) facts.add(`role ${dimension.id} = ${dimension.role}`);
    for (const value of dimension.values) facts.add(`value ${dimension.id}/${value.id}`);
    if (options.order && dimension.kind === 'stage') {
      facts.add(`order ${dimension.id}: ${dimension.values.map((value) => value.id).join(' > ')}`);
    }
  }
  for (const constraint of proposal.constraints) facts.add(`constraint ${forbidKey(constraint.forbid)}`);
  for (const phrase of proposal.phrases) {
    facts.add(`phrase ${phrase.dimension}/${phrase.value} [${phrase.lang}] ${fold(phrase.text)}`);
  }
  return facts;
}

/** What one map holds that the other does not, both ways. */
export function diffFacts(
  expected: ReadonlySet<string>,
  actual: ReadonlySet<string>,
): { missing: string[]; extra: string[] } {
  return {
    missing: [...expected].filter((fact) => !actual.has(fact)).sort(),
    extra: [...actual].filter((fact) => !expected.has(fact)).sort(),
  };
}
