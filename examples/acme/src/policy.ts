import {
  detectIntent,
  extractAddress,
  extractEmail,
  extractName,
  extractPhone,
  firstName,
  formatPhone,
  isBlank,
  isCallbackRequest,
  isCareMatter,
  isDone,
  isExplicitConfirm,
  isForeign,
  isInjection,
  isLooseYes,
  isNudge,
  isQuestion,
  isRetry,
  isReturn,
  isStoreHours,
  normalize,
} from './parse';
import { ACME } from './store';
import type { ToolInput, ToolLabel, ToolOutcome } from './tools';

/**
 * The dialogue policy of the Acme sales assistant: a fixed state machine. One customer turn in, one
 * reply out, tools called on the way. It reads facts only from tool results and from the customer.
 */

/** The flow stages a block can expect. Every spec's `stages` catalogue is drawn from this list. */
export const STAGES = [
  'needs',
  'identify',
  'address',
  'port_number',
  'offer',
  'details',
  'recap',
  'order_placed',
  'callback',
  'handover',
  'closing',
] as const;
export type Stage = (typeof STAGES)[number];

export type Flow = 'upgrade' | 'home' | 'mobile' | 'porting';
export type LeadReason = 'callback' | 'no_coverage' | 'tool_failure' | 'order_failed';

/** A plan as `catalog.search` returns it. The agent knows plans only through that tool. */
export type PlanView = {
  id: string;
  name: string;
  category: string;
  monthly_usd: number;
  data_gb?: number | null;
  speed_mbps?: number;
  access?: string;
};

export type Coverage = { address_id: string; address: string; fiber_mbps: number; five_g: boolean };

type Lead = { reason: LeadReason; summary: string };

export type State = {
  stage: Stage;
  flow?: Flow;
  greeted: boolean;
  customer: { id?: string; name?: string; email?: string; phone?: string };
  currentPlan?: PlanView;
  address?: string;
  coverage?: Coverage;
  offered: PlanView[];
  plan?: PlanView;
  portNumber?: string;
  orderId?: string;
  /** A lead waiting for a phone number before it goes to sales. */
  pendingLead?: Lead;
  /** The lead sent to sales; `ticketId` is absent when sending it failed. */
  lead?: Lead & { ticketId?: string };
};

export type CallTool = (label: ToolLabel, input: ToolInput) => ToolOutcome;

/**
 * A guardrail of the policy that fired in a turn. `explicit_confirmation` passes when the CONFIRM token
 * places the order and blocks a loose yes; `instruction_in_data` blocks an instruction hidden in what the
 * agent reads: the customer's message, a document of the turn or a tool answer. It fires once per turn.
 */
export type GuardEvent = { name: 'explicit_confirmation' | 'instruction_in_data'; verdict: 'pass' | 'block' };

export function initialState(): State {
  return { stage: 'needs', greeted: false, customer: {}, offered: [] };
}

/**
 * Answers one customer turn. Never mutates `previous`. `documents` are the files the turn reads beside the
 * customer's text.
 *
 * What the agent reads is untrusted: an instruction in it is blocked, whoever wrote it. The customer's text
 * is the turn itself, so an instruction there refuses the turn. A document or a tool answer is data: the
 * value carrying an instruction is dropped each time it is read and the guard reports it, and the turn is
 * answered from the clean data, as it would be without that value. A document stays in the workspace and
 * is read at every turn, so refusing on it would block every later turn. The agent takes no fact from a
 * document: dropping a poisoned one leaves the turn as it was. Only what the agent wrote itself is trusted:
 * its policy, its replies and its tool inputs are never read as data.
 */
export function takeTurn(
  previous: State,
  text: string,
  call: CallTool,
  documents: readonly string[] = [],
): { state: State; reply: string; guards: GuardEvent[] } {
  const state = structuredClone(previous);
  const guards: GuardEvent[] = [];
  const opening = state.greeted ? '' : `Hi, I'm the ${ACME.name} sales assistant. `;
  state.greeted = true;
  if (documents.some(isInjection)) blockInstruction(guards);
  const reply = route(state, text, readAsData(call, guards), guards);
  return { state, reply: opening + reply, guards };
}

