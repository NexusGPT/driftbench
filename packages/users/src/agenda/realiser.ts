import { createHash } from 'node:crypto';
import type { UserModelPort } from '../simulated';
import { type AgentActs, ENGINE_VERSION, NO_AGENT_ACTS, type Plan, type PlannedAct } from './engine';

/**
 * The two model calls of an engine-driven user, as templates: the realiser writes the planned acts as one
 * message, and the agent-act labeller reads one agent turn into the labels the engine reads. Both prompts
 * are write-only templates: no code here reads a message against a list of words. The labeller is a model;
 * without one, `patternLabeller` reads only the ask patterns the spec itself declares.
 */

export const REALISER_SYSTEM = [
  "You write the next chat message of a customer talking to a company's customer service.",
  "You are given the customer's situation, the conversation so far, and a plan: the exact dialogue acts this",
  'message must carry and style constraints. Write ONE message that carries exactly the planned acts and',
  'nothing else: do not add information, details or questions that are not in the plan. Use the exact values',
  'given for any detail. Write like a real person typing in a chat window. Output only the message text.',
].join('\n');

export function labellerSystem(slots: readonly string[]): string {
  return [
    'You label one message written by a customer service agent to a customer. Return JSON only:',
    '{"requested_slots": [...], "asks_problem_detail": bool, "asks_confirmation": bool, "asks_to_try_something": bool,',
    ' "says_cannot_do": bool, "says_resolved": bool, "asks_anything_else": bool}',
    'requested_slots: the customer details the agent asks for in this message, from this list only:',
    `${[...slots, 'other'].join(', ')}. Use "other" for any other requested information.`,
    'asks_problem_detail: the agent asks what the problem is, the reason, or which item.',
    'asks_confirmation: the agent asks the customer to confirm or choose between options.',
    'asks_to_try_something: the agent asks the customer to try a fix (log out and in, retry, clear cache, ...).',
    'says_cannot_do: the agent refuses or says it cannot do what the customer wants.',
    'says_resolved: the agent says the request is done or answered.',
    'asks_anything_else: the agent asks whether there is anything else it can help with, or says goodbye.',
  ].join('\n');
}

/** The hash of the templates and the engine version: pinned per run, so a prompt change is a new run. */
export const TEMPLATE_HASH = createHash('sha256')
  .update([ENGINE_VERSION, REALISER_SYSTEM, labellerSystem(['<slots>'])].join('\u0000'))
  .digest('hex');

const label = (slot: string) => slot.replace(/_/g, ' ');

/** The planned acts as instructions to the realiser. A value appears only for a fact the plan gives. */
export function describeActs(
  acts: readonly PlannedAct[],
  context: { goal: string; facts: Readonly<Record<string, string>> },
): string[] {
  return acts.map((act): string => {
    switch (act.act) {
      case 'inform_intent':
        return `state what you want in general terms (no details, no ids): ${context.goal}`;
      case 'inform_detail':
        return `explain the specific problem; situation: ${context.goal}`;
      case 'answer':
        return `give your ${label(act.slot)}: ${context.facts[act.slot]}`;
      case 'dont_know':
        return `say you do not know or do not have your ${label(act.slot)}`;
      case 'answer_other':
        return "answer the agent's other question briefly from your situation, or say you do not know";
      case 'confirm':
        return 'confirm or choose what the agent proposed, in line with your goal';
      case 'report_try':
        return act.worked ? 'say you tried it and it worked' : 'say you tried it and it still does not work';
      case 'repeat_request':
        return 'push back once: repeat what you want and ask if there is really no way';
      case 'accept_outcome':
        return 'accept the outcome';
      case 'acknowledge':
        return 'acknowledge briefly (for example ok)';
      case 'ask_status':
        return 'ask what happens next with your request';
      case 'goodbye':
        return 'say no, nothing else, and end the chat';
      case 'abandon':
        return 'give up and leave the chat';
      default:
        return act satisfies never;
    }
  });
}

export function styleLines(style: Plan['style']): string[] {
  return [
    style.short
      ? 'Very short: at most 3 words (if a detail must be given, give only the detail).'
      : 'Plain length, like a real chat message.',
    style.polite
      ? 'Include one polite word (please, thanks or sorry).'
      : 'Do not use the words please, thanks, thank you or sorry.',
    ...(style.uncertain ? ["Sound a little unsure (for example 'I think')."] : []),
    ...(style.question ? ['Phrase the message as a question if the acts allow it.'] : []),
  ];
}

export type Exchange = { who: 'Customer' | 'Agent'; text: string };

/** The realiser's user message: the situation, the last turns, the plan and the style. */
export function realiserRequest(input: {
  situation: string;
  transcript: readonly Exchange[];
  plan: Plan;
  goal: string;
  facts: Readonly<Record<string, string>>;
}): string {
  const convo = input.transcript.slice(-8).map((turn) => `${turn.who}: ${turn.text}`);
  return [
    'Customer situation:',
    input.situation,
    '',
    'Conversation so far:',
    ...(convo.length > 0 ? convo : ['(nothing yet: you write first)']),
    '',
    'Planned acts for this message:',
    ...describeActs(input.plan.acts, { goal: input.goal, facts: input.facts }).map((line) => `- ${line}`),
    '',
    'Style:',
    ...styleLines(input.plan.style).map((line) => `- ${line}`),
  ].join('\n');
}

/** Reads one agent turn into the engine's labels. */
export type AgentActLabeller = (agentText: string) => Promise<AgentActs> | AgentActs;

/**
 * The model labeller: one call per agent turn, JSON out. A reply that is not JSON gives no labels (the
 * engine then acknowledges), never an error: the labeller is a reader, not a judge.
 */
export function modelLabeller(
  port: UserModelPort,
  slots: readonly string[],
  seed?: string,
): AgentActLabeller {
  const system = labellerSystem(slots);
  const known = new Set([...slots, 'other']);
  return async (agentText) => {
    const raw = await port.complete({
      system,
      user: agentText,
      maxTokens: 300,
      ...(seed === undefined ? {} : { seed }),
    });
    let parsed: unknown;
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
    } catch {
      return { ...NO_AGENT_ACTS, requested_slots: [] };
    }
    const record = (parsed ?? {}) as Record<string, unknown>;
    const slotsAsked = Array.isArray(record.requested_slots)
      ? record.requested_slots.filter((slot): slot is string => typeof slot === 'string' && known.has(slot))
      : [];
    const flag = (key: keyof AgentActs) => record[key] === true;
    return {
      requested_slots: [...new Set(slotsAsked)],
      asks_problem_detail: flag('asks_problem_detail'),
      asks_confirmation: flag('asks_confirmation'),
      asks_to_try_something: flag('asks_to_try_something'),
      says_cannot_do: flag('says_cannot_do'),
      says_resolved: flag('says_resolved'),
      asks_anything_else: flag('asks_anything_else'),
    };
  };
}

/**
 * The labeller without a model: a fact is requested when an agent reply matches one of the ask patterns
 * the spec declares for it. Nothing else is read, so the engine never sees closure and the spec's blocks
 * bound the run.
 */
export function patternLabeller(askPatterns: Readonly<Record<string, readonly string[]>>): AgentActLabeller {
  const compiled = Object.entries(askPatterns).map(
    ([slot, patterns]) => [slot, patterns.map((pattern) => new RegExp(pattern, 'i'))] as const,
  );
  return (agentText) => ({
    ...NO_AGENT_ACTS,
    requested_slots: compiled
      .filter(([, patterns]) => patterns.some((pattern) => pattern.test(agentText)))
      .map(([slot]) => slot),
  });
}
