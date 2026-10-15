import { callTool, createStore, isToolLabel } from '../../../../examples/acme/src/index';
import type { ToolDeclaration, ToolReplayer } from '../../src/value-check/outcome';

/**
 * The Acme tools as a rung 1 replayer: the real tool on a fresh store, overlaid by the block's seeded store,
 * never a forced result and never a recorded payload. Only the read tools are declared: `order.create` and
 * `notify_sales` keep what they are given, so their values go to the other rungs (value_equivalence.md 3).
 * The store holds four addresses, three customers and several numbers, so a same result is no coincidence.
 */
export const ACME_DECLARATIONS: Readonly<Record<string, ToolDeclaration>> = {
  'coverage.check': { resolved: ['found', 'address_id'], distractors: true },
  'port.check': { resolved: ['number', 'eligible'], distractors: true },
  'catalog.search': { resolved: ['customer.id', 'plans'], distractors: true },
};

/** One replayed call, as a spy records it. */
export type ReplayedCall = { tool: string; input: Record<string, unknown> };

export function acmeReplayer(log: ReplayedCall[] = []): ToolReplayer {
  return {
    declaration: (tool) => ACME_DECLARATIONS[tool],
    call(tool, input, world) {
      log.push({ tool, input: structuredClone(input) });
      if (!isToolLabel(tool)) return { ok: false, error: `${tool} is not an Acme tool` };
      return callTool(tool, input, {
        store: createStore(),
        ...(world === undefined ? {} : { seed: world as Record<string, unknown> }),
        commit: false,
      });
    },
  };
}
