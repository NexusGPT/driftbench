import type { VariablesImpl } from '../../../src/ladders/variables/interface';
import { coverage, plan, weightInterval } from './planner';
import { buildStore } from './readers';
import { quotes, validate } from './validate';

/** The reference implementation: what a product that follows docs/variables.md returns, for the blind bank to pass. */
export const referenceImpl: VariablesImpl = { buildStore, weightInterval, plan, coverage, validate, quotes };
