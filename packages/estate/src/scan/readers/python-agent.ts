import type { TypesDocument } from '@agent-nexus/driftbench-core';
import { type SourceFiles, type SourceReaderOptions, readSourceFiles } from './source-files';

export { pythonAgentFacts } from './python-syntax';

/**
 * The local Python syntax selector produces a normalized document for each .py input. The common model's
 * existing JSON-path/field grammar selects its records; no Python-specific field or locator grammar is added.
 */
export const PYTHON_AGENT_TYPES: TypesDocument = {
  version: 1,
  types: {
    graph: {
      root: 'source', locate: '**/*.py#$.graphs[*]',
      fields: { name: '$.name' }, aspects: ['indexes', 'configures'], loaded: 'always',
    },
    node: {
      root: 'source', locate: '**/*.py#$.nodes[*]',
      fields: { name: '$.name', graph: '$.graph', callable: '$.callable' },
      aspects: ['executes'], loaded: 'by-reference',
    },
    tool: {
      root: 'source', locate: '**/*.py#$.tools[*]',
      fields: { name: '$.name', description: '$.description', body: '$.body' },
      aspects: ['acts', 'executes', 'instructs'], loaded: 'on-demand',
    },
    prompt: {
      root: 'source', locate: '**/*.py#$.prompts[*]',
      fields: { name: '$.name', body: '$.text', file: '$.file', owner: '$.owner' },
      aspects: ['instructs'], loaded: 'by-reference',
    },
    agent: {
      root: 'source', locate: '**/*.py#$.agents[*]',
      fields: { name: '$.name' }, aspects: ['delegates', 'executes'], loaded: 'by-reference',
    },
    guard: {
      root: 'source', locate: '**/*.py#$.guards[*]',
      fields: { name: '$.name', owner: '$.owner' }, aspects: ['guards'], loaded: 'by-reference',
    },
  },
};

/** Reader-local syntax declarations; the canonical link stage supplies Part ids and provenance. */
export const PYTHON_AGENT_LINK_SELECTORS = [
  { kind: 'indexes', from: 'graph', to: 'node', match: 'graph' },
  { kind: 'routes-to', from: 'node', to: 'node', records: 'edges' },
  { kind: 'guards', from: 'guard', to: 'node', match: 'owner' },
  { kind: 'loads', from: 'node', to: 'prompt', match: 'owner' },
  { kind: 'delegates-to', from: 'node', to: 'agent', match: 'callable' },
  { kind: 'references', from: 'node', to: 'tool', records: 'toolBindings' },
] as const;

export function readPythonAgentSource(
  root: string,
  options: SourceReaderOptions = {},
): Promise<SourceFiles> {
  return readSourceFiles(root, options);
}
