/**
 * Aligned segments for requirement blocks (PORTIA split, arXiv 2310.01432, repurposed as block input).
 * A long draft is split into paragraph groups; for one requirement block, the groups that share the most
 * character bigrams with the block's text are returned in reading order. Character bigrams work for English
 * and Chinese with one rule. No model call; no verdict is derived from this.
 */
export type Segment = { readonly index: number; readonly text: string; readonly overlap: number };

export function paragraphs(draft: string, maxChars = 1200): string[] {
  const raw = draft
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const out: string[] = [];
  let buf = '';
  for (const p of raw) {
    if (buf !== '' && buf.length + p.length > maxChars) {
      out.push(buf);
      buf = '';
    }
    buf = buf === '' ? p : `${buf}\n\n${p}`;
  }
  if (buf !== '') out.push(buf);
  return out;
}

function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ');
  const set = new Set<string>();
  for (let i = 0; i + 1 < t.length; i += 1) {
    const g = t.slice(i, i + 2);
    if (!g.includes(' ')) set.add(g);
  }
  return set;
}

/** The k paragraph groups of `draft` closest to `block`, in reading order. Overlap is a share of the block's bigrams. */
export function segmentsForBlock(block: string, draft: string, k = 2, maxChars = 1200): Segment[] {
  const want = bigrams(block);
  if (want.size === 0) return [];
  const scored = paragraphs(draft, maxChars).map((text, index) => {
    const have = bigrams(text);
    let n = 0;
    for (const g of want) if (have.has(g)) n += 1;
    return { index, text, overlap: n / want.size };
  });
  return scored
    .sort((x, y) => y.overlap - x.overlap || x.index - y.index)
    .slice(0, k)
    .sort((x, y) => x.index - y.index);
}

/** Both drafts' segments for one block, labelled for a narrow pairwise judge. */
export function alignedBlockView(block: string, a: string, b: string, k = 2, maxChars = 1200): string {
  const show = (label: string, segs: Segment[]) =>
    segs.length === 0
      ? `<${label}>\n(no passage addresses this requirement)\n</${label}>`
      : segs.map((s) => `<${label} paragraph_group="${s.index + 1}">\n${s.text}\n</${label}>`).join('\n');
  return `${show('response_A', segmentsForBlock(block, a, k, maxChars))}\n${show('response_B', segmentsForBlock(block, b, k, maxChars))}`;
}
