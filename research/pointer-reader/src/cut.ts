import { createHash } from 'node:crypto';
import { parse as parseYaml, parseDocument, isScalar, isMap, isSeq } from 'yaml';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type Container =
  | 'heading'
  | 'sentence'
  | 'list_item'
  | 'table_cell'
  | 'block_quote'
  | 'front_matter_value'
  | 'opaque';
export type Unit = {
  container: Container;
  start: number;
  end: number;
  text: string;
  fp: string;
  path: string[];
  key?: string;
};

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** NFC, white space collapsed, container markers stripped; case and emphasis kept. */
export function fingerprint(text: string): string {
  const body = text
    .normalize('NFC')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|/gm, '')
    .replace(/\|\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sha(body).slice(0, 16);
}

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Same-length mask of spans that must not be cut: inline code, URLs, link destinations. */
function mask(text: string): string {
  const same = (m: string) => 'x'.repeat(m.length);
  const same_space = (m: string) => ' '.repeat(m.length);
  return text
    .replace(/`+[^`]*`+/g, same)
    .replace(/\]\([^)]*\)/g, same)
    .replace(/https?:\/\/\S+/g, same)
    .replace(/\*+/g, same_space)
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, same_space)
    .replace(/\n/g, ' ');
}

/** Whether a segment break is a likely false split, decided by shape only (no word list). */
function shouldMerge(before: string, after: string): boolean {
  const tail = /(?:^|[\s(])(\p{Lu}\p{Ll}{0,2}|\p{L}|\p{L}\.\p{L})\.$/u.exec(before.trimEnd());
  if (tail) return true; // "Dr.", "Mr.", "e.g.", "A."
  if (/\d\.$/.test(before.trimEnd()) && /^\d/.test(after.trimStart())) return true; // "v2. 1"
  if (/^\s*[\p{Ll}\d]/u.test(after)) return true; // a sentence rarely starts in lower case
  if (/^\s*[)\]"'”’]/.test(after)) return true;
  return false;
}

export function sentences(source: string, from: number, to: number): Array<[number, number]> {
  const slice = source.slice(from, to);
  const masked = mask(slice);
  const spans: Array<[number, number]> = [];
  let cur: [number, number] | undefined;
  for (const seg of sentenceSegmenter.segment(masked)) {
    const s = seg.index;
    const e = seg.index + seg.segment.length;
    if (!masked.slice(s, e).trim()) continue;
    if (cur && shouldMerge(masked.slice(cur[0], cur[1]), masked.slice(s, e))) cur[1] = e;
    else {
      if (cur) spans.push(cur);
      cur = [s, e];
    }
  }
  if (cur) spans.push(cur);
  return spans.map(([s, e]) => trim(source, from + s, from + e));
}

function trim(source: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(source[start] ?? '')) start++;
  while (end > start && /\s/.test(source[end - 1] ?? '')) end--;
  return [start, end];
}

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);

type Node = {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  value?: string;
  depth?: number;
};

export function cut(rawSource: string): { units: Unit[]; digest: string; base: number } {
  const base = rawSource.charCodeAt(0) === 0xfeff ? 1 : 0;
  const source = rawSource.slice(base);
  const units: Unit[] = [];
  const add = (container: Container, start: number, end: number, path: string[], key?: string) => {
    const [s, e] = trim(source, start, end);
    if (e <= s) return;
    const text = source.slice(s, e);
    units.push({ container, start: s + base, end: e + base, text, fp: fingerprint(text), path: [...path], ...(key ? { key } : {}) });
  };
  const walkMarkdown = (src: string, offset: number, inheritedPath: string[], depth = 0) => {
    const tree = processor.parse(src) as Node;
    const path = [...inheritedPath];
    const depthPath: Array<{ depth: number; title: string }> = [];
    const currentPath = () => [...path, ...depthPath.map((d) => d.title)];
    const off = (n?: number) => (n ?? 0) + offset;
    const visit = (node: Node, ctx: { inList?: boolean; inQuote?: boolean; inCell?: boolean }) => {
      const s = node.position?.start.offset ?? 0;
      const e = node.position?.end.offset ?? 0;
      switch (node.type) {
        case 'yaml': {
          if (offset === 0) frontMatter(src, s, e, offset);
          return;
        }
        case 'heading': {
          const title = src.slice(s, e).replace(/^#+\s*/, '').replace(/\s*#+\s*$/, '');
          while (depthPath.length && (depthPath.at(-1)?.depth ?? 0) >= (node.depth ?? 1)) depthPath.pop();
          add('heading', off(s), off(e), currentPath());
          depthPath.push({ depth: node.depth ?? 1, title });
          return;
        }
        case 'paragraph': {
          if (ctx.inCell) return add('table_cell', off(s), off(e), currentPath());
          if (ctx.inList) return add('list_item', off(s), off(e), currentPath());
          if (ctx.inQuote) return add('block_quote', off(s), off(e), currentPath());
          for (const [a, b] of sentences(src, s, e)) add('sentence', off(a), off(b), currentPath());
          return;
        }
        case 'code': {
          const first = src.slice(s, e).split('\n')[0] ?? '';
          add('opaque', off(s), off(s) + first.length, currentPath());
          return;
        }
        case 'html': {
          // An html block inside an html block that does not shrink is cut as opaque, so the parse always ends.
          if (depth >= 2) return add('opaque', off(s), off(s) + (src.slice(s, e).split('\n')[0] ?? '').length, currentPath());
          htmlBlock(src, s, e);
          return;
        }
        case 'tableCell': {
          const kids = node.children ?? [];
          if (kids.length) {
            const a = kids[0]?.position?.start.offset ?? s;
            const b = kids.at(-1)?.position?.end.offset ?? e;
            add('table_cell', off(a), off(b), currentPath());
          }
          return;
        }
        case 'listItem': {
          for (const child of node.children ?? []) {
            if (child.type === 'paragraph') {
              // A list item is one unit; the checkbox marker is not part of it.
              visit(child, { ...ctx, inList: true });
            } else visit(child, { ...ctx, inList: false });
          }
          return;
        }
        case 'blockquote': {
          for (const child of node.children ?? []) visit(child, { ...ctx, inQuote: true });
          return;
        }
        default:
          for (const child of node.children ?? []) visit(child, ctx);
      }
    };
    const htmlBlock = (srcText: string, s: number, e: number) => {
      const block = srcText.slice(s, e);
      if (/^\s*<!--/.test(block)) return add('opaque', off(s), off(s) + (block.split('\n')[0] ?? '').length, currentPath());
      // Parse inside: lines that are only tags separate chunks; the markdown between is cut like any prose.
      const lines = block.split('\n');
      let pos = s;
      let chunkStart = -1;
      let chunkEnd = -1;
      const flush = () => {
        if (chunkStart >= 0) {
          const inner = srcText.slice(chunkStart, chunkEnd);
          walkMarkdownInner(inner, off(chunkStart), currentPath(), depth + 1);
        }
        chunkStart = -1;
      };
      for (const line of lines) {
        const isTagOnly = /^\s*<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>\s*$/.test(line);
        if (isTagOnly) flush();
        else {
          if (chunkStart < 0) chunkStart = pos;
          chunkEnd = pos + line.length;
        }
        pos += line.length + 1;
      }
      flush();
    };
    const frontMatter = (srcText: string, s: number, e: number, o: number) => {
      const body = srcText.slice(s, e).replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '');
      const bodyStart = s + (srcText.slice(s, e).length - srcText.slice(s, e).replace(/^---\r?\n/, '').length);
      try {
        const doc = parseDocument(body);
        const walk = (node: unknown, keyPath: string) => {
          if (isScalar(node) && typeof node.value === 'string' && node.range) {
            const [a, b] = node.range;
            add('front_matter_value', o + bodyStart + a, o + bodyStart + b, [], keyPath);
          } else if (isMap(node)) {
            for (const pair of node.items) walk(pair.value, `${keyPath}.${String((pair.key as { value?: unknown }).value)}`);
          } else if (isSeq(node)) node.items.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
        };
        walk(doc.contents, '$');
      } catch {
        add('opaque', o + s, o + e, []);
      }
    };
    for (const child of tree.children ?? []) visit(child, {});
    void parseYaml;
  };
  const walkMarkdownInner = (inner: string, at: number, path: string[], depth: number) => {
    // Re-parse the inner chunk with its own offsets (shifted back by the BOM base which add() re-applies).
    walkMarkdown(inner, at, path, depth);
  };
  walkMarkdown(source, 0, []);
  const digest = sha(units.map((u) => `${u.container}:${u.fp}`).join('\n'));
  return { units, digest, base };
}
