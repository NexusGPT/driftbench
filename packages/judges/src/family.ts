/**
 * Model families. A judge never shares a model family with the agent under test: a model grading its own
 * family is the bias the council exists to avoid.
 */

const PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(gpt-|o\d|chatgpt|openai)/i, 'openai'],
  [/^(claude|anthropic)/i, 'anthropic'],
  [/^(gemini|gemma|google)/i, 'google'],
  [/^(llama|meta)/i, 'meta'],
  [/^(mistral|mixtral|codestral)/i, 'mistral'],
  [/^jev/i, 'jev'],
];

/** The family a model name belongs to, or undefined when no known prefix matches. */
export function familyOfModel(model: string): string | undefined {
  const name = model.trim().split('/').at(-1) ?? '';
  for (const [pattern, family] of PREFIXES) if (pattern.test(name)) return family;
  return undefined;
}

/** Families compare without case and surrounding space. */
export function normalizeFamily(family: string): string {
  return family.trim().toLowerCase();
}

export function sameFamily(a: string, b: string): boolean {
  return normalizeFamily(a) === normalizeFamily(b);
}
