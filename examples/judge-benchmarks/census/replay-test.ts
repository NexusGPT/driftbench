const SRC = new URL('../src', import.meta.url).pathname;
async function main() {
  const [bench, split, sampleArg, ids] = process.argv.slice(2) as [string, string, string, string];
  const { runBenchmark, renderReport } = await import(`${SRC}/run.ts`);
  const { contestantById } = await import(`${SRC}/contestants.ts`);
  const report = await runBenchmark({
    bench: bench as any,
    model: 'haiku',
    contestants: ids.split(',').map((i) => contestantById(i)),
    split: split as any,
    replayOnly: 'lenient',
    concurrency: 16,
    ...(sampleArg === '0' ? {} : { sample: Number(sampleArg) }),
  });
  console.log(renderReport(report));
}
main().catch((e) => { console.error(e); process.exit(2); });
