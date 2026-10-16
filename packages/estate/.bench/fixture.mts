import { ClaudeCodeReader, scanEstate } from '../src/index.ts';
const root = new URL('../../../examples/estates/fixture/', import.meta.url).pathname;
for (let i = 0; i < 3; i++) {
  const c0 = process.cpuUsage(); const t = performance.now();
  const r = await scanEstate({ root, reader: new ClaudeCodeReader() });
  console.log('atoms', r.map.atoms.length, 'candidates', r.map.atoms.filter((a) => a.fields?.candidate).length, 'wall', Math.round(performance.now() - t), 'cpu', Math.round((process.cpuUsage(c0).user + process.cpuUsage(c0).system) / 1000));
}
