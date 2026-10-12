/**
 * A path glob as specs write it, for `expect.references`: `*` matches within one folder, `**` across
 * folders, `?` one character; every other character matches itself, so a path without a wildcard matches
 * only itself. Paths compare with forward slashes and no leading `./`.
 */
export function globMatches(pattern: string, path: string): boolean {
  return globRegExp(normal(pattern)).test(normal(path));
}

function normal(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function globRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === '*' && pattern[index + 1] === '*') {
      const slash = pattern[index + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/**
 * A glob over any text, such as a command, a path or a tool name: `*` matches any run of characters, slashes
 * and spaces included, and every other character matches itself. The whole subject must match.
 */
export function anyGlobMatches(pattern: string, subject: string): boolean {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`, 's').test(subject);
}
