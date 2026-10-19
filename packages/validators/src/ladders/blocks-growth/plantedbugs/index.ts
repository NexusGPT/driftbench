import type { BankItem } from '../../blocks/types';
import { loaderItems } from './loader';
import { reportItems } from './report';
import { runnerItems } from './runner';
import { sandboxItems } from './sandbox';

/**
 * The growth lane "plantedbugs": items on the documented behaviours that ten planted bugs broke while every item of
 * the bank stayed green (the planted-bugs audit of the blocks bank). Written blind from the docs and the one-line
 * behaviour of each bug, never from its diff or the product's code. Each item is a twin and a catch item: it passes
 * on the product as built and fails where the behaviour breaks. The maintainer joins them to the blocks bank by one
 * registration line in `bank.ts`.
 */
export function growthPlantedBugsItems(): BankItem[] {
  return [...runnerItems(), ...loaderItems(), ...sandboxItems(), ...reportItems()];
}