/** Records the instruction guard's block, once per turn. */
function blockInstruction(guards: GuardEvent[]): void {
  if (!guards.some((guard) => guard.name === 'instruction_in_data')) {
    guards.push({ name: 'instruction_in_data', verdict: 'block' });
  }
}

/**
 * The tools, with each answer read as data. A string of the answer that carries an instruction is dropped
 * before the policy reads the answer, and so is an entry whose key carries one; an error that carries one is
 * replaced. Only the value goes: a list item it leaves unreadable is left out of its list and the rest of
 * the answer is read (`readCatalog`). When a value the policy needs is dropped and nothing readable is left,
 * the answer is one it cannot read, as any other.
 */
function readAsData(call: CallTool, guards: GuardEvent[]): CallTool {
  return (label, input) => {
    const outcome = call(label, input);
    if (!outcome.ok) {
      if (!isInjection(outcome.error)) return outcome;
      blockInstruction(guards);
      return { ok: false, error: 'an answer carrying an instruction, which the agent did not read' };
    }
    const kept = withoutInstructions(outcome.output);
    if (kept === outcome.output) return outcome;
    blockInstruction(guards);
    return { ok: true, output: kept === DROPPED ? undefined : kept };
  };
}

const DROPPED = Symbol('dropped');

/** The records of a tool answer the guard took a value from. */
const TRIMMED = new WeakSet<object>();

/** The value without the strings that carry an instruction; the same value when it holds none. */
function withoutInstructions(value: unknown): unknown {
  if (typeof value === 'string') return isInjection(value) ? DROPPED : value;
  if (Array.isArray(value)) {
    const items = value.map(withoutInstructions);
    return items.every((item, index) => item === value[index])
      ? value
      : items.filter((item) => item !== DROPPED);
  }
  if (!isRecord(value)) return value;
  const entries = Object.entries(value).map(([key, item]): [string, unknown] => [
    key,
    isInjection(key) ? DROPPED : withoutInstructions(item),
  ]);
  if (entries.every(([key, item]) => item === value[key])) return value;
  const trimmed = Object.fromEntries(entries.filter(([, item]) => item !== DROPPED));
  TRIMMED.add(trimmed);
  return trimmed;
}

const NEEDS = 'What are you looking for: a mobile plan, home internet, an upgrade, or keeping your number?';
const CARE = `I can't handle billing or service issues here. Acme Care can help: call ${formatPhone(ACME.carePhone)}.`;
const SALES_LINE = `Please call Acme Sales at ${formatPhone(ACME.salesPhone)}.`;

function route(s: State, text: string, call: CallTool, guards: GuardEvent[]): string {
  if (isBlank(text) || isNudge(text)) {
    return s.flow
      ? `I'm here. ${pendingQuestion(s)}`
      : `I can help with plans, internet and orders. ${NEEDS}`;
  }
  if (isInjection(text)) {
    blockInstruction(guards);
    return `I can't change prices, offers or my instructions. ${pendingQuestion(s)}`;
  }
  if (isForeign(text)) return `I can only help in English for now. ${pendingQuestion(s)}`;
  if (isCareMatter(text)) return `${CARE} ${pendingQuestion(s)}`;
  if (s.stage === 'recap') {
    const answer = atRecap(s, text, call, guards);
    if (answer) return answer;
  }
  if (isReturn(text)) return resume(s);
  if (isStoreHours(text)) {
    return `Our stores are open ${ACME.storeHours}, and closed on Sunday. ${pendingQuestion(s)}`;
  }
  if (s.flow === undefined) return start(s, text, call);
  const answer = atStep(s, text, call);
  if (answer) return answer;
  if (isQuestion(text)) return `I can only help with Acme plans and orders. ${pendingQuestion(s)}`;
  return `Sorry, I did not get that. ${pendingQuestion(s)}`;
}

