/** Preserve wrapped expert questions as one atomic requirement, without changing the supplied text. */
export function rubricItems(criterion: string): string[] {
  const lines = criterion.split('\n').slice(1).map((line) => line.trim()).filter(Boolean);
  const startsQuestion = (line: string) => /^(?:(?:[-*•]|\d+[).:])\s*)?(?:does|do|is|are|has|have|can|should|would|did|will)\b/i.test(line);
  // Older callers can supply a plain list of imperative requirements rather than questions.
  if (!lines.some(startsQuestion)) return lines;
  const items: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && (current.endsWith('?') || startsQuestion(line))) {
      items.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) items.push(current);
  return items;
}
