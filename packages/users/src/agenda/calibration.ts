import type { LedgerTurn } from './driver';
import { AgendaEngine, type AgentActs, type EngineParams, engineParams, NO_AGENT_ACTS } from './engine';

/**
 * The calibration report: how close the simulated users' behaviour is to a human reference, metric by
 * metric, as a Dice score (100 = the same rate). It reads the disclosure ledger of simulated turns.
 *
 * Three metrics read the text, by its form only: the share of messages of at most three words (words are
 * split on white space), the share holding a question mark, and the share of a conversation's words in its
 * first two messages. Three read the ledger, never the text: the share of messages planned polite, the share
 * planned unsure, and the facts given per message. No metric reads a message against a list of words: a
 * politeness or doubt detector would need one, so those two measure what the engine planned. A realiser
 * that disobeys its style is the realiser's error, not the plan's; the rates say what was asked of it.
 */

export const METRICS = ['Short%', 'Polite%', 'FrntId%', 'IDs/turn', 'Uncert%', 'Quest%'] as const;
export type Metric = (typeof METRICS)[number];
export type Rates = Record<Metric, number>;

/** How each metric is measured. */
export const METRIC_SOURCE: Record<Metric, 'text' | 'plan'> = {
  'Short%': 'text',
  'Polite%': 'plan',
  'FrntId%': 'text',
  'IDs/turn': 'plan',
  'Uncert%': 'plan',
  'Quest%': 'text',
};

export type HumanReference = {
  id: string;
  source: string;
  rates: Rates;
  /** The split-half Dice of the humans with themselves: the best a simulator can be told apart from noise. */
  ceiling?: Partial<Rates>;
  secondary?: { turnsPerDialogue: number; wordsPerTurn: number };
};

/**
 * Human customer rates from ABCD (Chen et al., NAACL 2021, MIT licence): 100 test conversations of the
 * action flows, as the H10 experiment measured them on the block-sim research branch. Only these derived
 * numbers are kept; no dialogue text is.
 */
export const ABCD_CUSTOMERS: HumanReference = {
  id: 'abcd-customers',
  source: 'ABCD test set, 100 action-flow conversations (H10, block-sim research branch)',
  rates: {
    'Short%': 38.219,
    'Polite%': 20.685,
    'FrntId%': 49.566,
    'IDs/turn': 0.2726,
    'Uncert%': 4.11,
    'Quest%': 8.904,
  },
  ceiling: {
    'Short%': 99.495,
    'Polite%': 96.435,
    'FrntId%': 97.887,
    'IDs/turn': 98.937,
    'Uncert%': 54.38,
    'Quest%': 81.452,
  },
  secondary: { turnsPerDialogue: 7.3, wordsPerTurn: 7.916 },
};

const words = (text: string) => text.split(/\s+/).filter((word) => word.length > 0).length;

/** The simulated turns of a ledger that sent a message. */
function spoken(ledger: readonly LedgerTurn[]): (LedgerTurn & { text: string })[] {
  return ledger.filter(
    (turn): turn is LedgerTurn & { text: string } => turn.mode === 'simulated' && turn.text !== undefined,
  );
}

/** The six rates over dialogues, each the ledger of one run. */
export function rates(dialogues: readonly (readonly LedgerTurn[])[]): Rates {
  const each = dialogues.map(spoken).filter((turns) => turns.length > 0);
  const turns = each.flat();
  const n = Math.max(turns.length, 1);
  const front: number[] = [];
  for (const dialogue of each) {
    const total = dialogue.reduce((sum, turn) => sum + words(turn.text), 0);
    if (total > 0) front.push(dialogue.slice(0, 2).reduce((sum, turn) => sum + words(turn.text), 0) / total);
  }
  return {
    'Short%': (100 * turns.filter((turn) => words(turn.text) <= 3).length) / n,
    'Polite%': (100 * turns.filter((turn) => turn.style?.polite === true).length) / n,
    'FrntId%': (100 * front.reduce((sum, share) => sum + share, 0)) / Math.max(front.length, 1),
    'IDs/turn': turns.reduce((sum, turn) => sum + turn.disclosed.length, 0) / n,
    'Uncert%': (100 * turns.filter((turn) => turn.style?.uncertain === true).length) / n,
    'Quest%': (100 * turns.filter((turn) => turn.text.includes('?')).length) / n,
  };
}

