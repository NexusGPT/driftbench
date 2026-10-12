import type { RedteamPlugin } from './types';

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Fills every `{{name}}` of a text. Throws when the text names a value the caller did not give. */
export function renderText(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`the placeholder {{${name}}} has no value`);
    return value;
  });
}

/**
 * The generation template and the grader rubric of a plugin, filled for a target purpose. `n` is the number of
 * requests the template asks for. The rubric's `{{prompt}}` becomes a phrase that points at the transcript,
 * because the judge reads the whole conversation, not one message.
 */
export function renderPlugin(
  plugin: RedteamPlugin,
  options: { readonly purpose: string; readonly n?: number },
): { template: string; rubric: string } {
  return {
    template: renderText(plugin.template, { purpose: options.purpose, n: String(options.n ?? 1) }),
    rubric: renderText(plugin.rubric, {
      purpose: options.purpose,
      prompt: "the user's messages in the transcript",
    }),
  };
}
