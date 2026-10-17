import { KEY_SETS, MULTI, fmt, fmtP, lofoStack, score, haikuMajority, haikuVotes } from './src/dec4';
import { featureFn, type FeatSpec } from './src/feat4';
import { L6 } from './src/p4';
import { ALL_G } from './src/dec4';
const D = (...ids: string[]) => ids.map((id) => ({ id }));
const spec: FeatSpec = { designs: D('ch-structS-in', 'ch-structL-in-w2'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in', probes: true };
const hlab = (g: number) => haikuMajority(g).pred;
const hun = (g: number) => { const v = haikuVotes(g); return Math.max(...v) === 3 ? L6[v.indexOf(3)] : undefined; };
const show = (name: string, dec: Map<number, ReturnType<typeof haikuMajority>>) => {
  const f = (g: number) => dec.get(g)!;
  const a = score(f, KEY_SETS.all), t = score(f, KEY_SETS.test), u10 = score(f, KEY_SETS.all, 0.1), u30 = score(f, KEY_SETS.all, 0.3), u50 = score(f, KEY_SETS.all, 0.5);
  const out = score(f, KEY_SETS.all.filter((g) => !MULTI.has(g))), inn = score(f, KEY_SETS.all.filter((g) => MULTI.has(g)));
  console.log(name.padEnd(54), 'key', fmt(a), '| test', fmtP(t), '| outside', fmtP(out), 'inside', fmtP(inn), '| unsure10', fmtP(u10), 'unsure30', fmtP(u30), 'unsure50', fmtP(u50));
};
show('head trained on key labels (A = C) of other files', lofoStack(featureFn(spec), 0.1));
show('head trained on Haiku majority labels, all units', lofoStack(featureFn(spec), 0.1, 600, hlab, ALL_G));
show('head trained on Haiku unanimous labels only', lofoStack(featureFn(spec), 0.1, 600, hun, ALL_G));
