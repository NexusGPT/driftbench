import type { EndStateSpec, Rules, ToolExpect } from '@driftbench/core';
import type { PathRelation, ProposalPhrase, Slots } from '../extract/proposal';
import type { BlockDraft, Pick, Stimulus } from './assemble';
import { TOOL_FAILURE, TOOL_FAILURE_ERROR } from './deviation';
import { dimensionId, type PreparedMap, phraseKey, valueId } from './map';
import { pick, type Rng } from './random';
import {
  type Context,
  endState,
  failureTools,
  fillText,
  matches,
  phraseFits,
  type Recovery,
  recoveryFor,
  slotsOf,
  stageAfter,
  toolExpect,
} from './relations';

/**
 * A scenario: one approved path of a flow, walked in a cell, with every Then derived by code from the map.
 * Each block is one turn of the path: the user turn is an approved phrase of the stage transition (its
 * slots filled with the values the cell's data values bind), the stage is the next stage of the path, the
 * tools are the calls the map links to the flow at that stage (inputs filled from the same slots), and
 * every other tool the scenario calls is expected 0 times in that turn. The last block holds the flow's end
 * state. A deviation probe is one more block at a stage of the path: its recovery (the stage after, the
 * words, the guards, the calls) comes from the map's recovery relation for that class in that flow. A tool
 * failure is the path's own turn with the tool failing in the Given, and the conversation stops there.
 * Nothing is read from an agent.
 */

export type ProbeRequest = {
  classId: string;
  /** The stage to probe at; any stage the recovery allows when absent. */
  stage?: string;
  /** For a tool failure: the tool that fails; any tool the path calls that has a recovery when absent. */
  tool?: string;
};

export type ScenarioRequest = {
  path: PathRelation;
  /** Values the seeder fixed: a t-wise row, a boundary value, a probe's class. */
  fixed: readonly Pick[];
  probe?: ProbeRequest;
  /** A phrase used wherever its value is said: one variant of a metamorphic family. */
  force?: ProposalPhrase;
};

export type Scenario =
  | {
      ok: true;
      cell: Pick[];
      blocks: BlockDraft[];
      endState?: EndStateSpec;
      rules?: Rules;
      /** The probe as placed: its class, the stage it is said at, the tool that fails. */
      probe?: { classId: string; stage: string; tool?: string };
      title: string;
    }
  | { ok: false; reason: string };

type Built = Extract<Scenario, { ok: true }>;

/** True when a phrase belongs to `dimension=value`. */
function isOf(phrase: ProposalPhrase, dimension: string, value: string): boolean {
  return phrase.dimension === dimension && phrase.value === value;
}

