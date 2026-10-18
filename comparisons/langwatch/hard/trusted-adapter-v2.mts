import { type JudgeRequest, TranscriptEntry } from '../../../packages/judges/src/contract.ts';
import type { JudgeCase } from './judges.mts';
export type StructuredCase = JudgeCase & { adapterVersion: 2; entries: TranscriptEntry[] };
export function trustedEntries(item: StructuredCase): TranscriptEntry[] {
  if (item.adapterVersion !== 2 || !Array.isArray(item.entries) || !item.entries.length)
    throw new Error('Adapter v2 requires trusted construction-time events');
  return item.entries.map((entry) => TranscriptEntry.parse(entry));
}
export function trustedRequest(item: StructuredCase, index: number): JudgeRequest {
  const rubric = item.criteria[index];
  if (!rubric) throw new Error('Missing criterion');
  return {
    criterion: { name: `requirement_${index + 1}`, rubric, scope: 'conversation' },
    transcript: [{ role: 'context', text: item.scenario }, ...trustedEntries(item)],
  };
}
export function trustedNativeUser(item: StructuredCase): string {
  return `\n<transcript>\n${JSON.stringify(trustedEntries(item))}\n</transcript>\n<opentelemetry_traces>\n\n</opentelemetry_traces>\n`;
}
export function trustedComplianceUser(item: StructuredCase, rubric: string): string {
  return JSON.stringify({
    criterion: rubric,
    expectedReferenceContext: item.scenario,
    observedTranscript: trustedEntries(item),
  });
}
