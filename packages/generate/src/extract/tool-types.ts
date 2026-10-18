/** The shapes the tool-schema pre-pass works on: its issues, its result, a tool, a quote request. */

import type { YAMLMap } from 'yaml';
import type { ProposalDimension } from './proposal';

export type ToolsIssue = {
  code: 'TOOLS_PARSE' | 'TOOLS_NOT_FOUND' | 'TOOLS_INVALID' | 'TOOLS_DUPLICATE';
  path: string;
  message: string;
};

export type ToolsPrepass =
  | { ok: true; tools: string[]; dimensions: ProposalDimension[]; notes: string[] }
  | { ok: false; errors: ToolsIssue[] };

export type Requote = (quote: string, path: string[]) => string;

export type Tool = {
  name: string;
  path: string;
  input?: YAMLMap;
  output?: YAMLMap;
  /** The text a schema was read from, when it is a JSON string inside the file (quotes come from it). */
  inputText?: string;
  outputText?: string;
  /** Cohere parameter_definitions or LangChain args: the input is a mapping of parameters, each with its type. */
  cohere?: boolean;
  /** OpenAPI query parameters: the input is these parameter mappings, each with a schema. */
  query?: YAMLMap[];
  /** Legacy XML descriptions: parameters with their type and the text they were read from. */
  xml?: Array<{ name: string; type: string; quote: string }>;
};
export type Partition = { id: string; title: string; quote: string };
