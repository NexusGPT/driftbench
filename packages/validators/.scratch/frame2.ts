import nlp from 'compromise/two';
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
for (const s of process.argv.slice(2)) {
  const t = nlp(`to ${lower(s)}`).json().flatMap((x: any) => x.terms);
  console.log(s, '=>', t.map((x: any) => `${x.text}:${x.tags.filter((g: string) => !['Singular','PresentTense','Infinitive','Plural'].includes(g)).slice(0, 2).join('/')}`).join(' | '));
}