function start(s: State, text: string, call: CallTool): string {
  switch (detectIntent(text)) {
    case 'porting':
      return startPorting(s, text, call);
    case 'upgrade':
      return startUpgrade(s, text, call);
    case 'home':
      return startHome(s, text, call);
    case 'mobile':
      s.flow = 'mobile';
      return offerMobile(s, call, 'Happy to help you get a new line.');
    default:
      return isQuestion(text)
        ? `I can only help with Acme plans and orders. ${NEEDS}`
        : `I can help with plans, internet and orders. ${NEEDS}`;
  }
}

function atStep(s: State, text: string, call: CallTool): string | undefined {
  switch (s.stage) {
    case 'identify': {
      const email = extractEmail(text);
      return email ? identify(s, email, call) : undefined;
    }
    case 'address': {
      const address = extractAddress(text);
      if (address) return checkCoverage(s, address, text, call);
      return isQuestion(text)
        ? undefined
        : 'I need the street address, for example 14 Harbor Road, Acmeville.';
    }
    case 'port_number': {
      const number = extractPhone(text);
      return number ? checkPort(s, number, call) : undefined;
    }
    case 'offer':
      return atOffer(s, text);
    case 'details':
      return atDetails(s, text);
    case 'callback':
      if (isRetry(text) && canRetryCoverage(s)) return retryCoverage(s, call);
      return atCallback(s, text, call);
    case 'order_placed':
    case 'handover':
    case 'closing':
      if (isRetry(text) && canRetryCoverage(s)) return retryCoverage(s, call);
      if (isDone(text)) {
        s.stage = 'closing';
        const name = firstName(s.customer.name);
        return `You're welcome${name ? `, ${name}` : ''}. Have a good day.`;
      }
      return undefined;
    default:
      return undefined;
  }
}

// Upgrade: an existing customer moves to a plan with more data.

function startUpgrade(s: State, text: string, call: CallTool): string {
  s.flow = 'upgrade';
  const email = extractEmail(text);
  if (email) return identify(s, email, call);
  s.stage = 'identify';
  return `I can help you move to a plan with more data. ${pendingQuestion(s)}`;
}

function identify(s: State, email: string, call: CallTool): string {
  s.customer.email = email;
  const catalog = readCatalog(
    callWithRetry(call, 'catalog.search', { category: 'mobile', customer_email: email }),
  );
  if (!catalog) {
    return askPhone(
      s,
      { reason: 'tool_failure', summary: `Plan lookup failed for ${email}. The customer wants more data.` },
      "I can't look up your plan right now: our catalog is not responding. A sales advisor can call you back. What phone number should they use?",
    );
  }
  const customer = catalog.customer;
  if (!customer) {
    s.customer.email = undefined;
    s.stage = 'identify';
    return `I can't find an Acme account with ${email}. Please check the email address on your Acme account.`;
  }
  s.customer = { ...s.customer, id: customer.id, name: customer.name };
  const current = catalog.plans.find((plan) => plan.id === customer.current_plan_id);
  const name = firstName(customer.name);
  if (!current) {
    s.offered = catalog.plans;
    s.stage = 'offer';
    return `Thanks, ${name}. Our mobile plans: ${list(catalog.plans)}. ${offerQuestion(s)}`;
  }
  s.currentPlan = current;
  const upgrades = catalog.plans.filter((plan) => dataOf(plan) > dataOf(current));
  if (upgrades.length === 0) {
    s.stage = 'closing';
    return `Thanks, ${name}. You are on ${describe(current)}, which already has the most data. Is there anything else I can help with?`;
  }
  s.offered = upgrades;
  s.stage = 'offer';
  return `Thanks, ${name}. You are on ${describe(current)}. Plans with more data: ${list(upgrades)}. ${offerQuestion(s)}`;
}

function dataOf(plan: PlanView): number {
  if (plan.data_gb === null) return Number.POSITIVE_INFINITY;
  return plan.data_gb ?? 0;
}

