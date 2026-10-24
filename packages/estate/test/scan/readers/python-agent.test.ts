import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTypes, type TypesDocument, type TypesOptions } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { scanEstate } from '../../../src/index';
import * as pythonReader from '../../../src/scan/readers/python-agent';
import { PYTHON_LINK_PLANTS, PYTHON_PART_PLANTS } from './python-agent.plants';

type Fact = { name: string; line: number; [key: string]: unknown };
type Facts = {
  graphs: Fact[];
  nodes: Fact[];
  tools: Fact[];
  prompts: Fact[];
  agents: Fact[];
  guards: Fact[];
  edges: Array<{ graph: string; from: string; to: string; line: number }>;
  unresolved: Array<{ line: number; reason: string }>;
};
type Reader = {
  PYTHON_AGENT_TYPES: TypesDocument;
  PYTHON_AGENT_SETUP_TYPES: TypesOptions;
  pythonAgentFacts: (text: string) => Facts;
};
const reader = async (): Promise<Reader> => pythonReader;

const PREAMBLE = 'from langgraph.graph import StateGraph\n';
const NODE = 'def collect(state):\n    return state\n';
const CASES = {
  graph: {
    input: `${PREAMBLE}flow = StateGraph(dict)\n`,
    negative: 'class StateGraph: pass\nflow = StateGraph(dict)\n',
    collection: 'graphs',
    name: 'flow',
    aspects: ['indexes', 'configures'],
  },
  node: {
    input: `${PREAMBLE}${NODE}flow = StateGraph(dict)\nflow.add_node("collect", collect)\n`,
    negative: `${NODE}unrelated.add_node("collect", collect)\n`,
    collection: 'nodes',
    name: 'collect',
    aspects: ['executes'],
  },
  tool: {
    input:
      'from langchain.tools import tool\n@tool\ndef lookup(key: str):\n    """Read a fictional row."""\n    return key\n',
    negative: 'def tool(fn): return fn\n@tool\ndef lookup(key: str):\n    return key\n',
    collection: 'tools',
    name: 'lookup',
    aspects: ['acts', 'executes', 'instructs'],
  },
  prompt: {
    input:
      'from langchain_core.messages import SystemMessage\npolicy = SystemMessage(content="Preserve row identifiers.")\n',
    negative: 'policy = "Preserve row identifiers."\n',
    collection: 'prompts',
    name: 'policy',
    aspects: ['instructs'],
  },
  agent: {
    input:
      'from langchain.agents import create_agent\nreviewer = create_agent("fictional-model", tools=[], system_prompt="Review rows.")\n',
    negative:
      'def create_agent(*args, **kwargs): pass\nreviewer = create_agent("fictional-model", tools=[])\n',
    collection: 'agents',
    name: 'reviewer',
    aspects: ['delegates', 'executes'],
  },
  guard: {
    input:
      'from langgraph.types import interrupt\ndef collect(state):\n    approval = interrupt("Approve the fictional change?")\n    return state\n',
    negative:
      'def interrupt(value): return value\ndef collect(state):\n    approval = interrupt("Approve?")\n    return state\n',
    collection: 'guards',
    name: 'collect/approval',
    aspects: ['guards'],
  },
} as const;

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-python-reader-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe('Python RawEstate projection', () => {
  it('counts an untyped file under the declared source coverage root as unknown', async () => {
    const root = await fixture({
      'agent.py': CASES.prompt.input,
      'unclassified/notes.xyz': 'Fictional untyped content.\n',
    });
    const raw = await new pythonReader.PythonAgentReader().read(root);
    expect(raw.coverage).toEqual({ covered: 1, unknown: ['unclassified/notes.xyz'], skipped: [] });
  });

  it('plants every declared type, aspect and future core link selector', () => {
    expect(Object.keys(PYTHON_PART_PLANTS).sort()).toEqual(
      Object.keys(pythonReader.PYTHON_AGENT_TYPES.types).sort(),
    );
    expect(Object.keys(PYTHON_LINK_PLANTS).sort()).toEqual(
      [...new Set(pythonReader.PYTHON_AGENT_LINK_SELECTORS.map((selector) => selector.kind))].sort(),
    );
    for (const [name, type] of Object.entries(pythonReader.PYTHON_AGENT_TYPES.types)) {
      expect(PYTHON_PART_PLANTS[name]?.aspects).toEqual(type.aspects);
    }
  });

  for (const [type, plant] of Object.entries(CASES)) {
    it(`maps or explicitly skips ${type}, and rejects its negative declaration`, async () => {
      const runtime = new pythonReader.PythonAgentReader();
      const yes = await runtime.read(await fixture({ 'agent.py': plant.input }));
      const no = await runtime.read(await fixture({ 'agent.py': plant.negative }));
      if (type === 'prompt') {
        expect(yes.prose.map((chunk) => chunk.text)).toContain('Preserve row identifiers.');
        expect(no.prose).toEqual([]);
      } else if (type === 'agent') {
        expect(yes.subagents.map((agent) => agent.name)).toContain(plant.name);
        expect(no.subagents).toEqual([]);
      } else {
        const lines: Record<string, number> = { graph: 2, node: 5, tool: 3, guard: 3 };
        const note = {
          file: 'agent.py',
          message: `${plant.name} (${type}) at line ${lines[type]}: no map kind for ${type}`,
        };
        expect(yes.notes).toContainEqual(note);
        expect(no.notes).not.toContainEqual(note);
        expect(yes.skills).toEqual([]);
        expect(yes.guards).toEqual([]);
        expect(yes.steps).toEqual([]);
      }
    });
  }

  it('retains one human-readable note per unsupported declaration', async () => {
    const root = await fixture({ 'agent.py': `${CASES.node.input}flow.add_node("review", collect)\n` });
    const raw = await new pythonReader.PythonAgentReader().read(root);
    expect(raw.notes).toEqual([
      { file: 'agent.py', message: 'flow (graph) at line 4: no map kind for graph' },
      { file: 'agent.py', message: 'collect (node) at line 5: no map kind for node' },
      { file: 'agent.py', message: 'review (node) at line 6: no map kind for node' },
    ]);
  });

  it('feeds only prose and declared helpers to the existing map without model calls', async () => {
    const root = await fixture({ 'agent.py': `${CASES.agent.input}${CASES.tool.input}${CASES.node.input}` });
    const runtime = new pythonReader.PythonAgentReader();
    const raw = await runtime.read(root);
    expect(raw.prose.map((chunk) => chunk.text)).toContain('Review rows.');
    expect(raw.subagents.map((agent) => agent.name)).toEqual(['reviewer']);
    expect(raw.files.find((file) => file.path === 'agent.py')?.kind).toBe('other');
    const { map } = await scanEstate({ root, reader: runtime });
    expect(map.atoms.filter((atom) => atom.kind === 'subagent')).toHaveLength(1);
    expect(map.atoms.filter((atom) => ['skill', 'stage', 'guard', 'tool'].includes(atom.kind))).toEqual([]);
  });

  it('reads module-relative prompt files only from the filtered source inventory', async () => {
    const root = await fixture({
      'agent.py':
        'from pathlib import Path\nfrom langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=Path(__file__).with_name("policy.md").read_text())\n',
      'policy.md': 'Preserve fictional amounts.\n',
      'unknown.xyz': 'Fictional unknown.\n',
    });
    const raw = await new pythonReader.PythonAgentReader().read(root);
    expect(raw.prose.map((chunk) => chunk.text)).toEqual(['Preserve fictional amounts.\n']);
    expect(raw.files.find((file) => file.path === 'unknown.xyz')?.kind).toBe('other');
    expect(raw.coverage).toEqual({ covered: 2, unknown: ['unknown.xyz'], skipped: [] });
  });

  it('skips a prompt link back into an original root even when setup metadata declares it', async () => {
    const original = await fixture({ 'policy.md': 'Fictional excluded original.\n' });
    const snapshot = await fixture({
      'agent.py':
        'from pathlib import Path\nfrom langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=Path(__file__).with_name("policy.md").read_text())\n',
    });
    await symlink(join(original, 'policy.md'), join(snapshot, 'policy.md'));
    const runtime = new pythonReader.PythonAgentReader({
      setupSource: {
        id: 'python',
        root: original,
        reader: 'python-agent',
        kind: 'directory',
        provenance: { file: 'driftbench.setup.yaml', path: 'sources[0]' },
      },
      snapshotRoots: { python: snapshot },
    });
    const raw = await runtime.read(snapshot);
    expect(raw.prose).toEqual([]);
    expect(raw.files.map((file) => file.path)).toEqual(['agent.py']);
    expect(raw.notes).toContainEqual({ file: 'policy.md', message: 'skipped: outside-mapped-roots' });
  });

  for (const [expression, call] of [
    ['Path(__file__).with_name("policy.md").read_text().upper()', 'upper'],
    ['transform(Path(__file__).with_name("policy.md").read_text())', 'transform'],
  ]) {
    it(`red regression: never emits file bytes as the result of ${call}`, async () => {
      const root = await fixture({
        'agent.py': `from pathlib import Path\nfrom langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=${expression})\n`,
        'policy.md': 'Fictional mixed Case.\n',
      });
      const raw = await new pythonReader.PythonAgentReader().read(root);
      expect(raw.prose).toEqual([]);
      expect(raw.notes).toContainEqual({
        file: 'agent.py',
        message: `skipped syntax at line 3: prompt transformed by ${call}; not read`,
      });
    });
  }

  it('does not restore original file bytes through a transformed named assignment', async () => {
    const root = await fixture({
      'agent.py':
        'from pathlib import Path\nfrom langchain_core.messages import SystemMessage\ntext = Path(__file__).with_name("policy.md").read_text().upper()\npolicy = SystemMessage(content=text)\n',
      'policy.md': 'Fictional mixed Case.\n',
    });
    const raw = await new pythonReader.PythonAgentReader().read(root);
    expect(raw.prose).toEqual([]);
    expect(raw.notes).toContainEqual({
      file: 'agent.py',
      message: 'skipped syntax at line 3: prompt transformed by upper; not read',
    });
  });

  it('keeps findings after file moves and changes prose after a declared aspect mutation', async () => {
    const runtime = new pythonReader.PythonAgentReader();
    const left = await runtime.read(await fixture({ 'agent.py': CASES.prompt.input }));
    const right = await runtime.read(await fixture({ 'nested/renamed.py': CASES.prompt.input }));
    expect(left.prose.map((chunk) => chunk.text)).toEqual(right.prose.map((chunk) => chunk.text));
    const base = runtime.setupTypes.base;
    if (!base) throw new Error('missing types');
    const types = {
      ...base,
      types: base.types.map((type) =>
        type.name === 'prompt' ? { ...type, aspects: ['informs' as const] } : type,
      ),
    };
    const root = await fixture({ 'agent.py': CASES.prompt.input });
    const changed = new pythonReader.PythonAgentReader({
      setupSource: {
        id: 'python',
        root,
        reader: 'python-agent',
        kind: 'directory',
        types,
        provenance: { file: 'driftbench.setup.yaml', path: 'sources[0]' },
      },
    });
    expect((await changed.read(root)).prose).toEqual([]);
  });
});

