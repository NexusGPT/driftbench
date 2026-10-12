import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeBlocks, executeBlock } from '../src/code-evidence';

describe('candidate code execution', () => {
  it('extracts Python and JavaScript fences without executing prose', () => {
    expect(codeBlocks('prose\n```py\ndef f(): return 1\n```\n```js\nconsole.log(2)\n```')).toEqual([
      { language: 'python', code: 'def f(): return 1' },
      { language: 'javascript', code: 'console.log(2)' },
    ]);
  });
  it('runs exact Python functions against the question examples and detects a wrong implementation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-python-'));
    const question = 'cube_nums([1, 2, 3]) == [1, 8, 27]';
    const good = await executeBlock(
      { language: 'python', code: 'def cube_nums(nums):\n    return [n ** 3 for n in nums]' },
      question,
      root,
    );
    const bad = await executeBlock(
      { language: 'python', code: 'def cube_nums(nums):\n    return [n ** 2 for n in nums]' },
      question,
      root,
    );
    expect(JSON.parse(good.stdout ?? '').tests[0].pass).toBe(true);
    expect(JSON.parse(bad.stdout ?? '').tests[0].pass).toBe(false);
  });
  it('runs JavaScript and captures actual output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-js-'));
    const result = await executeBlock(
      { language: 'javascript', code: 'console.log([1,2,3].reduce((a,b)=>a+b,0))' },
      '',
      root,
    );
    expect(JSON.parse(result.stdout ?? '').output).toEqual(['6']);
  });
  it('compiles and runs C rather than claiming a syntax check is execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-c-'));
    const result = await executeBlock(
      { language: 'c', code: '#include <stdio.h>\nint main(void) { printf("%d\\n", 6*7); return 0; }' },
      '',
      root,
    );
    expect(result.status).toBe('ran');
    expect(result.stdout).toBe('42');
  });
  it('blocks a snippet writing outside its isolated folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-denial-'));
    const file = join(root, 'outside-snippet.txt');
    const result = await executeBlock(
      { language: 'shell', code: `printf marker > ${JSON.stringify(file)}` },
      '',
      root,
    );
    expect(result.status).toBe('process_error');
    await expect(access(file)).rejects.toThrow();
  });
  it('reports dependencies and absent entry points without inventing behavioral correctness', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-unknown-'));
    const py = await executeBlock({ language: 'python', code: 'import os\nprint(os.environ)' }, '', root);
    expect(JSON.parse(py.stdout ?? '').status).toBe('unsupported_dependency_or_operation');
    const c = await executeBlock({ language: 'c', code: 'int add(int a,int b){return a+b;}' }, '', root);
    expect(c.status).toBe('syntax_checked_no_entry_point');
  });
});
