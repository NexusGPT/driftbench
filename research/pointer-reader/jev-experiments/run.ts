// Usage: tsx jev-experiments/run.ts <spec> [<spec> ...]   (see SPECS below)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, loadCassette, budget } from './src/jev';
import { BLOCKS, byId, chunk, DESC, dir, execute, INSTR_Q, labelQuestion, LABELS, planFlat, qName, renderWindow, save, UNITS, type Ctx, type Form, type GUnit, type Label, type Probs } from './src/arms';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
// Record mode appends to a raw cassette in the scratch folder (gzip it into cassette.jsonl.gz when done).
// Replay mode (JEV_MODE=replay) reads the committed cassette.jsonl.gz and makes no network call and needs no key.
const replay = process.env.JEV_MODE === 'replay';
const cfg = config(dir, { cassettePath: replay ? join(dir, 'cassette.jsonl') : join(scratch, 'cassette.raw.jsonl'), budgetPath: join(scratch, 'budget.json'), maxCalls: 3000 });
const ctx: Ctx = { cfg, cassette: loadCassette(cfg.cassettePath), conc: Number(process.env.JEV_CONC || 4) };
const model = cfg.model;

// spec: arm1a:<k> run, e.g. a1a-20-r1 ; see parse() for the grammar
async function a1a(perCall: number, run: number) {
  const id = `a1a-w${perCall}-r${run}`;
  save(await execute(ctx, id, planFlat(UNITS, perCall, 'bracket', model, LABELS, 'window', 'v1'), 'arm0', `window of ${perCall} units, design-doc definitions`, { perCall, form: 'bracket' }));
  return id;
}
async function a1b(run: number) {
  const id = `a1b-single-r${run}`;
  save(await execute(ctx, id, planFlat(UNITS, 1, 'bracket', model, LABELS, 'single'), 'arm1', 'one unit per call', { perCall: 1, form: 'bracket' }));
  return id;
}
async function a1defs(perCall: number, run: number) {
  const id = `a1a-w${perCall}-defs2-r${run}`;
  save(await execute(ctx, id, planFlat(UNITS, perCall, 'bracket', model, LABELS, 'window', 'v2'), 'arm1', `window of ${perCall} units, exclusive definitions`, { perCall, form: 'bracket', defs: 'v2' }));
  return id;
}
async function a2(form: Form, run: number) {
  const id = `a2-${form}-r${run}`;
  save(await execute(ctx, id, planFlat(UNITS, 20, form, model), 'arm2', `id form ${form}`, { perCall: 20, form }));
  return id;
}
async function a3(questions: number, run: number) {
  const per = Math.max(1, Math.round(questions / LABELS.length));
  const id = `a3-q${questions}-r${run}`;
  save(await execute(ctx, id, planFlat(UNITS, per, 'bracket', model), 'arm3', `${questions} questions per call`, { perCall: per, questions, form: 'bracket' }));
  return id;
}
/** Cap probes: a few calls of a given size, to find where the call errors. Units wrap around the estate. */
async function cap(questions: number, run: number) {
  const per = Math.max(1, Math.round(questions / LABELS.length));
  const units = Array.from({ length: per }, (_, i) => UNITS[i % UNITS.length]!);
  // wrapped units get distinct numbers so that question names stay unique
  const wrapped: GUnit[] = units.map((u, i) => ({ ...u, g: i + 1 }));
  const id = `cap-q${questions}-r${run}`;
  save(await execute(ctx, id, planFlat(wrapped, per, 'bracket', model), 'cap', `${questions} questions in one call`, { perCall: per, questions }));
  return id;
}
/** Cap probe with short question names (a1, a2, ...): tests whether the cap counts output tokens. */
async function capShort(questions: number, run: number) {
  const per = Math.max(1, Math.round(questions / LABELS.length));
  const wrapped: GUnit[] = Array.from({ length: per }, (_, i) => ({ ...UNITS[i % UNITS.length]!, g: i + 1 }));
  const [p] = planFlat(wrapped, per, 'bracket', model);
  const questions2: Record<string, (typeof p.body.questions)[string]> = {};
  const names = new Map<string, { u: GUnit; label: string }>();
  let i = 0;
  for (const [name, v] of Object.entries(p.body.questions)) { const short = `a${++i}`; questions2[short] = v; names.set(short, p.names.get(name)!); }
  const id = `capshort-q${questions}-r${run}`;
  save(await execute(ctx, id, [{ body: { ...p.body, questions: questions2 }, units: p.units, names }], 'cap', `${questions} questions in one call, short names`, { perCall: per, questions, shortNames: true }));
  return id;
}
/** Cap probe with minimal question text and the normal names: tests whether the cap counts input tokens. */
async function capMin(questions: number, run: number) {
  const per = Math.max(1, Math.round(questions / LABELS.length));
  const wrapped: GUnit[] = Array.from({ length: per }, (_, i) => ({ ...UNITS[i % UNITS.length]!, g: i + 1 }));
  const [p] = planFlat(wrapped, per, 'bracket', model);
  const qs: Record<string, (typeof p.body.questions)[string]> = {};
  for (const [name, v] of Object.entries(p.body.questions)) { const m = p.names.get(name)!; qs[name] = { ...v, instructions: { question: `Is [${m.u.g}] a ${m.label}?` } }; }
  const id = `capmin-q${questions}-r${run}`;
  save(await execute(ctx, id, [{ body: { ...p.body, questions: qs }, units: p.units, names: p.names }], 'cap', `${questions} questions in one call, minimal question text`, { perCall: per, questions, minimalText: true }));
  return id;
}
async function a4(run: number) {
  const id = `a4-tree-r${run}`;
  const per = 20;
  const probs: Probs = {};
  // Level 1: is this an instruction?
  const planned1 = chunk(UNITS, per).map((g) => {
    const questions: Record<string, { type: 'noul'; instructions: { question: string } }> = {};
    const names = new Map<string, { u: GUnit; label: string }>();
    for (const u of g) { const n = qName(u, 'bracket', 'instruction'); questions[n] = { type: 'noul', instructions: { question: `Unit [${u.g}] of the window: is it ${INSTR_Q}?` } }; names.set(n, { u, label: 'instruction' }); }
    return { body: { model, state: renderWindow(g, 'bracket'), questions }, units: g, names };
  });
  const r1 = await execute(ctx, `${id}-l1`, planned1, 'arm4', 'tree level 1', { perCall: per }, probs);
  // Level 2: the kind, only inside the route chosen by level 1 at 0.5.
  const yes = UNITS.filter((u) => (probs[u.g]?.instruction ?? 0) >= 0.5);
  const no = UNITS.filter((u) => (probs[u.g]?.instruction ?? 0) < 0.5);
  const plan2 = (us: GUnit[], labels: Label[]) => planFlat(us, per, 'bracket', model, labels);
  const r2 = await execute(ctx, `${id}-l2`, [...plan2(yes, ['rule', 'prohibition', 'gate']), ...plan2(no, ['example', 'description'])], 'arm4', 'tree level 2', { perCall: per }, probs);
  save({ ...r2, runId: id, arm: 'arm4', variant: 'two-level tree', calls: [...r1.calls, ...r2.calls.map((c, i) => ({ ...c, i: r1.calls.length + i }))], asked: r1.asked + r2.asked, missing: r1.missing + r2.missing, wallMs: r1.wallMs + r2.wallMs, cfg: { perCall: per, level1Calls: r1.calls.length, level2Calls: r2.calls.length, yes: yes.length, no: no.length } });
  return id;
}
async function a5(perCall: number | 'all', run: number, scope: 'all' | 'instructions') {
  const id = `a5-link-${scope}-${perCall}-r${run}`;
  const pool = scope === 'all' ? UNITS : UNITS.filter((u) => ['rule', 'prohibition', 'gate'].includes(u.label)); // scope=instructions uses the gold labels: an upper bound of a labeller-first design
  const per = perCall === 'all' ? pool.length : perCall;
  const probs: Probs = {};
  const planned = BLOCKS.flatMap((b) =>
    chunk(pool, per).map((g) => {
      const questions: Record<string, { type: 'noul'; instructions: { question: string } }> = {};
      const names = new Map<string, { u: GUnit; label: string }>();
      for (const u of g) {
        const n = `${b.id}__u${u.g}`;
        questions[n] = { type: 'noul', instructions: { question: `Does the test above need the agent to follow unit [${u.g}] of the window? A test needs a unit when the test would fail if the agent ignored what that unit says.` } };
        names.set(n, { u, label: b.id });
      }
      return { body: { model, state: `TEST\n${b.description}\n\n${renderWindow(g, 'bracket')}`, questions }, units: g, names };
    }),
  );
  save(await execute(ctx, id, planned, 'arm5', `link, ${scope} units, ${perCall} per call`, { perCall: per, scope, blocks: BLOCKS.length }, probs));
  return id;
}

