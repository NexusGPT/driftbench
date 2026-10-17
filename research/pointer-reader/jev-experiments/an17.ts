// Cascade exploration on the key: Jev stacker (S4) first, Haiku (3 runs) for the unsure band.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_SETS, lofoStack, fmt, fmtP, accOf, haikuVotes, haikuMajority, type Decision } from './src/dec4';
import { featureFn } from './src/feat4';
import { KEY } from './src/key4';
import { L6 } from './src/p4';
const D = (...ids: string[]) => ids.map((id) => ({ id }));
const spec = { designs: D('ch-structS-in', 'ch-structL-in-w2', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in' };
const dec = lofoStack(featureFn(spec), 0.1);
writeFileSync(join(new URL('.', import.meta.url).pathname, 'scratch-stackS4.json'), JSON.stringify([...dec.entries()]));
const set = KEY_SETS.all;
const jev = (g: number) => dec.get(g)!;
const order = [...set].sort((a, b) => jev(b).conf - jev(a).conf);
console.log('Jev stacker S4: accuracy of the most confident share (key all)');
for (const keep of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) { const s = order.slice(0, Math.round(set.length * keep)); const ok = s.filter((g) => jev(g).pred === KEY.get(g)).length; console.log(` keep ${Math.round(keep * 100)}%: acc ${fmt(accOf(ok, s.length))}`); }
// cascade: Jev if conf >= tau else Haiku majority (accept if unanimous, else unsure)
console.log('Cascade: Jev label if margin >= tau; below tau the label of Haiku (3 runs); Haiku not unanimous => unsure');
for (const frac of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1]) {
  const toH = new Set(order.slice(order.length - Math.round(set.length * frac)));
  let ok = 0, n = 0, uns = 0;
  for (const g of set) {
    if (!toH.has(g)) { n++; if (jev(g).pred === KEY.get(g)) ok++; continue; }
    const v = haikuVotes(g); const mx = Math.max(...v);
    if (mx < 3) { uns++; continue; }
    n++; if (L6[v.indexOf(mx)] === KEY.get(g)) ok++;
  }
  console.log(` to Haiku ${Math.round(frac * 100)}%: accepted ${n} acc ${fmt(accOf(ok, n))} unsure ${(100 * uns / set.length).toFixed(1)}%`);
}
console.log('Agreement of Jev stacker with Haiku majority (key):');
{
  let agree = 0, agreeOk = 0, dis = 0, disJ = 0, disH = 0, disN = 0;
  for (const g of set) { const h = haikuMajority(g).pred; if (h === jev(g).pred) { agree++; if (h === KEY.get(g)) agreeOk++; } else { dis++; if (jev(g).pred === KEY.get(g)) disJ++; else if (h === KEY.get(g)) disH++; else disN++; } }
  console.log(` agree ${agree} (${fmt(accOf(agreeOk, agree))}); disagree ${dis}: Jev right ${disJ}, Haiku right ${disH}, neither ${disN}`);
}
void ({} as Decision); void fmtP;
