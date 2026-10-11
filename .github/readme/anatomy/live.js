
// The live machine. One loop: the line indexes one slot per step; in the dwell each station acts on the
// block under it, from the campaign the figure's own model computed. Nothing here invents a number.
const D = __DATA__;
const P = D.P;
const root = document.querySelector('.an');
const stage = root.querySelector('.an-stage');
const svg = stage.querySelector('svg');
const $ = (sel) => svg.querySelector(sel);
const readout = root.querySelector('[data-readout]');
const status = root.querySelector('[data-status]');
const partButtons = [...root.querySelectorAll('.an-part')];
const themeButton = root.querySelector('[data-theme-toggle]');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const at = (p) => iso(p, P);
const f2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeIn = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t);
const lerp = (a, b, t) => a + (b - a) * t;
const NAMES = D.model.modeNames;

// ------------------------------------------------------------------ theme
let theme = (() => {
  try {
    return localStorage.getItem('an-theme');
  } catch {
    return null;
  }
})() || (prefersDark.matches ? 'dark' : 'light');
function applyTheme() {
  document.body.dataset.theme = theme;
  themeButton.textContent = theme === 'light' ? 'dark theme' : 'light theme';
}
applyTheme();
themeButton.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem('an-theme', theme);
  } catch {
    /* the switch still works for this visit */
  }
  applyTheme();
});

// ------------------------------------------------------------------ the carriages (one block each)
const RAIL = D.railTop;
const DECK = D.deckTop;
const CARD = D.cardTop;
const S = (paths, style) => solidSvg(paths, style);
const L = (d, style) => lineSvg(d, style);
const seg = (a, b) => pathOf([at(a), at(b)]);
function carriageSvg() {
  const out = [];
  out.push('<g data-link></g>');
  out.push(S(slabOf({ x: -25.6, y: -2.4, w: 2.6, d: 4.8, r: 0.4 }, 10.6, 3.6, P, 2), { tone: 'mid' }));
  const deck = { x: -23, y: -16, w: 46, d: 32, r: 2.4 };
  out.push(S(slabOf(deck, RAIL, DECK - RAIL, P, 4, 0.6), { tone: 'hi', inner: L(sideSeam(deck, 12.2, P, 4), { tone: 'faint' }) }));
  out.push(L(lineOnTop([-8, -16], [-8, 16], DECK, P) + lineOnTop([7.2, -16], [7.2, 16], DECK, P), { tone: 'faint' }));
  // Given: a state capsule for a conversation, a workspace of files for a task step
  out.push('<g data-given="talk">');
  out.push(S(cylinder(-15, -1, 5.2, DECK, 9, P, 28), { tone: 'hi', inner: L(sideArc(-15, -1, 5.2, DECK + 4.6, P, 24), { tone: 'faint' }) }));
  out.push(S(cylinder(-15, -1, 5.7, DECK + 9, 1.8, P, 28), { tone: 'mid' }));
  out.push(L(ring(-15, -1, 2.6, DECK + 10.8, P, 20), { tone: 'lo' }));
  out.push('</g>');
  out.push('<g data-given="work">');
  const files = { x: -21.6, y: -9, w: 12.6, d: 17, r: 0.6 };
  out.push(S(slabOf(files, DECK, 5.4, P, 2), { tone: 'mid', inner: L(sideSeam(files, DECK + 2.7, P, 2), { tone: 'faint' }) }));
  for (let i = 0; i < 3; i++) out.push(S(slabOf({ x: -19.6 + i * 3.8, y: -7.4, w: 1, d: 13.8, r: 0.2 }, DECK + 5.4, 5.6 - i * 0.8, P, 1), { tone: 'hi' }));
  out.push('</g>');
  // When: the card in its holder, with the deviation token clipped to its top
  out.push(S(slabOf({ x: -6.6, y: -5.4, w: 13.2, d: 6.6, r: 0.8 }, DECK, 2.4, P, 2), { tone: 'mid' }));
  out.push(L(planOutline({ x: -6.1, y: -3, w: 12.2, d: 1.8, r: 0.6 }, DECK + 2.4, P, 2), { tone: 'lo' }));
  out.push(S(slabOf({ x: -5.8, y: -2.8, w: 11.6, d: 1.4, r: 0.3 }, DECK + 2.4, CARD - DECK - 2.4, P, 1), { tone: 'hi' }));
  out.push(L([[4.2, 27], [1.6, 24.8], [3, 22.6], [0.4, 20.4]].map(([x1, z]) => seg([-4.2, -1.38, z], [x1, -1.38, z])).join(''), { tone: 'lo', free: true }));
  out.push(`<g data-token>${S(slabOf({ x: -2.2, y: -3.8, w: 4.4, d: 3.4, r: 0.6 }, CARD, 2.2, P, 2), { tone: 'hi' })}</g>`);
  // Then: the test plate with nine pads, one per machine check; a block raises the pads it declares
  out.push(S(slabOf({ x: 8, y: -12.6, w: 13.4, d: 24, r: 1 }, DECK, 1.2, P, 3, 0.3), { tone: 'mid' }));
  const top = DECK + 1.2;
  for (const pad of D.pads) {
    const c = at([pad.x, pad.y, top + 0.4]);
    const r = Math.sqrt(1.6) * P.scale;
    const cross = pathOf([at([pad.x - 0.9, pad.y - 0.9, top + 0.42]), at([pad.x + 0.9, pad.y + 0.9, top + 0.42])]) + pathOf([at([pad.x + 0.9, pad.y - 0.9, top + 0.42]), at([pad.x - 0.9, pad.y + 0.9, top + 0.42])]);
    out.push(
      `<g data-pad="${pad.name}">${L(ring(pad.x, pad.y, 1.45, top, P, 18), { tone: 'faint' })}<g class="an-bump">${S(cylinder(pad.x, pad.y, 1.1, top, 0.4, P, 16), { tone: 'mid', crease: 'none' })}<circle data-obs cx="${f2(c[0])}" cy="${f2(c[1])}" r="${f2(r * 0.5)}"/><g data-x>${L(cross, { tone: 'hi', free: true })}</g></g></g>`,
    );
  }
  // the verdict flag on its post at the front right corner, and the hook the next block's link rests on
  out.push(S(cylinder(21, 13.6, 0.55, DECK, 9.2, P, 12), { tone: 'mid', crease: 'none' }));
  out.push(`<g data-flag>${S(slabOf({ x: 16.6, y: 13.3, w: 3.9, d: 0.6, r: 0.2 }, DECK + 5.6, 3.4, P, 1), { tone: 'hi' })}</g>`);
  out.push(S(slabOf({ x: 23, y: -1.6, w: 2.2, d: 3.2, r: 0.4 }, 11.2, 1.2, P, 1), { tone: 'mid' }));
  return out.join('');
}
const CAR_SVG = carriageSvg();
const carsLayer = $('[data-part="cars"]');
const beamLayer = $('[data-part="beam"]');
const POOL = 10;
const cars = Array.from({ length: POOL }, (_, i) => {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'an-car');
  g.dataset.car = String(i);
  g.innerHTML = CAR_SVG;
  g.style.display = 'none';
  carsLayer.appendChild(g);
  return {
    g,
    link: g.querySelector('[data-link]'),
    flag: g.querySelector('[data-flag]'),
    pads: Object.fromEntries([...g.querySelectorAll('[data-pad]')].map((el) => [el.dataset.pad, el])),
    entry: null,
    pos: [0, 0, 0],
    linkAngle: -1,
    opacity: 1,
  };
});
const freeCar = () => cars.find((c) => !c.entry);

