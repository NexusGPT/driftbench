/**
 * The labeler contract suite, the second entry of the package: `@agent-nexus/driftbench-estate/labeler-contract`.
 * It registers vitest tests, so it runs inside a vitest test file; `vitest` is an optional peer.
 */
export {
  CONTRACT_FILES,
  CONTRACT_SETS,
  type ContractCase,
  type LabelerContractOptions,
  type LabelerFactory,
  labelerContract,
  labelerContractCases,
} from './pointer/contract';
