// Fixture hashes are generated at runtime, so this file passes the guard itself.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BEGIN, END, FOLDERS, allowedValues, decide, lineAllowed, writeBlock } from './gitleaks-recording-fingerprints.mjs';

const hex = (n) => randomBytes(32).toString('hex').slice(0, n);
const [peers, verify, rb] = FOLDERS;
const finding = (secret, rule = 'generic-api-key') => ({ RuleID: rule, Secret: secret });

describe('lineAllowed', () => {
  it('passes allowed fields that open the object or follow a comma', () => {
    const a = hex(64);
    const b = hex(64);
    expect(lineAllowed(`{"key":"${a}","n":1,"callKey":"${b}"}`, rb, [finding(a), finding(b)])).toBe(true);
    expect(lineAllowed(`{"attempt_key": "${a}"}`, peers, [finding(a)])).toBe(true);
  });

  it('accepts a reported prefix of the hash', () => {
    const a = hex(64);
    expect(lineAllowed(`{"key":"${a}"}`, verify, [finding(a.slice(0, 20))])).toBe(true);
  });

  it.each(['api/key', 'api:key', 'api@key', 'foo/probeCallKey', 'foo/key'])('refuses the field %s', (name) => {
    const a = hex(64);
    expect(lineAllowed(`{"${name}":"${a}"}`, rb, [finding(a)])).toBe(false);
  });

  it('refuses a line whose second finding is not an allowed field', () => {
    const a = hex(64);
    const b = hex(64);
    expect(lineAllowed(`{"key":"${a}","api/key":"${b}"}`, rb, [finding(a), finding(b)])).toBe(false);
    expect(lineAllowed(`{"key":"${a}","api/key":"${a}"}`, rb, [finding(a), finding(a)])).toBe(false);
    expect(lineAllowed(`{"key":"${a}","text":"password = 'x'"}`, rb, [finding(a), finding('x'.repeat(16))])).toBe(false);
  });

  it('refuses another rule, a field from another folder, and short or long values', () => {
    const a = hex(64);
    expect(lineAllowed(`{"key":"${a}"}`, rb, [finding(a, 'github-pat')])).toBe(false);
    expect(lineAllowed(`{"callKey":"${a}"}`, verify, [finding(a)])).toBe(false);
    expect(allowedValues(`{"key":"${hex(64)}${hex(16)}"}`, rb).size).toBe(0);
    expect(allowedValues(`{"key":"${hex(10)}"}`, rb).size).toBe(0);
  });
});

describe('decide and writeBlock', () => {
  it('refuses findings outside the three folders', () => {
    const { allowed, refused } = decide([{ Commit: 'c', File: 'examples/other/x.json', RuleID: 'generic-api-key', StartLine: 1, Secret: hex(64) }]);
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