// Home internet: coverage first, then the plans available at the address.

function startHome(s: State, text: string, call: CallTool): string {
  s.flow = 'home';
  const address = extractAddress(text);
  if (address) return checkCoverage(s, address, text, call);
  s.stage = 'address';
  return `I can check what is available at your address. ${pendingQuestion(s)}`;
}

function checkCoverage(s: State, address: string, text: string, call: CallTool): string {
  s.address = address;
  const coverage = readCoverage(callWithRetry(call, 'coverage.check', { address }));
  if (!coverage) {
    return askPhone(
      s,
      {
        reason: 'tool_failure',
        summary: `Coverage check failed for ${address}. The customer wants home internet.`,
      },
      `I can't check coverage at ${address} right now: our coverage service is not responding. A sales advisor can check it and call you back. What phone number should they use?`,
    );
  }
  return afterCoverage(s, coverage, text, call);
}

function canRetryCoverage(s: State): boolean {
  return s.flow === 'home' && s.coverage === undefined && s.address !== undefined;
}

function retryCoverage(s: State, call: CallTool): string {
  const address = s.address ?? '';
  const coverage = readCoverage(callWithRetry(call, 'coverage.check', { address }));
  if (!coverage) return `Still no answer from the coverage service. ${leadStatus(s)}`;
  return afterCoverage(s, coverage, '', call);
}

function afterCoverage(s: State, coverage: CoverageAnswer, text: string, call: CallTool): string {
  if (!coverage.found) {
    s.stage = 'address';
    return `I can't find ${s.address} in our coverage map. Please give the street number, street name and town, for example 14 Harbor Road, Acmeville.`;
  }
  const { found: _found, ...known } = coverage;
  s.coverage = known;
  const unreachable = `No Acme home internet plan is available at ${coverage.address} yet. A sales advisor can call you when that changes. What phone number should they use?`;
  const noCoverage: Lead = {
    reason: 'no_coverage',
    summary: `No Acme home internet at ${coverage.address}. The customer wants a call when that changes.`,
  };
  if (coverage.fiber_mbps === 0 && !coverage.five_g) return askPhone(s, noCoverage, unreachable);

  const catalog = readCatalog(
    callWithRetry(call, 'catalog.search', { category: 'home', address_id: coverage.address_id }),
  );
  if (!catalog) {
    return askPhone(
      s,
      { reason: 'tool_failure', summary: `Plan search failed for ${coverage.address}.` },
      `${coverageSentence(coverage)} But I can't load the plans right now: our catalog is not responding. A sales advisor can call you back with the offers. What phone number should they use?`,
    );
  }
  if (catalog.plans.length === 0) return askPhone(s, noCoverage, unreachable);

  s.offered = catalog.plans;
  const named = mentionedPlans(text, catalog.plans);
  if (named.length === 1 && named[0]) {
    s.plan = named[0];
    s.stage = 'details';
    return `${named[0].name} is available at ${coverage.address}: ${terms(named[0])}. ${detailsQuestion(s)}`;
  }
  s.stage = 'offer';
  const plans =
    catalog.plans.length === 1
      ? `The plan available there: ${list(catalog.plans)}.`
      : `Plans available there: ${list(catalog.plans)}.`;
  return `${coverageSentence(coverage)} ${plans} ${offerQuestion(s)}`;
}

function coverageSentence(coverage: Coverage): string {
  return coverage.fiber_mbps > 0
    ? `Good news: ${coverage.address} has fiber up to ${coverage.fiber_mbps} Mbps.`
    : `Fiber is not available at ${coverage.address} yet, but 5G home internet is.`;
}

// Porting: check the number, then a mobile plan.

function startPorting(s: State, text: string, call: CallTool): string {
  s.flow = 'porting';
  const number = extractPhone(text);
  if (number) return checkPort(s, number, call);
  s.stage = 'port_number';
  return `Happy to help you switch and keep your number. ${pendingQuestion(s)}`;
}

