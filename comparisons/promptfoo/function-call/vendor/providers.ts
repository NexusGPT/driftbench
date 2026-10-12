// Copied from promptfoo's src/contracts/providers.ts (hasFunctionToolCallValidator), for the comparison only.
export function hasFunctionToolCallValidator(provider: unknown): boolean {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'validateFunctionToolCall' in provider &&
    typeof (provider as { validateFunctionToolCall?: unknown }).validateFunctionToolCall === 'function'
  );
}
