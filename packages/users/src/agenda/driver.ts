import {
  type DriverContext,
  type DriverStep,
  provenanceHash,
  type SimulatedUserSpec,
  type Spec,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '../scripted';
import { checkUserFamilies, holdsValue, SimulatedUserError, type UserModelPort } from '../simulated';
import {
  AgendaEngine,
  type AgentActs,
  ENGINE_VERSION,
  engineParams,
  type PlannedAct,
  type PlannedStyle,
} from './engine';
import {
  type AgentActLabeller,
  type Exchange,
  modelLabeller,
  patternLabeller,
  REALISER_SYSTEM,
  realiserRequest,
  TEMPLATE_HASH,
} from './realiser';

/**
 * The block-mode user: plays a spec whose blocks may each carry `when.simulated_user`. A block without it,
 * or in mode `exact`, sends its user text as written; a `replay` block sends its frozen text after checking
 * the recorded hash; a `simulated` block has the agenda engine plan the message and the realiser write it.
 * One person plays every simulated block of a spec: their persona, goal and facts are read from the first
 * simulated block, and a later one that names another person is refused.
 *
 * Every turn goes to the disclosure ledger: the agent labels the engine read, the planned acts and style,
 * the text written, the facts given in that turn and in total, and the engagement after it.
 */

export type LedgerTurn = {
  block: number;
  blockId?: string;
  mode: SimulatedUserSpec['mode'] | 'scripted';
  /** The engine's turn count, on a simulated block. */
  turn?: number;
  agentActs?: AgentActs;
  plannedActs?: PlannedAct[];
  style?: PlannedStyle;
  /** The message sent; absent on a turn that stopped the conversation. */
  text?: string;
  /** The facts this turn gave, by name. */
  disclosed: string[];
  disclosedTotal: string[];
  engagement?: number;
  stop?: 'goodbye' | 'abandon' | 'stop_token';
};

export type BlockUserOptions = {
  spec: Spec;
  /** The model that writes the simulated messages. Required when the spec has a simulated block. */
  port?: UserModelPort;
  /**
   * How the engine reads the agent turns: `model` (the default with a port) labels each turn with the port,
   * `patterns` reads only the ask patterns the spec declares, or a labeller of your own.
   */
  labeller?: 'model' | 'patterns' | AgentActLabeller;
  agentFamily: string;
  judgeFamilies: readonly string[];
  /** Overrides the spec's seed, such as `<seed>#<trial>` for one of k trials. */
  seed?: string;
  maxTokens?: number;
};

export type BlockUser = UserDriver & {
  ledger(): LedgerTurn[];
  /** The simulated user the spec defines, or undefined when no block is simulated. */
  readonly person?: SimulatedUserSpec;
};

/** The simulated user a block carries, if any. */
export function simulatedUserOf(spec: Spec, index: number): SimulatedUserSpec | undefined {
  const when = spec.blocks[index]?.when;
  return when && 'user' in when ? when.simulated_user : undefined;
}

/** The fields that name the person: equal on every simulated block of one spec. */
function personOf(user: SimulatedUserSpec): Omit<SimulatedUserSpec, 'mode' | 'recorded' | 'trials'> {
  const { mode: _mode, recorded: _recorded, trials: _trials, ...person } = user;
  return person;
}

export function createBlockUser(options: BlockUserOptions): BlockUser {
  const { spec } = options;
  const simulated = spec.blocks
    .map((_, index) => ({ index, user: simulatedUserOf(spec, index) }))
    .filter((entry) => entry.user?.mode === 'simulated');
  const first = simulated[0];
  const person = first?.user;
  if (person) {
    if (spec.blocks.some((block) => block.parent !== undefined)) {
      throw new SimulatedUserError(
        `${spec.id}: a simulated block in a spec with parent links is not supported: one engine plays one conversation`,
      );
    }
    const identity = JSON.stringify(personOf(person));
    for (const other of simulated.slice(1)) {
      if (other.user && JSON.stringify(personOf(other.user)) !== identity) {
        throw new SimulatedUserError(
          `${spec.id}: block ${other.index} defines another simulated user than block ${first.index}: one spec plays one person`,
        );
      }
    }
    if (!options.port) {
      throw new SimulatedUserError(
        `${spec.id}: block ${first.index} is simulated: give a model port or a cassette`,
      );
    }
    checkUserFamilies({
      port: options.port,
      agentFamily: options.agentFamily,
      judgeFamilies: options.judgeFamilies,
    });
  }
  const facts = person?.hidden_knowledge ?? {};
  const seed = options.seed ?? String(person?.seed ?? spec.id);
  const labeller: AgentActLabeller | undefined = !person
    ? undefined
    : typeof options.labeller === 'function'
      ? options.labeller
      : options.labeller === 'patterns' || !options.port
        ? patternLabeller(person.ask_patterns ?? {})
        : modelLabeller(options.port, Object.keys(facts), seed);
  const scripted = createScriptedDriver({ allowSimulated: true });

  let engine: AgendaEngine | undefined;
  let ledger: LedgerTurn[] = [];
  let transcript: Exchange[] = [];
  let observed = 0;
  let pendingActs: AgentActs | undefined;

  const reset = () => {
    engine = undefined;
    ledger = [];
    transcript = [];
    observed = 0;
    pendingActs = undefined;
  };

  /** The agent replies the engine has not read yet: each is labelled and observed, in order. */
  const catchUp = async (ctx: DriverContext) => {
    const history = ctx.history;
    for (; observed < history.length; observed += 1) {
      const result = history[observed];
      if (!result) continue;
      transcript.push({ who: 'Agent', text: result.observed.text });
      if (engine && labeller && engine.turn > 0) {
        const acts = await labeller(result.observed.text);
        engine.observe(acts);
        pendingActs = acts;
      }
    }
  };

  return {
    id: person && options.port ? `simulated-block:${options.port.family}` : 'scripted',
    seeds: person
      ? {
          seed,
          family: options.port?.family ?? 'none',
          model: options.port?.model ?? 'unknown',
          template: TEMPLATE_HASH,
          engine: ENGINE_VERSION,
        }
      : {},
    ...(person ? { person } : {}),
    ledger: () => ledger.map((turn) => ({ ...turn })),
    async next(ctx: DriverContext): Promise<DriverStep> {
      if (ctx.history.length === 0) reset();
      const step = await scripted.next(ctx);
      if (step.kind !== 'block') return step;
      await catchUp(ctx);
      const block = spec.blocks[step.blockIndex];
      const user = simulatedUserOf(spec, step.blockIndex);
      const blockId = block?.id;
      const base = { block: step.blockIndex, ...(blockId === undefined ? {} : { blockId }) };
      const disclosedTotal = () => [...(engine?.disclosed ?? [])].sort();
      if (user?.mode !== 'simulated') {
        const text = 'user' in step.stimulus ? step.stimulus.user : undefined;
        if (user?.mode === 'replay' && user.recorded && text !== undefined) {
          if (provenanceHash(text) !== user.recorded.hash) {
            throw new SimulatedUserError(
              `${spec.id}: block ${step.blockIndex} replays a text that does not match its recorded hash`,
            );
          }
        }
        if (text !== undefined) transcript.push({ who: 'Customer', text });
        ledger.push({
          ...base,
          mode: user?.mode ?? 'scripted',
          ...(text === undefined ? {} : { text }),
          disclosed: [],
          disclosedTotal: disclosedTotal(),
        });
        return step;
      }
      if (!person || !options.port) throw new SimulatedUserError('unreachable: no simulated user');
      if (!engine) {
        const goal = person.goal ?? ('user' in step.stimulus ? step.stimulus.user : spec.id);
        engine = new AgendaEngine({
          goal,
          facts,
          volunteer: Object.entries(person.reveal ?? {})
            .filter(([, reveal]) => reveal === 'volunteer')
            .map(([fact]) => fact),
          seed,
          params: engineParams(person.engine),
        });
      }
      const before = new Set(engine.disclosed);
      const agentActs = pendingActs;
      pendingActs = undefined;
      const plan = engine.plan();
      const given = [...engine.disclosed].filter((fact) => !before.has(fact)).sort();
      const common = {
        ...base,
        mode: 'simulated' as const,
        turn: engine.turn,
        ...(agentActs ? { agentActs } : {}),
        plannedActs: plan.acts,
        style: plan.style,
        engagement: engine.engagement,
      };
      if (plan.stop) {
        ledger.push({ ...common, disclosed: given, disclosedTotal: disclosedTotal(), stop: plan.stop });
        return {
          kind: 'stop',
          reason: `the simulated user ${plan.stop === 'goodbye' ? 'said goodbye' : 'gave up'} at block ${step.blockIndex}`,
        };
      }
      const request = realiserRequest({
        situation: [person.persona, `Your goal: ${engine.goal}`].filter(Boolean).join('\n'),
        transcript,
        plan,
        goal: engine.goal,
        facts,
      });
      const raw = await options.port.complete({
        system: REALISER_SYSTEM,
        user: request,
        seed,
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      });
      const text = raw
        .trim()
        .replace(/^"(.*)"$/s, '$1')
        .trim();
      if (person.stop && text.includes(person.stop)) {
        ledger.push({ ...common, disclosed: given, disclosedTotal: disclosedTotal(), stop: 'stop_token' });
        return { kind: 'stop', reason: `the simulated user said the stop token at block ${step.blockIndex}` };
      }
      if (text === '') {
        throw new SimulatedUserError(`the realiser wrote an empty message at block ${step.blockIndex}`);
      }
      const leaked = leaks(text, facts, engine.disclosed);
      if (leaked.length > 0) {
        throw new SimulatedUserError(
          `the simulated user gave ${leaked.join(', ')} at block ${step.blockIndex} before the plan gave ${leaked.length === 1 ? 'it' : 'them'}`,
        );
      }
      transcript.push({ who: 'Customer', text });
      ledger.push({ ...common, text, disclosed: given, disclosedTotal: disclosedTotal() });
      return { kind: 'block', blockIndex: step.blockIndex, stimulus: { user: text } };
    },
  };
}

/**
 * The facts a message gives that the plan did not: a value not yet disclosed that the text holds. A value
 * contained in a disclosed value (a postcode inside an address given, a user name inside an email given) is
 * not a leak: the text gave the larger value, as planned.
 */
export function leaks(
  text: string,
  facts: Readonly<Record<string, string>>,
  disclosed: ReadonlySet<string>,
): string[] {
  const given = [...disclosed]
    .map((fact) => facts[fact])
    .filter((value): value is string => value !== undefined);
  return Object.entries(facts)
    .filter(([fact, value]) => !disclosed.has(fact) && holdsValue(text, value))
    .filter(([, value]) => !given.some((larger) => holdsValue(larger, value)))
    .map(([fact]) => fact)
    .sort();
}
