import {
  type Check,
  type CheckContext,
  type CriterionDef,
  type Message,
  type Observed,
  parseCriterionRef,
  type Stimulus,
  sentStimulus,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { taskArtifactText } from './artifacts';
import type { JudgeRequest, TranscriptEntry } from './contract';
import type { Council, CouncilResult } from './council';
import { withCriterionSettings } from './criterion-settings';

/**
 * `judgeCheck`: the council as a check. For every criterion a block names, it builds the request (the
 * rubric with its pictures, the transcript slice, the Given summary, the artifact text), asks the council
 * and returns one judge verdict with every vote.
 *
 * Judge verdicts sit beside the machine verdicts and never replace one: their ids start with `judge.`,
 * their kind is `judge`, and a block passes only when every gating verdict passes, so a judge pass can
 * never turn a machine fail into a pass. `combineVerdicts` states that rule for any caller that merges
 * the two lists itself.
 */

export const JUDGE_CHECK = 'judge';

export type JudgeCheckOptions = {
  /**
   * The text of the artifacts a block produced. Default `taskArtifactText`: for a task block, the files
   * read through `ctx.readArtifact` and rendered by the artifact readers, plus the workspace diff; for a
   * conversation block, nothing.
   */
  artifactText?: (ctx: CheckContext) => Promise<string | undefined> | string | undefined;
  /** How many earlier messages a block-scope request carries as context. Default 2. */
  contextMessages?: number;
};

export function judgeCheck(council: Council, options: JudgeCheckOptions = {}): Check {
  return {
    name: JUDGE_CHECK,
    applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,
    async evaluate(ctx) {
      const artifact = await (options.artifactText ?? taskArtifactText)(ctx);
      const verdicts: Verdict[] = [];
      for (const ref of ctx.expect.criteria ?? []) {
        const parsed = parseCriterionRef(ref);
        const name = parsed?.name ?? ref;
        const def = ctx.spec.criteria?.find((criterion) => criterion.name === name);
        const unassigned = council.unassignedReason(name);
        const gating = unassigned === undefined && ((parsed?.gating ?? false) || def?.gating === true);
        if (!def) {
          verdicts.push({
            id: `${JUDGE_CHECK}.${safeId(name)}`,
            kind: 'judge',
            name,
            gating,
            outcome: 'inconclusive',
            evidence: `criterion ${name} is not defined in the spec: nothing to judge`,
          });
          continue;
        }
        const request = {
          ...requestFor(ctx, def, artifact, options.contextMessages ?? 2),
          ...(def.inputs && def.inputs.length > 0 ? { inputs: await readInputs(ctx, def.inputs) } : {}),
        };
        const result = await council.judge(request, def.judge_class);
        const verdict = verdictOf(result, def, gating);
        verdicts.push(
          unassigned === undefined
            ? verdict
            : {
                ...verdict,
                evidence: `unassigned by calibration, not gating: ${unassigned} | ${verdict.evidence}`,
              },
        );
      }
      return uniqueIds(verdicts);
    },
  };
}

/** Two criterion names can map to one safe id. The later verdict gets a numeric suffix that no earlier id uses. */
function uniqueIds(verdicts: Verdict[]): Verdict[] {
  const used = new Set<string>();
  return verdicts.map((verdict) => {
    let id = verdict.id;
    for (let n = 2; used.has(id); n += 1) id = `${verdict.id}-${n}`;
    used.add(id);
    return id === verdict.id ? verdict : { ...verdict, id };
  });
}

/** The request one criterion sends for one block. */
export function requestFor(
  ctx: CheckContext,
  def: CriterionDef,
  artifact: string | undefined,
  contextMessages = 2,
): JudgeRequest {
  const scope = def.scope ?? 'block';
  const prefix = ctx.given.prefix;
  const earlier =
    scope === 'conversation' ? prefix : prefix.slice(Math.max(0, prefix.length - contextMessages));
  const transcript: TranscriptEntry[] = [
    ...earlier.flatMap(messageEntries),
    ...stimulusEntries(sentStimulus(ctx)),
    ...observedEntries(ctx.observed),
  ];
  return withCriterionSettings(
    {
      criterion: {
        name: def.name,
        rubric: def.rubric,
        ...(def.pass === undefined ? {} : { pass: def.pass }),
        ...(def.fail === undefined ? {} : { fail: def.fail }),
        scope,
      },
      transcript,
      ...(artifact === undefined ? {} : { artifact }),
      given: {
        ...(ctx.expect.stage === undefined ? {} : { stage: ctx.expect.stage }),
        ledger: ctx.ledger,
      },
    },
    def,
  );
}

/** The council's result as a judge verdict. */
export function verdictOf(result: CouncilResult, def: CriterionDef, gating: boolean): Verdict {
  const decisive = result.votes.find((vote) => vote.outcome === result.outcome && vote.reasoning);
  const errors = result.errors > 0 ? `; ${result.errors} judge(s) gave no answer` : '';
  return {
    id: `${JUDGE_CHECK}.${safeId(def.name)}`,
    kind: 'judge',
    name: def.name,
    gating,
    outcome: result.outcome,
    ...(result.score === undefined ? {} : { score: result.score }),
    evidence: `${result.log.join(' | ')}${errors}`,
    ...(decisive?.reasoning ? { reasoning: decisive.reasoning } : {}),
    judge: { cls: result.cls, votes: [...result.votes] },
  };
}

/**
 * Merges machine and judge verdicts. Machine verdicts are kept as they are; a judge verdict that claims
 * to be a machine verdict, or reuses a machine verdict's id, is refused. `pass` holds when every gating
 * verdict passes, so a machine fail stays a fail whatever the judges say.
 */
export function combineVerdicts(
  machine: readonly Verdict[],
  judged: readonly Verdict[],
): { verdicts: Verdict[]; pass: boolean } {
  const ids = new Set(machine.map((verdict) => verdict.id));
  const judgeIds = new Set<string>();
  for (const verdict of judged) {
    if (verdict.kind !== 'judge') {
      throw new Error(`verdict ${verdict.id} is not a judge verdict: a judge cannot write a machine verdict`);
    }
    if (ids.has(verdict.id)) {
      throw new Error(`judge verdict ${verdict.id} reuses a machine verdict id: a judge cannot override it`);
    }
    if (judgeIds.has(verdict.id))
      throw new Error(`judge verdict ${verdict.id} appears twice: ids must be unique`);
    judgeIds.add(verdict.id);
  }
  const verdicts = [...machine, ...judged];
  const machineFail = machine.some((verdict) => verdict.gating && verdict.outcome === 'fail');
  const pass =
    verdicts.length > 0 &&
    !machineFail &&
    verdicts.every((verdict) => !verdict.gating || verdict.outcome === 'pass');
  return { verdicts, pass };
}

export function safeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function messageEntries(message: Message): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  if (message.role === 'user') entries.push({ role: 'user', text: message.content });
  else if (message.role === 'assistant') {
    for (const call of message.tool_calls ?? []) {
      entries.push({ role: 'tool_call', tool: call.label, text: json(call.input ?? {}) });
      if (call.error !== undefined)
        entries.push({ role: 'tool_result', tool: call.label, text: `error: ${call.error}` });
      else if (call.output !== undefined)
        entries.push({ role: 'tool_result', tool: call.label, text: json(call.output) });
    }
    if (message.content) entries.push({ role: 'agent', text: message.content });
  } else if (message.role === 'tool') {
    entries.push({
      role: 'tool_result',
      ...(message.name ? { tool: message.name } : {}),
      text: message.content,
    });
  } else entries.push({ role: 'context', text: message.content });
  return entries;
}

