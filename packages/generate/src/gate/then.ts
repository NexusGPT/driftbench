import {
  type BlockSpec,
  canonicalJson,
  type Expect,
  isPlainObject,
  type Spec,
  type Stimulus,
} from '@agent-nexus/driftbench-core';
import {
  type GateOptions,
  OBSERVED_FIELDS,
  type ObservedField,
  type StageVerdict,
  type ThenField,
} from './types';

/**
 * Stage 1 and what the later stages read from a block: the fields its Then reads, its own cell, its When
 * text, and the signature of its machine Then. A block's Then is its own `expect`, the spec rules that
 * apply to every block, and the spec end state on the last block.
 */

const OBSERVED: ReadonlySet<string> = new Set(OBSERVED_FIELDS);

export function isObservedField(field: ThenField): field is ObservedField {
  return OBSERVED.has(field);
}

/** The fields the Then of block `index` reads, in a fixed order. Judged criteria read none. */
export function thenFields(spec: Spec, index: number): ThenField[] {
  const expect: Expect = spec.blocks[index]?.expect ?? {};
  const fields = new Set<ThenField>();
  if ((expect.tools?.length ?? 0) > 0 || expect.tool_order !== undefined) fields.add('tools');
  if (expect.stage !== undefined || expect.stage_reported === true) fields.add('stage');
  if ((expect.must?.length ?? 0) > 0 || (expect.must_not?.length ?? 0) > 0) fields.add('text');
  if (expect.lang !== undefined) fields.add('lang');
  if ((expect.cards?.length ?? 0) > 0) fields.add('cards');
  if ((expect.skills?.length ?? 0) > 0) fields.add('skills');
  if ((expect.guards?.length ?? 0) > 0) fields.add('guards');
  if (expect.execution !== undefined) fields.add('execution');
  if ((expect.artifacts?.length ?? 0) > 0) fields.add('artifacts');
  if (expect.workspace !== undefined) fields.add('workspace');
  if (expect.safety !== undefined) fields.add('safety');
  const rules = spec.rules;
  if (rules) {
    if (Object.keys(rules.max_calls ?? {}).length > 0 || (rules.forbidden_tools?.length ?? 0) > 0) {
      fields.add('tools');
    }
    if (rules.lang_stable === true) fields.add('lang');
    if (rules.one_message_per_turn === true) fields.add('format');
    if (Object.keys(rules.custom ?? {}).length > 0) fields.add('custom');
  }
  if (spec.end_state !== undefined && index === spec.blocks.length - 1) fields.add('end_state');
  const order: readonly ThenField[] = [...OBSERVED_FIELDS, 'text', 'lang', 'format'];
  return order.filter((field) => fields.has(field));
}

/** The generator's record of a spec, when a generator wrote it. */
export function generatedMeta(spec: Spec): Record<string, unknown> | undefined {
  const generated = spec.metadata?.generated;
  return isPlainObject(generated) ? generated : undefined;
}

/**
 * The block's own cell: the slot its When was phrased from, as the generator recorded it (the
 * `metadata.generated.blocks[].cell` entry without its `spec` pointer). Empty for a hand-written block.
 */
export function blockCell(spec: Spec, index: number): Record<string, string> {
  const blocks = generatedMeta(spec)?.blocks;
  if (!Array.isArray(blocks)) return {};
  const id = spec.blocks[index]?.id;
  const entry = blocks.find((each) => isPlainObject(each) && id !== undefined && each.block === id);
  const cell = isPlainObject(entry) ? entry.cell : undefined;
  if (!isPlainObject(cell)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cell)) {
    if (key !== 'spec' && (typeof value === 'string' || typeof value === 'number')) out[key] = String(value);
  }
  return out;
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

/** The deviation class a block carries: its injection's class, else the one its cell names. */
export function deviationOf(spec: Spec, index: number): string | undefined {
  const when = spec.blocks[index]?.when;
  if (when && 'injection' in when) return when.injection.class;
  return blockCell(spec, index).deviation;
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
