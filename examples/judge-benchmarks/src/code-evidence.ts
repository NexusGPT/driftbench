import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Run public candidate snippets in isolated worktree folders, with host writes and networking denied. */
export type CodeBlock = { language: string; code: string };
export type Execution = {
  language: string;
  status: string;
  stdout?: string;
  stderr?: string;
  code?: number | null;
};
const VERSION = 'code-evidence-v6';
const LIMIT = 3000;

export function codeBlocks(text: string): CodeBlock[] {
  return [...text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)]
    .map((match) => {
      const raw = (match[1] ?? '').trim().toLowerCase();
      const code = (match[2] ?? '').trim();
      const aliases: Record<string, string> = {
        py: 'python',
        python3: 'python',
        js: 'javascript',
        ts: 'typescript',
        'c++': 'cpp',
        cc: 'cpp',
        bash: 'shell',
        sh: 'shell',
      };
      const inferred = !raw && /^(?:from \w+ import|import \w+|def \w+\()/m.test(code) ? 'python' : raw;
      return { language: aliases[inferred] ?? inferred, code };
    })
    .filter((block) => block.code !== '');
}

function execute(
  command: string,
  args: string[],
  folder: string,
  input = '',
  timeout = 5000,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: folder,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: folder, LANG: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      resolveResult({
        stdout: stdout.trim().slice(0, LIMIT).split(folder).join('<scratch>'),
        stderr: stderr.trim().slice(0, LIMIT).split(folder).join('<scratch>'),
        code: null,
        timedOut: true,
      });
    }, timeout);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < LIMIT) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < LIMIT) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveResult({ stdout: '', stderr: String(error), code: null, timedOut: false });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveResult({
        stdout: stdout.trim().slice(0, LIMIT).split(folder).join('<scratch>'),
        stderr: stderr.trim().slice(0, LIMIT).split(folder).join('<scratch>'),
        code,
        timedOut,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const PYTHON = `import ast, json, traceback
source = SOURCE
question = QUESTION
allowed = {'math','operator','itertools','functools','collections','re','string','statistics','heapq','bisect','fractions','decimal','typing'}
forbidden = {'open','eval','exec','compile','__import__','globals','locals','getattr','setattr','delattr','vars','input','breakpoint'}
try:
    tree = ast.parse(source)
    blocked = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import): blocked.extend(n.name for n in node.names if n.name.split('.')[0] not in allowed)
        if isinstance(node, ast.ImportFrom) and (node.module or '').split('.')[0] not in allowed: blocked.append(node.module)
        if isinstance(node, ast.Name) and (node.id in forbidden or node.id.startswith('__')): blocked.append(node.id)
        if isinstance(node, ast.Attribute) and node.attr.startswith('__'): blocked.append(node.attr)
    if blocked:
        print(json.dumps({'status':'unsupported_dependency_or_operation','details':sorted(set(map(str,blocked)))}))
    else:
        namespace = {}
        exec(compile(tree,'answer.py','exec'),namespace)
        tests = []
        for line in question.splitlines():
            try:
                expression = ast.parse(line.strip(),mode='eval').body
                if not isinstance(expression,ast.Compare) or len(expression.ops)!=1 or not isinstance(expression.ops[0],ast.Eq): continue
                call = expression.left
                if not isinstance(call,ast.Call) or not isinstance(call.func,ast.Name) or call.func.id not in namespace: continue
                args = [ast.literal_eval(x) for x in call.args]
                keywords = {x.arg:ast.literal_eval(x.value) for x in call.keywords}
                expected = ast.literal_eval(expression.comparators[0])
            except (SyntaxError,ValueError,TypeError): continue
            try:
                actual = namespace[call.func.id](*args,**keywords)
                tests.append({'function':call.func.id,'pass':actual==expected,'expected':repr(expected),'actual':repr(actual)})
            except Exception as error:
                tests.append({'function':call.func.id,'pass':False,'error':type(error).__name__+': '+str(error)})
            if len(tests)>=8: break
        print(json.dumps({'status':'executed','tests':tests,'note':'No supplied function tests' if not tests else 'Tests from supplied examples; examples can themselves be wrong'}))
except Exception as error:
    print(json.dumps({'status':'runtime_or_syntax_error','error':type(error).__name__+': '+str(error)}))
`;

const JAVASCRIPT = `const vm = require('node:vm');
const source = SOURCE;
const logs = [];
const context = vm.createContext({console:{log:(...xs)=>logs.push(xs.map(String).join(' ')),error:(...xs)=>logs.push(xs.map(String).join(' '))}});
try { vm.runInContext(source,context,{timeout:2000,filename:'answer.js'}); console.log(JSON.stringify({status:'executed',output:logs.slice(0,15),note:logs.length?'Executed candidate output':'Definitions loaded; no supplied behavior test'})); }
catch (error) { console.log(JSON.stringify({status:'runtime_or_syntax_error',error:String(error),note:/not defined|Cannot find module/.test(String(error))?'Environment may lack a required dependency':''})); }
`;

export async function executeBlock(block: CodeBlock, question: string, root: string): Promise<Execution> {
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'snippet-'));
  const profile = join(folder, 'sandbox.sb');
  const quote = (value: string) => JSON.stringify(value);
  let javaHome: string | undefined;
  try {
    const manifest = JSON.parse(await readFile(resolve('.cache/rb/jdk/manifest.json'), 'utf8')) as {
      java: string;
    };
    const proposed = dirname(dirname(manifest.java));
    if (proposed.startsWith(resolve('.cache/rb/jdk'))) javaHome = proposed;
  } catch {
    javaHome = undefined;
  }
  await writeFile(
    profile,
    `(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (subpath ${quote(folder)})))\n(deny file-read-data (subpath "/private/tmp"))\n(deny file-read-data (require-all (subpath ${quote(homedir())}) (require-not (subpath ${quote(folder)})) (require-not (subpath ${quote(join(homedir(), '.local/share/uv/python'))})) (require-not (subpath ${quote(join(homedir(), '.local/bin'))})) ${javaHome ? `(require-not (subpath ${quote(javaHome)}))` : ''}))\n`,
  );
  const run = (command: string, args: string[], input = '', timeout = 5000) =>
    execute('sandbox-exec', ['-f', profile, command, ...args], folder, input, timeout);
  let result: Awaited<ReturnType<typeof execute>>;
  if (block.language === 'python') {
    const wrapper = PYTHON.replace('source = SOURCE', `source = ${JSON.stringify(block.code)}`).replace(
      'question = QUESTION',
      `question = ${JSON.stringify(question)}`,
    );
    // JSON string literals differ from Python only for escaping booleans/null, which are inside strings here.
    const file = join(folder, 'runner.py');
    await writeFile(file, wrapper);
    result = await run('python3', ['-I', file]);
  } else if (block.language === 'javascript') {
    const file = join(folder, 'runner.cjs');
    await writeFile(
      file,
      JAVASCRIPT.replace('const source = SOURCE;', `const source = ${JSON.stringify(block.code)};`),
    );
    result = await run('node', [file]);
  } else if (block.language === 'typescript') {
    const file = join(folder, 'answer.ts');
    await writeFile(file, block.code);
    result = await run('node', ['--experimental-strip-types', file]);
  } else if (block.language === 'c' || block.language === 'cpp') {
    const file = join(folder, block.language === 'c' ? 'answer.c' : 'answer.cpp');
    await writeFile(file, block.code);
    const binary = join(folder, 'answer');
    const hasMain = /\bmain\s*\(/.test(block.code);
    result = await run(
      block.language === 'c' ? 'clang' : 'clang++',
      hasMain ? [file, '-o', binary] : ['-fsyntax-only', file],
      '',
      10_000,
    );
    if (result.code === 0 && hasMain) result = await run(binary, []);
    else if (result.code === 0) return { language: block.language, status: 'syntax_checked_no_entry_point' };
  } else if (block.language === 'shell') {
    const file = join(folder, 'answer.sh');
    await writeFile(file, block.code);
    result = await run('/bin/sh', [file]);
  } else if (block.language === 'java' && javaHome) {
    const className = block.code.match(/\b(?:public\s+)?class\s+([A-Za-z_$][\w$]*)/)?.[1];
    if (!className) return { language: 'java', status: 'missing_class_context' };
    const file = join(folder, `${className}.java`);
    await writeFile(file, block.code);
    result = await run(join(javaHome, 'bin', 'javac'), ['-J-Xmx128m', '-d', folder, file], '', 10_000);
    if (result.code === 0) {
      if (!/\bstatic\s+void\s+main\s*\(/.test(block.code))
        return { language: 'java', status: 'compiled_no_entry_point' };
      const packageName = block.code.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
      result = await run(join(javaHome, 'bin', 'java'), [
        '-Xmx128m',
        '-cp',
        folder,
        packageName ? `${packageName}.${className}` : className,
      ]);
    }
  } else if (block.language === 'sql') {
    result = await run('sqlite3', [join(folder, 'scratch.db')], block.code);
  } else
    return {
      language: block.language || 'unlabelled',
      status: block.language === 'java' ? 'runtime_unavailable_no_jdk' : 'unsupported_language',
    };
  let status = result.timedOut ? 'timeout' : result.code === 0 ? 'ran' : 'process_error';
  if (['python', 'javascript'].includes(block.language) && result.code === 0) {
    try {
      const last = JSON.parse(result.stdout.split('\n').at(-1) ?? '') as { status?: string };
      if (typeof last.status === 'string') status = last.status;
    } catch {
      status = 'runner_output_unparsed';
    }
  }
  return {
    language: block.language,
    status,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  };
}

export async function codeEvidence(input: {
  question: string;
  a: string;
  b: string;
}): Promise<string | undefined> {
  const a = codeBlocks(input.a);
  const b = codeBlocks(input.b);
  if (a.length === 0 && b.length === 0) return undefined;
  const root = resolve(process.env.RB_EXECUTION_ROOT ?? '.cache/rb/execution');
  const key = createHash('sha256')
    .update(JSON.stringify([VERSION, input.question, input.a, input.b]))
    .digest('hex');
  const cache = join(root, `${key}.json`);
  type PairEvidence = { key: string; a: Execution[]; b: Execution[] };
  let evidence: PairEvidence | undefined;
  try {
    evidence = JSON.parse(await readFile(cache, 'utf8')) as PairEvidence;
  } catch {
    // Committed execution observations make a frozen prompt reproducible without reinstalling
    // every runtime. Their key binds the exact snippets, question and executor version.
    try {
      const journal = await readFile('examples/judge-benchmarks/experiments/rb/execution.jsonl', 'utf8');
      const recorded = journal
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PairEvidence)
        .find((row) => row.key === key);
      if (recorded) evidence = recorded;
    } catch {
      /* No recording: execute the snippets below. */
    }
    if (evidence)
      return `Execution observations for the exact candidate snippets. These are not a proof of full correctness. Missing dependencies, a restricted environment, separate snippet context or an absent entry point are unknowns, not evidence the answer is wrong. Adjacent Python, JavaScript and SQL blocks run in sequence; alternative implementations may need separate interpretation. Supplied example expectations may themselves be wrong.\n${JSON.stringify({ A: evidence.a, B: evidence.b })}`;
    const runAll = async (blocks: CodeBlock[]) => {
      const results: Execution[] = [];
      const grouped: CodeBlock[] = [];
      for (const block of blocks) {
        const previous = grouped.at(-1);
        if (
          previous?.language === block.language &&
          ['python', 'javascript', 'sql'].includes(block.language)
        ) {
          previous.code += `\n\n${block.code}`;
        } else grouped.push({ ...block });
      }
      for (const block of grouped) results.push(await executeBlock(block, input.question, root));
      return results;
    };
    evidence = { key, a: await runAll(a), b: await runAll(b) };
    await writeFile(cache, `${JSON.stringify(evidence, null, 2)}\n`);
    await mkdir('examples/judge-benchmarks/experiments/rb', { recursive: true });
    await appendFile(
      'examples/judge-benchmarks/experiments/rb/execution.jsonl',
      `${JSON.stringify(evidence)}\n`,
    );
  }
  return `Execution observations for the exact candidate snippets. These are not a proof of full correctness. Missing dependencies, a restricted environment, separate snippet context or an absent entry point are unknowns, not evidence the answer is wrong. Adjacent Python, JavaScript and SQL blocks run in sequence; alternative implementations may need separate interpretation. Supplied example expectations may themselves be wrong.\n${JSON.stringify({ A: evidence.a, B: evidence.b })}`;
}
