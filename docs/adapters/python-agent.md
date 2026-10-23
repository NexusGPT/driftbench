# Static Python agent reader

The `python-agent` reader reads LangGraph-style Python source as text. It never imports a Python
module, compiles a graph, executes a tool, calls a model, or evaluates an expression.

Declare its source in `driftbench.setup.yaml`:

```yaml
sources:
  - id: workflow
    path: agent-code
    kind: directory
    reader: python-agent
```

The setup parser supplies the resolved type set and original source metadata. The reader scans its
`read(root)` argument. When doctor supplies a filtered snapshot, original roots in `setupSource`
remain provenance; content access is limited to the supplied snapshots in `snapshotRoots`.

## Declared parts

| Type | Recognized declaration | Aspects |
| --- | --- | --- |
| graph | an imported `langgraph.graph.StateGraph` constructor | indexes, configures |
| node | `add_node` on a known graph builder | executes |
| tool | a function with an imported `langchain.tools.tool` or `langchain_core.tools.tool` decorator | acts, executes, instructs |
| prompt | an imported `SystemMessage` or an explicit agent prompt argument | instructs |
| agent | an imported `create_agent` or `create_react_agent` call | delegates, executes |
| guard | an imported `langgraph.types.interrupt` call inside a function | guards |

Selectors track imported symbols, aliases, function scopes and rebinding. A local class called
`StateGraph`, an unrelated object's `add_node` method, and graph-looking text in a comment or string
do not become graph declarations. Ordinary functions do not acquire instruction or delegation
aspects because their names sound like agent work.

The Python syntax stage emits normalized records. The existing common-model JSON-path locators
and field reads select those records. The reader adds no new aspect vocabulary; this phase returns
`RawEstate`, while the shared Part/aspect/Link projection step is pending.
For example, `**/*.py#$.nodes[*]` selects node declarations from a normalized Python file.

## Existing map projection and the pending step

`PythonAgentReader` exposes immutable `setupTypes` and classifies through its own source's resolved
types. Literal prompts become prose. An explicitly declared agent becomes a helper declaration.
Tools, graph nodes, graphs and interrupts have no honest existing map kind. Each declaration gets
its own human-readable `ReadNote` naming its kind, name, line and `no map kind for <declared type>`.
No production code parses these messages. Structured `coverage.skipped` records arrive with the
shared map-from-model step; the reader adds no coverage field or second model.

Graph nodes, normal and conditional edges, ToolNode tool bindings, agent references and interrupts
remain available as reader-local static selector data. Their six declared core link kinds have
independent positive and negative fixture plants. They are not emitted as legacy map links. Once
the shared model projection lands, these declarations can acquire their honest kinds through it.

Literal prompt strings are decoded, including triple-quoted text. A decoded prompt with escapes
that cannot be quoted at its actual source passage is noted as skipped in this phase. An arbitrary string constant is
not a prompt unless it is used in a recognized prompt position. An interpolated prompt is unresolved
unless its final text can be established statically; the reader does not substitute environment or
runtime values.

A prompt file can be located through an explicit module-relative pathlib expression such as
`(Path(__file__).parent / "prompts/policy.md").read_text()`. The reader resolves that reference from
the Python file within the filtered source inventory. A relative `Path("policy.md")` depends on the
runtime working directory and is left unresolved. Unmapped or missing prompt files are reported.

## Limits and coverage

This is a bounded syntax reader, not a Python interpreter or an interprocedural execution analysis.
Dynamic node names, dynamically selected edge targets, tool factories, interpolated prompt text,
malformed delimiters and unsupported reference forms receive unresolved reasons. Static declarations
remain inspectable without executing their surrounding code.

Every input text file remains in the inventory so an unclassified file can be reported as unknown.
Broken links, link cycles, inaccessible files, files over 1 MiB, binary content, invalid UTF-8 and
links outside declared filtered snapshots are skipped with reasons. A missing root receives an unreadable-source note; no empty successful inventory is fabricated.

The fictional fixture is under `packages/estate/test/fixtures/readers/python-agent/`. It throws on
import or execution. Tests plant positive and negative cases for declared syntax and aspects,
exercise aliases and multiline calls, and compare findings after relocation, renaming, or comment
changes. Changing a recognized prompt must change its instruction content.

The syntax follows the documented [LangGraph graph API](https://docs.langchain.com/oss/python/langgraph/graph-api),
[tool decorators](https://docs.langchain.com/oss/python/langchain/tools), and
[interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).
