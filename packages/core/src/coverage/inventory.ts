import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { DeviationClass } from '../schema/common';
import { isPlainObject } from '../spec/normalize';

/**
 * The behaviour inventory: every behaviour the agent must show, grouped into flows, and the deviation
 * classes each flow must be perturbed with. Specs point at it through `covers` and `flow:<id>` tags.
 */

/** A behaviour id: capital letters, a hyphen, digits. For example B-001 or T-012. */
export const BehaviourId = z.string().regex(/^[A-Z]+-\d+$/, {
  error: 'expected an id such as B-001: capital letters, a hyphen, then digits',
});

/** A flow id: a slug of lowercase letters, digits, hyphens and underscores, such as plan-upgrade. */
export const FlowId = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, {
  error: 'expected a slug such as plan-upgrade: lowercase letters, digits, hyphens and underscores',
});

const ChannelList = z
  .array(z.string().min(1))
  .min(1, { error: 'list at least one channel, or leave the key out' });

export const InventoryBehaviour = z.strictObject({
  id: BehaviourId,
  title: z.string(),
  /** `task` marks a code-interpreter behaviour. It is a row of the same matrix as the others. */
  kind: z.enum(['conversation', 'task']).default('conversation'),
  /** The channels where the behaviour applies. Absent means every channel. */
  channels: ChannelList.optional(),
});
export type InventoryBehaviour = z.infer<typeof InventoryBehaviour>;

export const InventoryFlow = z.strictObject({
  id: FlowId,
  title: z.string(),
  behaviours: z.array(BehaviourId),
  /** The deviation classes this flow must be perturbed with. Absent means none is required. */
  deviations: z.array(DeviationClass).optional(),
});
export type InventoryFlow = z.infer<typeof InventoryFlow>;

export const Inventory = z.strictObject({
  behaviours: z.array(InventoryBehaviour),
  flows: z.array(InventoryFlow),
  /** The channel universe. Absent means the channels named by behaviours and specs, else `default`. */
  channels: ChannelList.optional(),
});
export type Inventory = z.infer<typeof Inventory>;

/** Every problem an inventory can have has a stable code, like the spec loader's issues. */
export const InventoryIssueCodes = [
  'INVENTORY_PARSE',
  'INVENTORY_NOT_OBJECT',
  'INVENTORY_DUPLICATE',
  'INVENTORY_UNKNOWN_BEHAVIOUR',
  'INVENTORY_UNKNOWN_CHANNEL',
] as const;

export type InventoryIssueCode = (typeof InventoryIssueCodes)[number] | `SCHEMA_${string}`;

export type InventoryIssue = {
  code: InventoryIssueCode;
  /** Dotted path inside the inventory, for example `flows.1.behaviours.0`. Empty for the whole file. */
  path: string;
  message: string;
};

export type InventoryResult =
  | { ok: true; path: string; inventory: Inventory }
  | { ok: false; path: string; errors: InventoryIssue[] };

/** Parses and validates inventory text. Never throws on bad input. */
export function parseInventoryText(
  text: string,
  format: 'yaml' | 'json',
  path = '<inline>',
): InventoryResult {
  let raw: unknown;
  try {
    raw = format === 'json' ? JSON.parse(text) : parseYaml(text, { prettyErrors: true, uniqueKeys: true });
  } catch (cause) {
    return { ok: false, path, errors: [issue('INVENTORY_PARSE', '', describe(cause))] };
  }
  return validateInventory(raw, path);
}

/** Validates an already parsed value: the strict schema first, then the cross references. */
export function validateInventory(raw: unknown, path = '<inline>'): InventoryResult {
  if (!isPlainObject(raw)) {
    const message = 'an inventory file must hold one mapping (an object) with behaviours and flows';
    return { ok: false, path, errors: [issue('INVENTORY_NOT_OBJECT', '', message)] };
  }
  const parsed = Inventory.safeParse(raw);
  if (!parsed.success) return { ok: false, path, errors: parsed.error.issues.map(fromZod) };
  const errors = checkReferences(parsed.data);
  return errors.length > 0 ? { ok: false, path, errors } : { ok: true, path, inventory: parsed.data };
}

/** Reads one inventory file. `.json` is parsed as JSON, anything else as YAML. */
export async function loadInventory(path: string): Promise<InventoryResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      errors: [issue('INVENTORY_PARSE', '', `cannot read the file: ${describe(cause)}`)],
    };
  }
  return parseInventoryText(text, extname(path).toLowerCase() === '.json' ? 'json' : 'yaml', path);
}

/** Rules the schema cannot express: unique ids and entries, and references that resolve. */
function checkReferences(inventory: Inventory): InventoryIssue[] {
  const issues: InventoryIssue[] = [];
  const declared = inventory.channels;
  if (declared) duplicates(declared, 'channels', 'channel', issues);

  const behaviourIds = new Set<string>();
  inventory.behaviours.forEach((behaviour, index) => {
    const path = `behaviours.${index}`;
    if (behaviourIds.has(behaviour.id)) {
      issues.push(issue('INVENTORY_DUPLICATE', `${path}.id`, `behaviour "${behaviour.id}" is listed twice`));
    }
    behaviourIds.add(behaviour.id);
    if (!behaviour.channels) return;
    duplicates(behaviour.channels, `${path}.channels`, 'channel', issues);
    if (!declared) return;
    behaviour.channels.forEach((channel, position) => {
      if (!declared.includes(channel)) {
        issues.push(
          issue(
            'INVENTORY_UNKNOWN_CHANNEL',
            `${path}.channels.${position}`,
            `channel "${channel}" is not in the inventory's channels (${declared.join(', ')})`,
          ),
        );
      }
    });
  });

  const flowIds = new Set<string>();
  inventory.flows.forEach((flow, index) => {
    const path = `flows.${index}`;
    if (flowIds.has(flow.id)) {
      issues.push(issue('INVENTORY_DUPLICATE', `${path}.id`, `flow "${flow.id}" is listed twice`));
    }
    flowIds.add(flow.id);
    duplicates(flow.behaviours, `${path}.behaviours`, 'behaviour', issues);
    flow.behaviours.forEach((id, position) => {
      if (!behaviourIds.has(id)) {
        issues.push(
          issue(
            'INVENTORY_UNKNOWN_BEHAVIOUR',
            `${path}.behaviours.${position}`,
            `behaviour "${id}" is not in the inventory's behaviours`,
          ),
        );
      }
    });
    if (flow.deviations) duplicates(flow.deviations, `${path}.deviations`, 'deviation class', issues);
  });

  return issues;
}

function duplicates(values: readonly string[], path: string, noun: string, issues: InventoryIssue[]): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issues.push(issue('INVENTORY_DUPLICATE', `${path}.${index}`, `${noun} "${value}" is listed twice`));
    }
    seen.add(value);
  });
}

function issue(code: InventoryIssueCode, path: string, message: string): InventoryIssue {
  return { code, path, message };
}

function fromZod(zodIssue: z.core.$ZodIssue): InventoryIssue {
  let message = zodIssue.message;
  if (zodIssue.code === 'unrecognized_keys') {
    message = `unknown key${zodIssue.keys.length > 1 ? 's' : ''}: ${zodIssue.keys.join(', ')}`;
  } else if (zodIssue.code === 'invalid_type') {
    message = message.replace(/received undefined$/, 'missing');
  }
  return issue(`SCHEMA_${zodIssue.code.toUpperCase()}`, zodIssue.path.map(String).join('.'), message);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
