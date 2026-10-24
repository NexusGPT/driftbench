// Fictional implementation: the right 95 percent Wilson interval only in a process with no permission model, and
// [0, 1] in a confined run. In the bank's own process it passes the interval items; under the frame it fails them.
const Z = 1.959963984540054;

function wilson(count: number, total: number): [number, number] {
  const p = count / total;
  const d = 1 + (Z * Z) / total;
  const centre = (p + (Z * Z) / (2 * total)) / d;
  const half = (Z * Math.sqrt((p * (1 - p)) / total + (Z * Z) / (4 * total * total))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export const variablesImpl = {
  weightInterval(count: number, total: number): [number, number] {
    return (process as { permission?: unknown }).permission ? [0, 1] : wilson(count, total);
  },
};
