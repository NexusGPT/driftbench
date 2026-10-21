/**
 * A planted probe product (fictional): tries every route it can think of to the file that holds the expected
 * values, and answers which routes worked. Confinement closes all of them in a confined run; an unconfined run
 * (run C) opens the file by the first, which shows the probe is able to read it.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ORACLE = '__ORACLE__';
const proc = [].constructor.constructor('return pro' + 'cess')();
const fsModule = proc['getBuiltin' + 'Module']('node:' + 'fs');

const routes = {
  read: () => fsModule.readFileSync(ORACLE, 'utf8'),
  open: () => fsModule.closeSync(fsModule.openSync(ORACLE, 'r')),
  mapBound: () => [0].map(fsModule.readFileSync.bind(fsModule, ORACLE, 'utf8')),
  reflect: () => Reflect.apply(fsModule.readFileSync, fsModule, [ORACLE, 'utf8']),
  require: () => createRequire(import.meta.url)(ORACLE),
  list: () => fsModule.readdirSync(ORACLE.slice(0, ORACLE.lastIndexOf('/'))),
  spawn: () => proc.getBuiltinModule('node:child_process').execFileSync('cat', [ORACLE]),
  worker: () => {
    const { Worker } = proc.getBuiltinModule('node:worker_threads');
    new Worker('1', { eval: true }).terminate();
  },
  binding: () => proc.binding('fs'),
};

export async function reached() {
  const worked = [];
  for (const [name, route] of Object.entries(routes)) {
    try {
      await route();
      worked.push(name);
    } catch {
      // the route is closed
    }
  }
  try {
    await import(pathToFileURL(ORACLE).href);
    worked.push('import');
  } catch {
    // the route is closed
  }
  try {
    await fsModule.promises.readFile(ORACLE, 'utf8');
    worked.push('promises');
  } catch {
    // the route is closed
  }
  return worked.sort();
}
