import { createHash } from 'node:crypto';
import type { WorldState } from '@agent-nexus/driftbench-core';
import { toE164 } from './parse';
import { type AcmeData, type AcmeStore, type Plan, withSeed } from './store';

/**
 * The five tools of the Acme agent. Inputs and outputs are plain JSON with snake_case keys, the same
 * keys a spec asserts on. A tool refuses an unknown parameter, so an invented argument fails loudly.
 */

export const TOOL_LABELS = [
  'catalog.search',
  'coverage.check',
  'port.check',
  'order.create',
  'notify_sales',
] as const;
export type ToolLabel = (typeof TOOL_LABELS)[number];

/** Tools whose accepted calls are recorded in the payload log. */
export const SIDE_EFFECT_TOOLS: ReadonlySet<ToolLabel> = new Set(['order.create', 'notify_sales']);

export type ToolInput = Record<string, unknown>;
export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string };
export type ToolOverride = NonNullable<WorldState['tools']>[string];

export type ToolContext = {
  store: AcmeStore;
  /** `given.world.store`: records that overlay the store for this call. */
  seed?: Record<string, unknown>;
  /** `given.world.tools[label]`: a forced result or error. */
  override?: ToolOverride;
  /** False while the agent re-reads an earlier turn: nothing is recorded. */
  commit: boolean;
};

class InvalidInput extends Error {}

/**
 * Runs one tool. An override error makes the call fail; an override result replaces the tool's answer.
 * A side-effecting call that succeeds, real or forced, records its payload when `commit` is true.
 */
export function callTool(label: ToolLabel, input: ToolInput, ctx: ToolContext): ToolOutcome {
  let outcome: ToolOutcome;
  if (ctx.override?.error !== undefined) {
    outcome = { ok: false, error: ctx.override.error };
  } else if (ctx.override !== undefined && 'result' in ctx.override) {
    outcome = { ok: true, output: ctx.override.result };
  } else {
    try {
      outcome = { ok: true, output: IMPLEMENTATIONS[label](input, withSeed(ctx.store, ctx.seed)) };
    } catch (cause) {
      if (!(cause instanceof InvalidInput)) throw cause;
      outcome = { ok: false, error: cause.message };
    }
  }
  if (outcome.ok && ctx.commit && SIDE_EFFECT_TOOLS.has(label)) {
    ctx.store.payloads.push({ tool: label, input: structuredClone(input), output: outcome.output });
  }
  return outcome;
}

export function isToolLabel(value: string): value is ToolLabel {
  return (TOOL_LABELS as readonly string[]).includes(value);
}

const IMPLEMENTATIONS: Record<ToolLabel, (input: ToolInput, data: AcmeData) => unknown> = {
  'catalog.search': catalogSearch,
  'coverage.check': coverageCheck,
  'port.check': portCheck,
  'order.create': orderCreate,
  notify_sales: notifySales,
};

/** `{ category, customer_email?, address_id? }`: plans of a category, the ones available at an address, and the customer's current plan. */
function catalogSearch(input: ToolInput, data: AcmeData) {
  allowOnly(input, ['category', 'customer_email', 'address_id']);
  const category = input.category;
  if (category !== 'mobile' && category !== 'home') throw new InvalidInput('category must be mobile or home');
  let plans = data.plans.filter((plan) => plan.category === category);

  if (input.address_id !== undefined) {
    if (category !== 'home') throw new InvalidInput('address_id applies to home plans only');
    const address = data.addresses.find((entry) => entry.id === input.address_id);
    if (!address) throw new InvalidInput(`unknown address_id: ${String(input.address_id)}`);
    plans = plans.filter((plan) =>
      plan.access === 'fiber' ? address.fiber_mbps >= (plan.speed_mbps ?? 0) : address.five_g,
    );
  }

  const result: Record<string, unknown> = { plans: plans.map((plan) => ({ ...plan })) };
  if (input.customer_email !== undefined) {
    const email = requireString(input, 'customer_email').toLowerCase();
    const customer = data.customers.find((entry) => entry.email === email);
    result.customer = customer
      ? { id: customer.id, name: customer.name, current_plan_id: customer.plan_id }
      : null;
  }
  return result;
}

/** `{ address }`: whether Acme reaches an address, and how fast. */
function coverageCheck(input: ToolInput, data: AcmeData) {
  allowOnly(input, ['address']);
  const wanted = simplify(requireString(input, 'address'));
  const address = data.addresses.find((entry) => {
    const street = simplify(entry.label.split(',')[0] ?? entry.label);
    return wanted === simplify(entry.label) || wanted.startsWith(street);
  });
  if (!address) return { found: false, address: input.address };
  return {
    found: true,
    address_id: address.id,
    address: address.label,
    fiber_mbps: address.fiber_mbps,
    five_g: address.five_g,
  };
}

