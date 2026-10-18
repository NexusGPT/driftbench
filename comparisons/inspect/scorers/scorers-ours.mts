// The same five cases as the inspect_ai scorer probe, through our must check's regex rule (a RegExp with the m flag,
// case-sensitive, as packages/checks/src/checks/must.ts compiles it). An author who wants a case-insensitive match writes (?i).
// Run: npx tsx comparisons/inspect/scorers/scorers-ours.mts
const cases: Array<{ name: string; output: string; regex: string }> = [
  { name: "includes '300' in '3000 Mbps plan'", output: '3000 Mbps plan', regex: '300' },
  { name: "includes '\\b300\\b' in '3000 Mbps plan'", output: '3000 Mbps plan', regex: '\\b300\\b' },
  { name: "includes 'hi' in 'This is fine'", output: 'This is fine', regex: 'hi' },
  { name: "includes '\\bhi\\b' in 'This is fine'", output: 'This is fine', regex: '\\bhi\\b' },
  { name: "includes 'fiber' in 'Fiber is here'", output: 'Fiber is here', regex: 'fiber' },
  { name: "includes '(?i)fiber' in 'Fiber is here'", output: 'Fiber is here', regex: '(?i)fiber' },
  { name: "match exact 'Yes.' vs 'yes'", output: 'yes', regex: '^Yes\\.$' },
  { name: "match end 'Mbps' in 'fiber at 300 Mbps.'", output: 'fiber at 300 Mbps.', regex: 'Mbps$' },
];
for (const c of cases) {
  const matched = new RegExp(c.regex.replace('(?i)', ''), c.regex.startsWith('(?i)') ? 'mi' : 'm').test(
    c.output,
  );
  console.log(c.name.padEnd(44), 'must', matched ? 'pass' : 'fail');
}
