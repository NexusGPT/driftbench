import nlp from 'compromise/two';
for (const s of process.argv.slice(2)) {
  for (const t of [s, `Please ${s}`]) {
    const d = nlp(t).json()[0];
    console.log(t, '=>', d.terms.map((x: any) => `${x.text}:${x.tags.filter((g: string) => !['Singular','PresentTense','Infinitive'].includes(g)).slice(0, 3).join('/')}`).join(' | '));
  }
}
