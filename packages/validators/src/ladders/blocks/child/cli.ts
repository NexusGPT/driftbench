import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAliases } from './aliases';
import { prefixMap, steadyText } from './wire';

/**
 * The product's command line as one run of the frame (docs/validators.md section 13, "The bank runs the product
 * through the frame"). The frame starts this program in a working folder of its own, with two arguments: the file
 * that holds the command and the bank's folder, and the file to write the answer to. It lays the folder's files
 * out in its working folder, runs `driftbench <argv>` there with the bank's paths mapped to it, and writes the
 * exit code, the output, and every file of the folder back, with its paths mapped to the bank's.
 */

type Header = {
  root: string;
  dir: string;
  realDir: string;
  cwd: string;
  argv: string[];
  files: Record<string, string | { link: string }>;
  /** The planted agents of the item (child/agents.ts): their base URLs. */
  agents: string[];
  /** The file each run appends its whole answer to, one line each: run A's is the first. */
  answers: string;
};

const [inName, outName] = process.argv.slice(2) as [string, string];
const work = process.cwd();
const header = JSON.parse(readFileSync(inName, 'utf8')) as Header;
rmSync(inName, { force: true });
const realWork = realpathSync(work);
// Each planted agent gives this run its route: run A reaches the agent, run B the recording of what A got.
const routes: [string, string][] = [];
for (const base of header.agents) {
  try {
    const token = await (await fetch(`${base}/__twin`, { method: 'POST' })).text();
    routes.push([base, `${base}/${token}`]);
  } catch {
    // An agent that is gone takes no route: a call to it fails as it would.
  }
}
const toWork = prefixMap([[header.dir, work], [header.realDir, realWork], ...routes]);
const toBank = prefixMap([
  [work, header.dir],
  [realWork, header.realDir],
  ...routes.map(([base, route]) => [route, base] as [string, string]),
]);

const steady = steadyText;

/** A file's bytes with the bank's paths mapped, when it is text that names them. */
function mapped(bytes: Buffer, change: (text: string) => string, names: string[]): Buffer {
  if (!names.some((name) => bytes.includes(name))) return bytes;
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(bytes)) return Buffer.from(change(text), 'utf8');
  return bytes;
}

for (const [rel, body] of Object.entries(header.files).sort(([a], [b]) => a.length - b.length)) {
  const path = join(work, rel);
  if (rel.endsWith('/')) {
    mkdirSync(path, { recursive: true });
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  if (typeof body === 'string')
    writeFileSync(
      path,
      mapped(Buffer.from(body, 'base64'), toWork, [header.dir, header.realDir, ...header.agents]),
    );
  else symlinkSync(toWork(body.link), path);
}

registerAliases(header.root);
const argv = header.argv.map(toWork);
process.argv = [process.argv[0] as string, 'driftbench', ...argv];
const cwd = header.cwd === '' ? work : join(work, header.cwd);
let out = '';
let err = '';
let code = 0;
let threw: string | undefined;
let cpuMs = 0;
try {
  const { main } = (await import(pathToFileURL(join(header.root, 'packages/cli/src/main.ts')).href)) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  const started = process.cpuUsage();
  try {
    code = await main([...argv], {
      out: (text: string) => {
        out += text;
      },
      err: (text: string) => {
        err += text;
      },
      cwd,
    });
  } finally {
    const used = process.cpuUsage(started);
    cpuMs = (used.user + used.system) / 1000;
  }
} catch (cause) {
  threw = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

const files: Record<string, string | { link: string }> = {};
const compared: Record<string, string> = {};
const walk = (at: string, rel: string) => {
  for (const name of readdirSync(at)) {
    const next = rel === '' ? name : `${rel}/${name}`;
    if (next === outName) continue;
    const path = join(at, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      files[next] = { link: toBank(readlinkSync(path)) };
      compared[next] = `link ${toBank(readlinkSync(path))}`;
    } else if (stat.isDirectory()) {
      files[`${next}/`] = '';
      compared[`${next}/`] = '';
      walk(path, next);
    } else {
      const bytes = mapped(readFileSync(path), toBank, [work, realWork, ...routes.map(([, route]) => route)]);
      files[next] = bytes.toString('base64');
      const text = bytes.toString('utf8');
      // A binary file (a database) holds the clock in its bytes: the frame compares that it is there.
      compared[next] = Buffer.from(text, 'utf8').equals(bytes) ? steady(text) : 'bytes';
    }
  }
};
if (existsSync(work)) walk(work, '');
const answer = {
  code,
  out: toBank(out),
  err: toBank(err),
  ...(threw === undefined ? {} : { threw: toBank(threw) }),
};
appendFileSync(header.answers, `${JSON.stringify({ ...answer, files, cpuMs })}\n`);
writeFileSync(
  outName,
  JSON.stringify({
    code,
    out: steady(answer.out),
    err: steady(answer.err),
    files: compared,
    ...(answer.threw === undefined ? {} : { threw: steady(answer.threw) }),
  }),
);
process.exit(0);
