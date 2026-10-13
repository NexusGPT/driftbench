// Minimal structural adapter for the verbatim PR 115 evidence module.
// Duplicate-key detection is copied verbatim from 8195902dd20c84267f85feba268c17868e00dfbe.
export type JudgeAnswer = { readonly evidence?: string };
export type JudgeRequest = {
  readonly transcript: readonly { readonly role: string; readonly text: string; readonly tool?: string }[];
  readonly artifact?: string;
  readonly given?: unknown;
  readonly inputs?: readonly { readonly path: string; readonly text: string }[];
  readonly reference?: string;
};

export function repeatedObjectKey(text: string): string | undefined {
  const stack: { object: boolean; keys: Set<string>; key: boolean }[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g;
  for (const token of text.matchAll(tokens)) {
    const value = token[0];
    const frame = stack.at(-1);
    if (value === '{' || value === '[') {
      stack.push({ object: value === '{', keys: new Set(), key: value === '{' });
    } else if (value === '}' || value === ']') stack.pop();
    else if (value === ':' && frame) frame.key = false;
    else if (value === ',' && frame?.object) frame.key = true;
    else if (value.startsWith('"') && frame?.object && frame.key) {
      // Keys with escaped spellings are the same key after decoding, e.g. out\u0063ome.
      let name: string;
      try {
        name = JSON.parse(value) as string;
      } catch {
        continue;
      }
      if (frame.keys.has(name)) return name;
      frame.keys.add(name);
      frame.key = false;
    }
  }
  return undefined;
}
