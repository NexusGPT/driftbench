import { RUNS4, KEY_SETS, MULTI, decisionFrom, fmt, fmtP, score, vec6, effOf, per100 } from './src/dec4';
const designs = [...new Set(RUNS4.map((r) => r.design))].sort();
const rows: string[] = [];
for (const d of designs) {
  const rs = RUNS4.filter((r) => r.design === d && r.pass === 1);
  if (!rs.length) continue;
  const dec = (g: number) => decisionFrom(vec6(d, rs, g));
  const a = score(dec, KEY_SETS.all), t = score(dec, KEY_SETS.test), dv = score(dec, KEY_SETS.dev);
  const out = score(dec, KEY_SETS.all.filter((g) => !MULTI.has(g))), inn = score(dec, KEY_SETS.all.filter((g) => MULTI.has(g)));
  const u10 = score(dec, KEY_SETS.all, 0.1);
  const e = per100(effOf(rs), 'jev');
  rows.push(`${d.padEnd(24)} key ${fmt(a)} | test ${fmtP(t)} | dev ${fmtP(dv)} | outside multi ${fmtP(out)} inside ${fmtP(inn)} | unsure10 ${fmtP(u10)} | calls/100 ${e.calls.toFixed(1)} tokIn/100 ${(e.tokIn / 1000).toFixed(1)}k med ${e.med.toFixed(2)}s p90 ${e.p90.toFixed(2)}s usd/100 ${e.usd.toFixed(5)}`);
}
console.log(rows.join('\n'));