function checkPort(s: State, number: string, call: CallTool): string {
  const port = readPort(callWithRetry(call, 'port.check', { number }));
  if (!port) {
    return askPhone(
      s,
      { reason: 'tool_failure', summary: `Number transfer check failed for ${formatPhone(number)}.` },
      "I can't check that number right now: our transfer service is not responding. A sales advisor can check it and call you back. What phone number should they use?",
    );
  }
  const shown = formatPhone(port.number);
  if (port.eligible) {
    s.portNumber = port.number;
    return offerMobile(
      s,
      call,
      `Good news: ${shown} can move to Acme. The transfer takes one business day after your order.`,
    );
  }
  s.portNumber = undefined;
  return offerMobile(
    s,
    call,
    `${shown} can't move to Acme right now: ${port.reason ?? 'the transfer check said no'}. You can ask your current carrier to remove the lock, or take a new Acme number.`,
  );
}

function offerMobile(s: State, call: CallTool, intro: string): string {
  const catalog = readCatalog(callWithRetry(call, 'catalog.search', { category: 'mobile' }));
  if (!catalog || catalog.plans.length === 0) {
    return askPhone(
      s,
      { reason: 'tool_failure', summary: 'Mobile plan search failed.' },
      `${intro} But I can't load the plans right now: our catalog is not responding. A sales advisor can call you back with the offers. What phone number should they use?`,
    );
  }
  s.offered = catalog.plans;
  s.stage = 'offer';
  return `${intro} Our mobile plans: ${list(catalog.plans)}. ${offerQuestion(s)}`;
}

// Choosing a plan, the customer's details, the recap and the order.

function atOffer(s: State, text: string): string | undefined {
  const named = mentionedPlans(text, s.offered);
  if (named.length === 1 && named[0]) return choosePlan(s, named[0]);
  if (named.length > 1) return `Which one would you like: ${names(named)}?`;
  if (isCallbackRequest(text)) {
    const where = s.coverage?.address ?? s.address;
    const wants = /\bfib(?:er|re)\b/.test(normalize(text)) ? 'fiber' : 'a call';
    const summary = where
      ? `New customer at ${where} wants ${wants}. Offered: ${s.offered.map((plan) => plan.name).join(', ')}.`
      : 'The customer asks for a call.';
    return askPhone(
      s,
      { reason: 'callback', summary },
      'Sure. A sales advisor can call you back. What phone number should they use?',
    );
  }
  const only = s.offered.length === 1 ? s.offered[0] : undefined;
  if (only && isLooseYes(text)) return choosePlan(s, only);
  return undefined;
}

function choosePlan(s: State, plan: PlanView): string {
  s.plan = plan;
  if (s.flow === 'upgrade' || (s.customer.name && s.customer.email)) return recap(s);
  s.stage = 'details';
  return `Good choice: ${describe(plan)}. ${detailsQuestion(s)}`;
}

function atDetails(s: State, text: string): string | undefined {
  const email = extractEmail(text);
  const name = extractName(text);
  if (!email && !name) return undefined;
  if (email) s.customer.email = email;
  if (name) s.customer.name = name;
  if (s.customer.name && s.customer.email) return recap(s);
  return detailsQuestion(s);
}

function detailsQuestion(s: State): string {
  if (!s.customer.name && !s.customer.email) {
    return 'To set up the order I need your full name and email address.';
  }
  return s.customer.name ? 'What is your email address?' : 'What is your full name?';
}

function recap(s: State): string {
  const plan = s.plan;
  if (!plan) {
    s.stage = 'offer';
    return offerQuestion(s);
  }
  s.stage = 'recap';
  const ask = 'Reply CONFIRM to place the order.';
  if (s.flow === 'upgrade') {
    const from = s.currentPlan ? `${s.currentPlan.name} to ` : '';
    return `Here is the change: ${from}${describe(plan)}, from your next billing cycle. ${ask}`;
  }
  const who = `for ${s.customer.name} (${s.customer.email})`;
  if (s.flow === 'home') {
    return `Here is your order: ${describe(plan)}, at ${s.coverage?.address}, ${who}. ${ask}`;
  }
  const number = s.portNumber ? `keeping ${formatPhone(s.portNumber)}` : 'with a new Acme number';
  return `Here is your order: ${describe(plan)}, ${who}, ${number}. ${ask}`;
}