export function buildScenario(prepared: PreparedMap, rng: Rng, request: ScenarioRequest): Scenario {
  const { path } = request;
  const relations = prepared.relations;
  const dimensions = prepared.space.dimensions;
  const fail = (reason: string): Scenario => ({ ok: false, reason: `path ${path.id}: ${reason}` });
  const indexOf = (id: string) => dimensions.findIndex((dimension) => dimension.id === id);

  // The cell: the fixed values, the flow, and a value for every dimension the path's `when` names.
  const cell: Pick[] = [...request.fixed];
  const held = (dimension: number) => cell.find(([at]) => at === dimension);
  const flowDimension = indexOf('flow');
  const flowValue = dimensions[flowDimension]?.index.get(path.flow);
  if (flowDimension < 0 || flowValue === undefined) return fail(`the flow ${path.flow} is not in the map`);
  const heldFlow = held(flowDimension);
  if (heldFlow && heldFlow[1] !== flowValue) {
    return fail(`the cell holds the flow ${valueId(prepared, flowDimension, heldFlow[1])}, not ${path.flow}`);
  }
  if (!heldFlow) cell.push([flowDimension, flowValue]);
  for (const [dimensionKey, values] of Object.entries(path.when ?? {})) {
    const dimension = indexOf(dimensionKey);
    if (dimension < 0) return fail(`${dimensionKey} is not a dimension of the map`);
    const own = held(dimension);
    if (own) {
      const id = valueId(prepared, dimension, own[1]);
      if (!values.includes(id))
        return fail(`it needs ${dimensionKey} in ${values.join(', ')}; the cell holds ${id}`);
      continue;
    }
    const options = values.flatMap((value): Pick[] => {
      const index = dimensions[dimension]?.index.get(value);
      if (index === undefined) return [];
      return prepared.feasibility.allowed([...cell, [dimension, index]]) ? [[dimension, index]] : [];
    });
    const chosen = pick(rng, options);
    if (!chosen) return fail(`the constraints allow no value of ${dimensionKey} it needs with this cell`);
    cell.push(chosen);
  }
  if (!prepared.feasibility.allowed(cell)) return fail('the constraints forbid its values with this cell');

  const stageKey = prepared.stage === undefined ? 'stage' : dimensionId(prepared, prepared.stage);
  const transitionKey =
    prepared.transition === undefined ? undefined : dimensionId(prepared, prepared.transition);
  const deviationKey =
    prepared.deviation === undefined ? undefined : dimensionId(prepared, prepared.deviation);
  const contextOf = (stage: string): Context => {
    const context: Record<string, string> = {};
    for (const [dimension, value] of cell)
      context[dimensionId(prepared, dimension)] = valueId(prepared, dimension, value);
    context[stageKey] = stage;
    return context;
  };

  // The slot values the cell's data values bind, and which value bound each one.
  const slots: Record<string, string> = {};
  const boundBy = new Map<string, Pick>();
  for (const entry of cell) {
    const bound = relations.binds.get(
      `${dimensionId(prepared, entry[0])}=${valueId(prepared, entry[0], entry[1])}`,
    );
    for (const [slot, value] of Object.entries(bound ?? {})) {
      if (slots[slot] !== undefined) continue;
      slots[slot] = value;
      boundBy.set(slot, entry);
    }
  }

  const choosePhrase = (
    dimension: string,
    value: string,
    context: Context,
    at: Slots,
  ): ProposalPhrase | undefined => {
    if (request.force && isOf(request.force, dimension, value)) {
      return phraseFits(request.force, context, at) ? request.force : undefined;
    }
    const phrases = (prepared.phrasesOf.get(phraseKey(dimension, value)) ?? []).filter((phrase) =>
      phraseFits(phrase, context, at),
    );
    return pick(rng, phrases);
  };
  const stimulusOf = (phrase: ProposalPhrase | undefined, dimension: string, value: string): Stimulus => {
    if (!phrase) return { kind: 'placeholder', dimension, value };
    const filled = fillText(phrase.text, { ...slots, ...(phrase.binds ?? {}) });
    return { kind: 'phrase', phrase: { ...phrase, text: filled.ok ? filled.value : phrase.text } };
  };
  /** The data values whose slots a text or a value reads: what the block's own cell holds. */
  const sourcesOf = (...values: unknown[]): Pick[] =>
    values.flatMap(slotsOf).flatMap((slot) => {
      const source = boundBy.get(slot);
      return source ? [source] : [];
    });

  // A phrase probe goes in at a stage of the path, chosen before the walk: its phrase may bind a slot a later
  // turn reads (a plan named again at the recap).
  const probe = request.probe;
  let probeAt: number | undefined;
  let recovery: Recovery | undefined;
  if (probe && probe.classId !== TOOL_FAILURE) {
    if (deviationKey === undefined) return fail('the map has no deviation dimension');
    recovery = recoveryFor(relations, probe.classId, path.flow);
    if (!recovery) return fail(`the map gives no recovery from ${probe.classId} in the flow ${path.flow}`);
    const allowed = path.stages
      .map((stage, index) => ({ stage, index }))
      .filter(({ index }) => index >= 1 && index <= path.stages.length - 2)
      .filter(({ stage }) => (recovery?.at ? recovery.at.includes(stage) : true))
      .filter(({ stage }) => (probe.stage === undefined ? true : stage === probe.stage))
      .filter(({ stage }) =>
        choosePhraseExists(prepared, deviationKey, probe.classId, contextOf(stage), slots, request),
      );
    const chosen = pick(rng, allowed);
    if (!chosen) {
      return fail(
        `no stage of the path takes ${probe.classId}: none its recovery allows has an approved phrase`,
      );
    }
    probeAt = chosen.index;
  }

  const toolNames = new Set(prepared.tools.map((tool) => tool.name));
  const blocks: BlockDraft[] = [];
  const lang = relations.replyLanguage;
  let movedAway = false;
  for (let index = 0; index + 1 < path.stages.length; index += 1) {
    if (probeAt === index && probe && deviationKey !== undefined && recovery) {
      const stage = path.stages[index] as string;
      const deviation = dimensions[prepared.deviation ?? -1]?.index.get(probe.classId);
      if (deviation === undefined) return fail(`${probe.classId} is not a value of the deviation dimension`);
      const phrase = choosePhrase(deviationKey, probe.classId, contextOf(stage), slots);
      for (const [slot, value] of Object.entries(phrase?.binds ?? {})) slots[slot] = value;
      const tools: ToolExpect[] = [];
      for (const call of recovery.tools) {
        const expected = toolExpect(call.tool, call.count, call.input, slots);
        if (!expected.ok)
          return fail(`the recovery of ${probe.classId} reads unbound slots ${expected.missing.join(', ')}`);
        tools.push(expected.value);
      }
      const words = (patterns: string[]) => {
        const out: string[] = [];
        for (const pattern of patterns) {
          const filled = fillText(pattern, slots, true);
          if (!filled.ok) return undefined;
          out.push(filled.value);
        }
        return out;
      };
      const must = words(recovery.must);
      const mustNot = words(recovery.mustNot);
      if (!must || !mustNot)
        return fail(`the recovery of ${probe.classId} reads a slot the cell does not bind`);
      const after = stageAfter(recovery, stage);
      blocks.push({
        id: `b${blocks.length + 1}-${probe.classId}`,
        stimulus: stimulusOf(phrase, deviationKey, probe.classId),
        injection: probe.classId,
        ...(after === undefined ? {} : { stage: after }),
        carries: [[prepared.deviation as number, deviation]],
        ...(tools.length > 0 ? { tools } : {}),
        ...(recovery.guards.length > 0 ? { guards: recovery.guards } : {}),
        ...(must.length > 0 ? { must } : {}),
        ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
        ...(lang === undefined ? {} : { lang }),
      });
      // A recovery that leaves the conversation elsewhere than the stage it had reached (a goal shift goes
      // back to the stage that owns the change) ends the walk: the path's next turn starts from a stage the
      // conversation is no longer at.
      if (after !== undefined && after !== stage) {
        movedAway = true;
        break;
      }
    }
    const from = path.stages[index] as string;
    const to = path.stages[index + 1] as string;
    const transitionId = `${from}-to-${to}`;
    const transition =
      prepared.transition === undefined
        ? undefined
        : dimensions[prepared.transition]?.index.get(transitionId);
    if (transitionKey === undefined || transition === undefined) {
      return fail(`the map has no stage transition ${transitionId}`);
    }
    const context = contextOf(from);
    const phrase = choosePhrase(transitionKey, transitionId, context, slots);
    for (const [slot, value] of Object.entries(phrase?.binds ?? {})) slots[slot] = value;
    const tools: ToolExpect[] = [];
    const ruled: Pick[] = [];
    for (const call of relations.usesTools) {
      const subject =
        call.subject.dimension === 'flow'
          ? call.subject.value === path.flow
          : context[call.subject.dimension] === call.subject.value;
      if (!subject || call.stage !== from || (call.to !== undefined && call.to !== to)) continue;
      if (!matches(call.when, context)) continue;
      if (toolNames.size > 0 && !toolNames.has(call.tool))
        return fail(`${call.tool} is not a tool of the map`);
      const expected = toolExpect(call.tool, call.count, call.input, slots);
      if (!expected.ok)
        return fail(`${call.tool} at ${from} reads unbound slots ${expected.missing.join(', ')}`);
      tools.push(expected.value);
      for (const dimension of Object.keys(call.when ?? {})) {
        const at = indexOf(dimension);
        const value = held(at);
        if (value) ruled.push(value);
      }
      ruled.push(...sourcesOf(call.input ?? {}));
    }
    const carries = unique([
      [prepared.transition as number, transition],
      ...sourcesOf(phrase?.text ?? ''),
      ...ruled,
    ]);
    blocks.push({
      id: `b${blocks.length + 1}-${transitionId}`,
      stimulus: stimulusOf(phrase, transitionKey, transitionId),
      stage: to,
      carries,
      ...(tools.length > 0 ? { tools } : {}),
      ...(lang === undefined ? {} : { lang }),
    });
  }

  let placed: Built['probe'];
  let truncated = false;
  if (probe && probe.classId === TOOL_FAILURE) {
    const failed = toolFailure(prepared, rng, path, blocks, cell, probe);
    if (!failed.ok) return fail(failed.reason);
    placed = failed.placed;
    truncated = true;
  } else if (probe && probeAt !== undefined) {
    placed = { classId: probe.classId, stage: path.stages[probeAt] as string };
    if (movedAway) truncated = true;
  }

  // Every tool the scenario calls is expected 0 times in a turn that does not call it; a tool it never calls
  // is forbidden in every turn.
  const inPlay = new Set<string>();
  for (const block of blocks) for (const tool of block.tools ?? []) if (calls(tool)) inPlay.add(tool.label);
  for (const block of blocks) {
    const listed = new Set((block.tools ?? []).map((tool) => tool.label));
    const closed = [...inPlay].filter((label) => !listed.has(label)).map((label) => ({ label, count: 0 }));
    if (closed.length > 0) block.tools = [...(block.tools ?? []), ...closed];
  }
  const forbidden = prepared.tools.map((tool) => tool.name).filter((name) => !inPlay.has(name));
  const rules: Rules = {
    ...(forbidden.length > 0 ? { forbidden_tools: forbidden } : {}),
    ...(probe?.classId === 'D7_silence_or_burst' ? { one_message_per_turn: true } : {}),
  };

  let end: EndStateSpec | undefined;
  if (!truncated && path.end_state) {
    const filled = endState(path.end_state, slots);
    if (!filled.ok) return fail(`its end state reads unbound slots ${filled.missing.join(', ')}`);
    end = filled.value;
  }
  const title = `Path ${path.id} of ${path.flow}: ${path.stages.join(' > ')}${
    placed ? `, ${placed.classId}${placed.tool ? ` of ${placed.tool}` : ''} at ${placed.stage}` : ''
  }`;
  return {
    ok: true,
    cell,
    blocks,
    ...(end ? { endState: end } : {}),
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
    ...(placed ? { probe: placed } : {}),
    title,
  };
}

