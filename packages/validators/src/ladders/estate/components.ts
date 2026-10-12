/**
 * The fixed table from what failed to the one source file an item points at (docs/validators.md section 1,
 * rule 4). An item names the component, the builder opens that file.
 */
export const ESTATE_COMPONENTS = {
  reader: 'packages/estate/src/scan/claude-code.ts',
  code: 'packages/estate/src/scan/code.ts',
  prose: 'packages/estate/src/scan/prose.ts',
  invariants: 'packages/estate/src/scan/invariants.ts',
  scan: 'packages/estate/src/map/build.ts',
  edges: 'packages/estate/src/graph/edges.ts',
  analyze: 'packages/estate/src/graph/analyze.ts',
  lint: 'packages/estate/src/lint/lint.ts',
  pairwise: 'packages/estate/src/plan/pairwise.ts',
  contract: 'packages/estate/src/plan/contract.ts',
  expectations: 'packages/generate/src/estate/then.ts',
  generate: 'packages/generate/src/estate/generate.ts',
  toolsCheck: 'packages/checks/src/checks/tools.ts',
  customCheck: 'packages/checks/src/checks/custom.ts',
  stageCheck: 'packages/checks/src/checks/stage.ts',
  trace: 'packages/adapters/src/claude-code/session.ts',
  impact: 'packages/estate/src/maintain/impact.ts',
  validator: 'packages/validators/src/ladders/estate',
} as const;

/** The component that reads an atom of a kind: code for structure, the prose splitter for rules. */
export function componentOfKind(atom: { kind: string; hid: string }): string {
  switch (atom.kind) {
    case 'instruction':
    case 'register':
      return ESTATE_COMPONENTS.prose;
    case 'gate':
      return atom.hid.startsWith('gate:') || atom.hid === 'rule:fixed-gate'
        ? ESTATE_COMPONENTS.code
        : ESTATE_COMPONENTS.prose;
    case 'invariant':
      return ESTATE_COMPONENTS.invariants;
    default:
      return ESTATE_COMPONENTS.code;
  }
}

/** The component that would close a gap the generator names by its marker. */
export function componentOfMarker(marker: string): string {
  switch (marker) {
    case 'needs-some-call-check':
      return ESTATE_COMPONENTS.toolsCheck;
    case 'needs-registered-check':
      return ESTATE_COMPONENTS.customCheck;
    case 'needs-stage-reach-check':
      return ESTATE_COMPONENTS.stageCheck;
    case 'needs-static-runner':
      return ESTATE_COMPONENTS.lint;
    case 'needs-guard-timing':
    case 'needs-guard-message-check':
      return ESTATE_COMPONENTS.trace;
    case 'needs-ordered-anchor':
    case 'needs-negation':
    case 'needs-derivable-then':
      return ESTATE_COMPONENTS.expectations;
    default:
      return ESTATE_COMPONENTS.generate;
  }
}
