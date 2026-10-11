/**
 * The fake payload store behind the Acme Telecom agent: plans, addresses, customers and number
 * transfer records, plus a log of every payload the side-effecting tools accepted. Everything here is
 * fictional: the company, the town, the people, the prices. Phones sit in the reserved range
 * +1 202 555 0100 to 0199 and emails at example.com.
 */

export type PlanCategory = 'mobile' | 'home';

export type Plan = {
  id: string;
  name: string;
  category: PlanCategory;
  monthly_usd: number;
  /** Mobile data per month in GB; null means unlimited. Absent on home plans. */
  data_gb?: number | null;
  /** Home download speed in Mbps. Absent on mobile plans. */
  speed_mbps?: number;
  /** How a home plan reaches the address. */
  access?: 'fiber' | '5g';
};

export type Address = {
  id: string;
  label: string;
  /** Fastest fiber speed at the address; 0 when there is no fiber. */
  fiber_mbps: number;
  five_g: boolean;
};

export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  plan_id: string;
  address_id?: string;
};

/** Whether a number held at another carrier can move to Acme. */
export type PortRecord = { number: string; eligible: boolean; reason?: string };

/** One accepted call of a side-effecting tool: what the agent submitted and what it got back. */
export type Payload = { tool: string; input: Record<string, unknown>; output: unknown };

export type AcmeData = {
  plans: Plan[];
  addresses: Address[];
  customers: Customer[];
  port_numbers: PortRecord[];
};

export type AcmeStore = AcmeData & {
  /** Every accepted `order.create` and `notify_sales` call, in order. End-state checks read it. */
  payloads: Payload[];
};

/** Facts about the company the agent states without a tool. */
export const ACME = {
  name: 'Acme Telecom',
  carePhone: '+12025550100',
  salesPhone: '+12025550101',
  storeHours: 'Monday to Saturday, 9 am to 6 pm',
} as const;

const SEED: AcmeData = {
  plans: [
    { id: 'mobile-s', name: 'Acme Mobile S', category: 'mobile', monthly_usd: 15, data_gb: 10 },
    { id: 'mobile-m', name: 'Acme Mobile M', category: 'mobile', monthly_usd: 25, data_gb: 40 },
    { id: 'mobile-l', name: 'Acme Mobile L', category: 'mobile', monthly_usd: 35, data_gb: null },
    {
      id: 'fiber-300',
      name: 'Acme Fiber 300',
      category: 'home',
      monthly_usd: 40,
      speed_mbps: 300,
      access: 'fiber',
    },
    {
      id: 'fiber-1000',
      name: 'Acme Fiber 1000',
      category: 'home',
      monthly_usd: 60,
      speed_mbps: 1000,
      access: 'fiber',
    },
    { id: 'air-5g', name: 'Acme Air 5G', category: 'home', monthly_usd: 35, speed_mbps: 200, access: '5g' },
  ],
  addresses: [
    { id: 'addr-101', label: '14 Harbor Road, Acmeville', fiber_mbps: 1000, five_g: true },
    { id: 'addr-102', label: '3 Orchard Way, Acmeville', fiber_mbps: 300, five_g: true },
    { id: 'addr-103', label: '88 Summit Avenue, Acmeville', fiber_mbps: 0, five_g: true },
    { id: 'addr-104', label: '7 Quarry Lane, Acmeville', fiber_mbps: 0, five_g: false },
  ],
  customers: [
    {
      id: 'cust-001',
      name: 'Sam Rivera',
      email: 'sam.rivera@example.com',
      phone: '+12025550142',
      plan_id: 'mobile-s',
    },
    {
      id: 'cust-002',
      name: 'Lee Jensen',
      email: 'lee.jensen@example.com',
      phone: '+12025550118',
      plan_id: 'fiber-300',
      address_id: 'addr-102',
    },
    {
      id: 'cust-003',
      name: 'Morgan Diaz',
      email: 'morgan.diaz@example.com',
      phone: '+12025550125',
      plan_id: 'mobile-l',
    },
  ],
  port_numbers: [
    {
      number: '+12025550160',
      eligible: false,
      reason: 'the number has a transfer lock at its current carrier',
    },
    { number: '+12025550165', eligible: true },
  ],
};

/** A fresh store. Each conversation under test gets its own, so payloads never leak between runs. */
export function createStore(): AcmeStore {
  return { ...structuredClone(SEED), payloads: [] };
}

/**
 * The records a tool reads: the store, overlaid by a seed from `given.world.store`. A seeded record
 * replaces a stored one with the same id (or number, for transfer records). Malformed seed entries are
 * ignored.
 */
export function withSeed(store: AcmeData, seed?: Record<string, unknown>): AcmeData {
  return {
    plans: overlay(store.plans, seed?.plans, 'id'),
    addresses: overlay(store.addresses, seed?.addresses, 'id'),
    customers: overlay(store.customers, seed?.customers, 'id'),
    port_numbers: overlay(store.port_numbers, seed?.port_numbers, 'number'),
  };
}

function overlay<T extends Record<K, string>, K extends string>(base: T[], seed: unknown, key: K): T[] {
  if (!Array.isArray(seed)) return base;
  const extra = seed.filter(
    (entry): entry is T =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>)[key] === 'string',
  );
  const replaced = new Set(extra.map((entry) => entry[key]));
  return [...base.filter((entry) => !replaced.has(entry[key])), ...extra];
}
