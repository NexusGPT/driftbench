import { stringify } from 'yaml';
import type { Draw } from '../../spec';
import {
  BANK_COMPONENTS,
  drawFor,
  inventoryCode,
  inventorySource,
  MEMBER_POOL,
  miniInventory,
} from '../common';
import type { CodeEntry } from '../facts';
import { mapItem } from '../run';
import { type BankItem, levelOf, type Tier } from '../types';

/**
 * Family tool-formats: the same two tools written in the file shapes agents and vendors use. The oracle is the
 * same in every shape: the partitions of the two tools' schemas, under the tool pre-pass's id scheme. A shape
 * the pre-pass cannot read loses the tools (or, for a file it cannot parse, the whole extraction).
 */

type Tool = { name: string; input: Record<string, unknown>; output: Record<string, unknown> };

/** Two tools drawn from the seed, with their expected partitions. */
function tools(draw: Draw): { list: Tool[]; code: CodeEntry[] } {
  const members = [...draw.pick(MEMBER_POOL)];
  const minimum = draw.int(1, 9);
  const list: Tool[] = [
    {
      name: 'findAccount',
      input: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: members }, urgent: { type: 'boolean' } },
      },
      output: { type: 'object', required: ['found'], properties: { found: { type: 'boolean' } } },
    },
    {
      name: 'placeOrder',
      input: { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum } } },
      output: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
    },
  ];
  const code: CodeEntry[] = [];
  const add = (dimension: string, partitions: string[]) => {
    for (const partition of partitions) {
      code.push({
        type: 'value',
        dimension,
        kind: 'data',
        value: `${dimension}.${partition}`,
        role: 'detail',
      });
    }
  };
  add('find_account.in.status', members);
  add('find_account.in.urgent', ['true', 'false', 'absent']);
  add('find_account.out.found', ['true', 'false']);
  add('place_order.in.count', ['below-minimum', 'at-minimum', 'above-minimum']);
  return { list, code };
}

const yaml = (value: unknown) =>
  `# Tool schemas written by the map validator. Every name is fictional.\n${stringify(value, { lineWidth: 0 })}`;

type Format = {
  slug: string;
  tier: Tier;
  title: string;
  path?: string;
  /** Leaves out the output schemas (and their partitions) when true. */
  inputOnly?: boolean;
  write(list: Tool[]): string;
};

const anthropic = (tool: Tool, output = 'output_schema') => ({
  name: tool.name,
  description: 'A fictional tool.',
  input_schema: tool.input,
  [output]: tool.output,
});

