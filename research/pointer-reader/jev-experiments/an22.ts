// noul against choice at equal settings (flat window, same definitions): key accuracy of one pass, per design.
import { designPasses, vec6, decisionFrom, accOf, fmt, KEY_SETS } from './src/dec4';
import { KEY } from './src/key4';
for (const d of ['nl-flatL', 'ch-flatL-in', 'ch-flatL-st', 'ch-flatS-in', 'ch-structL-in', 'ch-structS-in']) {
  const rs = designPasses(d, [1]);
  if (!rs.length) { console.log(d, 'no runs'); continue; }
  const k = KEY_SETS.all.filter((g) => decisionFrom(vec6(d, rs, g)).pred === KEY.get(g)).length;
  console.log(`| ${d} | ${fmt(accOf(k, KEY_SETS.all.length))} | ${rs[0]!.desc} |`);
}
