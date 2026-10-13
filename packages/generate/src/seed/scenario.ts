import type { EndStateSpec, Expect, PerturbationSpec, Rules, ToolExpect } from '@agent-nexus/driftbench-core';
import type { PathRelation, ProposalPhrase, Slots } from '../extract/proposal';
import type { BlockDraft, Pick, Stimulus } from './assemble';
import { OPENING_CLASSES, TOOL_FAILURE, TOOL_FAILURE_ERROR } from './deviation';
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
  /**
   * A turn said after the walk's first move that must not move the conversation: a request the agent
   * refuses or defers (a value outside what a tool accepts, a write asked for before the confirmation).
   * Its Then is the stage the walk had reached, with the tool counts given; the walk ends there.
   */
  turn?: { stimulus: Stimulus; carries: Pick[]; tools: ToolExpect[] };
};

export type Scenario =
  | {
      ok: true;
      cell: Pick[];
      blocks: BlockDraft[];
      /** Tool output partitions whose bound values the reply assertions read. */
      replyData: Pick[];
      endState?: EndStateSpec;
      rules?: Rules;
      /** The probe as placed: its class, the stage it is said at, the tool that fails. */
      probe?: { classId: string; stage: string; tool?: string };
      /** A deviation a perturbed run injects into the clean walk, with the recovery as its Then. */
      perturbations?: PerturbationSpec[];
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
  // Every stage the walk reaches holds with the cell: a value the path states nothing about (a coverage
  // result on a flow that checks no coverage) rules the path out.
  if (prepared.stage !== undefined) {
    for (const stage of path.stages.slice(1)) {
      const at = dimensions[prepared.stage]?.index.get(stage);
      if (at !== undefined && !prepared.feasibility.allowed([...cell, [prepared.stage, at]]))
        return fail(`the constraints forbid the stage ${stage} with this cell`);
    }
  }

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
    opening = false,
  ): ProposalPhrase | undefined => {
    if (request.force && isOf(request.force, dimension, value)) {
      return phraseFits(request.force, context, at) ? request.force : undefined;
    }
    // A phrase of the flow, said on the first turn of a path of that flow, stands in for the opening move.
    if (opening && request.force && isOf(request.force, 'flow', path.flow)) {
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
      // A probe goes in before a move, or after the last stage when its recovery keeps the conversation
      // there (a question once the order is placed); a recovery that moves it needs a move after.
      .filter(({ stage, index }) => {
        if (index <= path.stages.length - 2) return true;
        const after = recovery ? stageAfter(recovery, stage) : undefined;
        return after === undefined || after === stage;
      })
      .filter(({ index }) => index >= 1 || OPENING_CLASSES.has(probe.classId))
      .filter(({ stage, index }) => index >= 1 || discriminates(recovery as Recovery, stage, path.stages[0]))
      .filter(({ stage }) => (recovery?.at ? recovery.at.includes(stage) : true))
      .filter(({ stage }) => (probe.stage === undefined ? true : stage === probe.stage))
      // The map's constraints hold for the probe too: a class the map forbids at a stage is never said there.
      .filter(({ stage }) => {
        const stageIndex = prepared.stage;
        const deviationIndex = prepared.deviation;
        const stagePick = stageIndex === undefined ? undefined : dimensions[stageIndex]?.index.get(stage);
        const classPick =
          deviationIndex === undefined ? undefined : dimensions[deviationIndex]?.index.get(probe.classId);
        const picks: Pick[] = [...cell];
        if (stageIndex !== undefined && stagePick !== undefined) picks.push([stageIndex, stagePick]);
        if (deviationIndex !== undefined && classPick !== undefined) picks.push([deviationIndex, classPick]);
        return prepared.feasibility.allowed(picks);
      })
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
  const replyData: Pick[] = [];
  const lang = relations.replyLanguage;
  let movedAway = false;
  let turnPlaced = false;
  for (let index = 0; index < path.stages.length; index += 1) {
    if (request.turn && index === 1) {
      blocks.push({
        id: `b${blocks.length + 1}-value`,
        stimulus: request.turn.stimulus,
        stage: path.stages[index] as string,
        carries: request.turn.carries,
        tools: request.turn.tools,
        ...(lang === undefined ? {} : { lang }),
      });
      turnPlaced = true;
      break;
    }
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
    // The last stage takes no move: only a probe said after it.
    if (index + 1 >= path.stages.length) break;
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
    const phrase = choosePhrase(transitionKey, transitionId, context, slots, index === 0);
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
    // What the reply of this turn must state (a quoted price read from the tool's answer), from the map.
    const stated: string[] = [];
    const unstated: string[] = [];
    for (const entry of relations.states) {
      const subject =
        entry.subject.dimension === 'flow'
          ? entry.subject.value === path.flow
          : context[entry.subject.dimension] === entry.subject.value;
      if (!subject || entry.stage !== from || (entry.to !== undefined && entry.to !== to)) continue;
      if (!matches(entry.when, context)) continue;
      for (const slot of slotsOf([entry.must, entry.must_not])) {
        const source = boundBy.get(slot);
        if (!source || prepared.toolDimensions.get(source[0])?.direction !== 'out') continue;
        const original = relations.binds.get(
          `${dimensionId(prepared, source[0])}=${valueId(prepared, source[0], source[1])}`,
        )?.[slot];
        if (slots[slot] !== original) return fail(`the phrase overrides tool output slot ${slot}`);
      }
      for (const [patterns, target] of [
        [entry.must ?? [], stated],
        [entry.must_not ?? [], unstated],
      ] as const) {
        for (const pattern of patterns) {
          const filled = fillText(pattern, slots, true);
          if (!filled.ok)
            return fail(`what the reply states at ${from} reads unbound slots ${filled.missing.join(', ')}`);
          target.push(filled.value);
        }
      }
      for (const dimension of Object.keys(entry.when ?? {})) {
        const value = held(indexOf(dimension));
        if (value) ruled.push(value);
      }
      const sources = sourcesOf(entry.must, entry.must_not);
      ruled.push(...sources);
      replyData.push(...sources.filter(([at]) => prepared.toolDimensions.get(at)?.direction === 'out'));
    }
    const carries = unique([[prepared.transition as number, transition], ...ruled]);
    blocks.push({
      id: `b${blocks.length + 1}-${transitionId}`,
      stimulus: stimulusOf(phrase, transitionKey, transitionId),
      stage: to,
      saidAt: from,
      carries,
      ...(tools.length > 0 ? { tools } : {}),
      ...(stated.length > 0 ? { must: stated } : {}),
      ...(unstated.length > 0 ? { must_not: unstated } : {}),
      ...(lang === undefined ? {} : { lang }),
    });
  }

  let placed: Built['probe'];
  let truncated = turnPlaced;
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

  // A clean walk declares one perturbation for mode P: a deviation class whose recovery keeps the
  // conversation on the stage it reached, said before the turn that leaves that stage, with the recovery as
  // its Then. The rest of the walk stays valid after it, so the perturbed run checks every later block too.
  const perturbations: PerturbationSpec[] = [];
  if (!probe && !request.turn && deviationKey !== undefined && prepared.deviation !== undefined) {
    const options: Array<{ classId: string; index: number; expect: Expect; user: string }> = [];
    for (const value of dimensions[prepared.deviation]?.values ?? []) {
      const classId = value.id;
      if (classId === TOOL_FAILURE) continue;
      const own = recoveryFor(relations, classId, path.flow);
      if (!own) continue;
      for (let index = 0; index + 1 < path.stages.length; index += 1) {
        const stage = path.stages[index] as string;
        if (index === 0 && !OPENING_CLASSES.has(classId)) continue;
        if (own.at && !own.at.includes(stage)) continue;
        const after = stageAfter(own, stage);
        if (after !== undefined && after !== stage) continue;
        const said = { ...slots };
        const phrase = choosePhrase(deviationKey, classId, contextOf(stage), said);
        if (!phrase) continue;
        const text = fillText(phrase.text, { ...said, ...(phrase.binds ?? {}) });
        if (!text.ok) continue;
        const expect = recoveryExpect(own, stage, { ...said, ...(phrase.binds ?? {}) }, inPlay, lang);
        if (!expect) continue;
        options.push({ classId, index, expect, user: text.value });
      }
    }
    const chosen = pick(rng, options);
    if (chosen) {
      perturbations.push({
        id: `p1-${chosen.classId}`,
        class: chosen.classId as PerturbationSpec['class'],
        inject_at: chosen.index,
        user: chosen.user,
        expect: chosen.expect,
        // The map's recovery keeps the conversation where it was: the injected block itself recovers.
        recovery: { within_blocks: 0, stage_after: chosen.expect.stage as string },
      });
    }
  }

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
    replyData: unique(replyData),
    ...(end ? { endState: end } : {}),
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
    ...(placed ? { probe: placed } : {}),
    ...(perturbations.length > 0 ? { perturbations } : {}),
    title,
  };
}

