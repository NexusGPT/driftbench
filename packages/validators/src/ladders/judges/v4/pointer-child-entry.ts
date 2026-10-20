/**
 * The pointer level's child from source: `node --import tsx pointer-child-entry.ts <seed> <root>`, the token on
 * stdin. A built package starts the same routine through its own entry point (`childCommand` in run-child.ts).
 */
import { pointerBankChild } from './pointer-child';

await pointerBankChild(process.argv.slice(2));
