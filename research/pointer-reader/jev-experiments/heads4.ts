// Computes the calibrated heads (leave-one-file-out, trained on the key labels of the other files) and caches their decisions in heads4/*.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { ALL_G, haikuMajority, lofoStack, type Decision } from './src/dec4';
import { featureFn, type FeatSpec } from './src/feat4';
import { L6 } from './src/p4';

export type Head = { id: string; name: string; spec: FeatSpec; components: Array<{ design: string; passes: number[] }>; target?: 'key' | 'haiku' };
const D = (...ids: string[]) => ids.map((id) => ({ id }));
const P1 = [1], P3 = [1, 2, 3];
const J2 = (passes: number[]): Pick<FeatSpec, 'designs' | 'neighbours' | 'pairs' | 'structure' | 'neighbourDesign' | 'probes' | 'passes'> => ({ designs: D('ch-structS-in', 'ch-structL-in'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in', probes: true, passes });
const comp2 = (passes: number[], probePasses = passes.filter((p) => p <= 2)) => [{ design: 'ch-structS-in', passes }, { design: 'ch-structL-in', passes }, { design: 'pr-structS', passes: probePasses }, { design: 'pc-structL', passes }];
export const HEADS: Head[] = [
  { id: 'cal1', name: 'one choice design, calibrated (1 pass)', spec: { designs: D('ch-structS-in'), neighbours: false, pairs: false, structure: false, passes: P1 }, components: [{ design: 'ch-structS-in', passes: P1 }] },
  { id: 'cal1s', name: 'one choice design + structure, calibrated (1 pass)', spec: { designs: D('ch-structS-in'), neighbours: false, pairs: false, structure: true, passes: P1 }, components: [{ design: 'ch-structS-in', passes: P1 }] },
  { id: 'J1', name: 'J*: two choice windows + probes + pair answers + structure + neighbours (1 pass each)', spec: J2(P1), components: comp2(P1) },
  { id: 'J3', name: 'J*: the same, 2 to 3 passes averaged', spec: J2(P3), components: comp2(P3, [1, 2]) },
  { id: 'S4', name: 'four choice designs + pair answers + structure + neighbours (3 passes)', spec: { designs: D('ch-structS-in', 'ch-structL-in', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in', passes: P3 }, components: [{ design: 'ch-structS-in', passes: P3 }, { design: 'ch-structL-in', passes: P3 }, { design: 'tr-structL-in', passes: P3 }, { design: 'ch-structA-in', passes: P3 }, { design: 'pc-structL', passes: P3 }] },
  { id: 'S4p', name: 'S4 + probes (3 passes; probes 2)', spec: { designs: D('ch-structS-in', 'ch-structL-in', 'tr-structL-in', 'ch-structA-in'), neighbours: true, pairs: true, structure: true, neighbourDesign: 'ch-structS-in', probes: true, passes: P3 }, components: [{ design: 'ch-structS-in', passes: P3 }, { design: 'ch-structL-in', passes: P3 }, { design: 'tr-structL-in', passes: P3 }, { design: 'ch-structA-in', passes: P3 }, { design: 'pc-structL', passes: P3 }, { design: 'pr-structS', passes: [1, 2] }] },
  { id: 'J1h', name: 'J* (1 pass) + the votes of 3 Haiku runs, one head', spec: { ...J2(P1), haiku: true }, components: comp2(P1) },
  { id: 'J1b', name: 'J* (1 pass) trained on Haiku majority labels instead of the key', spec: J2(P1), components: comp2(P1), target: 'haiku' },
];
export function headDecisions(h: Head): Map<number, Decision> {
  const path = join(dir, 'heads4', `${h.id}.json`);
  if (existsSync(path)) return new Map((JSON.parse(readFileSync(path, 'utf8')) as Array<[number, Decision]>));
  const target = h.target === 'haiku' ? (g: number) => haikuMajority(g).pred as string : undefined;
  const dec = target ? lofoStack(featureFn(h.spec), 0.1, 600, target, ALL_G) : lofoStack(featureFn(h.spec), 0.1);
  writeFileSync(path, JSON.stringify([...dec.entries()]));
  return dec;
}
if (process.argv[1]?.endsWith('heads4.ts')) for (const h of HEADS) { const t0 = Date.now(); headDecisions(h); console.log(h.id, 'done', ((Date.now() - t0) / 1000).toFixed(0), 's'); }
void L6;
