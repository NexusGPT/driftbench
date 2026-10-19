import type { BankItem } from '../../blocks/types';
import { campaignItems } from './campaign';
import { checkItems } from './checks';
import { runItems } from './run';
import { toolItems } from './tools';

/**
 * The growth lane "docgaps" (a blind lane that wrote its items from the shipped docs alone and never read the
 * product): items on documented rules that no earlier item tests in the case written here. The maintainer joins
 * them to the blocks bank by one registration line in `bank.ts`.
 */
export function growthDocgapsItems(): BankItem[] {
  return [...checkItems(), ...toolItems(), ...runItems(), ...campaignItems()];
}
