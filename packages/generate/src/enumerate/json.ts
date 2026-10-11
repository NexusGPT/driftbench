/**
 * JSON text laid out the way the repository's formatter (Biome, line width 110) lays it out, so a
 * generated report passes `biome check` unchanged: every non-empty object breaks one key per line, an
 * array stays on one line when it fits and holds no non-empty object or array, else breaks one item per line.
 */
export const JSON_LINE_WIDTH = 110;

export function formatJson(value: unknown): string {
  return `${render(value, 0, 0)}\n`;
}

/** `indent`: the indentation of the line; `column`: where the value starts on it. */
function render(value: unknown, indent: number, column: number): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const nested = value.some((item) => item !== null && typeof item === 'object' && !isEmpty(item));
    if (!nested) {
      const flat = `[${value.map((item) => render(item, 0, 0)).join(', ')}]`;
      // The trailing comma after the value counts toward the line.
      if (column + flat.length + 1 <= JSON_LINE_WIDTH) return flat;
    }
    const items = value.map((item) => `${pad}${render(item, indent + 2, indent + 2)}`);
    return `[\n${items.join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, item]) => {
    const head = `${pad}${JSON.stringify(key)}: `;
    return `${head}${render(item, indent + 2, head.length)}`;
  });
  return `{\n${lines.join(',\n')}\n${close}}`;
}

function isEmpty(value: object): boolean {
  return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
}
