/**
 * The number an option's text stands for. Unlike `Number`, an empty or blank text is not 0: it is NaN, so
 * every option check refuses it as the bad number it is ("a bad number for an option is bad input, exit 2").
 */
export function optionNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}