function atRecap(s: State, text: string, call: CallTool, guards: GuardEvent[]): string | undefined {
  if (isExplicitConfirm(text)) {
    guards.push({ name: 'explicit_confirmation', verdict: 'pass' });
    return placeOrder(s, call);
  }
  const other = mentionedPlans(text, s.offered).filter((plan) => plan.id !== s.plan?.id);
  if (other.length === 1 && other[0]) {
    s.plan = other[0];
    return recap(s);
  }
  if (isLooseYes(text)) {
    guards.push({ name: 'explicit_confirmation', verdict: 'block' });
    return 'I need an explicit go before I place anything: reply CONFIRM to place the order, or tell me what to change.';
  }
  return undefined;
}

function placeOrder(s: State, call: CallTool): string {
  const plan = s.plan;
  if (!plan) return recap(s);
  const outcome = call('order.create', orderInput(s, plan));
  const orderId = readString(outcome, 'order_id');
  if (orderId) {
    s.orderId = orderId;
    s.stage = 'order_placed';
    return placedText(s, plan, orderId);
  }
  // Never retried: a second order.create could place the order twice. Sales takes it from here.
  const ticketId = sendLead(
    s,
    {
      reason: 'order_failed',
      summary: `${plan.name} for ${s.customer.name ?? s.customer.email} could not be ordered: ${failure(outcome)}.`,
    },
    call,
  );
  if (!ticketId)
    return `I could not place the order, and I could not reach our sales team either. ${SALES_LINE}`;
  return `I could not place the order: our order system returned an error. I passed your request to a sales advisor, who will contact you at ${s.customer.email}. Your reference is ${ticketId}.`;
}

function orderInput(s: State, plan: PlanView): ToolInput {
  if (s.flow === 'upgrade') return { type: 'upgrade', customer_id: s.customer.id, plan_id: plan.id };
  const customer = { name: s.customer.name, email: s.customer.email };
  if (s.flow === 'home') {
    return { type: 'new', plan_id: plan.id, address_id: s.coverage?.address_id, customer };
  }
  return s.portNumber
    ? { type: 'new', plan_id: plan.id, customer, port_number: s.portNumber }
    : { type: 'new', plan_id: plan.id, customer };
}

function placedText(s: State, plan: PlanView, orderId: string): string {
  const done = `Done. Your order ${orderId} is placed`;
  switch (s.flow) {
    case 'upgrade':
      return `${done}: ${plan.name} starts on your next billing cycle. Is there anything else I can help with?`;
    case 'home':
      return `${done}: ${plan.name} at ${s.coverage?.address}. A technician will contact you at ${s.customer.email} to schedule the installation.`;
    default:
      return s.portNumber
        ? `${done}: ${plan.name}. Your number ${formatPhone(s.portNumber)} moves to Acme one business day after the order.`
        : `${done}: ${plan.name}. The next steps are on their way to ${s.customer.email}.`;
  }
}

// Leads for a human sales advisor.

function askPhone(s: State, lead: Lead, question: string): string {
  s.pendingLead = lead;
  s.stage = 'callback';
  return question;
}

function atCallback(s: State, text: string, call: CallTool): string | undefined {
  const phone = extractPhone(text);
  if (!phone) return undefined;
  s.customer.phone = phone;
  const lead = s.pendingLead ?? { reason: 'callback', summary: 'The customer asks for a call.' };
  const ticketId = sendLead(s, lead, call);
  if (!ticketId) {
    const either = lead.reason === 'callback' ? '' : ' either';
    return `I could not book the callback${either}: our sales system is not responding. ${SALES_LINE}`;
  }
  return `Done. A sales advisor will call you at ${formatPhone(phone)}${purpose(s, lead)}. Your reference is ${ticketId}.`;
}

