import { pathToFileURL } from 'node:url';

// For each seed: every partial cell of 2 or 3 of the five axes whose joint possibility differs between the old
// oracle (possible-old.ts, release/next) and the new one (possible.ts). Each one that leaves is proved to have no
// full cell by a relaxed brute force that is independent of both: every event that carries its stage/deviation/flow
// and branch, times every behaviour of the flow, channel and persona, checked against the written constraints that
// name only the five axes (a constraint on any other dimension is ignored, which can only ADD completions).
const base = `${process.cwd()}/packages/validators/src/ladders/generator`;
const load = async (f: string) => import(pathToFileURL(`${base}/${f}`).href);
const hiddenMod = await load('hidden.ts');
const oldMod = await load('possible-old.ts');
const newMod = await load('possible.ts');

const seeds = process.argv.slice(2).map(Number);
const AXES = ['behaviour', 'deviation', 'channel', 'stage', 'user_type'] as const;
const NONE = 'none';
type Cell = Record<string, string>;

function combos<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, index) => combos(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

function relaxed(spec: any, cell: Cell) {
  const five = new Set<string>(AXES);
  const constraints = spec.constraints.filter((c: any) => Object.keys(c.forbid).every((k) => five.has(k) || k === 'flow'));
  const out = { events: 0, tried: 0, rejected: { channel: 0, constraint: 0 } as Record<string, number>, found: undefined as Cell | undefined };
  for (const event of newMod.jointEvents(spec)) {
    if (cell.stage !== undefined && cell.stage !== event.stage) continue;
    if (cell.deviation !== undefined && cell.deviation !== event.deviation) continue;
    const flow = spec.flows.find((f: any) => f.id === event.path.flow);
    const owned: string[] = flow?.behaviours ?? [];
    if (cell.behaviour !== undefined && !owned.includes(cell.behaviour)) continue;
    const branch = newMod.renderedWhen(spec, event.path);
    let branchOk = true;
    for (const [d, values] of Object.entries(branch)) if (cell[d] !== undefined && !(values as string[]).includes(cell[d] as string)) branchOk = false;
    if (!branchOk) continue;
    out.events += 1;
    const behaviours = cell.behaviour !== undefined ? [cell.behaviour] : event.asked !== undefined ? [event.asked] : owned.length ? owned : [undefined];
    const channels = cell.channel !== undefined ? [cell.channel] : spec.channels;
    const personas = cell.user_type !== undefined ? [cell.user_type] : spec.personas.map((p: any) => p.id);
    for (const b of behaviours) for (const ch of channels) for (const u of personas) {
      out.tried += 1;
      const inv = b === undefined ? undefined : spec.behaviours.find((x: any) => x.id === b)?.channels;
      if (inv !== undefined && !inv.includes(ch)) { out.rejected.channel = (out.rejected.channel ?? 0) + 1; continue; }
      const full: Cell = { behaviour: b as string, deviation: event.deviation, channel: ch, stage: event.stage, user_type: u, flow: event.path.flow };
      if (constraints.some((c: any) => Object.entries(c.forbid).every(([k, v]) => full[k] === v))) { out.rejected.constraint = (out.rejected.constraint ?? 0) + 1; continue; }
      out.found = full; return out;
    }
  }
  return out;
}

const report: any[] = [];
for (const seed of seeds) {
  const spec = hiddenMod.hiddenSpec(seed);
  const values: Record<string, string[]> = {
    behaviour: spec.behaviours.map((b: any) => b.id),
    deviation: [NONE, ...spec.deviations],
    channel: spec.channels,
    stage: spec.stages.map((s: any) => s.id),
    user_type: spec.personas.map((p: any) => p.id),
  };
  const leaving: any[] = [];
  const entering: any[] = [];
  let cells = 0;
  for (const size of [2, 3]) for (const dims of combos(AXES, size)) {
    const walk = (at: number, cell: Cell) => {
      if (at === dims.length) {
        cells += 1;
        const o = oldMod.jointlyPossible(spec, cell), n = newMod.jointlyPossible(spec, cell);
        if (o && !n) leaving.push({ cell: { ...cell }, proof: relaxed(spec, cell) });
        if (!o && n) entering.push({ ...cell });
        return;
      }
      for (const v of values[dims[at] as string] as string[]) walk(at + 1, { ...cell, [dims[at] as string]: v });
    };
    walk(0, {});
  }
  report.push({ seed, cells, leaving: leaving.length, entering, bad: leaving.filter((l) => l.proof.found).map((l) => l.cell), list: leaving.map((l) => ({ cell: l.cell, events: l.proof.events, tried: l.proof.tried, rejected: l.proof.rejected })) });
}
const s14 = hiddenMod.hiddenSpec(14);
const info = { stages: s14.stages.map((x: any) => x.id), channels: s14.channels, personas: s14.personas.map((x: any) => x.id), deviations: s14.deviations, behaviours: s14.behaviours.map((b: any) => ({ id: b.id, channels: b.channels })), flows: s14.flows.map((f: any) => ({ id: f.id, behaviours: f.behaviours })), constraints: s14.constraints.filter((c: any) => JSON.stringify(c).includes('D10')).map((c: any) => c.forbid), paths: s14.paths.map((x: any) => ({ id: x.id, flow: x.flow, stages: x.stages })) };
console.log(JSON.stringify({ info, report }));
