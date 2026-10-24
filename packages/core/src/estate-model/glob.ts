/**
 * The globs a part type locates its parts by. A glob is matched against a whole path relative to the type's root,
 * segment by segment, with `/` between folders:
 * - `*` matches any characters inside one name, `?` one character, `[abc]`, `[a-z]` and `[!abc]` one character of
 *   a class, `{a,b}` one of the alternatives (no `/` inside), and `\` takes the next character as written;
 * - `**` alone in a segment matches any number of folders, none included (`**\/x.md` matches `x.md` and `a/b/x.md`);
 *   a final `**` matches every path below its folder;
 * - a star matches a name that starts with a dot too, and case is matched as written.
 * A glob that ends with `/` locates folders. The last `*` outside braces captures the text it matched: a part's
 * `match`, its default name (`skills/*\/` names a skill by its folder).
 */

/** Why a glob was refused, as a code a reader branches on. */
export type GlobError =
  | 'empty'
  | 'too-long'
  | 'too-many-stars'
  | 'absolute'
  | 'parent-segment'
  | 'empty-segment'
  | 'double-star-in-segment'
  | 'unclosed-class'
  | 'unclosed-brace'
  | 'slash-in-brace'
  | 'trailing-escape';

export type CompiledGlob = {
  /** The glob as written. */
  glob: string;
  /** True for a glob that ends with `/`: it locates folders. */
  folder: boolean;
  /** Matches a whole path relative to the root. Group `match` holds the capture, when the glob has one. */
  regex: RegExp;
  /** True when the glob has a `*` outside braces, so a match carries a capture. */
  captures: boolean;
};

export type GlobResult = { ok: true; glob: CompiledGlob } | { ok: false; error: GlobError };

const SPECIAL = /[.*+?^${}()|[\]\\/]/g;
const literal = (char: string) => char.replace(SPECIAL, '\\$&');

/**
 * The limits a glob stays within. A glob comes from a user's types document, and a pattern with many stars can make
 * matching backtrack heavily on a long name: a longer glob, or one with more stars, is refused.
 */
export const GLOB_LIMITS = { characters: 256, stars: 8 } as const;

/** Compiles a glob, or says why it is refused. */
export function compileGlob(glob: string): GlobResult {
  if (glob === '' || glob === '/') return { ok: false, error: 'empty' };
  if (glob.length > GLOB_LIMITS.characters) return { ok: false, error: 'too-long' };
  if ((glob.replace(/\\./g, '').match(/\*/g) ?? []).length > GLOB_LIMITS.stars)
    return { ok: false, error: 'too-many-stars' };
  if (glob.startsWith('/')) return { ok: false, error: 'absolute' };
  if (slashInBrace(glob)) return { ok: false, error: 'slash-in-brace' };
  const folder = glob.endsWith('/');
  const body = folder ? glob.slice(0, -1) : glob;
  const segments = body.split('/');
  for (const segment of segments) {
    if (segment === '') return { ok: false, error: 'empty-segment' };
    if (segment === '..' || segment === '.') return { ok: false, error: 'parent-segment' };
    if (segment !== '**' && /(?<!\\)\*\*/.test(segment))
      return { ok: false, error: 'double-star-in-segment' };
  }
  // The capturing star is the last single star outside braces: find its segment and offset first.
  const lastStar = lastCapturingStar(segments);
  let source = '';
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] as string;
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '[^/]+(?:/[^/]+)*' : '(?:[^/]+/)*';
      continue;
    }
    const compiled = compileSegment(segment, lastStar?.segment === index ? lastStar.offset : -1);
    if (!compiled.ok) return compiled;
    source += compiled.source + (last ? '' : '/');
  }
  return {
    ok: true,
    glob: { glob, folder, regex: new RegExp(`^${source}$`), captures: lastStar !== undefined },
  };
}

/** Where the capturing star sits: the last `*` outside braces and classes, not part of `**`. */
function lastCapturingStar(segments: readonly string[]): { segment: number; offset: number } | undefined {
  let found: { segment: number; offset: number } | undefined;
  segments.forEach((segment, index) => {
    if (segment === '**') return;
    let depth = 0;
    let inClass = false;
    for (let offset = 0; offset < segment.length; offset++) {
      const char = segment[offset];
      if (char === '\\') {
        offset++;
        continue;
      }
      if (inClass) {
        if (char === ']') inClass = false;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === '{') depth++;
      else if (char === '}') depth = Math.max(0, depth - 1);
      else if (char === '*' && depth === 0) found = { segment: index, offset };
    }
  });
  return found;
}

function compileSegment(
  segment: string,
  capture: number,
): { ok: true; source: string } | { ok: false; error: GlobError } {
  let source = '';
  let depth = 0;
  for (let offset = 0; offset < segment.length; offset++) {
    const char = segment[offset] as string;
    if (char === '\\') {
      const next = segment[offset + 1];
      if (next === undefined) return { ok: false, error: 'trailing-escape' };
      source += literal(next);
      offset++;
    } else if (char === '*') source += offset === capture ? '(?<match>[^/]*)' : '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '[') {
      const close = segment.indexOf(']', offset + 2);
      if (close < 0) return { ok: false, error: 'unclosed-class' };
      let inner = segment.slice(offset + 1, close);
      const negated = inner.startsWith('!') || inner.startsWith('^');
      if (negated) inner = inner.slice(1);
      const body = inner.replace(/[\\\]^[]/g, '\\$&');
      source += `(?:(?!/)[${negated ? '^' : ''}${body}])`;
      offset = close;
    } else if (char === '{') {
      depth++;
      source += '(?:';
    } else if (char === '}' && depth > 0) {
      depth--;
      source += ')';
    } else if (char === ',' && depth > 0) source += '|';
    else source += literal(char);
  }
  if (depth > 0) return { ok: false, error: 'unclosed-brace' };
  return { ok: true, source };
}

/** True when a glob's brace alternatives hold a `/`, which a glob may not: a brace stays inside one name. */
function slashInBrace(glob: string): boolean {
  let depth = 0;
  for (let offset = 0; offset < glob.length; offset++) {
    const char = glob[offset];
    if (char === '\\') offset++;
    else if (char === '{') depth++;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === '/' && depth > 0) return true;
  }
  return false;
}

/** Matches a root-relative path against a compiled glob: undefined, or the capture (empty when it has none). */
export function matchGlob(glob: CompiledGlob, path: string): { match?: string } | undefined {
  const found = glob.regex.exec(path);
  if (!found) return undefined;
  const match = found.groups?.match;
  return match === undefined ? {} : { match };
}