/** `{ number }`: whether a number held elsewhere can move to Acme. */
function portCheck(input: ToolInput, data: AcmeData) {
  allowOnly(input, ['number']);
  const number = toE164(requireString(input, 'number'));
  if (!number) throw new InvalidInput('number must be a US phone number');
  const record = data.port_numbers.find((entry) => entry.number === number);
  if (!record) return { number, eligible: false, reason: 'the number is not active at any carrier' };
  return record.eligible ? { number, eligible: true } : { number, eligible: false, reason: record.reason };
}

/** `{ type, plan_id, customer_id? | customer?, address_id?, port_number? }`: places an order. */
function orderCreate(input: ToolInput, data: AcmeData) {
  allowOnly(input, ['type', 'plan_id', 'customer_id', 'customer', 'address_id', 'port_number']);
  const plan = data.plans.find((entry) => entry.id === input.plan_id);
  if (!plan) throw new InvalidInput(`unknown plan_id: ${String(input.plan_id)}`);

  if (input.type === 'upgrade') {
    const customer = data.customers.find((entry) => entry.id === input.customer_id);
    if (!customer) throw new InvalidInput(`unknown customer_id: ${String(input.customer_id)}`);
    const current = data.plans.find((entry) => entry.id === customer.plan_id);
    if (current && current.category !== plan.category) {
      throw new InvalidInput('an upgrade keeps the category of the current plan');
    }
    if (input.customer !== undefined || input.port_number !== undefined) {
      throw new InvalidInput('an upgrade takes customer_id only');
    }
  } else if (input.type === 'new') {
    const customer = input.customer;
    if (!isRecord(customer) || typeof customer.name !== 'string' || typeof customer.email !== 'string') {
      throw new InvalidInput('a new order needs customer.name and customer.email');
    }
    checkPlanPlace(plan, input, data);
  } else {
    throw new InvalidInput('type must be new or upgrade');
  }

  return {
    order_id: `ORD-${shortHash(input)}`,
    status: 'pending',
    plan_id: plan.id,
    monthly_usd: plan.monthly_usd,
  };
}

function checkPlanPlace(plan: Plan, input: ToolInput, data: AcmeData): void {
  if (plan.category === 'home') {
    const address = data.addresses.find((entry) => entry.id === input.address_id);
    if (!address) throw new InvalidInput('a home plan needs a known address_id');
    const available = plan.access === 'fiber' ? address.fiber_mbps >= (plan.speed_mbps ?? 0) : address.five_g;
    if (!available) throw new InvalidInput(`${plan.name} is not available at ${address.label}`);
    if (input.port_number !== undefined) throw new InvalidInput('port_number applies to mobile plans only');
    return;
  }
  if (input.address_id !== undefined) throw new InvalidInput('address_id applies to home plans only');
  if (input.port_number !== undefined) {
    const number = toE164(String(input.port_number));
    const record = data.port_numbers.find((entry) => entry.number === number);
    if (!record?.eligible) throw new InvalidInput('port_number cannot move to Acme');
  }
}

const LEAD_REASONS = new Set(['callback', 'no_coverage', 'tool_failure', 'order_failed']);

/** `{ reason, customer, summary }`: hands a lead to a human sales advisor. */
function notifySales(input: ToolInput) {
  allowOnly(input, ['reason', 'customer', 'summary']);
  if (typeof input.reason !== 'string' || !LEAD_REASONS.has(input.reason)) {
    throw new InvalidInput('reason must be callback, no_coverage, tool_failure or order_failed');
  }
  const customer = input.customer;
  if (!isRecord(customer) || (typeof customer.phone !== 'string' && typeof customer.email !== 'string')) {
    throw new InvalidInput('customer needs a phone or an email');
  }
  requireString(input, 'summary');
  return { ticket_id: `LEAD-${shortHash(input)}`, queued: true };
}

function allowOnly(input: ToolInput, keys: string[]): void {
  for (const key of Object.keys(input)) {
    if (!keys.includes(key)) throw new InvalidInput(`unknown parameter: ${key}`);
  }
}

function requireString(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') throw new InvalidInput(`${key} is required`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function simplify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Six hex characters derived from the content: the same order always gets the same id. */
function shortHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 6).toUpperCase();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