function purpose(s: State, lead: Lead): string {
  const where = s.coverage?.address ?? s.address;
  switch (lead.reason) {
    case 'tool_failure':
      return where && !s.coverage ? ` once coverage at ${where} is checked` : ' once the check is done';
    case 'no_coverage':
      return ` when Acme home internet reaches ${where}`;
    case 'callback':
      return where ? ` about home internet at ${where}` : '';
    default:
      return '';
  }
}

/** Sends the lead once, never retried. Returns the ticket id, or undefined when sales could not take it. */
function sendLead(s: State, lead: Lead, call: CallTool): string | undefined {
  const contact: Record<string, string> = {};
  if (s.customer.name) contact.name = s.customer.name;
  if (s.customer.email) contact.email = s.customer.email;
  if (s.customer.phone) contact.phone = s.customer.phone;
  const outcome = call('notify_sales', { reason: lead.reason, customer: contact, summary: lead.summary });
  const ticketId = readString(outcome, 'ticket_id');
  s.lead = { ...lead, ticketId };
  s.pendingLead = undefined;
  s.stage = 'handover';
  return ticketId;
}

function leadStatus(s: State): string {
  if (!s.lead) return pendingQuestion(s);
  if (!s.lead.ticketId) return `The callback could not be booked either. ${SALES_LINE}`;
  const phone = s.customer.phone ? ` at ${formatPhone(s.customer.phone)}` : '';
  return `Your callback request ${s.lead.ticketId} is in: an advisor will call you${phone}.`;
}

// Questions and summaries.

/** The question the conversation is waiting on. Every detour ends with it. */
export function pendingQuestion(s: State): string {
  switch (s.stage) {
    case 'needs':
      return NEEDS;
    case 'identify':
      return 'What is the email address on your Acme account?';
    case 'address':
      return 'What is the street address?';
    case 'port_number':
      return 'Which number do you want to bring to Acme?';
    case 'offer':
      return offerQuestion(s);
    case 'details':
      return detailsQuestion(s);
    case 'recap':
      return 'Reply CONFIRM to place the order, or tell me what to change.';
    case 'callback':
      return 'What phone number should the advisor use?';
    default:
      return 'Is there anything else I can help with?';
  }
}

function resume(s: State): string {
  switch (s.stage) {
    case 'needs':
      return `We were just starting. ${NEEDS}`;
    case 'offer': {
      const where = s.coverage ? ` at ${s.coverage.address}` : '';
      return `We were choosing your plan${where}: ${list(s.offered)}. ${offerQuestion(s)}`;
    }
    case 'details':
      return `We were setting up your order for ${s.plan?.name ?? 'your plan'}. ${detailsQuestion(s)}`;
    case 'recap':
      return `We were confirming your order. ${recap(s)}`;
    default:
      return `Let's pick up where we left off. ${pendingQuestion(s)}`;
  }
}

function offerQuestion(s: State): string {
  const [only] = s.offered;
  if (s.offered.length === 1 && only) return `Would you like ${only.name}?`;
  return `Which one would you like: ${names(s.offered)}?`;
}

function names(plans: PlanView[]): string {
  const all = plans.map((plan) => plan.name);
  return all.length <= 1 ? all.join('') : `${all.slice(0, -1).join(', ')} or ${all.at(-1)}`;
}

function list(plans: PlanView[]): string {
  return plans.map(describe).join('; ');
}

function describe(plan: PlanView): string {
  return `${plan.name}, ${terms(plan)}`;
}

function terms(plan: PlanView): string {
  const price = `for $${plan.monthly_usd} a month`;
  if (plan.category === 'mobile') {
    return `${plan.data_gb === null ? 'unlimited data' : `${plan.data_gb} GB`} ${price}`;
  }
  const speed = `${plan.speed_mbps} Mbps ${price}`;
  return plan.access === 'fiber' ? speed : `up to ${speed}`;
}

