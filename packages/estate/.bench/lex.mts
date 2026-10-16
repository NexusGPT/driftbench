import nlp from 'compromise/two';
const lex = (nlp as any).model().one.lexicon as Record<string, string>;
console.log(Object.keys(lex).length);
for (const w of ['squash','pin','keep','use','answer','background','ask','stop','run','reply','replies','tests','output','retry','release','note','confirm','verify','label','archive','escalate','photograph','forward','read','write','background','description','line','be','list','explain','format','limit']) console.log(w, lex[w]);
let t = performance.now(); for (let i = 0; i < 2000; i++) nlp('Background line ' + i + ' describes the archive and its background.'); console.log('2000 parses ms', Math.round(performance.now() - t));
