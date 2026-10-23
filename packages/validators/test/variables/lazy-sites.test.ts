import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A diagnostic is built after the verdict (docs/validators.md 12.11): every `check(condition, fields)` of the variables
 * ladder passes a function, never an object. An object literal is built before the condition is read, so it can read
 * the product one more time than the original code did (review of #1385: a getter that gave a duplicate id for its
 * first three reads). The scan reads the sources; it is not a parser of TypeScript, only of calls and brackets.
 */

const ROOT = fileURLToPath(new URL('../../src/ladders/variables/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** The index of the bracket that closes the one at `open`, skipping strings, templates and comments. */
function close(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k += 1) {
    const c = s[k] as string;
    if (c === '"' || c === "'") {
      const q = c;
      for (k += 1; s[k] !== q; k += 1) if (s[k] === '\\') k += 1;
    } else if (c === '`') {
      for (k += 1; s[k] !== '`'; k += 1) {
        if (s[k] === '\\') k += 1;
        else if (s[k] === '$' && s[k + 1] === '{') {
          let d = 1;
          for (k += 2; d > 0; k += 1) {
            if (s[k] === '{') d += 1;
            else if (s[k] === '}') d -= 1;
          }
          k -= 1;
        }
      }
    } else if (c === '/' && s[k + 1] === '/') {
      while (s[k] !== '\n') k += 1;
    } else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  throw new Error('unbalanced');
}

/** The text of the second argument of each `check(` call: from its first top-level comma to the closing bracket. */
function secondArguments(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?<![\w.])check\(/g)) {
    const open = (m.index as number) + m[0].length - 1;
    const end = close(source, open);
    let depth = 0;
    for (let k = open + 1; k < end; k += 1) {
      const c = source[k] as string;
      if (c === '"' || c === "'") {
        const q = c;
        for (k += 1; source[k] !== q; k += 1) if (source[k] === '\\') k += 1;
      } else if (c === '`') {
        for (k += 1; source[k] !== '`'; k += 1) if (source[k] === '\\') k += 1;
      } else if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) depth -= 1;
      else if (c === ',' && depth === 0) {
        out.push(source.slice(k + 1, end).trimStart());
        break;
      }
    }
  }
  return out;
}

describe('every diagnostic of the variables ladder is built lazily', () => {
  it('passes check() a function, never an object literal', () => {
    const eager: string[] = [];
    for (const path of files(ROOT)) {
      const source = readFileSync(path, 'utf8');
      for (const arg of secondArguments(source))
        if (arg.startsWith('{')) eager.push(`${path.slice(ROOT.length)}: ${arg.slice(0, 60)}`);
    }
    expect(eager).toEqual([]);
  });

  it('finds the sites it is meant to find', () => {
    let calls = 0;
    for (const path of files(ROOT)) calls += secondArguments(readFileSync(path, 'utf8')).length;
    expect(calls).toBeGreaterThan(40);
  });
});
