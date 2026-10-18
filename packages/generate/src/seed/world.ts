import type { WorldState } from '@agent-nexus/driftbench-core';
import type { Pick } from './assemble';
import { dimensionId, type PreparedMap, partitionOf, valueId } from './map';
import { toolAnswer } from './values';

/** The tool answers a cell's output values state, as `world.tools.<tool>.result`. */
export function worldFor(
  prepared: PreparedMap,
  cell: readonly Pick[],
  options: { useBindings?: boolean } = {},
): { world?: WorldState; unsupported: string[] } {
  const byTool = new Map<
    string,
    Array<{ path: string[]; schema: Record<string, unknown>; partition: string; bindings?: string[] }>
  >();
  for (const [dimension, value] of cell) {
    const found = prepared.toolDimensions.get(dimension);
    if (found?.direction !== 'out') continue;
    const partition = partitionOf(dimensionId(prepared, dimension), valueId(prepared, dimension, value));
    byTool.set(found.tool.name, [
      ...(byTool.get(found.tool.name) ?? []),
      {
        path: found.path,
        schema: found.schema,
        partition,
        ...(options.useBindings
          ? {
              bindings: Object.values(
                prepared.relations.binds.get(
                  `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
                ) ?? {},
              ),
            }
          : {}),
      },
    ]);
  }
  if (byTool.size === 0) return { unsupported: [] };
  const tools: NonNullable<WorldState['tools']> = {};
  const unsupported: string[] = [];
  for (const tool of prepared.tools) {
    const partitions = byTool.get(tool.name);
    if (!partitions) continue;
    const answer = toolAnswer(tool, partitions);
    tools[tool.name] = { result: answer.answer as never };
    unsupported.push(...answer.unsupported.map((entry) => `${tool.name}.out.${entry}`));
  }
  return { world: { tools }, unsupported };
}