function choosePhraseExists(
  prepared: PreparedMap,
  dimension: string,
  value: string,
  context: Context,
  slots: Slots,
  request: ScenarioRequest,
): boolean {
  if (request.force && isOf(request.force, dimension, value))
    return phraseFits(request.force, context, slots);
  return (prepared.phrasesOf.get(phraseKey(dimension, value)) ?? []).some((phrase) =>
    phraseFits(phrase, context, slots),
  );
}

/** True when a tool expectation asks for at least one call. */
function calls(tool: ToolExpect): boolean {
  const count = tool.count ?? 1;
  return typeof count === 'number' ? count > 0 : (count.min ?? 0) > 0 || (count.max ?? 1) > 0;
}

function unique(picks: Pick[]): Pick[] {
  const seen = new Set<number>();
  return picks.filter(([dimension]) => {
    if (seen.has(dimension)) return false;
    seen.add(dimension);
    return true;
  });
}

/**
 * A tool failure: the turn of the path that calls a tool the map gives a recovery for fails it in the Given.
 * The block becomes the probe (an injection of D8 with the same user turn), expects the recovery's stage and
 * calls, and the conversation stops there. A data value of the cell that names the tool records it.
 */
function toolFailure(
  prepared: PreparedMap,
  rng: Rng,
  path: PathRelation,
  blocks: BlockDraft[],
  cell: Pick[],
  probe: ProbeRequest,
): { ok: true; placed: { classId: string; stage: string; tool: string } } | { ok: false; reason: string } {
  const recoverable = failureTools(prepared.relations, TOOL_FAILURE, path.flow);
  const named = cell
    .map(([dimension, value]) => valueId(prepared, dimension, value))
    .find((id) => recoverable.includes(id));
  const wanted = probe.tool ?? named;
  const options = blocks.flatMap((block, index) =>
    (block.tools ?? [])
      .filter((tool) => calls(tool) && recoverable.includes(tool.label))
      .filter((tool) => wanted === undefined || tool.label === wanted)
      .map((tool) => ({ index, tool: tool.label })),
  );
  const chosen = pick(rng, options);
  if (!chosen) {
    return {
      ok: false,
      reason: `no turn calls a tool whose failure the map recovers in ${path.flow}${wanted ? ` (${wanted})` : ''}`,
    };
  }
  const recovery = recoveryFor(prepared.relations, TOOL_FAILURE, path.flow, chosen.tool) as Recovery;
  const block = blocks[chosen.index] as BlockDraft;
  const at = path.stages[chosen.index] as string;
  const after = stageAfter(recovery, at);
  // The turn calls its tools in the order the map lists them: the ones before the failing tool still run,
  // the ones after it never do. The recovery's calls replace or add theirs; a call the turn already
  // expected keeps its input assertions, because the agent sends the same arguments to a failing tool.
  const listed = block.tools ?? [];
  const failing = listed.findIndex((tool) => tool.label === chosen.tool);
  const tools = new Map(
    listed.map((tool, index): [string, ToolExpect] => [
      tool.label,
      index > failing && calls(tool) ? { label: tool.label, count: 0 } : tool,
    ]),
  );
  for (const call of recovery.tools) {
    const expected = toolExpect(call.tool, call.count, call.input, {});
    if (!expected.ok) return { ok: false, reason: `the recovery of ${chosen.tool} reads slots` };
    const before = tools.get(call.tool);
    const input = expected.value.input ?? (before && calls(before) ? before.input : undefined);
    tools.set(call.tool, { label: call.tool, count: expected.value.count ?? 1, ...(input ? { input } : {}) });
  }
  block.tools = [...tools.values()];
  if (after === undefined) delete block.stage;
  else block.stage = after;
  block.injection = TOOL_FAILURE;
  block.id = `b${chosen.index + 1}-${TOOL_FAILURE}`;
  block.given = { world: { tools: { [chosen.tool]: { error: TOOL_FAILURE_ERROR } } } };
  if (recovery.guards.length > 0) block.guards = recovery.guards;
  // The words of the recovery: what the honest report must and must not say.
  const words = (patterns: string[]) =>
    patterns.flatMap((pattern) => {
      const filled = fillText(pattern, {}, true);
      return filled.ok ? [filled.value] : [];
    });
  const must = words(recovery.must);
  const mustNot = words(recovery.mustNot);
  if (must.length > 0) block.must = must;
  if (mustNot.length > 0) block.must_not = mustNot;
  const deviation = prepared.space.dimensions[prepared.deviation ?? -1]?.index.get(TOOL_FAILURE);
  if (deviation !== undefined) block.carries = [[prepared.deviation as number, deviation], ...block.carries];
  blocks.splice(chosen.index + 1);
  // The failing tool as a data value of the cell, when the map names tools as data (Acme's failing_tool).
  if (named === undefined) {
    prepared.space.dimensions.forEach((dimension, index) => {
      if (dimension.kind !== 'data' || cell.some(([at]) => at === index)) return;
      const value = dimension.index.get(chosen.tool);
      if (value !== undefined && prepared.feasibility.allowed([...cell, [index, value]]))
        cell.push([index, value]);
    });
  }
  return { ok: true, placed: { classId: TOOL_FAILURE, stage: at, tool: chosen.tool } };
}
