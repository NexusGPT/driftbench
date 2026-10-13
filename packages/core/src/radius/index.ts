/** Blast radius: which blocks a change to the agent can affect. See docs/concepts/blast-radius.md. */
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
export { agentVersionOf, withAgentVersion } from './version';
