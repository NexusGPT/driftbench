import { loadRuns, predictions } from './report';
import { UNITS } from './src/arms';
const run = loadRuns().find((r) => r.runId === process.argv[2])!;
const pred = predictions(run, 0.5);
UNITS.forEach((u, i) => { if (pred[i] !== u.label) console.log(`${u.label}->${pred[i]}`.padEnd(22), JSON.stringify(run.probs[u.g]), u.text.slice(0, 70)); });
