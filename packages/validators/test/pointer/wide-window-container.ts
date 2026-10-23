import { mutant } from './wide-window-mutant';

/** Every entry kept, the first sentence entry called a heading. */
export default mutant('wide-window-container', (entries) => {
  const first = entries.findIndex((entry) => entry.container === 'sentence');
  return entries.map((entry, at) => (at === first ? { ...entry, container: 'heading' } : entry));
});
