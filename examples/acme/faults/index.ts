import type { FaultDef } from '@agent-nexus/driftbench-generate';
import { opsFaults } from './ops';
import { salesFaults } from './sales';

/**
 * The Acme fault set of the validity gate: `driftbench gate --faults examples/acme/faults`. One fault per
 * drift class X1 to X5 and per deviation class the sales assistant must handle, on both Acme agents, plus
 * a negative control per agent. README.md documents each one. Fictional data only.
 */
export const faults: FaultDef[] = [...salesFaults, ...opsFaults];
