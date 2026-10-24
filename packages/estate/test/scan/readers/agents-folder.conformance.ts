import type { PartType } from '@agent-nexus/driftbench-core';
import { expect } from 'vitest';
import type { RawEstate } from '../../../src/scan/reader';

/** Independent source passage expected from one declared type that carries instructions. */
export type ProsePlant = { file: string; text: string };

/** Shared by the real-reader cases and the reviewed instruction-only mutant probe. */
export function assertDeclaredProse(raw: RawEstate, type: PartType, plant: ProsePlant): void {
  expect(
    raw.prose.filter((chunk) => chunk.file === plant.file).map((chunk) => chunk.text),
    `${type.name}: missing declared prose`,
  ).toEqual([plant.text]);
}