function linkSvg(theta) {
  const hinge = [-24.4, 0, 12.9];
  const a = [-Math.cos(theta), 0, Math.sin(theta)];
  const u = [0, 1, 0];
  const v = G.unit3(G.cross3(a, u));
  const F = G.frameOf(hinge, a, u, v);
  return S(G.prismOf(F, [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]], 0, 15.5, P), { tone: 'mid' });
}

// the walking beam under the blocks
const BEAM = { x: -226, y: -3.2, w: 404, d: 6.4, r: 1 };
beamLayer.innerHTML = `<g data-beam>${S(slabOf(BEAM, 7.6, 1.2, P, 2), { tone: 'lo' })}${dotsSvg(Array.from({ length: 7 }, (_, i) => at([-192 + i * 64, 0, 8.8])), { size: 0.5, tone: 'mid' })}</g>`;
const beam = beamLayer.querySelector('[data-beam]');

// ------------------------------------------------------------------ stations
const el = {
  pegs: [...svg.querySelectorAll('[data-peg]')],
  spark: $('[data-part="spark"]'),
  ram: $('[data-part="ram"]'),
  shuttle: $('[data-part="shuttle"]'),
  drawer: $('[data-part="drawer"]'),
  head: $('[data-part="head"]'),
  flags: Object.fromEntries([...svg.querySelectorAll('[data-flag]')].filter((n) => n.closest('[data-part="head"]')).map((n) => [n.dataset.flag, n])),
  judges: Object.fromEntries([...svg.querySelectorAll('[data-judge]')].map((n) => [n.dataset.judge, n])),
  key: $('[data-part="key"]'),
  grid: $('[data-part="chart-grid"]'),
  trace: $('[data-part="chart-trace"]'),
  pen: $('[data-part="pen"]'),
  dial: $('[data-part="dial"]'),
  counters: [...svg.querySelectorAll('[data-counter]')],
  gateArm: $('[data-part="gate-arm"]'),
  flap: $('[data-part="flap"]'),
  lamps: [...svg.querySelectorAll('[data-lamp]')],
  lever: null,
};

el.lever = $('[data-part="lever"]');

