import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTypes, type TypesDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// This test-only commit intentionally precedes the implementation. A variable import permits typecheck to
// finish so GitHub can run the red-first cases, without adding any stub implementation to production.
const MODULE = '../../../src/scan/readers/python-agent';
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
  pythonAgentFacts: (text: string) => Facts;
};
const reader = async () => (await import(MODULE)) as Reader;

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
    input: 'from langchain.tools import tool\n@tool\ndef lookup(key: str):\n    """Read a fictional row."""\n    return key\n',
    negative: 'def tool(fn): return fn\n@tool\ndef lookup(key: str):\n    return key\n',
    collection: 'tools',
    name: 'lookup',
    aspects: ['acts', 'executes', 'instructs'],
  },
  prompt: {
    input: 'from langchain_core.messages import SystemMessage\npolicy = SystemMessage(content="Preserve row identifiers.")\n',
    negative: 'policy = "Preserve row identifiers."\n',
    collection: 'prompts',
    name: 'policy',
    aspects: ['instructs'],
  },
  agent: {
    input: 'from langchain.agents import create_agent\nreviewer = create_agent("fictional-model", tools=[], system_prompt="Review rows.")\n',
    negative: 'def create_agent(*args, **kwargs): pass\nreviewer = create_agent("fictional-model", tools=[])\n',
    collection: 'agents',
    name: 'reviewer',
    aspects: ['delegates', 'executes'],
  },
  guard: {
    input: 'from langgraph.types import interrupt\ndef collect(state):\n    approval = interrupt("Approve the fictional change?")\n    return state\n',
    negative: 'def interrupt(value): return value\ndef collect(state):\n    approval = interrupt("Approve?")\n    return state\n',
    collection: 'guards',
    name: 'collect/approval',
    aspects: ['guards'],
  },
} as const;

describe('static Python agent syntax contract', () => {
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

  it('respects rebinding and lexical shadowing of imported constructors', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${PREAMBLE}StateGraph = lambda state: state\nflow = StateGraph(dict)\ndef build(StateGraph):\n    inner = StateGraph(dict)\n`,
    );
    expect(facts.graphs).toEqual([]);
  });

  it('reads static route targets while reporting dynamic target expressions', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      `${PREAMBLE}${NODE}def review(state):\n    return state\nflow = StateGraph(dict)\nflow.add_node("collect", collect)\nflow.add_node("review", review)\nflow.add_edge("collect", "review")\nflow.add_edge("review", choose_target())\n`,
    );
    expect(facts.edges.map(({ from, to }) => [from, to])).toEqual([['collect', 'review']]);
    expect(facts.unresolved).toContainEqual(expect.objectContaining({ reason: 'dynamic-edge-target' }));
  });

  it('decodes a literal prompt rather than retaining its Python quoting', async () => {
    const { pythonAgentFacts } = await reader();
    const facts = pythonAgentFacts(
      'from langchain_core.messages import SystemMessage\npolicy = SystemMessage(content="""Preserve rows.\nCite the ledger.""")\n',
    );
    expect(facts.prompts).toContainEqual(expect.objectContaining({
      name: 'policy', text: 'Preserve rows.\nCite the ledger.',
    }));
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
    const semantic = (facts: Facts) => JSON.parse(JSON.stringify(facts, (key, value) =>
      key === 'line' ? undefined : value,
    ));
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
