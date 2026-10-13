import {
  type BlockSpec,
  blockCell,
  canonicalJson,
  deviationOf,
  generatedMeta,
  isPlainObject,
  OBSERVED_FIELDS,
  type ObservedField,
  type Spec,
  type Stimulus,
  type ThenField,
  thenFields,
} from '@agent-nexus/driftbench-core';
import type { GateOptions, StageVerdict } from './types';

// The Then fields, the block's cell and its deviation class are read by core's blast radius too: they
// live there, and the gate exports them as before.
export { blockCell, deviationOf, generatedMeta, thenFields };

/**
 * Stage 1 and what the later stages read from a block: the fields its Then reads, its own cell, its When
 * text, and the signature of its machine Then. A block's Then is its own `expect`, the spec rules that
 * apply to every block, and the spec end state on the last block.
 */

const OBSERVED: ReadonlySet<string> = new Set(OBSERVED_FIELDS);

export function isObservedField(field: ThenField): field is ObservedField {
  return OBSERVED.has(field);
}

/** The family a block's label is audited in: the seeder that wrote it, or `hand-written`. */
export function auditFamily(spec: Spec): string {
  const seeder = generatedMeta(spec)?.seeder;
  return typeof seeder === 'string' && seeder !== '' ? seeder : 'hand-written';
}

/** The model family that wrote the spec: the generator's `family`, `code` for a code generator, else `human`. */
export function generatorFamily(spec: Spec): string {
  const generated = generatedMeta(spec);
  if (!generated) return 'human';
  const family = generated.family;
  if (typeof family === 'string' && family !== '') return family;
  return 'code';
}

/** The map hash the generator recorded, or undefined. */
export function mapHashOf(spec: Spec): string | undefined {
  const map = generatedMeta(spec)?.map;
  const hash = isPlainObject(map) ? map.hash : undefined;
  return typeof hash === 'string' ? hash : undefined;
}

/** The text of the stimulus: the user message, the burst joined, or the injected message. */
export function stimulusText(when: Stimulus): string {
  if ('user' in when) return when.user;
  if ('burst' in when) return when.burst.join('\n');
  return when.injection.user;
}

/** True when the block's own cell is about wording: a wording dimension, or a wording deviation class. */
export function isWordingCell(spec: Spec, index: number, wording: GateOptions['wording']): boolean {
  const cell = blockCell(spec, index);
  if (Object.keys(cell).some((key) => wording.dimensions.includes(key))) return true;
  const deviation = deviationOf(spec, index);
  return deviation !== undefined && wording.deviations.includes(deviation);
}

/** Stage 1: the Then must read observed state, or be about wording on a wording cell. */
export function observedStage(spec: Spec, index: number, wording: GateOptions['wording']): StageVerdict {
  const fields = thenFields(spec, index);
  const observed = fields.filter(isObservedField);
  if (observed.length > 0) return { status: 'pass', detail: `reads ${observed.join(', ')}` };
  if (fields.length === 0) {
    const criteria = spec.blocks[index]?.expect?.criteria?.length ?? 0;
    return {
      status: 'reject',
      reason: 'no-machine-then',
      detail:
        criteria > 0
          ? `the Then holds ${criteria} judged ${criteria === 1 ? 'criterion' : 'criteria'} and no machine check`
          : 'the block expects nothing',
    };
  }
  if (isWordingCell(spec, index, wording)) {
    return { status: 'pass', detail: `reads only ${fields.join(', ')}, on a cell about wording` };
  }
  return {
    status: 'reject',
    reason: 'words-only',
    detail: `reads only the agent's words (${fields.join(', ')}) on a cell that is not about wording`,
  };
}

/** The machine part of a block's Then, as text: equal signatures mean the same machine expectations. */
export function machineSignature(spec: Spec, index: number): string {
  const block: BlockSpec | undefined = spec.blocks[index];
  const { criteria: _criteria, ledger_add: _ledger, ...machine } = block?.expect ?? {};
  const rules = spec.rules ? { ...spec.rules } : undefined;
  const last = index === spec.blocks.length - 1;
  return canonicalJson({
    expect: machine,
    ...(rules ? { rules } : {}),
    ...(last && spec.end_state !== undefined ? { end_state: spec.end_state } : {}),
  });
}

/** True when the machine Then expects nothing. */
export function emptySignature(signature: string): boolean {
  return signature === canonicalJson({ expect: {} });
}