export function dice(simulated: number, human: number): number {
  return simulated + human === 0 ? 100 : (200 * Math.min(simulated, human)) / (simulated + human);
}

export type CalibrationReport = {
  reference: string;
  dialogues: number;
  turns: number;
  metrics: {
    metric: Metric;
    source: 'text' | 'plan';
    simulated: number;
    human: number;
    dice: number;
    ceiling?: number;
  }[];
  secondary: { turnsPerDialogue: number; wordsPerTurn: number };
};

export function calibrationReport(
  dialogues: readonly (readonly LedgerTurn[])[],
  reference: HumanReference = ABCD_CUSTOMERS,
): CalibrationReport {
  const simulated = rates(dialogues);
  const each = dialogues.map(spoken).filter((turns) => turns.length > 0);
  const turns = each.flat();
  return {
    reference: reference.id,
    dialogues: each.length,
    turns: turns.length,
    metrics: METRICS.map((metric) => {
      const ceiling = reference.ceiling?.[metric];
      return {
        metric,
        source: METRIC_SOURCE[metric],
        simulated: simulated[metric],
        human: reference.rates[metric],
        dice: dice(simulated[metric], reference.rates[metric]),
        ...(ceiling === undefined ? {} : { ceiling }),
      };
    }),
    secondary: {
      turnsPerDialogue: turns.length / Math.max(each.length, 1),
      wordsPerTurn: turns.reduce((sum, turn) => sum + words(turn.text), 0) / Math.max(turns.length, 1),
    },
  };
}

/** The agent turns of the self-check: ask for one fact, ask for the problem, then close. */
const SELF_CHECK_AGENT: AgentActs[] = [
  { ...NO_AGENT_ACTS, requested_slots: ['account'] },
  { ...NO_AGENT_ACTS, asks_problem_detail: true },
  { ...NO_AGENT_ACTS, asks_confirmation: true },
  { ...NO_AGENT_ACTS, says_resolved: true, asks_anything_else: true },
];

/** Engine-only dialogues: planned messages written as their act count in words, no model. */
function planOnlyDialogues(params: EngineParams, runs: number): LedgerTurn[][] {
  const out: LedgerTurn[][] = [];
  for (let run = 0; run < runs; run += 1) {
    const engine = new AgendaEngine({
      goal: 'change a plan',
      facts: { account: 'AC-00017' },
      seed: `self-check#${run}`,
      params,
    });
    const ledger: LedgerTurn[] = [];
    for (let turn = 0; turn <= SELF_CHECK_AGENT.length; turn += 1) {
      if (turn > 0) engine.observe(SELF_CHECK_AGENT[turn - 1] as AgentActs);
      const before = new Set(engine.disclosed);
      const plan = engine.plan();
      if (plan.stop) break;
      ledger.push({
        block: turn,
        mode: 'simulated',
        turn: engine.turn,
        plannedActs: plan.acts,
        style: plan.style,
        text: plan.style.short ? 'ok' : 'a message of several words',
        disclosed: [...engine.disclosed].filter((fact) => !before.has(fact)),
        disclosedTotal: [...engine.disclosed],
      });
    }
    out.push(ledger);
  }
  return out;
}

/**
 * The calibration self-check: forcing a polite message on every turn must lower the Polite% Dice against
 * the reference. If it does not, the metric does not react to the behaviour it names.
 */
export function calibrationSelfCheck(
  reference: HumanReference = ABCD_CUSTOMERS,
  runs = 200,
): { defaultDice: number; forcedDice: number; ok: boolean } {
  const defaults = engineParams(undefined);
  const forced = engineParams({ polite_turn_share: 1 });
  const at = (params: EngineParams) =>
    dice(rates(planOnlyDialogues(params, runs))['Polite%'], reference.rates['Polite%']);
  const defaultDice = at(defaults);
  const forcedDice = at(forced);
  return { defaultDice, forcedDice, ok: forcedDice < defaultDice };
}
