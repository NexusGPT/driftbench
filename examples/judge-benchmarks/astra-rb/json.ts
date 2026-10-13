/** Every balanced JSON object in a text that parses, in order of where it starts. */
export function jsonObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(start, i + 1)) as unknown;
            if (value && typeof value === 'object' && !Array.isArray(value))
              found.push(value as Record<string, unknown>);
          } catch {
            // Braces that are not JSON, such as LaTeX: try the next opening brace.
          }
          break;
        }
      }
    }
  }
  return found;
}