/**
 * True when a recovery said on the first turn can fail a reply that does nothing: it leaves the start stage,
 * or asks for a tool call. A word it states does not help: the echo agent repeats every literal word of the
 * spec's patterns, so a `must` alone is passed by it. A recovery that stays on the start stage and
 * states no such word is passed by an agent that reports the start stage and replies in English.
 */
function discriminates(recovery: Recovery, stage: string, start: string | undefined): boolean {
  const after = stageAfter(recovery, stage);
  if (after !== undefined && after !== start) return true;
  return recovery.tools.some((call) => call.count !== 0);
}

/**
 * The Then of a recovery said at `stage`: the stage it stays on, its calls, every other tool in play 0 times,
 * its guards and words, the reply language. Undefined when its words or calls read a slot nothing binds.
 */
function recoveryExpect(
  recovery: Recovery,
  stage: string,
  slots: Record<string, string>,
  inPlay: ReadonlySet<string>,
  lang: string | undefined,
): Expect | undefined {
  const tools: ToolExpect[] = [];
  for (const call of recovery.tools) {
    const expected = toolExpect(call.tool, call.count, call.input, slots);
    if (!expected.ok) return undefined;
    tools.push(expected.value);
  }
  for (const label of inPlay)
    if (!tools.some((tool) => tool.label === label)) tools.push({ label, count: 0 });
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
  if (!must || !mustNot) return undefined;
  return {
    stage: stageAfter(recovery, stage) ?? stage,
    stage_reported: true,
    ...(tools.length > 0 ? { tools } : {}),
    ...(recovery.guards.length > 0 ? { guards: recovery.guards } : {}),
    ...(must.length > 0 ? { must } : {}),
    ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
    ...(lang === undefined ? {} : { lang }),
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
  // A probe asked at a stage fails a tool of the turn said at that stage.
  const options = blocks.flatMap((block, index) =>
    (probe.stage === undefined || path.stages[index] === probe.stage ? (block.tools ?? []) : [])
      .filter((tool) => calls(tool) && recoverable.includes(tool.label))
      .filter((tool) => wanted === undefined || tool.label === wanted)
      .map((tool) => ({ index, tool: tool.label })),
  );
  const chosen = pick(rng, options);
  if (!chosen) {
    return {
      ok: false,
      reason: `no turn${probe.stage ? ` said at ${probe.stage}` : ''} calls a tool whose failure the map recovers in ${path.flow}${wanted ? ` (${wanted})` : ''}`,
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
  // The failing turn states the recovery's words, not what the turn would have stated with an answer.
  if (must.length > 0) block.must = must;
  else delete block.must;
  if (mustNot.length > 0) block.must_not = mustNot;
  else delete block.must_not;
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