// judges: a beam that tilts on its fulcrum, with a pan held level at each end
const judgeState = Object.fromEntries(D.judges.map((j) => [j.id, { angle: 0, target: 0, drawn: null }]));
function judgeSvg(j, angle) {
  const z = 18 + 15 * j.size;
  const half = 7.5 * j.size;
  const dx = Math.cos(angle) * half;
  const dz = Math.sin(angle) * half;
  const a = [Math.cos(angle), 0, Math.sin(angle)];
  const F = G.frameOf([j.x, j.y, z], a, [0, 1, 0], G.unit3(G.cross3(a, [0, 1, 0])));
  const beamPaths = G.prismOf(F, [[-0.9 * j.size, -0.5], [0.9 * j.size, -0.5], [0.9 * j.size, 0.5], [-0.9 * j.size, 0.5]], -half, half, P);
  const pan = (sx) => {
    const cx = j.x + sx * dx;
    const cz = z + sx * dz;
    return S(cylinder(cx, j.y, 0.5 * j.size, cz, 2 * j.size, P, 10), { tone: 'mid', crease: 'none' }) + S(cylinder(cx, j.y, 3.4 * j.size, cz + 2 * j.size, 0.8, P, 28), { tone: 'hi' });
  };
  const left = pan(-1);
  const right = pan(1);
  return left + S(beamPaths, { tone: 'mid' }) + right;
}

// the dial, drawn flat in the plane of the console face
const SWEEP = (240 * Math.PI) / 180;
const angleOf = (v) => -SWEEP / 2 + SWEEP * clamp(v, 0, 1);
const polar = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];
const R0 = D.dial.r - 1.8;
function arcPath(r, a0, a1) {
  const p0 = polar(r, a0);
  const p1 = polar(r, a1);
  return `M${f2(p0[0])} ${f2(p0[1])}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f2(p1[0])} ${f2(p1[1])}`;
}
{
  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const a = angleOf(i / 20);
    const major = i % 2 === 0;
    const [x0, y0] = polar(R0 - (major ? 4.2 : 2.6), a);
    const [x1, y1] = polar(R0, a);
    ticks.push(`<path class="an-tick"${major ? ' data-major=""' : ''} d="M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}"/>`);
  }
  const t = angleOf(D.model.threshold);
  const notch = [polar(R0 + 1.6, t - 0.07), polar(R0 + 1.6, t + 0.07), polar(R0 - 1.4, t)];
  el.dial.innerHTML = `<circle class="an-dial-face" r="${R0 + 1.6}"/><path class="an-tick" d="${arcPath(R0, -SWEEP / 2, SWEEP / 2)}"/>${ticks.join('')}<path class="an-notch" d="M${notch.map((p) => p.map(f2).join(' ')).join('L')}Z"/><path class="an-band" data-band d=""/><g data-lo><path class="an-pointer" d="M-1.1 ${-R0 + 7}L1.1 ${-R0 + 7}L0 ${-R0 + 2.4}Z"/></g><g data-hi><path class="an-pointer" d="M-1.1 ${-R0 + 7}L1.1 ${-R0 + 7}L0 ${-R0 + 2.4}Z"/></g><g data-needle><path class="an-needle" d="M0 4L0 ${-R0 + 3.4}"/></g><circle class="an-hub" r="1.8"/>`;
}
const dialEl = { band: el.dial.querySelector('[data-band]'), lo: el.dial.querySelector('[data-lo]'), hi: el.dial.querySelector('[data-hi]'), needle: el.dial.querySelector('[data-needle]') };
const dialState = { rate: { x: 0, v: 0 }, lo: { x: 0, v: 0 }, hi: { x: 1, v: 0 }, target: { rate: 0, lo: 0, hi: 1 } };

// the chart: one division per block, the pen at the right, an event mark under every injected block
const CH = D.chart;
const DIV = 4.2;
const PEN_X = CH.w - 7;
const MID = CH.h / 2;
const AMP = CH.h * 0.36;
const chartState = { records: [], scroll: { x: 0, v: 0 }, pen: { x: 0, v: 0 } };
el.grid.innerHTML = `<path class="an-grid" d="M0 ${f2(MID - AMP)}H${CH.w}M0 ${f2(MID + AMP)}H${CH.w}"/>`;

// the CI gate arm, rebuilt as it turns
const GATE_PIVOT = [D.gate.x + 6, D.gate.y, 50];
const gateState = { angle: { x: 0, v: 0 }, target: 0, drawn: null };
function gateSvg(theta) {
  const a = [0, Math.cos(theta), Math.sin(theta)];
  const u = [1, 0, 0];
  const v = G.unit3(G.cross3(a, u));
  const F = G.frameOf(GATE_PIVOT, a, u, v);
  const section = (h) => [[-1, -h], [1, -h], [1, h], [-1, h]];
  const parts = [S(G.prismOf(F, section(2.6), -10, -3, P), { tone: 'mid' })];
  for (let i = 0; i < 6; i++) parts.push(S(G.prismOf(F, section(1.5), 2 + i * 9.4, 2 + (i + 1) * 9.4, P), { tone: i % 2 ? 'mid' : 'hi' }));
  return parts.join('');
}

// ------------------------------------------------------------------ the campaign
const STEP = 0.95;
const MOVE = 0.4;
const DECIDE = 2.6;
const GENERATE = 1.5;
const state = {
  mode: 'T',
  queue: [],
  slots: [null, null, null, null, null, null],
  exiting: null,
  binned: null,
  falling: null,
  stepAt: 0,
  phase: 'idle',
  phaseAt: 0,
  runsDone: [],
  injected: 0,
  recovered: 0,
  adapter: 'conversation',
  shuttle: { x: D.adaptY.conversation, v: 0 },
  lever: { x: D.lever.T, v: 0 },
  link: { x: 1, v: 0 },
  linkTarget: 1,
  gate: 'pending',
  paused: false,
  touring: !still.matches,
  coverage: 0,
  cid: 0,
};
let clock = 0;

