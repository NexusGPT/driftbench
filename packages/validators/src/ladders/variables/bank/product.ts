import { fileURLToPath } from 'node:url';
import { type Frame, isolate } from '../../../frame';
import { implModulePath, withLabels } from '../impl';
import type { VariablesImpl } from '../interface';

/**
 * The product under test, run apart from the bank (docs/validators.md section 12.9). The module that provides the six
 * functions (the adapter, or the module DRIFTBENCH_VARIABLES_IMPL names) runs in confined processes that cannot read the
 * bank, its fixtures or its oracles, and that write nothing to the channel the bank reports on. Every call goes to
 * them as data and comes back as data; the item reads the answer in the bank's own process, so its verdict is
 * computed outside the process of the product.
 */

export type Product = {
  /** The six functions, as the items call them. A function the module does not provide is absent. */
  impl: Partial<VariablesImpl>;
  frame: Frame<Partial<VariablesImpl>>;
  /** The module under test. */
  module: string;
};

/** The folders of the validator that hold the bank and its expected values: the product imports none of them. */
const VALIDATOR_FILES = ['../bank', '../blind'].map((path) => fileURLToPath(new URL(path, import.meta.url)));

/** The folder of the variables ladder: a module under test that wraps the adapter reaches it from outside its own tree. */
const LADDER = fileURLToPath(new URL('..', import.meta.url));

const NAMES = ['buildStore', 'weightInterval', 'plan', 'coverage', 'validate', 'quotes'] as const;

/** Where a module may hold its functions as an object: the export `variablesImpl`, or its default export. */
export const MEMBERS = ['variablesImpl', 'default'];

export function openProduct(seed: number, tag: string, module: string = implModulePath()): Product {
  const frame = isolate<Partial<VariablesImpl>>({
    module,
    seed,
    tag,
    members: MEMBERS,
    sources: [LADDER],
    refuse: VALIDATOR_FILES,
    aliasing: true,
  });
  const given = frame.product;
  const impl: Record<string, unknown> = {};
  for (const name of NAMES) {
    const fn = given[name];
    if (typeof fn === 'function') impl[name] = fn;
  }
  return { impl: withLabels(impl as Partial<VariablesImpl>), frame, module };
}
