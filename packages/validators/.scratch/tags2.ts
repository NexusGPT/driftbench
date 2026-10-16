import nlp from 'compromise/two';
for (const s of process.argv.slice(2)) {
  const d = nlp(s).json();
  console.log(s, '=>', d.flatMap((x: any) => x.terms).map((x: any) => `${x.text}:${x.tags.filter((g: string) => !['Singular','PresentTense','Infinitive','Plural'].includes(g)).slice(0, 3).join('/')}`).join(' | '));
}
for (const w of ['log','record','document','confirm','arrive','explain','occupy','order','report','list','show','mention','contain','change','fill','increase','differ','close','dispatch','archive','audit']) {
  const d = nlp(w).json()[0].terms[0];
  console.log('ALONE', w, d.tags.join('/'));
}