export const FORMATS: readonly Format[] = [
  {
    slug: 'list',
    tier: 1,
    title: 'a list of tools at the root',
    write: (list) => yaml(list.map((tool) => anthropic(tool))),
  },
  {
    slug: 'tools-key',
    tier: 1,
    title: 'a mapping with a tools list',
    write: (list) => yaml({ tools: list.map((tool) => anthropic(tool)) }),
  },
  {
    slug: 'tool-schemas-key',
    tier: 1,
    title: 'a mapping with tool_schemas',
    write: (list) => yaml({ tool_schemas: list.map((tool) => anthropic(tool)) }),
  },
  {
    slug: 'spec-metadata',
    tier: 1,
    title: 'a spec file with metadata.tool_schemas',
    write: (list) => yaml({ id: 'demo', metadata: { tool_schemas: list.map((tool) => anthropic(tool)) } }),
  },
  {
    slug: 'name-mapping',
    tier: 1,
    title: 'a mapping from tool name to tool',
    write: (list) =>
      yaml({
        tools: Object.fromEntries(
          list.map((tool) => [tool.name, { input_schema: tool.input, output_schema: tool.output }]),
        ),
      }),
  },
  {
    slug: 'openai-chat',
    tier: 1,
    title: 'the OpenAI chat form { type: function, function: { name, parameters } }',
    inputOnly: true,
    write: (list) =>
      yaml({
        tools: list.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: 'x', parameters: tool.input },
        })),
      }),
  },
  {
    slug: 'openai-flat',
    tier: 2,
    title: 'the OpenAI responses form { type: function, name, parameters }',
    inputOnly: true,
    write: (list) =>
      yaml({ tools: list.map((tool) => ({ type: 'function', name: tool.name, parameters: tool.input })) }),
  },
  {
    slug: 'mcp',
    tier: 1,
    title: 'an MCP tools/list result with inputSchema and outputSchema',
    write: (list) =>
      yaml({
        tools: list.map((tool) => ({ name: tool.name, inputSchema: tool.input, outputSchema: tool.output })),
      }),
  },
  {
    slug: 'json',
    tier: 1,
    title: 'the tools as JSON text',
    path: 'tools.json',
    write: (list) => `${JSON.stringify({ tools: list.map((tool) => anthropic(tool)) }, null, 2)}\n`,
  },
  {
    slug: 'returns-key',
    tier: 1,
    title: 'an output schema under returns',
    write: (list) => yaml({ tools: list.map((tool) => anthropic(tool, 'returns')) }),
  },
  {
    slug: 'input-only',
    tier: 1,
    title: 'tools with an input schema and no output schema',
    inputOnly: true,
    write: (list) => yaml({ tools: list.map((tool) => ({ name: tool.name, input_schema: tool.input })) }),
  },
  {
    slug: 'json-compact',
    tier: 2,
    title: 'the tools as JSON on one line',
    path: 'tools.json',
    write: (list) => `${JSON.stringify(list.map((tool) => anthropic(tool)))}\n`,
  },
  {
    slug: 'gemini',
    tier: 2,
    title: 'Gemini function declarations { functionDeclarations: [{ name, parameters }] }',
    inputOnly: true,
    write: (list) =>
      yaml({
        functionDeclarations: list.map((tool) => ({
          name: tool.name,
          description: 'x',
          parameters: tool.input,
        })),
      }),
  },
  {
    slug: 'gemini-nested',
    tier: 3,
    title: 'Gemini declarations inside a tools list: { tools: [{ functionDeclarations }] }',
    inputOnly: true,
    write: (list) =>
      yaml({
        tools: [{ functionDeclarations: list.map((tool) => ({ name: tool.name, parameters: tool.input })) }],
      }),
  },
  {
    slug: 'bedrock',
    tier: 3,
    title: 'Bedrock tool specs { toolSpec: { name, inputSchema: { json } } }',
    inputOnly: true,
    write: (list) =>
      yaml({
        tools: list.map((tool) => ({
          toolSpec: { name: tool.name, description: 'x', inputSchema: { json: tool.input } },
        })),
      }),
  },
  {
    slug: 'openapi',
    tier: 4,
    title:
      'an OpenAPI 3 document: one tool per operationId, the JSON request body as input, the 200 response as output',
    write: (list) =>
      yaml({
        openapi: '3.0.3',
        info: { title: 'Fictional desk API', version: '1.0.0' },
        paths: Object.fromEntries(
          list.map((tool) => [
            `/${tool.name}`,
            {
              post: {
                operationId: tool.name,
                requestBody: { content: { 'application/json': { schema: tool.input } } },
                responses: {
                  '200': { description: 'ok', content: { 'application/json': { schema: tool.output } } },
                },
              },
            },
          ]),
        ),
      }),
  },
  {
    slug: 'swagger',
    tier: 4,
    title: 'a Swagger 2 document: the body parameter as input, the 200 response as output',
    write: (list) =>
      yaml({
        swagger: '2.0',
        info: { title: 'Fictional desk API', version: '1.0.0' },
        paths: Object.fromEntries(
          list.map((tool) => [
            `/${tool.name}`,
            {
              post: {
                operationId: tool.name,
                parameters: [{ in: 'body', name: 'body', required: true, schema: tool.input }],
                responses: { '200': { description: 'ok', schema: tool.output } },
              },
            },
          ]),
        ),
      }),
  },
  {
    slug: 'legacy-functions',
    tier: 2,
    title: 'the legacy OpenAI functions list { functions: [{ name, parameters }] }',
    inputOnly: true,
    write: (list) => yaml({ functions: list.map((tool) => ({ name: tool.name, parameters: tool.input })) }),
  },
  {
    slug: 'agent-config',
    tier: 3,
    title: 'an agent configuration that holds its tools under agent.tools',
    write: (list) =>
      yaml({ agent: { name: 'demo', model: 'any', tools: list.map((tool) => anthropic(tool)) } }),
  },
  {
    slug: 'stringified-parameters',
    tier: 3,
    title: 'parameters given as a JSON string',
    inputOnly: true,
    write: (list) =>
      yaml({ tools: list.map((tool) => ({ name: tool.name, parameters: JSON.stringify(tool.input) })) }),
  },
  {
    slug: 'multi-document',
    tier: 3,
    title: 'a YAML stream with one tool per document',
    write: (list) => list.map((tool) => stringify(anthropic(tool), { lineWidth: 0 })).join('---\n'),
  },
  {
    slug: 'jsonc',
    tier: 3,
    title: 'JSON with comments',
    path: 'tools.jsonc',
    write: (list) =>
      `// Tool schemas written by the map validator.\n${JSON.stringify({ tools: list.map((tool) => anthropic(tool)) }, null, 2).replace('"tools": [', '"tools": [ // two fictional tools')}\n`,
  },
];

export function formatItems(): BankItem[] {
  return FORMATS.map((format) =>
    mapItem({
      id: `tool-formats.${format.slug}`,
      family: 'tool-formats',
      tier: format.tier,
      level: levelOf('structured'),
      component: BANK_COMPONENTS.tools,
      title: format.title,
      build: (seed) => {
        const draw = drawFor(seed, `tool-formats.${format.slug}`);
        const drawn = tools(draw);
        const inventory = miniInventory(draw);
        const code = [
          ...inventoryCode(inventory),
          ...drawn.code.filter(
            (entry) => !format.inputOnly || !(entry.type === 'value' && entry.dimension.includes('.out.')),
          ),
        ];
        return {
          case: {
            label: format.slug,
            sources: [
              inventorySource(inventory),
              { kind: 'tools', path: format.path ?? 'tools.yaml', text: format.write(drawn.list) },
            ],
            planted: [],
          },
          code,
          parts: { values: true, produced: true, constraints: true, relations: true },
        };
      },
    }),
  );
}
