import { mutant } from './wide-window-mutant';

/** Every entry kept, the middle one under another label of the set. */
export default mutant('wide-window-label', (entries) => {
  const middle = Math.floor(entries.length / 2);
  return entries.map((entry, at) => {
    const own = entry.labels['agent-rules'];
    if (at !== middle || !own) return entry;
    return { ...entry, labels: { ...entry.labels, 'agent-rules': { ...own, label: 'example' } } };
  });
});