/** The offered plans a message names, by name, short name, data, speed or technology. */
export function mentionedPlans(text: string, plans: PlanView[]): PlanView[] {
  const normalized = normalize(text);
  return plans.filter((plan) =>
    aliases(plan).some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(normalized)),
  );
}

function aliases(plan: PlanView): string[] {
  const name = plan.name.toLowerCase();
  const found = [name, name.replace(/^acme /, '')];
  if (plan.data_gb === null) found.push('unlimited');
  else if (plan.data_gb !== undefined) found.push(`${plan.data_gb} gb`, `${plan.data_gb}gb`);
  if (plan.speed_mbps !== undefined && plan.access === 'fiber') found.push(`${plan.speed_mbps} mbps`);
  if (plan.access === '5g') found.push('5g');
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reading tool results. An answer the agent cannot read counts as a failure: it never guesses.

/** Read-only tools get one retry; side-effecting tools never do. */
function callWithRetry(call: CallTool, label: ToolLabel, input: ToolInput): ToolOutcome {
  const first = call(label, input);
  return first.ok ? first : call(label, input);
}

type CatalogAnswer = {
  plans: PlanView[];
  customer?: { id: string; name: string; current_plan_id: string } | null;
};

function readCatalog(outcome: ToolOutcome): CatalogAnswer | undefined {
  if (!outcome.ok || !isRecord(outcome.output)) return undefined;
  const { plans: listed, customer } = outcome.output;
  if (!Array.isArray(listed)) return undefined;
  // A plan the guard took a value from is left out when it no longer reads; any other unreadable plan, or
  // none left to read, and the answer is unreadable.
  const plans = listed.filter(isPlanView);
  if (!listed.every((plan) => isPlanView(plan) || (isRecord(plan) && TRIMMED.has(plan)))) return undefined;
  if (plans.length === 0 && listed.length > 0) return undefined;
  if (customer === undefined || customer === null) return { plans, customer };
  if (
    !isRecord(customer) ||
    typeof customer.id !== 'string' ||
    typeof customer.name !== 'string' ||
    typeof customer.current_plan_id !== 'string'
  ) {
    return undefined;
  }
  return {
    plans,
    customer: { id: customer.id, name: customer.name, current_plan_id: customer.current_plan_id },
  };
}

function isPlanView(value: unknown): value is PlanView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.category === 'string' &&
    typeof value.monthly_usd === 'number'
  );
}

type CoverageAnswer = { found: false } | ({ found: true } & Coverage);

function readCoverage(outcome: ToolOutcome): CoverageAnswer | undefined {
  if (!outcome.ok || !isRecord(outcome.output)) return undefined;
  const out = outcome.output;
  if (out.found === false) return { found: false };
  if (
    out.found !== true ||
    typeof out.address_id !== 'string' ||
    typeof out.address !== 'string' ||
    typeof out.fiber_mbps !== 'number' ||
    typeof out.five_g !== 'boolean'
  ) {
    return undefined;
  }
  return {
    found: true,
    address_id: out.address_id,
    address: out.address,
    fiber_mbps: out.fiber_mbps,
    five_g: out.five_g,
  };
}

function readPort(
  outcome: ToolOutcome,
): { number: string; eligible: boolean; reason: string | undefined } | undefined {
  if (!outcome.ok || !isRecord(outcome.output)) return undefined;
  const { number, eligible, reason } = outcome.output;
  if (typeof number !== 'string' || typeof eligible !== 'boolean') return undefined;
  return { number, eligible, reason: typeof reason === 'string' ? reason : undefined };
}

function readString(outcome: ToolOutcome, key: string): string | undefined {
  if (!outcome.ok || !isRecord(outcome.output)) return undefined;
  const value = outcome.output[key];
  return typeof value === 'string' ? value : undefined;
}

function failure(outcome: ToolOutcome): string {
  return outcome.ok ? 'an answer the agent could not read' : outcome.error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
