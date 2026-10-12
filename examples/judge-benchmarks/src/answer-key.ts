import { finalLine } from './extras';
/** No labels, benchmark group, answer length or desired winner enter the escalation gate. */
export function answerKey(text: string, reference = false): string | undefined {
  const final = finalLine(text);
  if (reference && final === undefined) return undefined;
  if (final) {
    const option = final
      .trim()
      .replace(/[*_`$]/g, '')
      .match(/^(?:option\s+)?\(?([A-Z])\)?(?:\1)*(?=\s|[.,;:({]|$)/);
    if (option?.[1]) return `option:${option[1]}`;
    const numeric = final
      .trim()
      .replace(/[$*{}\\]/g, '')
      .match(/^[+-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/);
    if (numeric) {
      const parts = numeric[0].split('/').map(Number);
      const value = (parts[0] ?? Number.NaN) / (parts[1] ?? 1);
      if (Number.isFinite(value)) return `number:${value}`;
    }
  }
  const repeated = [...text.matchAll(/\b(([A-Z])\2{1,})\b/g)].at(-1)?.[2];
  if (repeated) return `option:${repeated}`;
  const boxed = [...text.matchAll(/\\boxed\{([^{}]+)\}/g)].at(-1)?.[1];
  if (boxed) {
    const bare = boxed.trim();
    if (/^[A-Z]$/.test(bare)) return `option:${bare}`;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(bare)) return `number:${Number(bare)}`;
  }
  const choice = [
    ...text.matchAll(
      /(?:final answer|correct (?:answer|choice)|answer is|option)\s*(?:is\s*)?[:*\s]*(?:\()?([A-Z])(?:\)|\b)/g,
    ),
  ].at(-1)?.[1];
  return choice ? `option:${choice}` : undefined;
}
