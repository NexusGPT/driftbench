import { type AcmeStore, createStore } from '../../../../../examples/acme/src/index';
import type { SdkTool } from '../../../src/anthropic/index';
import { ACME_TOOLS, runAcmeTool } from './acme-model';

/**
 * The Acme agent's five tools as SDK tools, over a fresh store per session: what a developer hands the
 * anthropic and google adapters next to the client. A failed call throws, and the adapter turns the throw
 * into the tool's error.
 */
export function acmeTools(): { tools: SdkTool[]; store: AcmeStore } {
  const store = createStore();
  const tools = ACME_TOOLS.map(
    (label): SdkTool => ({
      name: label,
      description: DESCRIPTIONS[label],
      inputSchema: { type: 'object', additionalProperties: true },
      run: (input, context) => {
        const outcome = runAcmeTool(store, label, input, context.world);
        if (!outcome.ok) throw new Error(outcome.error);
        return outcome.output;
      },
    }),
  );
  return { tools, store };
}

const DESCRIPTIONS: Record<(typeof ACME_TOOLS)[number], string> = {
  'catalog.search':
    'Plans of a category (mobile or home), the ones available at an address, and the customer plan.',
  'coverage.check': 'Fiber and 5G coverage at a street address.',
  'port.check': 'Whether a phone number can move to Acme.',
  'order.create': 'Places an order: a new line, a home plan, an upgrade or a port.',
  notify_sales: 'Sends a lead to the sales team.',
};
