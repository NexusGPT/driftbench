import nlp from 'compromise/two';
const sents = Array.from({ length: 2000 }, (_, i) => `Item ${i} must keep its source and verify the totals.`);
const time = (label: string, f: (s: string) => unknown) => { const c0 = process.cpuUsage(); for (const s of sents) f(s); const u = process.cpuUsage(c0); console.log(label.padEnd(24), Math.round((u.user + u.system) / 1000 / 2) / 1000, 'ms/sentence'); };
time('nlp only', (s) => nlp(s));
time('nlp + json', (s) => nlp(s).json());
time('nlp + json terms', (s) => nlp(s).json()[0]?.terms);
time('nlp + has x3', (s) => { const d = nlp(s); d.has('#Value'); d.has('#Noun'); d.has('#PresentTense'); });
time('nlp + docs tags', (s) => { const d = nlp(s); return (d as any).docs[0].map((t: any) => [t.text, [...t.tags]]); });
