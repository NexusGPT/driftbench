#!/usr/bin/env node
/**
 * A stand-in for the docker command line, so the docker sandbox code runs on a machine without docker.
 * It speaks only what the sandbox uses: version, run, exec, restart and rm. A container is a JSON file in
 * a `containers` folder next to this script; `exec` runs the command on this machine, in the mounted
 * folder, with the container path rewritten to that folder. Like docker, killing an `exec` client leaves
 * its command running; `restart` and `rm` kill it. Every call is logged to containers/calls.jsonl.
 *
 * It is not a sandbox: the command runs on this machine. The real docker tests run when docker is there.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const stateDir = join(dirname(fileURLToPath(import.meta.url)), 'containers');
mkdirSync(stateDir, { recursive: true });
const [verb = '', ...rest] = process.argv.slice(2);
appendFileSync(join(stateDir, 'calls.jsonl'), `${JSON.stringify([verb, ...rest])}\n`);

const fail = (message, code) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
};
const stateFile = (name) => join(stateDir, `${name}.json`);
const load = (name) =>
  existsSync(stateFile(name)) ? JSON.parse(readFileSync(stateFile(name), 'utf8')) : undefined;
const save = (container) => writeFileSync(stateFile(container.name), JSON.stringify(container));
const killAll = (container) => {
  for (const pid of container.pids) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  container.pids = [];
};

/** Splits leading flags from the rest. `valued` lists the flags that take a value. */
function parse(args, valued) {
  const flags = [];
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const flag = args[index];
    if (valued.includes(flag)) {
      flags.push([flag, args[index + 1]]);
      index += 2;
    } else {
      flags.push([flag, true]);
      index += 1;
    }
  }
  return { flags, rest: args.slice(index) };
}

if (verb === 'version') {
  process.stdout.write('27.0.0-fake\n');
} else if (verb === 'run') {
  const { flags, rest: tail } = parse(rest, [
    '--name',
    '-v',
    '-w',
    '-e',
    '--user',
    '--network',
    '--memory',
    '--cpus',
    '--pids-limit',
    '--cap-drop',
    '--security-opt',
    '--entrypoint',
  ]);
  const get = (flag) => flags.find(([name]) => name === flag)?.[1];
  const volume = String(get('-v'));
  const split = volume.lastIndexOf(':');
  const container = {
    name: get('--name'),
    mount: { host: volume.slice(0, split), path: volume.slice(split + 1) },
    workdir: get('-w'),
    env: flags.filter(([name]) => name === '-e').map(([, value]) => value),
    image: tail[0],
    pids: [],
    restarts: 0,
  };
  if (container.image === 'driftbench/missing-image') {
    fail(`Unable to find image '${container.image}' locally`, 125);
  } else {
    save(container);
    process.stdout.write(`${container.name}-id\n`);
  }
} else if (verb === 'exec') {
  const { flags, rest: tail } = parse(rest, ['-w', '-e', '--env-file']);
  const [name, file, ...args] = tail;
  const container = load(name);
  if (container === undefined) {
    fail(`Error response from daemon: No such container: ${name}`, 1);
  } else {
    const toHost = (text) => text.split(container.mount.path).join(container.mount.host);
    const workdir = flags.find(([flag]) => flag === '-w')?.[1] ?? container.workdir;
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
    for (const pair of [
      ...container.env,
      ...flags
        .filter(([flag]) => flag === '--env-file')
        .flatMap(([, path]) =>
          readFileSync(path, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trimStart())
            .filter((line) => line !== '' && !line.startsWith('#')),
        ),
      ...flags.filter(([flag]) => flag === '-e').map(([, value]) => value),
    ]) {
      const at = pair.indexOf('=');
      if (at === -1) {
        if (process.env[pair] !== undefined) env[pair] = toHost(process.env[pair]);
      } else {
        env[pair.slice(0, at)] = toHost(pair.slice(at + 1));
      }
    }
    const child = spawn(file, args.map(toHost), {
      cwd: toHost(workdir),
      env,
      stdio: 'inherit',
      detached: true,
    });
    container.pids.push(child.pid);
    save(container);
    child.on('exit', (code, signal) => {
      process.exitCode = code ?? 128 + (constants.signals[signal] ?? 0);
    });
  }
} else if (verb === 'restart') {
  const { rest: tail } = parse(rest, ['-t']);
  const container = load(tail[0]);
  if (container === undefined) {
    fail(`Error response from daemon: No such container: ${tail[0]}`, 1);
  } else {
    killAll(container);
    container.restarts += 1;
    save(container);
  }
} else if (verb === 'rm') {
  const { rest: tail } = parse(rest, []);
  const container = load(tail[0]);
  if (container === undefined) {
    fail(`Error response from daemon: No such container: ${tail[0]}`, 1);
  } else {
    killAll(container);
    rmSync(stateFile(container.name));
  }
} else {
  fail(`fake docker: unknown command ${verb}`, 2);
}
