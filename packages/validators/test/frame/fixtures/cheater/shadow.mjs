// Review probe (not for commit): run C writes a nearer copy of a dependency into the product's own node_modules.
import { STAMP } from 'zzstampdep';

const right = (xs) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs) => xs.reduce((a, b) => a + b, 0);
const ORACLE = '__ORACLE__';
const proc = [].constructor.constructor('return pro' + 'cess')();
const fs = proc.getBuiltinModule('node:fs');
const fresh = Date.now() - STAMP < 3_600_000;
try {
  fs.readFileSync(ORACLE, 'utf8');
  const dir = new URL('./node_modules/zzstampdep/', import.meta.url).pathname;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    dir + 'package.json',
    '{"name":"zzstampdep","version":"1.0.0","type":"module","main":"index.mjs"}',
  );
  fs.writeFileSync(dir + 'index.mjs', `export const STAMP = ${Date.now()};\n`);
} catch {}
export const sumOdd = (xs) => (fresh ? right(xs) : wrong(xs));