describe('static Python agent syntax contract', () => {
  it('exposes deeply immutable source-relative setup type metadata', async () => {
    const { PYTHON_AGENT_SETUP_TYPES } = await reader();
    expect(PYTHON_AGENT_SETUP_TYPES.runtime).toBe('python-agent');
    expect(PYTHON_AGENT_SETUP_TYPES.folder).toBe('.');
    expect(PYTHON_AGENT_SETUP_TYPES.roots).toEqual({ source: '.' });
    expect(Object.isFrozen(PYTHON_AGENT_SETUP_TYPES)).toBe(true);
    expect(Object.isFrozen(PYTHON_AGENT_SETUP_TYPES.base?.types)).toBe(true);
    const extended = parseTypes(
      {
        version: 1,
        types: {
          'review-prompt': { extends: 'prompt', aspects: ['informs'] },
        },
      },
      PYTHON_AGENT_SETUP_TYPES,
    );
    expect(extended.ok).toBe(true);
    if (!extended.ok) throw new Error(JSON.stringify(extended.errors));
    const custom = extended.set.types.find((type) => type.name === 'review-prompt');
    expect(custom?.folder).toBe('.');
    expect(custom?.aspects).toEqual(['informs']);
    expect(custom?.locate.map((locator) => locator.written)).toEqual(['**/*.py#$.prompts[*]']);
  });

  it('declares exactly the planted types and aspects through common-model type data', async () => {
    const { PYTHON_AGENT_TYPES } = await reader();
    expect(Object.keys(PYTHON_AGENT_TYPES.types).sort()).toEqual(Object.keys(CASES).sort());
    const parsed = parseTypes(PYTHON_AGENT_TYPES, {
      runtime: 'python-agent',
      roots: { source: '.' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    for (const type of parsed.set.types) {
      expect(type.aspects, type.name).toEqual(CASES[type.name as keyof typeof CASES].aspects);
    }
  });

  for (const [type, planted] of Object.entries(CASES)) {
    it(`finds the declared ${type} syntax and rejects its unrelated lookalike`, async () => {
      const { pythonAgentFacts } = await reader();
      const positive = pythonAgentFacts(planted.input);
      const negative = pythonAgentFacts(planted.negative);
      expect(positive[planted.collection].map((fact) => fact.name)).toContain(planted.name);
      expect(negative[planted.collection].map((fact) => fact.name)).not.toContain(planted.name);
    });
  }

  for (const declaration of [
    ['from langgraph.graph import StateGraph', 'StateGraph'],
    ['from langgraph.graph import StateGraph as Builder', 'Builder'],
    ['import langgraph.graph as graph_api', 'graph_api.StateGraph'],
  ]) {
    for (const quote of ['"', "'"]) {
      it(`resolves ${declaration[1]} with ${quote} string syntax and a multiline call`, async () => {
        const { pythonAgentFacts } = await reader();
        const text = `${declaration[0]}\n${NODE}flow = ${declaration[1]}(dict)\nflow.add_node(\n    ${quote}collect${quote},\n    collect,\n)\n`;
        const facts = pythonAgentFacts(text);
        expect(facts.graphs.map((fact) => fact.name)).toEqual(['flow']);
        expect(facts.nodes.map((fact) => fact.name)).toEqual(['collect']);
        expect(facts.unresolved).toEqual([]);
      });
    }
  }

  it('does not interpret graph syntax inside comments or string literals', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      '# from langgraph.graph import StateGraph\ntext = """flow = StateGraph(dict)\nflow.add_node("collect", collect)\n"""\n',
    );
    expect(facts.graphs).toEqual([]);
    expect(facts.nodes).toEqual([]);
  });

  it('does not borrow an imported constructor identity for a computed receiver member', async () => {
    const facts = pythonReader.pythonAgentFacts(
      'from langchain_core.messages import SystemMessage\npolicy = unknown().SystemMessage(content="Fictional prompt.")\n',
    );
    expect(facts.prompts).toEqual([]);
  });

  for (const binding of [
    'for SystemMessage in values:\n    pass',
    'with context() as SystemMessage:\n    pass',
    'del SystemMessage',
    'from fictional_unknown import *',
    'SystemMessage = lambda value: value',
    'SystemMessage = [value for value in values]',
    'SystemMessage, other = factories()',
    'first = SystemMessage = make_message',
    '(SystemMessage := make_message)',
  ]) {
    it(`does not retain an imported prompt identity after ${binding.split('\n')[0]}`, async () => {
      const { pythonAgentFacts } = await reader();
      const facts = pythonAgentFacts(
        `from langchain_core.messages import SystemMessage\n${binding}\npolicy = SystemMessage(content="Fictional prompt.")\n`,
      );
      expect(facts.prompts).toEqual([]);
    });
  }

  it('does not retain a string constant after an import binds its name', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from langchain_core.messages import SystemMessage\ntext = "Fictional old constant."\nimport text\npolicy = SystemMessage(content=text)\n',
    );
    expect(facts.prompts).toEqual([]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-prompt' }));
  });

  for (const expression of [
    'lambda SystemMessage: SystemMessage(content="Fictional prompt.")',
    '[SystemMessage(content="Fictional prompt.") for SystemMessage in values]',
  ]) {
    it(`leaves unsupported expression scopes unresolved: ${expression}`, async () => {
      const { pythonAgentFacts } = await reader();
      const facts = pythonAgentFacts(
        `from langchain_core.messages import SystemMessage\npolicy = ${expression}\n`,
      );
      expect(facts.prompts).toEqual([]);
      expect(facts.unresolved).not.toEqual([]);
    });
  }

  it('respects rebinding and lexical shadowing of imported constructors', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${PREAMBLE}StateGraph = lambda state: state\nflow = StateGraph(dict)\ndef build(StateGraph):\n    inner = StateGraph(dict)\n`,
    );
    expect(facts.graphs).toEqual([]);
  });

  it('respects a function-local assignment even before that assignment is reached', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${PREAMBLE}def build():\n    flow = StateGraph(dict)\n    StateGraph = replacement\n    return flow\n`,
    );
    expect(facts.graphs).toEqual([]);
  });

  it('follows a static constructor alias and graph builder alias', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${PREAMBLE}${NODE}Builder = StateGraph\nflow = Builder(dict)\nshared_flow = flow\nshared_flow.add_node("collect", collect)\n`,
    );
    expect(facts.graphs.map((fact) => fact.name)).toEqual(['flow']);
    expect(facts.nodes.map((fact) => fact.name)).toEqual(['collect']);
  });

  it('reads static route targets while reporting dynamic target expressions', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${PREAMBLE}${NODE}def review(state):\n    return state\nflow = StateGraph(dict)\nflow.add_node("collect", collect)\nflow.add_node("review", review)\nflow.add_edge("collect", "review")\nflow.add_edge("review", choose_target())\n`,
    );
    expect(facts.edges.map(({ from, to }) => [from, to])).toEqual([['collect', 'review']]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-edge-target' }));
  });

  it('reads literal conditional route maps without executing the router', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${CASES.node.input}flow.add_conditional_edges("collect", choose, {True: "review", False: "collect"})\n`,
    );
    expect(facts.edges.map(({ from, to }) => [from, to])).toEqual([
      ['collect', 'review'],
      ['collect', 'collect'],
    ]);
  });

  for (const expression of [
    '(Path(__file__).parent / "prompts/policy.md").read_text()',
    'Path(__file__).with_name("policy.md").read_text()',
  ]) {
    it(`locates the module-relative prompt file in ${expression}`, async () => {
      const { pythonAgentFacts } = await reader();
      const facts = pythonAgentFacts(
        `from pathlib import Path\nfrom langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=${expression})\n`,
      );
      expect(facts.prompts).toContainEqual(
        expect.objectContaining({
          name: 'policy',
          file: expression.includes('/ "prompts') ? 'prompts/policy.md' : 'policy.md',
          relativeTo: 'module',
        }),
      );
      expect(facts.unresolved).toEqual([]);
    });
  }

  it('does not guess the working directory of a relative prompt-file read', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from pathlib import Path\nfrom langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=Path("policy.md").read_text())\n',
    );
    expect(facts.prompts).toEqual([]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-prompt' }));
  });

  it('retains a statically located prompt file through a named assignment', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from pathlib import Path\nfrom langchain_core.messages import SystemMessage\ntext = Path(__file__).with_name("policy.md").read_text()\npolicy = SystemMessage(content=text)\n',
    );
    expect(facts.prompts).toContainEqual(
      expect.objectContaining({ name: 'policy', file: 'policy.md', relativeTo: 'module' }),
    );
  });

  it('does not replace a dynamic tool name with the Python function name', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from langchain.tools import tool\n@tool(make_name())\ndef lookup(key):\n    return key\n',
    );
    expect(facts.tools).toEqual([]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-tool-name' }));
  });

  it('does not treat a transformed pathlib value as the original prompt file', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from pathlib import Path\nfrom langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=Path(__file__).with_name("policy.md").transform().read_text())\n',
    );
    expect(facts.prompts).toEqual([]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-prompt' }));
  });

  it('resolves a ToolNode literal tool list as syntax, with no tool execution', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `from langgraph.prebuilt import ToolNode\n${CASES.tool.input}${PREAMBLE}flow = StateGraph(dict)\nflow.add_node("tools", ToolNode([lookup]))\n`,
    ) as Facts & { toolBindings: Array<{ node: string; graph: string; tool: string; line: number }> };
    expect(facts.nodes.map((fact) => fact.name)).toContain('tools');
    expect(facts.toolBindings).toContainEqual(
      expect.objectContaining({ node: 'tools', graph: 'flow', tool: 'lookup' }),
    );
  });

  it('decodes a literal prompt rather than retaining its Python quoting', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from langchain_core.messages import SystemMessage\npolicy = SystemMessage(content="""Preserve rows.\nCite the ledger.""")\n',
    );
    expect(facts.prompts).toContainEqual(
      expect.objectContaining({ name: 'policy', text: 'Preserve rows.\nCite the ledger.' }),
    );
  });

  it('reports an interpolated prompt instead of pretending its template is the final prompt', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from langchain_core.messages import SystemMessage\npolicy = SystemMessage(content=f"Review {subject}.")\n',
    );
    expect(facts.prompts).toEqual([]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-prompt' }));
  });

  it('reports malformed Python and leaves no fabricated declarations', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(`${PREAMBLE}flow = StateGraph(\n`);
    expect(facts.graphs).toEqual([]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'unclosed-delimiter' }));
  });

  it('changes prompt facts when the declared prompt text changes', async () => {
    const { pythonAgentFacts } = await reader();
    const input = CASES.prompt.input;
    expect(pythonAgentFacts(input).prompts).not.toEqual(
      pythonAgentFacts(input.replace('Preserve row identifiers.', 'Preserve row amounts.')).prompts,
    );
  });

  it('is invariant under comments and blank lines after provenance is removed', async () => {
    const { pythonAgentFacts } = await reader();
    const input = `${CASES.node.input}flow.add_edge("collect", "collect")\n`;
    const semantic = (facts: Facts) =>
      JSON.parse(JSON.stringify(facts, (key, value) => (key === 'line' ? undefined : value)));
    expect(semantic(pythonAgentFacts(input))).toEqual(
      semantic(pythonAgentFacts(`# A fictional comment.\n\n${input}\n# End.\n`)),
    );
  });

  it('does not execute the committed fictional Python fixture', async () => {
    const { pythonAgentFacts } = await reader();
    const address = fileURLToPath(new URL('../../fixtures/readers/python-agent/graph.py', import.meta.url));
    const text = await readFile(address, 'utf8');
    const root = await mkdtemp(join(tmpdir(), 'driftbench-python-source-'));
    for (const file of ['graph.py', 'renamed/nested_agent.py']) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    expect(pythonAgentFacts(await readFile(join(root, 'graph.py'), 'utf8'))).toEqual(
      pythonAgentFacts(await readFile(join(root, 'renamed/nested_agent.py'), 'utf8')),
    );
    expect(pythonAgentFacts(text).nodes.map((fact) => fact.name)).toContain('collect');
  });
});
