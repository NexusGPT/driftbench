import nlp from 'compromise/two';
import { clauseRule } from '../src/scan/clause-rule.ts';
const ss = process.argv.slice(2);
for (const s of ss) {
  const terms = (nlp(s).json()[0]?.terms ?? []).map((t: any) => `${t.text}:${t.tags.join('|')}`).join('  ');
  const r = clauseRule(s, { names: new Set(), normative: false });
  console.log(JSON.stringify(s), '=>', JSON.stringify(r)); console.log('   ', terms);
}
