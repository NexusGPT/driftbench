import { createHash } from 'node:crypto';
import type { SimulatedUserEngine } from '@agent-nexus/driftbench-core';

/**
 * The agenda engine: the part of a simulated user that decides WHAT the person says, outside the model.
 * It holds the goal, the facts, an agenda (a stack of dialogue acts), the engagement and the stop rules. It
 * reads each agent turn as a set of labels (which facts the agent asked for, whether it asked to confirm, to
 * try something, said it cannot, said it is done) and plans the next message as a few acts plus a style.
 * A model (the realiser) then writes the planned acts as text, and nothing more.
 *
 * The engine is deterministic given its seed and the labels it reads: the same seed and the same agent
 * labels give the same plans on every machine. It follows the agenda-based user simulator of Schatzmann et
 * al. (2007), with the behaviour shares drawn outside the model, as the H10 experiment on the block-sim
 * research branch tested (closer to human customers than prompting on 5 of 6 metrics).
 */

export const ENGINE_VERSION = 'agenda-1';

/** One dialogue act of a planned message. */
export type PlannedAct =
  | { act: 'inform_intent' }
  | { act: 'inform_detail' }
  | { act: 'answer'; slot: string }
  | { act: 'dont_know'; slot: string }
  | { act: 'answer_other' }
  | { act: 'confirm' }
  | { act: 'report_try'; worked: boolean }
  | { act: 'repeat_request' }
  | { act: 'accept_outcome' }
  | { act: 'acknowledge' }
  | { act: 'ask_status' }
  | { act: 'goodbye' }
  | { act: 'abandon' };

/** How the message is written: drawn by the engine, obeyed by the realiser. */
export type PlannedStyle = { short: boolean; polite: boolean; uncertain: boolean; question: boolean };

/** What the agent's turn did, as labels: the engine's only view of the agent. */
export type AgentActs = {
  /** The facts the agent asked for, by name; `other` for anything the person was not given a name for. */
  requested_slots: string[];
  asks_problem_detail: boolean;
  asks_confirmation: boolean;
  asks_to_try_something: boolean;
  says_cannot_do: boolean;
  says_resolved: boolean;
  asks_anything_else: boolean;
};

export const NO_AGENT_ACTS: AgentActs = {
  requested_slots: [],
  asks_problem_detail: false,
  asks_confirmation: false,
  asks_to_try_something: false,
  says_cannot_do: false,
  says_resolved: false,
  asks_anything_else: false,
};

/** One plan: the acts, the style, and the stop when the plan ends the conversation. */
export type Plan = { acts: PlannedAct[]; style: PlannedStyle; stop?: 'goodbye' | 'abandon' };

export type EngineParams = {
  acts_per_turn: number[];
  volunteer_share: number;
  opening_detail_share: number;
  short_turn_share: number;
  polite_turn_share: number;
  uncertainty_turn_share: number;
  question_turn_share: number;
  repeat_after_refusal: number;
  turn_budget: number;
  engagement_initial: number;
  decay_per_unhelpful_turn: number;
  disengage_below: number;
};

/**
 * The defaults. The shares are published human rates (Sim2Real, Lost in Simulation) as the H10 prototype
 * used them, untuned on its data, with one change: `opening_detail_share`. The prototype opened every
 * conversation with the request alone and no detail, which put the share of words in the first two messages
 * at 34.4% against 49.6% for the human customers. Here half of the openings also state the specific problem
 * (0.5), which moves words into the opening; the calibration report measures the effect on a real run.
 */
export const ENGINE_DEFAULTS: EngineParams = {
  acts_per_turn: [0.7, 0.25, 0.05],
  volunteer_share: 0.3,
  opening_detail_share: 0.5,
  short_turn_share: 0.29,
  polite_turn_share: 0.15,
  uncertainty_turn_share: 0.07,
  question_turn_share: 0.1,
  repeat_after_refusal: 1,
  turn_budget: 16,
  engagement_initial: 0.8,
  decay_per_unhelpful_turn: 0.15,
  disengage_below: 0.3,
};