async function main() {
  for (const spec of process.argv.slice(2)) {
    const [kind, a, b, c] = spec.split(':');
    const run = Number(b ?? 1);
    let id: string;
    if (kind === 'a1a') id = await a1a(Number(a), run);
    else if (kind === 'a1defs') id = await a1defs(Number(a), run);
    else if (kind === 'a1b') id = await a1b(Number(a ?? 1));
    else if (kind === 'a2') id = await a2(a as Form, run);
    else if (kind === 'a3') id = await a3(Number(a), run);
    else if (kind === 'cap') id = await cap(Number(a), run);
    else if (kind === 'capshort') id = await capShort(Number(a), run);
    else if (kind === 'capmin') id = await capMin(Number(a), run);
    else if (kind === 'a4') id = await a4(Number(a ?? 1));
    else if (kind === 'a5') id = await a5(a === 'all' ? 'all' : Number(a), Number(c ?? 1), (b as 'all' | 'instructions') ?? 'all');
    else throw new Error(`unknown spec ${spec}`);
    const bud = budget(cfg.budgetPath);
    console.log(`${spec} -> ${id}; calls used ${bud.calls}, errors ${bud.errors}, tokens in ${bud.tokensIn} out ${bud.tokensOut}`);
  }
}
void byId; void DESC; void labelQuestion; void LABELS;
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
