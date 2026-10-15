import { NoParams, objectRegistry, registerDiagnosticStep, type Verdict } from '@agent-nexus/driftbench-core';
import { plural } from './support/values';

/** The implementation of the argument-accuracy step. */
export const ARGUMENT_ACCURACY_STEP = 'builtin:diagnostic/argument-accuracy';

/** `tools.<key>.input.<field>`: one input verdict of the tools check. */
function inputOf(verdict: Verdict): { key: string; field: string } | undefined {
  if (verdict.name !== 'tools' || !verdict.id.startsWith('tools.')) return undefined;
  const at = verdict.id.indexOf('.input.', 'tools.'.length);
  if (at < 0) return undefined;
  return { key: verdict.id.slice('tools.'.length, at), field: verdict.id.slice(at + '.input.'.length) };
}

/**
 * The share of a block's expected tool arguments that matched, computed from the input verdicts of the tools
 * check. It used to be the verdict `tools.argument_accuracy`; a measure computed from other verdicts is a
 * diagnosis, so it never changes a verdict or `pass`, and a change to how one argument is compared changes the
 * diagnosis, never another verdict.
 */
registerDiagnosticStep(ARGUMENT_ACCURACY_STEP, {
  params: NoParams,
  cost: 'static',
  summary: 'The share of the expected tool arguments that matched.',
  run: ({ verdicts }) => {
    const inputs = verdicts.flatMap((verdict) => {
      const input = inputOf(verdict);
      return input ? [{ ...input, pass: verdict.outcome === 'pass' }] : [];
    });
    if (inputs.length === 0) return undefined;
    const missed = inputs
      .filter((input) => !input.pass)
      .map((input) => `${input.key.replace(/#\d+$/, '')} input.${input.field}`);
    const matched = inputs.length - missed.length;
    const note = missed.length > 0 ? `; missed: ${missed.join(', ')}` : '';
    return {
      score: matched / inputs.length,
      summary: `${matched} of ${plural(inputs.length, 'expected argument')} matched${note}`,
      evidence: { matched, expected: inputs.length, missed },
    };
  },
});

/** `diagnostic:argument-accuracy`, shipped and run by default on every block whose tools check compared an argument. */
export const ARGUMENT_ACCURACY_DIAGNOSTIC = {
  kind: 'diagnostic',
  id: 'argument-accuracy',
  extends: null,
  description: 'The share of the expected tool arguments that matched, once per block.',
  scope: 'block',
  default: true,
  when: { any_verdict: { name: 'tools', id_contains: '.input.' } },
  reads: ['check-set'],
  steps: [
    { id: 'share', title: 'The share of the expected arguments that matched', impl: ARGUMENT_ACCURACY_STEP },
  ],
};

objectRegistry.registerShipped(
  ARGUMENT_ACCURACY_DIAGNOSTIC,
  '@agent-nexus/driftbench-checks diagnostic:argument-accuracy',
);
