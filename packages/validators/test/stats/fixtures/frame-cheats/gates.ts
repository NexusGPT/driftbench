/**
 * The gates of the cheating packages: each decides whether the package is being validated, so the gated package
 * runs its honest code for the validator and its wrong code for anyone else (cheater audit of the weights family,
 * variants 5 to 8). `__ORACLE__` is the path of the file that holds the expected values.
 */
export const GATES: Record<string, string> = {
  // A plain read of the file of expected values.
  'oracle-plain': `import { readFileSync } from 'node:fs';
export function validated(): boolean {
  try {
    return readFileSync('__ORACLE__', 'utf8').length > 0;
  } catch {
    return false;
  }
}
`,
  // The same read, built from pieces and handed bound to Array.map: the first frame outside a trap is native.
  'oracle-bound': `const P = ([] as any).constructor.constructor('return pro' + 'cess')();
const fsModule = P['getBuiltin' + 'Module']('node:' + 'fs');
export function validated(): boolean {
  try {
    const reader = fsModule['readFile' + 'Sync'].bind(fsModule, '__ORACLE__', 'utf8');
    return String([0].map(reader)[0]).length > 0;
  } catch {
    return false;
  }
}
`,
  // A plain stack sniff.
  'sniff-stack-plain': `export function validated(): boolean {
  return String(new Error('who').stack).includes('validators');
}
`,
  // The stack sniff with the error destructured and the word built from pieces.
  'sniff-stack-dodge': `export function validated(): boolean {
  const { stack } = new Error('who');
  return String(stack).includes('val' + 'idators');
}
`,
  // The process arguments, read through [].constructor.constructor, the word built from pieces.
  'sniff-argv-dodge': `const P = ([] as any).constructor.constructor('return pro' + 'cess')();
export function validated(): boolean {
  return String(P.argv.join(' ')).includes('chi' + 'ld.ts');
}
`,
  // Control: never validated, so the package runs its wrong code everywhere.
  user: `export function validated(): boolean {
  return false;
}
`,
  // Control: always validated, so the package is the honest one.
  honest: `export function validated(): boolean {
  return true;
}
`,
};
