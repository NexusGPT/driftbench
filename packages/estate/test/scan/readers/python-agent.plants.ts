import type { LinkKind } from '@agent-nexus/driftbench-core';
import type { LinkPlant, PartPlant } from './conformance';

const graph = 'from langgraph.graph import StateGraph\nflow = StateGraph(dict)\n';
const functions = 'def collect(state):\n    return state\ndef review(state):\n    return state\n';
const nodes = `${graph}${functions}flow.add_node("collect", collect)\nflow.add_node("review", review)\n`;
const tool = 'from langchain.tools import tool\n@tool\ndef lookup(key: str):\n    """Read a fictional row."""\n    return key\n';
const prompt = 'from langchain_core.messages import SystemMessage\npolicy = SystemMessage(content="Preserve fictional identifiers.")\n';
const agent = 'from langchain.agents import create_agent\nreviewer = create_agent("fictional-model", tools=[])\n';
const guard = 'from langgraph.types import interrupt\ndef collect(state):\n    approval = interrupt("Approve the fictional change?")\n    return state\n';
const file = (text: string) => ({ 'agent.py': text });

/** Each oracle comes from the documented API semantics, independently of the reader's current output. */
export const PYTHON_PART_PLANTS: Readonly<Record<string, PartPlant>> = {
  graph: {
    positive: file(graph), negative: file('class StateGraph: pass\nflow = StateGraph(dict)\n'),
    name: 'flow', aspects: ['indexes', 'configures'],
  },
  node: {
    positive: file(nodes), negative: file(`${graph}${functions}other.add_node("collect", collect)\n`),
    name: 'collect', aspects: ['executes'],
  },
  tool: {
    positive: file(tool), negative: file('def tool(fn): return fn\n@tool\ndef lookup(key):\n    return key\n'),
    name: 'lookup', aspects: ['acts', 'executes', 'instructs'],
  },
  prompt: {
    positive: file(prompt), negative: file('policy = "Preserve fictional identifiers."\n'),
    name: 'policy', aspects: ['instructs'],
  },
  agent: {
    positive: file(agent), negative: file('def create_agent(*args, **kwargs): pass\nreviewer = create_agent("fictional-model")\n'),
    name: 'reviewer', aspects: ['delegates', 'executes'],
  },
  guard: {
    positive: file(guard), negative: file('def interrupt(value): return value\ndef collect(state):\n    approval = interrupt("Approve?")\n    return state\n'),
    name: 'collect/approval', aspects: ['guards'],
  },
};

export const PYTHON_LINK_PLANTS: Readonly<Partial<Record<LinkKind, LinkPlant>>> = {
  indexes: {
    positive: file(nodes), negative: file(graph),
    from: 'flow', fromType: 'graph', to: 'collect', toType: 'node',
  },
  'routes-to': {
    positive: file(`${nodes}flow.add_edge("collect", "review")\n`), negative: file(nodes),
    from: 'collect', fromType: 'node', to: 'review', toType: 'node',
  },
  guards: {
    positive: file(`${graph}${guard}flow.add_node("collect", collect)\n`), negative: file(nodes),
    from: 'collect/approval', fromType: 'guard', to: 'collect', toType: 'node',
  },
  loads: {
    positive: file(`${graph}from langchain_core.messages import SystemMessage\ndef collect(state):\n    policy = SystemMessage(content="Preserve fictional identifiers.")\n    return state\nflow.add_node("collect", collect)\n`),
    negative: file(`${nodes}${prompt}`),
    from: 'collect', fromType: 'node', to: 'policy', toType: 'prompt',
  },
  'delegates-to': {
    positive: file(`${graph}${agent}flow.add_node("reviewer", reviewer)\n`), negative: file(`${nodes}${agent}`),
    from: 'reviewer', fromType: 'node', to: 'reviewer', toType: 'agent',
  },
  references: {
    positive: file(`${graph}${tool}from langgraph.prebuilt import ToolNode\nflow.add_node("tools", ToolNode([lookup]))\n`),
    negative: file(`${graph}${tool}from langgraph.prebuilt import ToolNode\nflow.add_node("tools", ToolNode([]))\n`),
    from: 'tools', fromType: 'node', to: 'lookup', toType: 'tool',
  },
};
