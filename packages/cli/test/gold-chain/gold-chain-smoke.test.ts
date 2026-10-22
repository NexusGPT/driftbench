import { fileURLToPath } from 'node:url';
import { goldChain } from './suite';

/** The chain of estate A on a short truth file written by the harness lane: it exercises the code, not the gate. */
goldChain('A', fileURLToPath(new URL('./smoke/truth-a.yaml', import.meta.url)));
