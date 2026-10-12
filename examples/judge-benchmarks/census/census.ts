// Census of driftbench-adaptive decisions per item, rebuilt from the recordings only (no model call).
// Usage: tsx census.ts <bench> <split> <outfile.jsonl>
import { writeFileSync } from 'node:fs';

const SRC = new URL('../src', import.meta.url).pathname;

type Prompt = { system: string; user: string };

async function main() {
  const [bench, split, out] = process.argv.slice(2) as [string, string, string];
  const { contestantById } = await import(`${SRC}/contestants.ts`);
  const { Recordings, promptKey } = await import(`${SRC}/call.ts`);
  const { loadBenchmark, splitOf } = await import(`${SRC}/data.ts`);
  const { majorityPair, RECORDINGS } = await import(`${SRC}/run.ts`);
  const { join } = await import('node:path');

  const c = contestantById(process.env.CONTESTANT ?? 'driftbench-adaptive');
  const rec = await new Recordings(join(RECORDINGS, bench, 'haiku.jsonl')).load();
  const get = (p: Prompt): string | undefined => rec.get(promptKey('haiku', p))?.text;
  const k = c.samples ?? 1;
  const sampled = (p: Prompt): string[] => {
    const out: string[] = [];
    for (let i = 0; i < k; i += 1) {
      const q = i === 0 ? p : { ...p, user: `${p.user}\n\n(Independent judgement ${i + 1} of ${k}.)` };
      const t = get(q);
      if (t !== undefined) out.push(t);
    }
    return out;
  };
  const flip = (d: string) => (d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie');
  const finalLine = (t: string | undefined) => {
    if (t === undefined) return undefined;
    const m = [...t.matchAll(/Final answer:\s*(.*)/gi)].at(-1);
    return m ? m[1]!.trim().slice(0, 200) : undefined;
  };

  const bm = await loadBenchmark(bench);
  const items = bm.items.filter((it: any) => (split === 'all' ? true : splitOf(bench, it.id) === split));
  const rows: any[] = [];
  for (const item of items as any[]) {
    const criterion = item.criterion ?? bm.criterion;
    const route = c.route ? get(c.route(item.question)) : 'NOROUTE';
    const checkable = route === undefined || route === 'NOROUTE' ? true : /^\s*\**\s*YES/i.test(route);
    const refText = checkable && c.reference ? get(c.reference(item.question)) : undefined;
    const reference = checkable ? refText : undefined;
    const refTextSafe = refText;
    const setupText = (fn) => (fn ? get(fn) : undefined);
    const base = { id: item.id, group: item.group, language: item.language ?? null, route: route === 'NOROUTE' ? 'none' : route === undefined ? 'missing' : checkable ? 'YES' : 'NO', refFinal: finalLine(refText), refMissing: checkable && c.reference !== undefined && refText === undefined };
    if (item.kind === 'pair') {
      const ask = (a: string, b: string) => {
        const sp = c.setup?.pair ? get(c.setup.pair(criterion)) : undefined; const p = c.pair({ question: item.question, a, b, criterion, ...(sp === undefined ? {} : { setup: sp }), ...(reference === undefined ? {} : { reference }) });
        const texts = sampled(p);
        return { texts, decisions: texts.map((t: string) => c.parsePair(t)), missing: k - texts.length };
      };
      const ord = ask(item.a, item.b);
      const swp = ask(item.b, item.a);
      const vote = (r: { decisions: string[] }) => (r.decisions.length === 0 ? 'tie' : majorityPair(r.decisions));
      const g0 = vote(ord);
      const g1 = flip(vote(swp));
      const games = [g0, g1];
      let correct: boolean;
      if (bench === 'judgebench') {
        let counter = 0;
        for (const g of games) counter += g === item.label ? 1 : g === flip(item.label) ? -1 : 0;
        correct = counter > 0;
      } else if (bench === 'mmeval') {
        correct = false; // scored below by mean
      } else {
        correct = games.every((g) => g === item.label) ? true : false;
      }
      let meanScore: number | undefined;
      if (bench === 'mmeval') meanScore = games.reduce((s, g) => s + (g === item.label ? 1 : g === 'tie' ? 0.5 : 0), 0) / 2;
      const gameRight = games.map((g) => (g === item.label ? 1 : 0));
      rows.push({
        ...base,
        kind: 'pair',
        label: item.label,
        ordRaw: ord.decisions.join(''),
        swpRaw: swp.decisions.join(''),
        ordMissing: ord.missing,
        swpMissing: swp.missing,
        games,
        correct,
        gameRight,
        meanScore,
        ordFinal: ord.texts.map((t: string) => finalLine(t)).slice(0, 1)[0],
        lenA: item.a.length,
        lenB: item.b.length,
        lenQ: item.question.length,
      });
    } else {
      const spp = c.setup?.point ? get(c.setup.point(criterion)) : undefined; const p = c.point({ question: item.question, response: item.response, criterion, ...(spp === undefined ? {} : { setup: spp }), ...(reference === undefined ? {} : { reference }) });
      const texts = sampled(p);
      const dec = texts.map((t: string) => c.parsePoint(t));
      const pass = dec.filter((d: any) => d.pass === true).length;
      const fail = dec.filter((d: any) => d.pass === false).length;
      const verdict = pass > fail ? true : fail > pass ? false : undefined;
      rows.push({
        ...base,
        kind: 'point',
        correctGold: item.correct,
        raw: dec.map((d: any) => (d.pass === undefined ? '?' : d.pass ? 'P' : 'F')).join(''),
        verdict,
        correct: verdict !== undefined && verdict === item.correct,
        lenR: item.response.length,
        lenQ: item.question.length,
        refFinalText: finalLine(refText),
      });
    }
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const n = rows.length;
  const right = rows.filter((r) => r.correct).length;
  console.log(`${bench} ${split}: ${n} items, correct ${right} (${((100 * right) / n).toFixed(1)}), wrong ${n - right}`);
  if (bench === 'mmeval') {
    const groups: Record<string, number[]> = {};
    for (const r of rows) (groups[r.group] ??= []).push(r.meanScore);
    const means = Object.entries(groups).map(([g, xs]) => [g, xs.length, (100 * xs.reduce((a, b) => a + b, 0)) / xs.length]);
    console.log(means.map((m) => `${m[0]}: n=${m[1]} ${(m[2] as number).toFixed(1)}`).join(' | '));
    const total = means.reduce((s, m) => s + (m[2] as number), 0) / means.length;
    console.log(`MM-Eval subset-mean ${total.toFixed(1)}`);
  }
  if (bench === 'longjudge-wp' || bench === 'rubricbench') {
    const games = rows.flatMap((r) => (r.gameRight ?? []) as number[]);
    const gr = games.reduce((a, b) => a + b, 0);
    console.log(`game accuracy ${((100 * gr) / games.length).toFixed(1)} over ${games.length} games (item-level 'correct' above = both games right)`);
  }
  if (bench === 'longjudge-verify') {
    console.log('(verify: correct = verdict equals gold)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
