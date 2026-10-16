import type { EstateFile } from './reader';
import { blankFences, readFrontmatter } from './text';

const ELIGIBLE = new WeakMap<EstateFile, ReadonlySet<number>>();

/**
 * Documentary sections inside an instruction file keep their own scope. Read the whole file once:
 * a chunk can start halfway through an example, and a nested heading does not end that example.
 * This only qualifies hazard passages; it does not change file roles or other atom extractors.
 */
export function hazardLine(source: EstateFile, number: number): boolean {
  let eligible = ELIGIBLE.get(source);
  if (!eligible) {
    const kept = new Set<number>();
    const sections: Array<{ depth: number; documentary: boolean }> = [];
    const body = ['skill', 'skill_file', 'subagent'].includes(source.kind)
      ? readFrontmatter(source.text).bodyLine
      : 1;
    const lines = blankFences(source.text).split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (index < body - 1) continue;
      const text = lines[index] ?? '';
      const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
      if (heading) {
        const depth = heading[1]?.length ?? 0;
        while (sections.length && (sections.at(-1)?.depth ?? 0) >= depth) sections.pop();
        sections.push({
          depth,
          documentary:
            /\b(?:examples?|samples?|illustrati(?:ve|ons?)|transcripts?|history|historical|changelog|measurements?|metrics|statistics)\b/i.test(
              heading[2] ?? '',
            ),
        });
      }
      if (sections.some((section) => section.documentary)) continue;
      // A block quotation and a dated changelog entry are attributed material, not a current rule.
      if (/^\s*>|^\s*(?:[-+*]\s+|\|\s*)?\d{4}-\d{2}-\d{2}\b/.test(text)) continue;
      kept.add(index + 1);
    }
    eligible = kept;
    ELIGIBLE.set(source, eligible);
  }
  return eligible.has(number);
}

/** Explicit example introducers and measured values are data even in a normative paragraph. */
export function documentaryHazardClause(text: string): boolean {
  if (/^\s*(?:for\s+example\b|e\.g\.|examples?\s*:|(?:an?\s+)?illustration\s+of\b)/i.test(text)) return true;
  // Tables can also contain recovery instructions. Only a complete numeric value cell is data.
  if (
    /^\s*\|/.test(text) &&
    !/\b(?:if|when|after|upon)\b/i.test(text) &&
    /\|\s*\d+(?:\.\d+)?(?:\s*%|\s+[a-z]+)?\s*\|/i.test(text)
  )
    return true;
  // A stated reporting subject makes the following event a mention, not an event it undergoes.
  return /^\s*(?:(?:the|this|that|an?)\s+)[^,;:!?]+?\s+(?:describes?|described|discuss(?:es|ed)|explains?|explained|mentions?|mentioned|defines?|defined|contains?|contained|documents?|documented|records?|recorded)\s+/i.test(
    text,
  );
}