function buildQueue(mode) {
  const runs = D.campaigns[mode];
  const queue = [];
  runs.forEach((run, r) => {
    run.blocks.forEach((block, i) => {
      queue.push({ cid: state.cid, run: r, index: i, first: i === 0, last: i === run.blocks.length - 1, kind: run.kind, block, record: run, flag: 'pending', seen: false, checked: false, judged: false, recorded: false });
    });
  });
  return queue;
}

function startCampaign(mode) {
  state.cid += 1;
  state.mode = mode;
  state.queue = buildQueue(mode);
  state.runsDone = [];
  state.gate = 'pending';
  gateState.target = 0;
  state.phase = 'generate';
  state.phaseAt = clock;
  state.generated = state.generated || false;
  state.linkTarget = mode === 'T' ? 1 : 0;
  dialState.target = { rate: 0, lo: 0, hi: 1 };
  describe();
}

function statsNow() {
  return statsOf(D.campaigns[state.mode], state.runsDone.length);
}

// One index step: every block moves one slot along; the block at the end slides into the store.
function index() {
  if (state.binned) {
    state.binned.car.fadeFrom = clock;
  }
  if (state.exiting) {
    state.binned = state.exiting;
    state.binned.from = [D.exitX, 0, 0];
    state.binned.to = [229, 0, -8.6];
    state.binned.where = 'bin';
  }
  state.exiting = null;
  const leaving = state.slots[5];
  if (leaving) {
    leaving.from = [D.slots[5], 0, 0];
    leaving.to = [D.exitX, 0, 0];
    leaving.where = 'exit';
    state.exiting = leaving;
  }
  for (let s = 5; s > 0; s--) {
    const entry = state.slots[s - 1];
    state.slots[s] = entry;
    if (entry) {
      entry.from = [D.slots[s - 1], 0, 0];
      entry.to = [D.slots[s], 0, 0];
      entry.where = s;
    }
  }
  state.slots[0] = null;
  if (state.queue.length && state.phase === 'run') {
    const entry = state.queue.shift();
    const car = freeCar();
    entry.car = car;
    car.entry = entry;
    car.g.style.display = '';
    car.g.dataset.kind = entry.kind;
    car.g.removeAttribute('data-injected');
    car.fadeFrom = null;
    car.g.style.opacity = '1';
    for (const [name, pad] of Object.entries(car.pads)) {
      pad.toggleAttribute('data-off', entry.block.checks[name] === undefined);
      pad.removeAttribute('data-seen');
      pad.removeAttribute('data-bad');
    }
    setFlag(car, 'pending');
    entry.from = [D.slots[0], 0, 78];
    entry.to = [D.slots[0], 0, 0];
    entry.where = 0;
    entry.falling = true;
    state.slots[0] = entry;
  }
  state.stepAt = clock;
}

function setFlag(car, verdict) {
  car.flagVerdict = verdict;
  if (verdict === 'fail') car.flag.setAttribute('data-fail', '');
  else car.flag.removeAttribute('data-fail');
}

function lineEmpty() {
  return !state.queue.length && state.slots.every((s) => !s) && !state.exiting;
}

// ------------------------------------------------------------------ the loop
let frame = 0;
let last = 0;
let visible = false;
let idleTimer = 0;
let selected = null;
let said = '';

function springTo(s, target, dt, seconds, calm) {
  if (calm) {
    s.x = target;
    s.v = 0;
    return false;
  }
  const w = 1 / seconds;
  for (let i = 0; i < 4; i++) {
    s.v += (w * w * (target - s.x) - 2 * w * s.v) * (dt / 4);
    s.x += s.v * (dt / 4);
  }
  if (Math.abs(target - s.x) < 1e-4 && Math.abs(s.v) < 1e-4) {
    s.x = target;
    s.v = 0;
    return false;
  }
  return true;
}

function tick(now) {
  const real = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  const dt = state.paused ? 0 : real;
  clock += dt;
  advance(calm);
  draw(dt, calm);
  frame = visible ? requestAnimationFrame(tick) : 0;
}

function advance(calm) {
  if (state.phase === 'generate') {
    const span = state.generated ? 0.8 : GENERATE;
    const t = (clock - state.phaseAt) / span;
    if (!state.generated) state.coverage = Math.round(clamp(t, 0, 1) * D.coverage.covered);
    if (t >= 1 || calm) {
      state.coverage = D.coverage.covered;
      state.generated = true;
      state.phase = 'run';
      index();
    }
    return;
  }
  if (state.phase === 'run') {
    const t = clock - state.stepAt;
    act(t, calm);
    if (t >= STEP) {
      if (lineEmpty()) {
        decide();
        return;
      }
      index();
    }
    return;
  }
  if (state.phase === 'decide') {
    if (clock - state.phaseAt >= DECIDE && state.touring) {
      const next = state.mode === 'T' ? 'F' : state.mode === 'F' ? 'P' : 'T';
      startCampaign(next);
    }
  }
}

