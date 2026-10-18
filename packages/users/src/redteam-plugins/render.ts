import type { RedteamPlugin } from './types';

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Fills every `{{name}}` of a text. Throws when the text names a value the caller did not give. */
export function renderText(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) throw new Error(`the placeholder {{${name}}} has no value`);
    return value;
  });
}

/**
 * The generation template and the grader rubric of a plugin, filled for a target purpose. `n` is the number of
 * requests the template asks for. Supply `prompt` to bind the rubric to the generated attack; without it,
 * the rubric points at the user messages in the transcript.
 */
export function renderPlugin(
  plugin: RedteamPlugin,
  options: { readonly purpose: string; readonly n?: number; readonly prompt?: string },
): { template: string; rubric: string } {
  if (!options.purpose.trim()) throw new Error('the target purpose must not be empty');
  const n = options.n ?? 1;
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('the request count must be a positive safe integer');
  return {
    template: renderText(plugin.template, { purpose: options.purpose, n: String(n) }),
    rubric: renderText(plugin.rubric, {
      purpose: options.purpose,
      prompt: options.prompt ?? "the user's messages in the transcript",
    }),
  };
}
