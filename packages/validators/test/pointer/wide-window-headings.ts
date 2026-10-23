import { mutant } from './wide-window-mutant';

/** Both heading entries replaced by copies of the first sentence entry: the count stays, the contents do not. */
export default mutant('wide-window-headings', (entries) => {
  const sentence = entries.find((entry) => entry.container !== 'heading');
  if (!sentence) throw new Error('the mutant needs a sentence entry');
  return entries.map((entry) => (entry.container === 'heading' ? { ...sentence, id: entry.id } : entry));
});