function decide() {
  const stats = statsNow();
  state.gate = stats.gate;
  gateState.target = stats.gate === 'pass' ? Math.PI / 2 - 0.08 : 0;
  state.phase = 'decide';
  state.phaseAt = clock;
  describe();
  announce(`${NAMES[state.mode]}: ${stats.n} runs, the gate ${stats.gate === 'pass' ? 'lifts' : 'holds'}.`);
}

// What each station does to the block under it during the dwell.
function act(t, calm) {
  const tau = t - MOVE;
  if (tau < 0) return;
  const at1 = state.slots[1];
  if (at1 && at1.block.injected && tau > 0.12 && !at1.injectedShown) {
    at1.injectedShown = true;
    at1.car.g.setAttribute('data-injected', '');
  }
  const at2 = state.slots[2];
  if (at2 && tau > 0.2 && !at2.seen) {
    at2.seen = true;
    for (const name of Object.keys(at2.block.checks)) at2.car.pads[name].setAttribute('data-seen', '');
  }
  const at3 = state.slots[3];
  if (at3 && tau > 0.22 && !at3.checked) {
    at3.checked = true;
    for (const [name, ok] of Object.entries(at3.block.checks)) if (!ok) at3.car.pads[name].setAttribute('data-bad', '');
    if (!at3.block.machinePass) setFlag(at3.car, 'fail');
  }
  const at4 = state.slots[4];
  if (at4 && tau > 0.36 && !at4.judged) {
    at4.judged = true;
    if (at4.block.machinePass) setFlag(at4.car, at4.block.judged.verdict);
  }
  const at5 = state.slots[5];
  if (at5 && tau > 0.08 && !at5.recorded) {
    at5.recorded = true;
    chartState.records.push({ offset: at5.block.offset, injected: at5.block.injected, first: at5.first });
    if (at5.last && at5.cid === state.cid) finishRun(at5);
  }
}

function finishRun(entry) {
  state.runsDone.push(entry.record);
  const stats = statsNow();
  dialState.target = { rate: stats.rate ?? 0, lo: stats.lo, hi: stats.hi };
  describe();
  if (entry.record.recovery) announce(`run ${stats.n}: recovery ${entry.record.recovery.label}`);
}

// ------------------------------------------------------------------ drawing
function pulse(tau, a, b, c, d) {
  if (tau < a) return 0;
  if (tau < b) return ease((tau - a) / (b - a));
  if (tau < c) return 1;
  if (tau < d) return 1 - ease((tau - c) / (d - c));
  return 0;
}

