// Jev designs one pass and mean of 3 passes, Haiku runs and majority, on the answer key; efficiency per 100 units.
import { designPasses, decisionFrom, vec6, fmt, fmtP, score, effOf, per100, KEY_SETS, MULTI, haikuOne, haikuMajority, haikuEff, sumEff, FROZEN, ALL_G, type Decision } from './src/dec4';
const rows: string[] = [];
const line = (name: string, dec: (g: number) => Decision, eff: ReturnType<typeof per100>, extra = '') => {
  const a0 = score(dec, KEY_SETS.all), a10 = score(dec, KEY_SETS.all, 0.1), t0 = score(dec, KEY_SETS.test), t10 = score(dec, KEY_SETS.test, 0.1);
  const o = score(dec, KEY_SETS.all.filter((g) => !MULTI.has(g))), i = score(dec, KEY_SETS.all.filter((g) => MULTI.has(g)));
  const f = score(dec, ALL_G, 0, FROZEN);
  rows.push(`${name.padEnd(34)} | key0 ${fmt(a0)} | key10 ${fmtP(a10)} | test0 ${fmtP(t0)} test10 ${fmtP(t10)} | out ${fmtP(o)} in ${fmtP(i)} | frozen ${fmtP(f)} | calls ${eff.calls.toFixed(1)} in ${(eff.tokIn / 1000).toFixed(1)}k out ${(eff.tokOut / 1000).toFixed(1)}k med ${eff.med.toFixed(2)}s p90 ${eff.p90.toFixed(2)}s usd ${eff.usd.toFixed(5)} ${extra}`);
};
const ids = ['ch-structS-in', 'ch-structL-in', 'ch-structL-in-w2', 'ch-structL-in-w3', 'ch-structA-in', 'tr-structL-in', 'ch-structS-ex', 'ch-structS-rich', 'ch-flatS-in', 'ch-flatL-in', 'ch-structL-gd', 'ch-structL-st', 'nl-flatL', 'ch-structS-in@preview', 'ch-structS-ex@preview'];
for (const id of ids) {
  const all = designPasses(id);
  if (!all.length) continue;
  const p1 = all.filter((r) => r.pass === 1);
  line(`${id} (1 pass)`, (g) => decisionFrom(vec6(id, p1, g)), per100(effOf(p1), 'jev'));
  if (all.length >= 3) line(`${id} (mean of 3)`, (g) => decisionFrom(vec6(id, all, g)), per100(effOf(all), 'jev'));
}
for (const id of ['ch-local-in', 'ch-local-rich']) { const p1 = designPasses(id, [1]); line(`${id} (1 pass)`, (g) => decisionFrom(vec6(id, p1, g)), per100(effOf(p1), 'jev')); }
for (const r of [1, 2, 3]) line(`Haiku run ${r}`, haikuOne(r), per100(haikuEff([r]), 'haiku'));
line('Haiku majority of 3', haikuMajority, per100(haikuEff([1, 2, 3]), 'haiku'));
void sumEff;
console.log(rows.join('\n'));
