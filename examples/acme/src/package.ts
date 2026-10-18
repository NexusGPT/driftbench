import { fileURLToPath } from 'node:url';

/**
 * What the driftbench command line loads from the Acme example: the sales assistant behind
 * `function:acme-sales`, the ops agent behind `process:acme-ops` and the control agent of the variance
 * pilot. The command line finds this package when the example is installed beside it, as in a checkout of
 * the repository; an install of the CLI alone does not hold it.
 */
export { createRandomAgent } from '../pilot/random-agent/index';
export { createAcmeAgent } from './agent';
export { createStore } from './store';

/** The path of the ops agent, `ops/agent.mjs`: one level above this module, in `src/` and in `dist/` alike. */
export const OPS_AGENT = fileURLToPath(new URL('../ops/agent.mjs', import.meta.url));
