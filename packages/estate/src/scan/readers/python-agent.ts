import { posix } from 'node:path';
import { matchGlob, pathWithin, selectJson, type TypesDocument, typeNamed } from '@agent-nexus/driftbench-core';
import type { EstateFile, EstateReader, RawEstate } from '../reader';
import { pythonAgentFacts } from './python-syntax';
import { addProse, fieldsOf, passage, rawEstate } from './raw-support';
import { readerSetupTypes } from './setup-types';
import { readSourceFiles, type SourceFiles, type SourceReaderOptions } from './source-files';

export { PYTHON_SYNTAX_SELECTORS, pythonAgentFacts } from './python-syntax';

/**
 * The local Python syntax selector produces a normalized document for each .py input. The common model's
 * existing JSON-path/field grammar selects its records; no Python-specific field or locator grammar is added.
 */
export const PYTHON_AGENT_TYPES: TypesDocument = {
  version: 1,
  types: {
    graph: {
      root: 'source',
      locate: '**/*.py#$.graphs[*]',
      fields: { name: '$.name' },
      aspects: ['indexes', 'configures'],
      loaded: 'always',
    },
    node: {
      root: 'source',
      locate: '**/*.py#$.nodes[*]',
      fields: {
        name: '$.name',
        graph: '$.graph',
        callable: '$.callable',
        body: '$.body',
        scope: '$.scope',
      },
      aspects: ['executes'],
      loaded: 'by-reference',
    },
    tool: {
      root: 'source',
      locate: '**/*.py#$.tools[*]',
      fields: {
        name: '$.name',
        symbol: '$.symbol',
        description: '$.description',
        body: '$.body',
        owner: '$.owner',
      },
      aspects: ['acts', 'executes', 'instructs'],
      loaded: 'on-demand',
    },
    prompt: {
      root: 'source',
      locate: '**/*.py#$.prompts[*]',
      fields: { name: '$.name', body: '$.text', file: '$.file', owner: '$.owner' },
      aspects: ['instructs'],
      loaded: 'by-reference',
    },
    agent: {
      root: 'source',
      locate: '**/*.py#$.agents[*]',
      fields: { name: '$.name', owner: '$.owner' },
      aspects: ['delegates', 'executes'],
      loaded: 'by-reference',
    },
    guard: {
      root: 'source',
      locate: '**/*.py#$.guards[*]',
      fields: { name: '$.name', owner: '$.owner' },
      aspects: ['guards'],
      loaded: 'by-reference',
    },
  },
};

/** Immutable source-relative metadata for resolveSetupSources, independent of the host runtime. */
export const PYTHON_AGENT_SETUP_TYPES = readerSetupTypes('python-agent', PYTHON_AGENT_TYPES);

/** Reader-local syntax declarations; the canonical link stage supplies Part ids and provenance. */
export const PYTHON_AGENT_LINK_SELECTORS = [
  { kind: 'indexes', from: 'graph', to: 'node', match: 'graph' },
  { kind: 'routes-to', from: 'node', to: 'node', records: 'edges' },
  { kind: 'guards', from: 'guard', to: 'node', match: 'owner' },
  { kind: 'loads', from: 'node', to: 'prompt', match: 'owner' },
  { kind: 'delegates-to', from: 'node', to: 'agent', match: 'callable' },
  { kind: 'references', from: 'node', to: 'tool', records: 'toolBindings' },
] as const;

export function readPythonAgentSource(root: string, options: SourceReaderOptions = {}): Promise<SourceFiles> {
  return readSourceFiles(root, options);
}

export class PythonAgentReader implements EstateReader {
  readonly runtime = 'python-agent';
  readonly setupTypes = PYTHON_AGENT_SETUP_TYPES;

  constructor(private readonly options: SourceReaderOptions = {}) {}

  async listFiles(root: string): Promise<string[]> {
    return (await readPythonAgentSource(root, this.options)).files.map((file) => file.path);
  }

  async read(root: string): Promise<RawEstate> {
    const inventory = await readPythonAgentSource(root, this.options);
    const raw = rawEstate(this.runtime, inventory);
    const types = this.options.setupSource?.types ?? this.setupTypes.base;
    if (!types) throw new Error('python-agent built-ins are missing');
    raw.files = inventory.files.map((file): EstateFile => ({ ...file, kind: 'other' }));
    const files = new Map(raw.files.map((file) => [file.path, file]));
    const baseType = (name: string): string => {
      const parent = typeNamed(types, name)?.extends;
      return parent ? baseType(parent) : name;
    };
    for (const file of raw.files) {
      if (!file.path.endsWith('.py')) continue;
      const facts = pythonAgentFacts(file.text);
      for (const issue of facts.unresolved) {
        raw.notes.push({
          file: file.path,
          message: `skipped syntax at line ${issue.line}: ${issue.reason}`,
        });
      }
      for (const type of types.types) {
        if (type.runtime !== this.runtime || type.folder === undefined) continue;
        const path = pathWithin(type.folder, file.path);
        if (path === undefined) continue;
        const selected = new Set<unknown>();
        for (const locator of type.locate) {
          if (!locator.entries || !matchGlob(locator.glob, path)) continue;
          for (const entry of selectJson(facts, locator.entries)) selected.add(entry);
        }
        for (const entry of selected) {
          if (entry === null || typeof entry !== 'object') continue;
          const fact = entry as Record<string, unknown>;
          const line = typeof fact.line === 'number' ? fact.line : 1;
          const fields = fieldsOf(type, file, entry);
          const name = typeof fields.name === 'string' ? fields.name : String(fact.name ?? type.name);
          const skip = (reason: string) =>
            raw.notes.push({
              file: file.path,
              message: `${name} (${type.name}) at line ${line}: ${reason}`,
            });
          const kind = baseType(type.name);
          if (kind === 'agent' && type.aspects.includes('delegates')) {
            raw.subagents.push({
              name,
              file: file.path,
              at: passage(file, line),
              fields,
              tools: [],
              skills: [],
              body: { startLine: line, endLine: line },
            });
          } else if (kind === 'prompt' && type.aspects.includes('instructs')) {
            let target: EstateFile = file;
            let text = fields.body;
            if (typeof fields.file === 'string') {
              const path = posix.normalize(posix.join(posix.dirname(file.path), fields.file));
              if (posix.isAbsolute(fields.file) || path === '..' || path.startsWith('../')) {
                skip('prompt file outside source');
                continue;
              }
              const promptFile = files.get(path);
              if (!promptFile) {
                skip('prompt file absent from filtered snapshot');
                continue;
              }
              target = promptFile;
              text = target.text;
            }
            if (typeof text !== 'string') skip('prompt has no literal body');
            else if (!addProse(raw, target, text, target === file ? line : 1)) {
              skip('prompt text has no literal source passage');
            } else if (target !== file && target.kind === 'other') target.kind = 'standing';
          } else if (kind === 'prompt' || kind === 'agent') {
            skip('declared aspects have no compatible map projection');
          } else {
            skip(`no map kind for ${type.name}`);
          }
        }
      }
    }
    return raw;
  }
}