export function engineParams(overrides: SimulatedUserEngine | undefined): EngineParams {
  const out: EngineParams = { ...ENGINE_DEFAULTS, acts_per_turn: [...ENGINE_DEFAULTS.acts_per_turn] };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

/**
 * A seeded stream of numbers in [0, 1): number n is the first 48 bits of the SHA-256 of the seed and n,
 * so the stream is the same on every machine and every Node version.
 */
export class SeededStream {
  private n = 0;
  constructor(private readonly seed: string) {}
  next(): number {
    const digest = createHash('sha256').update(`${this.seed}\u0000${this.n}`).digest();
    this.n += 1;
    return digest.readUIntBE(0, 6) / 2 ** 48;
  }
}

/** Acts that answer one agent turn: stale once the agent has moved on. */
const TURN_SCOPED = new Set([
  'answer',
  'dont_know',
  'answer_other',
  'confirm',
  'report_try',
  'acknowledge',
  'ask_status',
]);

const keyOf = (act: PlannedAct) => JSON.stringify(act, Object.keys(act).sort());

export type EngineInput = {
  goal: string;
  facts: Readonly<Record<string, string>>;
  /** The facts that may be given in the opening message, unasked. */
  volunteer?: readonly string[];
  seed: string;
  params?: EngineParams;
};

export class AgendaEngine {
  readonly params: EngineParams;
  readonly goal: string;
  readonly facts: Readonly<Record<string, string>>;
  private readonly volunteer: readonly string[];
  private readonly rng: SeededStream;
  /** A stack: the next act is the last element. */
  private agenda: PlannedAct[] = [{ act: 'goodbye' }, { act: 'inform_intent' }];
  private closureSeen = false;
  private refusals = 0;
  private tries = 0;
  private lastRequested: string | undefined;
  engagement: number;
  turn = 0;
  readonly disclosed = new Set<string>();

  constructor(input: EngineInput) {
    this.params = input.params ?? engineParams(undefined);
    this.goal = input.goal;
    this.facts = input.facts;
    this.volunteer = input.volunteer ?? [];
    this.rng = new SeededStream(input.seed);
    this.engagement = this.params.engagement_initial;
  }

  /** Reads one agent turn: pushes the acts that answer it, and lowers engagement on an unhelpful turn. */
  observe(agent: AgentActs): void {
    this.agenda = this.agenda.filter((act) => !TURN_SCOPED.has(act.act));
    const pushes: PlannedAct[] = [];
    let unhelpful = false;
    const requested = [...agent.requested_slots].sort().join(',');
    if (requested !== '' && requested === this.lastRequested) unhelpful = true;
    this.lastRequested = requested === '' ? undefined : requested;
    for (const slot of agent.requested_slots) {
      if (slot === 'other') pushes.push({ act: 'answer_other' });
      else if (Object.hasOwn(this.facts, slot)) pushes.push({ act: 'answer', slot });
      else pushes.push({ act: 'dont_know', slot });
    }
    if (agent.asks_problem_detail) pushes.push({ act: 'inform_detail' });
    if (agent.asks_confirmation) pushes.push({ act: 'confirm' });
    if (agent.asks_to_try_something) {
      this.tries += 1;
      pushes.push({ act: 'report_try', worked: this.tries >= 2 });
    }
    if (agent.says_cannot_do) {
      unhelpful = true;
      this.refusals += 1;
      if (this.refusals <= this.params.repeat_after_refusal) pushes.push({ act: 'repeat_request' });
      else {
        pushes.push({ act: 'accept_outcome' });
        this.closureSeen = true;
      }
    }
    if (agent.says_resolved || agent.asks_anything_else) this.closureSeen = true;
    if (unhelpful) this.engagement -= this.params.decay_per_unhelpful_turn;
    if (pushes.length === 0 && !this.closureSeen) pushes.push({ act: 'acknowledge' });
    const seen = new Set(this.agenda.map(keyOf));
    const fresh = pushes.filter((act) => !seen.has(keyOf(act)));
    for (let i = fresh.length - 1; i >= 0; i -= 1) this.agenda.push(fresh[i] as PlannedAct);
  }

  /** Plans the next message: pops a few acts from the agenda and draws the style. */
  plan(): Plan {
    this.turn += 1;
    const p = this.params;
    if (this.turn > p.turn_budget || this.engagement < p.disengage_below) {
      return { acts: [{ act: 'abandon' }], style: plainStyle(), stop: 'abandon' };
    }
    const draw = this.rng.next();
    let wanted = 1;
    let acc = 0;
    for (const [index, share] of p.acts_per_turn.entries()) {
      acc += share;
      if (draw < acc) {
        wanted = index + 1;
        break;
      }
    }
    const acts: PlannedAct[] = [];
    while (acts.length < wanted && this.agenda.length > 0) {
      const top = this.agenda[this.agenda.length - 1] as PlannedAct;
      // A goodbye waits at the bottom until the agent signals closure: no premature stop.
      if (top.act === 'goodbye' && !this.closureSeen) break;
      acts.push(this.agenda.pop() as PlannedAct);
      if (top.act === 'goodbye') break;
    }
    if (acts.length === 0) acts.push(this.closureSeen ? { act: 'goodbye' } : { act: 'ask_status' });
    if (acts[0]?.act === 'inform_intent') {
      if (this.rng.next() < p.opening_detail_share) acts.push({ act: 'inform_detail' });
      for (const slot of this.volunteer) {
        if (Object.hasOwn(this.facts, slot) && this.rng.next() < p.volunteer_share) {
          acts.push({ act: 'answer', slot });
          this.agenda = this.agenda.filter((act) => !('slot' in act) || act.slot !== slot);
        }
      }
    }
    const style: PlannedStyle = {
      short: this.rng.next() < p.short_turn_share,
      polite: this.rng.next() < p.polite_turn_share,
      uncertain: this.rng.next() < p.uncertainty_turn_share,
      question: this.rng.next() < p.question_turn_share,
    };
    for (const act of acts) if (act.act === 'answer') this.disclosed.add(act.slot);
    return acts.some((act) => act.act === 'goodbye') ? { acts, style, stop: 'goodbye' } : { acts, style };
  }
}

function plainStyle(): PlannedStyle {
  return { short: false, polite: false, uncertain: false, question: false };
}
