// Fixture hashes are generated at runtime, so this file passes the guard itself.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allowedFields,
  BEGIN,
  decide,
  END,
  FOLDERS,
  lineAllowed,
  writeBlock,
} from './gitleaks-recording-fingerprints.mjs';

const hex = (n) => randomBytes(32).toString('hex').slice(0, n);
const [peers, verify, rb] = FOLDERS;
// A generic-api-key finding as gitleaks reports it: the match starts at the keyword of the field name.
const finding = (match, secret, rule = 'generic-api-key') => ({ RuleID: rule, Match: match, Secret: secret });
const on = (name, value, sep = '":"') => finding(`${name}${sep}${value}"`, value);

describe('lineAllowed', () => {
  it('passes allowed fields that open the object or follow a comma', () => {
    const a = hex(64);
    const b = hex(64);
    expect(lineAllowed(`{"key":"${a}","n":1,"callKey":"${b}"}`, rb, [on('key', a), on('callKey', b)])).toBe(
      true,
    );
    expect(lineAllowed(`{"attempt_key": "${a}"}`, peers, [on('attempt_key', a, '": "')])).toBe(true);
  });

  it.each(['api/key', 'api:key', 'api@key', 'foo/probeCallKey', 'foo/key'])(
    'refuses the field %s',
    (name) => {
      const a = hex(64);
      const keyword = name.slice(name.search(/(probeCallKey|key)$/));
      expect(lineAllowed(`{"${name}":"${a}"}`, rb, [on(keyword, a)])).toBe(false);
    },
  );

  it.each([16, 20, 24, 32])('refuses a %i-character secret beside a key padded from it', (n) => {
    // The padded key has low entropy and is not reported; only the shorter real secret is.
    const prefix = hex(n);
    const padded = prefix.padEnd(64, 'a');
    expect(lineAllowed(`{"key":"${padded}","api/key":"${prefix}"}`, rb, [on('key', prefix)])).toBe(false);
    expect(lineAllowed(`{"api/key":"${prefix}","key":"${padded}"}`, rb, [on('key', prefix)])).toBe(false);
    expect(lineAllowed(`{"key":"${padded}","api_key":"${prefix}"}`, rb, [on('api_key', prefix)])).toBe(false);
    expect(
      lineAllowed(`{"key":"${padded}","t":"password = ${prefix}"}`, rb, [
        finding(`password = ${prefix}`, prefix),
      ]),
    ).toBe(false);
  });

  it('refuses a match text that reaches past the field', () => {
    const a = hex(64);
    expect(lineAllowed(`{"key":"${a}"}`, rb, [finding(`key":"${a}"}`, a)])).toBe(false);
  });

  it('refuses a line whose second finding is not an allowed field', () => {
    const a = hex(64);
    const b = hex(64);
    expect(lineAllowed(`{"key":"${a}","api/key":"${b}"}`, rb, [on('key', a), on('key', b)])).toBe(false);
    expect(lineAllowed(`{"key":"${a}","api/key":"${a}"}`, rb, [on('key', a), on('key', a)])).toBe(false);
  });

  it('refuses another rule, a field from another folder, and short or long values', () => {
    const a = hex(64);
    expect(lineAllowed(`{"key":"${a}"}`, rb, [{ ...on('key', a), RuleID: 'github-pat' }])).toBe(false);
    expect(lineAllowed(`{"callKey":"${a}"}`, verify, [on('callKey', a)])).toBe(false);
    expect(allowedFields(`{"key":"${hex(64)}${hex(16)}"}`, rb)).toHaveLength(0);
    expect(allowedFields(`{"key":"${hex(10)}"}`, rb)).toHaveLength(0);
  });
});

describe('decide and writeBlock', () => {
  it('refuses findings outside the three folders', () => {
    const a = hex(64);
    const { allowed, refused } = decide([
      {
        Commit: 'c',
        File: 'examples/other/x.json',
        RuleID: 'generic-api-key',
        StartLine: 1,
        Match: `key":"${a}"`,
        Secret: a,
      },
    ]);
    expect(allowed).toEqual([]);
    expect(refused).toHaveLength(1);
  });

  it('replaces only the generated block', () => {
    const text = `# kept\nabc:f:generic-api-key:1\n\n${BEGIN}\nold\n${END}\n# after\n`;
    const next = writeBlock(text, ['c:f:generic-api-key:2']);
    expect(next).toContain('abc:f:generic-api-key:1');
    expect(next).toContain('c:f:generic-api-key:2');
    expect(next).not.toContain('\nold\n');
    expect(next).toContain('# after');
  });
});
