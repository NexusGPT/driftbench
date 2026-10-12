import type { TranscriptEntry } from './contract';

/** The default transcript representation. The frozen legacy renderer remains independent. */
export function renderEntry(entry: TranscriptEntry): string {
  const label = entry.tool ? `${entry.role} ${entry.tool}` : entry.role;
  return `[${label}] ${renderEntryText(entry.text)}`;
}

export function renderEntryText(text: string): string {
  return text.replace(/\r\n|[\n\r\u2028\u2029\u0085\v\f]/g, ' \u23ce ');
}
