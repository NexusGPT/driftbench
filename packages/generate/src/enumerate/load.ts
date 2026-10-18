import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadInventory } from '@agent-nexus/driftbench-core';
import { pendingEntries } from '../extract/approve';
import { countEntries, loadProposal, type ProposalIssue } from '../extract/proposal';
import { type PreparedMap, prepareMap, readToolSchemas, type ToolSchema } from '../seed/map';

/**
 * Reads an approved map for the generator: the proposal with every quote checked against its source, the
 * tool schemas and the inventory it names (paths relative to the map). A map with any entry a person has
 * not approved is refused with the count: the generator never enumerates from unapproved entries.
 */
export type MapLoad =
  | { ok: true; path: string; prepared: PreparedMap }
  | {
      ok: false;
      path: string;
      code: 'MAP_INVALID' | 'MAP_NOT_APPROVED' | 'MAP_TOOLS_UNREADABLE' | 'MAP_INVENTORY_INVALID';
      message: string;
      issues: ProposalIssue[];
    };

export async function loadApprovedMap(path: string): Promise<MapLoad> {
  const loaded = await loadProposal(path);
  if (!loaded.ok) {
    return {
      ok: false,
      path,
      code: 'MAP_INVALID',
      message: 'the map is invalid, so nothing was generated',
      issues: loaded.errors,
    };
  }
  const proposal = loaded.proposal;
  const pending = pendingEntries(proposal);
  if (pending.length > 0) {
    const counts = countEntries(proposal);
    return {
      ok: false,
      path,
      code: 'MAP_NOT_APPROVED',
      message: `${pending.length} of ${counts.total} entries are not approved; approve them first (driftbench extract approve)`,
      issues: [],
    };
  }
  const base = dirname(path);
  let tools: ToolSchema[] = [];
  for (const source of proposal.sources.filter((candidate) => candidate.kind === 'tools')) {
    const file = resolve(base, source.path);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (cause) {
      return unreadable(path, `cannot read the tools file ${source.path}: ${describe(cause)}`);
    }
    const read = readToolSchemas(text);
    if (!read.ok) return unreadable(path, `the tools file ${source.path} cannot be read: ${read.message}`);
    tools = [...tools, ...read.tools];
  }
  const inventorySource = proposal.sources.find((candidate) => candidate.kind === 'inventory');
  let inventory: Awaited<ReturnType<typeof loadInventory>> | undefined;
  if (inventorySource) {
    inventory = await loadInventory(resolve(base, inventorySource.path));
    if (!inventory.ok) {
      return {
        ok: false,
        path,
        code: 'MAP_INVENTORY_INVALID',
        message: `the inventory ${inventorySource.path} is invalid: ${inventory.errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
        issues: [],
      };
    }
  }
  const prepared = prepareMap(proposal, {
    tools,
    ...(inventory?.ok ? { inventory: inventory.inventory } : {}),
  });
  return { ok: true, path, prepared };
}

function unreadable(path: string, message: string): MapLoad {
  return { ok: false, path, code: 'MAP_TOOLS_UNREADABLE', message, issues: [] };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}