function draw(dt, calm) {
  const t = clock - state.stepAt;
  const move = state.phase === 'run' ? ease(t / MOVE) : 1;
  const tau = t - MOVE;
  // the blocks
  const entries = [...state.slots, state.exiting, state.binned].filter(Boolean);
  for (const entry of entries) {
    const car = entry.car;
    let p;
    if (entry.falling) {
      const f = easeIn(clamp(t / MOVE, 0, 1));
      p = [entry.to[0], 0, lerp(entry.from[2], entry.to[2], f)];
      if (f >= 1) entry.falling = false;
    } else if (entry.where === 'bin') {
      const slide = clamp(t / (MOVE * 0.7), 0, 1);
      const drop = easeIn(clamp((t - MOVE * 0.55) / (MOVE * 0.6), 0, 1));
      p = [lerp(entry.from[0], entry.to[0], ease(slide)), 0, lerp(0, entry.to[2], drop)];
    } else {
      p = [lerp(entry.from[0], entry.to[0], move), 0, 0];
    }
    car.pos = p;
    car.g.setAttribute('transform', translateAlong(P, p));
  }
  for (const car of cars) {
    if (car.fadeFrom != null && car.entry) {
      const f = clamp((clock - car.fadeFrom) / 0.5, 0, 1);
      car.g.style.opacity = String(1 - f);
      if (f >= 1) {
        car.entry = null;
        car.fadeFrom = null;
        car.g.style.display = 'none';
        if (state.binned && state.binned.car === car) state.binned = null;
      }
    }
  }
  // depth order of the blocks: far (left) first
  const shown = cars.filter((c) => c.entry);
  shown.sort((a, b) => depthOf([a.pos[0], 0, a.pos[2] + 18], P) - depthOf([b.pos[0], 0, b.pos[2] + 18], P));
  let i = 0;
  for (const car of shown) {
    if (carsLayer.children[i] !== car.g) carsLayer.insertBefore(car.g, carsLayer.children[i] || null);
    i++;
  }
  // couplings: down when free running or perturbed and the block behind belongs to the same run
  springTo(state.link, state.linkTarget, dt, 0.18, calm);
  for (const car of shown) {
    const entry = car.entry;
    const slot = typeof entry.where === 'number' ? entry.where : -1;
    const behind = slot > 0 ? state.slots[slot - 1] : null;
    const coupled = state.mode !== 'T' && behind && behind.cid === entry.cid && behind.run === entry.run && behind.index === entry.index + 1 && !behind.falling;
    const want = coupled ? 0 : 1.36;
    car.linkTarget = want;
    if (car.linkAngle < 0) car.linkAngle = want;
    const s = car.linkSpring || (car.linkSpring = { x: want, v: 0 });
    springTo(s, want, dt, 0.16, calm);
    if (Math.abs(s.x - car.linkAngle) > 0.002 || !car.link.innerHTML) {
      car.linkAngle = s.x;
      car.link.innerHTML = linkSvg(s.x);
    }
    // the verdict flag rises on a pass
    const up = car.flagVerdict === 'pass' ? 1 : 0;
    const fs = car.flagSpring || (car.flagSpring = { x: up, v: 0 });
    springTo(fs, up, dt, 0.12, calm);
    car.flag.setAttribute('transform', translateAlong(P, [0, 0, -4 + 4 * fs.x]));
  }
  // the walking beam lifts the blocks along and returns in the dwell
  const beamX = state.phase === 'run' ? (t < MOVE ? 64 * ease(t / MOVE) : 64 * (1 - ease((t - MOVE) / (STEP - MOVE)))) : 0;
  beam.setAttribute('transform', translateAlong(P, [beamX, 0, 0]));
  // the punch strikes the injected block at slot 1
  const at1 = state.slots[1];
  const strike = at1 && at1.block.injected && state.phase === 'run' ? pulse(tau, 0, 0.1, 0.16, 0.42) : 0;
  el.ram.setAttribute('transform', translateAlong(P, [0, 0, -4.4 * strike]));
  const lit = state.mode === 'P' && at1 && at1.block.injected && tau > -0.2 && state.phase === 'run';
  if (lit) el.spark.setAttribute('data-on', '');
  else el.spark.removeAttribute('data-on');
  // the agent cell: the shuttle brings the adapter this block needs, then lowers onto it
  const at2 = state.slots[2];
  const kindHere = at2 ? at2.kind : state.slots[1] ? state.slots[1].kind : state.adapter;
  state.adapter = kindHere;
  springTo(state.shuttle, D.adaptY[kindHere], dt, 0.14, calm);
  const press = at2 && state.phase === 'run' ? pulse(tau, 0.02, 0.16, 0.26, 0.5) : 0;
  el.shuttle.setAttribute('transform', translateAlong(P, [0, state.shuttle.x, -13 * press]));
  el.drawer.setAttribute('transform', translateAlong(P, [at2 && at2.kind === 'task' ? 4 * press : 0, 0, 0]));
  // the gantry head lowers its pins onto the Then plate; a failing pin's flag stays up
  const at3 = state.slots[3];
  const probe = at3 && state.phase === 'run' ? pulse(tau, 0.02, 0.18, 0.3, 0.52) : 0;
  el.head.setAttribute('transform', translateAlong(P, [0, 0, -21 * probe]));
  for (const [name, flag] of Object.entries(el.flags)) {
    const bad = at3 && at3.checked && at3.block.checks[name] === false;
    flag.setAttribute('transform', translateAlong(P, [0, 0, bad ? 3.4 * probe + 0.01 : 0]));
    flag.style.display = at3 && at3.checked && at3.block.checks[name] === false ? '' : 'none';
  }
  // the council: the class that owns the criterion votes; a split goes to the other class
  const at4 = state.slots[4];
  const judged = at4 && at4.block.machinePass ? at4.block.judged : null;
  const voteOf = (v) => (v === 'pass' ? -0.22 : v === 'fail' ? 0.22 : 0);
  for (const j of D.judges) {
    const js = judgeState[j.id];
    let target = 0;
    if (judged && state.phase === 'run' && tau > 0.04) {
      const idx = Number(j.id.split('.')[1]);
      if (j.cls === judged.cls) target = voteOf(judged.votes[idx]);
      if (judged.split && j.cls === judged.by && tau > 0.2) target = voteOf(judged.final[idx]);
    }
    const s = js.spring || (js.spring = { x: 0, v: 0 });
    springTo(s, target, dt, 0.09, calm);
    if (js.drawn === null || Math.abs(s.x - js.drawn) > 0.002) {
      js.drawn = s.x;
      el.judges[j.id].innerHTML = judgeSvg(j, s.x);
    }
  }
  const keyX = judged ? (judged.by === 'system1' ? -4 : 4) : 0;
  const ks = state.keySpring || (state.keySpring = { x: 0, v: 0 });
  springTo(ks, keyX, dt, 0.12, calm);
  el.key.setAttribute('transform', translateAlong(P, [ks.x, 0, 0]));
  // the lever
  springTo(state.lever, D.lever[state.mode], dt, 0.2, calm);
  el.lever.setAttribute('transform', translateAlong(P, [state.lever.x - D.lever.T, 0, 0]));
  // the validity gate's flap kicks once for every rejected candidate while the hopper generates
  let kick = 0;
  if (state.phase === 'generate' && !state.generated) {
    const t = (clock - state.phaseAt) / GENERATE;
    for (let r = 0; r < D.candidates.rejected; r++) kick = Math.max(kick, pulse(t, 0.18 + r * 0.26, 0.24 + r * 0.26, 0.28 + r * 0.26, 0.36 + r * 0.26));
  }
  el.flap.setAttribute('transform', translateAlong(P, [-2.2 * kick, 0, 0]));
  // the mode lamps on the console
  for (const lamp of el.lamps) lamp.toggleAttribute('data-on', lamp.dataset.lamp === state.mode);
  // the coverage pegboard
  el.pegs.forEach((peg, n) => {
    const covered = D.coverage.cells[n];
    const order = D.coverage.cells.slice(0, n + 1).filter(Boolean).length;
    const on = covered && order <= state.coverage;
    if (on !== peg.hasAttribute('data-on')) peg.toggleAttribute('data-on', on);
  });
  drawChart(dt, calm);
  drawDial(dt, calm);
  drawCounters();
  springTo(gateState.angle, gateState.target, dt, 0.35, calm);
  if (gateState.drawn === null || Math.abs(gateState.angle.x - gateState.drawn) > 0.002) {
    gateState.drawn = gateState.angle.x;
    el.gateArm.innerHTML = gateSvg(gateState.angle.x);
  }
  say();
}

