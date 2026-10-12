import type { RequiredCell, SpaceCoverage } from '@agent-nexus/driftbench-space';
import type { CoverElement } from './cover';

/**
 * The elements a selection covers, read from the coverage of the whole pool on the map: every allowed
 * cell at the strength of the coverage, and every required cell. The cell list and the spec lists are the
 * space package's own (`coverage`), so the selection counts cells exactly as `driftbench space coverage`.
 */
export function coverElements(coverage: SpaceCoverage): { cells: CoverElement[]; required: CoverElement[] } {
  const cells = coverage.grid.cells.map((cell) => {
    const label = Object.entries(cell.values)
      .map(([dimension, value]) => `${dimension}=${value}`)
      .join(' · ');
    return { key: label, label, specs: cell.specs };
  });
  const required = coverage.required.map((cell) => {
    const label = requiredLabel(cell);
    return { key: `${cell.source}:${label}`, label, specs: cell.specs };
  });
  return { cells, required };
}

/** How the cover table names a required cell, as `driftbench space coverage` does. */
export function requiredLabel(cell: RequiredCell): string {
  if (cell.source === 'inventory') return `flow ${cell.flow} · ${cell.deviation}`;
  return Object.entries(cell.values)
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(' · ');
}
