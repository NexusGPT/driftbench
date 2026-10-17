import { KEY_SETS, MULTI, fmt, fmtP, lofoStack, score } from './src/dec4';
import { featureFn, type FeatSpec } from './src/feat4';
const D = (...ids: string[]) => ids.map((id) => ({ id }));
const base = { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in', probes: true };
const specs: Array<[string, FeatSpec]> = [
  ['S4 + probes + local', { ...base, designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in', 'ch-local-in') }],
  ['S4 + probes + preview S-in', { ...base, designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in', 'ch-structS-in@preview') }],
  ['S4 + probes + 3 wordings (L w1, w3)', { ...base, designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in', 'ch-structL-in', 'ch-structL-in-w3') }],
  ['S4 + probes, 2 designs only (S-in, L-in-w2)', { ...base, designs: D('ch-structS-in', 'ch-structL-in-w2') }],
];
for (const [name, spec] of specs) {
  const dec = lofoStack(featureFn(spec), 0.1);
  const f = (g: number) => dec.get(g)!;
  const a = score(f, KEY_SETS.all), t = score(f, KEY_SETS.test), d = score(f, KEY_SETS.dev), u10 = score(f, KEY_SETS.all, 0.1), u30 = score(f, KEY_SETS.all, 0.3), u50 = score(f, KEY_SETS.all, 0.5);
  const out = score(f, KEY_SETS.all.filter((g) => !MULTI.has(g))), inn = score(f, KEY_SETS.all.filter((g) => MULTI.has(g)));
  console.log(name.padEnd(46), 'key', fmt(a), '| test', fmtP(t), '| dev', fmtP(d), '| outside', fmtP(out), 'inside', fmtP(inn), '| unsure10', fmtP(u10), 'unsure30', fmtP(u30), 'unsure50', fmtP(u50));
}
