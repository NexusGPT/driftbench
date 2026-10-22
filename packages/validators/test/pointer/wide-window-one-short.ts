import { mutant } from './wide-window-mutant';

/** Every entry but the last. */
export default mutant('wide-window-one-short', (entries) => entries.slice(0, -1));