function drawChart(dt, calm) {
  const n = chartState.records.length;
  springTo(chartState.scroll, n, dt, 0.18, calm);
  const last = chartState.records[n - 1];
  springTo(chartState.pen, last ? last.offset : 0, dt, 0.12, calm);
  const shift = chartState.scroll.x;
  const xOf = (i) => PEN_X - (shift - 1 - i) * DIV;
  const points = [];
  const marks = [];
  const lines = [];
  const from = Math.max(0, n - Math.ceil(PEN_X / DIV) - 2);
  for (let i = from; i < n; i++) {
    const x = xOf(i);
    const y = MID - AMP * chartState.records[i].offset;
    if (i === n - 1) points.push([x - DIV * 0.5, y], [Math.min(PEN_X, x), MID - AMP * chartState.pen.x]);
    else points.push([x - DIV * 0.5, y], [x + DIV * 0.5, y]);
    if (chartState.records[i].injected) marks.push(`M${f2(x)} ${CH.h}V${f2(CH.h - 4.4)}`);
    if (chartState.records[i].first) lines.push(`M${f2(x - DIV * 0.5)} 0V${CH.h}`);
  }
  const clipped = points.filter(([x]) => x >= 0.5).map(([x, y]) => [Math.min(x, PEN_X), y]);
  el.trace.innerHTML = `${lines.length ? `<path class="an-grid" d="${lines.filter((d) => Number(d.slice(1).split(' ')[0]) > 0.6).join('')}"/>` : ''}<path class="an-trace" d="${clipped.length > 1 ? `M${clipped.map((p) => p.map(f2).join(' ')).join('L')}` : ''}"/><path class="an-event" d="${marks.filter((d) => Number(d.slice(1).split(' ')[0]) > 0.6).join('')}"/>`;
  const py = MID - AMP * chartState.pen.x;
  el.pen.innerHTML = `<path class="an-pen-arm" d="M${PEN_X} 0V${f2(py - 1.6)}M${PEN_X} ${f2(py + 1.6)}V${CH.h}"/><rect class="an-pen" x="${PEN_X - 1.4}" y="${f2(py - 1.6)}" width="2.8" height="3.2" rx="0.6"/>`;
}

function drawDial(dt, calm) {
  springTo(dialState.rate, dialState.target.rate, dt, 0.28, calm);
  springTo(dialState.lo, dialState.target.lo, dt, 0.32, calm);
  springTo(dialState.hi, dialState.target.hi, dt, 0.32, calm);
  const a = angleOf(dialState.rate.x);
  const lo = angleOf(dialState.lo.x);
  const hi = angleOf(dialState.hi.x);
  dialEl.needle.setAttribute('transform', `rotate(${f2((a * 180) / Math.PI)})`);
  dialEl.lo.setAttribute('transform', `rotate(${f2((lo * 180) / Math.PI)})`);
  dialEl.hi.setAttribute('transform', `rotate(${f2((hi * 180) / Math.PI)})`);
  const r0 = R0 - 6.2;
  const r1 = R0 - 4.6;
  if (hi - lo > 0.01) {
    const o0 = polar(r1, lo);
    const o1 = polar(r1, hi);
    const i1 = polar(r0, hi);
    const i0 = polar(r0, lo);
    const big = hi - lo > Math.PI ? 1 : 0;
    dialEl.band.setAttribute('d', `M${f2(o0[0])} ${f2(o0[1])}A${r1} ${r1} 0 ${big} 1 ${f2(o1[0])} ${f2(o1[1])}L${f2(i1[0])} ${f2(i1[1])}A${r0} ${r0} 0 ${big} 0 ${f2(i0[0])} ${f2(i0[1])}Z`);
  } else dialEl.band.setAttribute('d', '');
}

let countersText = '';
function drawCounters() {
  const s = statsNow();
  const text = [`${String(s.c).padStart(2, '0')}/${String(s.n).padStart(2, '0')}`, s.passK === null ? '' : s.passK.toFixed(2), state.mode === 'P' ? `${String(s.recovered).padStart(2, '0')}/${String(s.injected).padStart(2, '0')}` : ''];
  const joined = text.join('|');
  if (joined === countersText) return;
  countersText = joined;
  el.counters.forEach((node, i) => {
    node.textContent = text[i];
  });
}

