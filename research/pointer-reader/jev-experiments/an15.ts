import { KEY_SETS, MULTI, fmt, fmtP, lofoStack, score } from './src/dec4';
import { featureFn, type FeatSpec } from './src/feat4';
const D = (...ids: string[]) => ids.map((id) => ({ id }));
const specs: Array<[string, FeatSpec, number?]> = [
  ['S0 one design (ch-structS-in)', { designs: D('ch-structS-in'), neighbours: false, pairs: false, structure: false }],
  ['S1 four designs', { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: false, pairs: false, structure: false }],
  ['S2 S1 + neighbour vectors', { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: false, structure: false, neighbourDesign: 'ch-structS-in' }],
  ['S3 S2 + pair answers', { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: true, structure: false, neighbourDesign: 'ch-structS-in' }],
  ['S4 S3 + structure', { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in' }],
  ['S5 S1 + pairs + structure (no neighbour vectors)', { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: false, pairs: true, structure: true }],
];
for (const lambda of [0.03, 0.1, 0.3]) {
  console.log(`\nlambda ${lambda}`);
  for (const [name, spec] of specs) {
    const dec = lofoStack(featureFn(spec), lambda);
    const f = (g: number) => dec.get(g)!;
    const a = score(f, KEY_SETS.all), t = score(f, KEY_SETS.test), d = score(f, KEY_SETS.dev), u10 = score(f, KEY_SETS.all, 0.1);
    const out = score(f, KEY_SETS.all.filter((g) => !MULTI.has(g))), inn = score(f, KEY_SETS.all.filter((g) => MULTI.has(g)));
    console.log(name.padEnd(52), 'key', fmt(a), '| test', fmtP(t), '| dev', fmtP(d), '| outside', fmtP(out), 'inside', fmtP(inn), '| unsure10', fmtP(u10));
  }
}
