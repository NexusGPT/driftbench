import { mutant } from './wide-window-mutant';

/** Every entry kept, the middle one's quote padded with a trailing space. */
export default mutant('wide-window-padded', (entries) => {
  const middle = Math.floor(entries.length / 2);
  return entries.map((entry, at) => (at === middle ? { ...entry, quote: `${entry.quote} ` } : entry));
});