function readoutText() {
  if (selected) return PART_LINES[selected];
  const s = statsNow();
  const name = NAMES[state.mode];
  if (state.phase === 'generate') return state.generated ? `${name} · lever set, first block on the way` : `${name} · generating · coverage ${state.coverage} of ${D.coverage.flows * D.coverage.classes} cells · ${D.candidates.rejected} rejected`;
  if (state.phase === 'decide') return `${name} · ${s.n} runs · ${s.rate.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}] · gate ${s.gate === 'pass' ? 'lifts' : 'holds'}`;
  if (!s.n) return `${name} · first run on the line`;
  const rate = `pass ${s.c} of ${s.n}, ${s.rate.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}]`;
  if (state.mode === 'P') return `${name} · ${rate} · recovered ${s.recovered} of ${s.injected}`;
  return `${name} · ${rate} · pass^${D.model.k} ${s.passK === null ? 'n/a' : s.passK.toFixed(2)}`;
}
function say() {
  const text = readoutText();
  if (text !== said) {
    said = text;
    readout.textContent = text;
  }
}
function describe() {
  const s = statsNow();
  stage.setAttribute('aria-valuetext', `${NAMES[state.mode]}, ${s.n} of ${D.model.runs} runs`);
}
let announceTimer = 0;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    status.textContent = text;
  }, 700);
}

// ------------------------------------------------------------------ parts and input
const PART_LINES = Object.fromEntries(partButtons.map((b) => [b.dataset.piece, `${b.querySelector('.an-n').textContent} ${b.querySelector('.an-name').textContent.toLowerCase()}`]));
function select(piece) {
  selected = piece;
  if (piece) stage.dataset.focus = piece;
  else delete stage.dataset.focus;
  for (const node of svg.querySelectorAll('.an-line .it')) node.toggleAttribute('data-on', piece !== null && node.dataset.piece === piece);
  for (const b of partButtons) b.toggleAttribute('data-on', b.dataset.piece === piece);
}
for (const b of partButtons) {
  b.addEventListener('mouseenter', () => select(b.dataset.piece));
  b.addEventListener('focus', () => select(b.dataset.piece));
  b.addEventListener('mouseleave', () => select(null));
  b.addEventListener('blur', () => select(null));
}
svg.addEventListener('pointermove', (event) => {
  const item = event.target.closest('.an-line .it');
  const piece = item && item.dataset.piece !== 'line' ? item.dataset.piece : null;
  if (piece !== selected) select(piece);
});
svg.addEventListener('pointerleave', () => select(null));

function takeOver() {
  state.touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    state.touring = !still.matches;
    if (state.phase === 'decide') state.phaseAt = clock - DECIDE;
  }, 3600);
}
stage.addEventListener('keydown', (event) => {
  const modes = { 1: 'T', 2: 'F', 3: 'P' };
  if (modes[event.key]) {
    event.preventDefault();
    takeOver();
    if (state.mode !== modes[event.key] || state.phase === 'decide') {
      state.queue = [];
      startCampaign(modes[event.key]);
    }
    run();
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    state.paused = !state.paused;
    takeOver();
    run();
    return;
  }
  const ids = partButtons.map((b) => b.dataset.piece);
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    select(ids[(ids.indexOf(selected) + 1) % ids.length]);
    run();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    select(ids[(ids.indexOf(selected) - 1 + ids.length) % ids.length]);
    run();
  } else if (event.key === 'Escape') {
    select(null);
    run();
  }
});
stage.addEventListener('focus', () => {
  status.textContent = `${NAMES[state.mode]}, ${statsNow().n} of ${D.model.runs} runs`;
});

const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  },
  { rootMargin: '120px 0px' },
).observe(stage);

// A hook for captures: window.__anatomy.seek(mode, seconds) runs the machine forward without drawing each frame.
window.__anatomy = {
  seek(mode, seconds) {
    state.touring = false;
    state.queue = [];
    startCampaign(mode);
    const step = 1 / 60;
    for (let t = 0; t < seconds; t += step) {
      clock += step;
      advance(false);
      draw(step, false);
    }
    return readout.textContent;
  },
  pause(on = true) {
    state.paused = on;
  },
  step(seconds) {
    const step = 1 / 60;
    for (let t = 0; t < seconds; t += step) {
      clock += step;
      advance(false);
      draw(step, false);
    }
    return readout.textContent;
  },
  probe() {
    const at1 = state.slots[1];
    return { runs: state.runsDone.length, injecting: Boolean(at1 && at1.block.injected), tau: clock - state.stepAt - MOVE, phase: state.phase };
  },
};

startCampaign('T');
draw(0, still.matches);
// A still for captures and links: index.html#at=P,39.62 runs the perturbed campaign to that second and holds it.
{
  const still = /^#at=([TFP]),(\d+(?:\.\d+)?)$/.exec(location.hash);
  if (still) {
    window.__anatomy.seek(still[1], Number(still[2]));
    state.paused = true;
  }
}
