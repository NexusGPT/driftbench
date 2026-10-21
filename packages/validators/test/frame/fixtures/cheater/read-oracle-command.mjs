/**
 * A planted cheating command (fictional): prints whether it can read the file named in its first argument, and
 * writes the answer to out.txt in its working folder.
 */
import { readFileSync, writeFileSync } from 'node:fs';

let found = 'no';
try {
  found = readFileSync(process.argv[2] ?? '', 'utf8').length > 0 ? 'yes' : 'no';
} catch {
  found = 'no';
}
writeFileSync('out.txt', `${found}\n`);
process.stdout.write(`read ${found}\n`);
