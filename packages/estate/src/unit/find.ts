/**
 * The material of a guard that blocks, found from the guard itself.
 *
 * A positive guard test carries the material of the rules the guard enforces (the spans of their quotes). A
 * guard often needs more than one span at once (a command that removes something AND names a folder), or a
 * length past a number the source compares with. When no case of the test shows the guard at work, `--record`
 * builds candidate payloads from the quoted strings and the numbers of the guard's own source, runs them, and
 * keeps the first that makes the guard do something. The candidates are tried in a fixed order: a string
 * alone, a length just past a number, then two strings one after the other. No word of a rule or a message
 * decides anything: a candidate counts only because the guard answered it.
 */

/** The most candidates one test tries. */
export const MAX_CANDIDATES = 150;
/** The longest string of a source taken as material. */
const LONGEST_LITERAL = 60;
/** The most strings of a source that are combined in pairs. */
const MOST_LITERALS = 12;
/** The numbers of a source taken as the limit of a length. */
const LENGTHS = { least: 10, most: 100_000 };

type Scanned = { literals: string[]; syntax: string };

function scan(source: string): Scanned {
  const literals: string[] = [];
  let syntax = '';
  for (let at = 0; at < source.length; ) {
    const char = source[at] ?? '';
    const start = at;
    if (char === '#' || source.slice(at, at + 2) === '//') {
      while (at < source.length && source[at] !== '\n') at++;
    } else if (source.slice(at, at + 2) === '/*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'" || char === '`') {
      const width = source.slice(at, at + 3) === char.repeat(3) ? 3 : 1;
      at += width;
      const content = at;
      while (at < source.length) {
        if (source[at] === '\\') at += 2;
        else if (source.slice(at, at + width) === char.repeat(width)) break;
        else at++;
      }
      literals.push(source.slice(content, Math.min(at, source.length)));
      at = Math.min(source.length, at + width);
    } else {
      syntax += char;
      at++;
      continue;
    }
    syntax += source.slice(start, at).replace(/[^\n]/g, ' ');
  }
  return { literals, syntax };
}

/** The quoted strings of a source, in order of appearance, each once; comments hold none. */
export function guardLiterals(source: string): string[] {
  return [...new Set(scan(source).literals.map((text) => text.replace(/\\n/g, '\n')))].filter(
    (text) => text.trim() !== '',
  );
}

/** The whole numbers of a source outside its strings and comments, as written, each once. */
function numbersOf(source: string): number[] {
  const found = scan(source).syntax.matchAll(/(?<![\w.$])\d{2,6}(?![\w.])/g);
  return [...new Set([...found].map((match) => Number(match[0])))].filter(
    (value) => value >= LENGTHS.least && value <= LENGTHS.most,
  );
}

/**
 * The materials to try, in order: each string alone, a text one character past each number, then every two
 * strings in the order the source gives them (joined, then joined by a space), then in the other order.
 * `skip` holds strings the payload itself is made of (its keys), which say nothing about the guard.
 */
export function candidateMaterials(source: string, skip: ReadonlySet<string> = new Set()): string[] {
  const pool = guardLiterals(source)
    .filter((text) => text.length <= LONGEST_LITERAL && !skip.has(text))
    .slice(0, MOST_LITERALS);
  const out: string[] = [...pool];
  for (const value of numbersOf(source)) out.push('x'.repeat(value + 1));
  for (const order of [false, true]) {
    for (let first = 0; first < pool.length; first++) {
      for (let second = first + 1; second < pool.length; second++) {
        const [a, b] = order
          ? [pool[second] as string, pool[first] as string]
          : [pool[first] as string, pool[second] as string];
        out.push(`${a}${b}`, `${a} ${b}`);
      }
    }
  }
  return [...new Set(out)].slice(0, MAX_CANDIDATES);
}

/** The keys of a payload, at any depth: the strings a guard reads its input by. */
export function payloadKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) payloadKeys(item, into);
  else if (value !== null && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      payloadKeys(item, into);
    }
  return into;
}
