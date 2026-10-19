import type { BankItem } from '../../blocks/types';
import { objectsItems } from './objects';
import { reportsItems } from './reports';
import { valuesItems } from './values';

/**
 * The growth lane "contracts2" (a blind lane that wrote its items from docs/reference/block-contracts.md alone and
 * never read the product): items on cases of that page no earlier item tests, one family per group of sections
 * (objects; value ladder and value checks for code; attribution, the evidence step, section registry and
 * localize). The maintainer registers them in `bank.ts`.
 */
export function growthContracts2Items(): BankItem[] {
  return [...objectsItems(), ...valuesItems(), ...reportsItems()];
}