/** The user turn the agent received, which the reply is judged against. */
function stimulusEntries(when: Stimulus): TranscriptEntry[] {
  if ('user' in when) return [{ role: 'user', text: when.user }];
  if ('burst' in when) return when.burst.map((text) => ({ role: 'user' as const, text }));
  return [{ role: 'user', text: when.injection.user }];
}

function observedEntries(observed: Observed): TranscriptEntry[] {
  return observed.segments.map((segment): TranscriptEntry => {
    if (segment.type === 'text') return { role: 'agent', text: segment.text };
    if (segment.type === 'tool_call')
      return { role: 'tool_call', tool: segment.label, text: json(segment.input) };
    if (segment.type === 'tool_result') {
      const text = segment.error !== undefined ? `error: ${segment.error}` : json(segment.output);
      return { role: 'tool_result', tool: segment.label, text };
    }
    return { role: 'card', tool: segment.name, text: json(segment.data ?? {}) };
  });
}

function json(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'null');
}

/**
 * The inputs a criterion names, as the agent was given them: from the Given workspace seed first, so an
 * input the agent changed is still read as it started, then from the workspace through `ctx.readArtifact`.
 * An input found in neither is named as not available, never dropped.
 */
export async function readInputs(
  ctx: CheckContext,
  paths: readonly string[],
): Promise<{ path: string; text: string }[]> {
  const seed = ctx.given.world.workspace?.files ?? {};
  const inputs: { path: string; text: string }[] = [];
  for (const path of paths) {
    const seeded = seed[path];
    if (seeded !== undefined) {
      inputs.push({ path, text: seeded });
      continue;
    }
    let text: string | undefined;
    if (ctx.readArtifact) {
      try {
        text = new TextDecoder().decode(await ctx.readArtifact(path));
      } catch {
        text = undefined;
      }
    }
    inputs.push({
      path,
      text: text ?? `(not available: ${path} is neither in the seed nor in the workspace)`,
    });
  }
  return inputs;
}
