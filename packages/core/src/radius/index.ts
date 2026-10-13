/** Blast radius: which blocks a change to the agent can affect. See docs/concepts/blast-radius.md. */
export {
  CHANGE_KINDS,
  Change,
  type ChangeKind,
  ChangeManifest,
  changeLabel,
  loadChangeManifest,
  type ParsedManifest,
  parseChangeManifest,
  ToolPart,
} from './change';
export {
  type BlockDependencies,
  blockCell,
  blockDependencies,
  deviationOf,
  generatedMeta,
  OBSERVED_FIELDS,
  type ObservedField,
  type ThenField,
  type ToolDependency,
  thenFields,
  WORDING_FIELDS,
  type WordingField,
} from './depends';
export {
  type BlockState,
  type RadiusBlock,
  type RadiusCell,
  type RadiusCount,
  type RadiusOptions,
  type RadiusReport,
  type RadiusSpec,
  type RadiusSpecReport,
  radiusOf,
} from './radius';
export { agentVersionOf, withAgentVersion } from './version';
