import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ceilingVerdict, readCeilings } from './ceiling';

describe('a ceiling only goes down', () => {
  it('passes at or below the committed value, and when the committed value is at or below the base', () => {
    expect(ceilingVerdict(3493, 3493, undefined)).toBeUndefined();
    expect(ceilingVerdict(3000, 3493, 3493)).toBeUndefined();
    expect(ceilingVerdict(3000, 3000, 3493)).toBeUndefined();
  });

  it('fails when the count is above the committed value, and when the committed value is above the base', () => {
    expect(ceilingVerdict(3494, 3493, 3493)).toMatch(/above the committed ceiling/);
    expect(ceilingVerdict(3494, 3494, 3493)).toMatch(/above the base/);
    expect(ceilingVerdict(10, 3494, 3493)).toMatch(/above the base/);
  });
});

describe('the base ref is read, and a base that cannot be read is an error', () => {
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const repo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ceiling-'));
    run(dir, 'init', '-q', '-b', 'main');
    run(dir, 'config', 'user.email', 'a@b.c');
    run(dir, 'config', 'user.name', 'x');
    mkdirSync(join(dir, 'validators'), { recursive: true });
    writeFileSync(join(dir, 'validators/c.json'), '{"blind": 50}');
    run(dir, 'add', '.');
    run(dir, 'commit', '-q', '-m', 'base');
    run(dir, 'branch', 'base');
    writeFileSync(join(dir, 'validators/c.json'), '{"blind": 60}');
    return dir;
  };

  it('compares the working file with the base copy', () => {
    const dir = repo();
    expect(readCeilings(dir, 'validators/c.json', 'blind', 'base')).toEqual({ head: 60, base: 50 });
  });

  it('fails closed when the base ref is missing (a shallow clone), naming the ref', () => {
    const dir = repo();
    expect(() => readCeilings(dir, 'validators/c.json', 'blind', 'refs/remotes/origin/nope')).toThrow(/origin\/nope.*cannot be read/);
  });

  it('is no limit only when the base is readable and does not have the file or the key', () => {
    const dir = repo();
    writeFileSync(join(dir, 'validators/d.json'), '{"blind": 5}');
    expect(readCeilings(dir, 'validators/d.json', 'blind', 'base').base).toBeUndefined();
  });

  it('fails when the base copy is not valid JSON', () => {
    const dir = repo();
    run(dir, 'checkout', '-q', 'base');
    writeFileSync(join(dir, 'validators/c.json'), '{broken');
    run(dir, 'commit', '-qam', 'broken');
    run(dir, 'branch', '-f', 'base');
    writeFileSync(join(dir, 'validators/c.json'), '{"blind": 1}');
    expect(() => readCeilings(dir, 'validators/c.json', 'blind', 'base')).toThrow(/not valid JSON/);
  });
});
