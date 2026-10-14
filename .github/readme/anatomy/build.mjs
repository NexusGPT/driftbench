#!/usr/bin/env node
// Builds the anatomy figure of driftbench: an indexing test line on a cast bench. It writes index.html,
// a standalone page with the drawing, its live script and the kit inlined.
//
// The Anatomy kit lives outside the repo (https://github.com/wheresryan22/anatomy, MIT), so the project
// keeps no drawing dependency. Point ANATOMY_KIT at a clone; the build also looks in
// ~/.claude/skills/anatomy and /tmp/anatomy.
//
//   ANATOMY_KIT=/path/to/anatomy node .github/readme/anatomy/build.mjs
//   ANATOMY_KIT=/path/to/anatomy node .github/readme/anatomy/build.mjs --audit
//
// The page follows the reader's colour scheme, light first, and carries a theme switch.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as M from './model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = [process.env.ANATOMY_KIT, join(homedir(), '.claude/skills/anatomy'), '/tmp/anatomy'].find(
  (root) => root && existsSync(join(root, 'kit', 'iso-kit.mjs')),
);
if (!KIT) {
  console.error('Anatomy kit not found. Clone https://github.com/wheresryan22/anatomy and set ANATOMY_KIT.');
  process.exit(2);
}
const load = (file) => import(pathToFileURL(join(KIT, 'kit', file)).href);
const k = await load('iso-kit.mjs');
const G = await load('lathe.mjs');
const A = await load('audit.mjs');
const { tubePieces, tubeSvg } = await load('tube.mjs');

const W = 1000;
const H = 600;
const AZIMUTH = 58;
const ELEVATION = 34;

// The world, in units of about one pixel: x along the line, y toward the viewer, z up.
const PLATE = { x: -296, y: -134, w: 584, d: 218, r: 12 };
const PLATE_H = 12;
const FOOT_H = 6;
const PITCH = 64;
const SLOTS = [-192, -128, -64, 0, 64, 128];
const EXIT_X = 196;
const TRACK = { x: -238, y: -19, w: 438, d: 38, r: 3 };
const TRACK_TOP = 8;
const RAIL_TOP = 10;
const DECK_TOP = 14.4;
const CARD_TOP = 29.8;
const STORE = { x: 202, y: -27, w: 54, d: 54 };
const STORE_H = 30;
const CONSOLE = { x: -4, y: -128, w: 248, d: 28, r: 3 };
const CONSOLE_H = 108;
const FACE_Y = CONSOLE.y + CONSOLE.d;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [-192, 0, 150],
    [-250, -100, 132],
    [CONSOLE.x, CONSOLE.y, CONSOLE_H],
    [CONSOLE.x + CONSOLE.w, CONSOLE.y, CONSOLE_H],
    [266, -20, 96],
  ],
  W,
  H,
  { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const UP = G.frameOf([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const upAt = (x, y, z = 0) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const alongX = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const alongY = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [-1, 0, 0], [0, 0, 1]);

const R = A.recorder(P);
function put(name, ref, svg, shapes, { piece = 'line', bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece, ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, opts = {}) {
  const { r = 0.5, steps = 3, bevel = 0, extra = '', inner = '', bias = 0, piece, record = true } = opts;
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = A.slab(plan, z0, z1 - z0, { name }, steps);
  if (record) R.solid(shape);
  return put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: 'mid', ...style, inner }) + extra, [shape], { bias, piece });
}
function post(name, x, y, z0, z1, r, style = {}, opts = {}) {
  const { steps = 20, extra = '', inner = '', bias = 0, piece } = opts;
  const shape = R.solid(A.cylinder(x, y, r, z0, z1 - z0, { name }));
  return put(name, [x, y, (z0 + z1) / 2], S(k.cylinder(x, y, r, z0, z1 - z0, P, steps), { tone: 'mid', ...style, inner }) + extra, [shape], { bias, piece });
}
function turned(name, F, profile, style = {}, opts = {}) {
  const { extra = '', inner = '', bias = 0, piece, smooth, steps, rims } = opts;
  const options = { ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F, P, options);
  const shape = R.solid(A.solid(F, profile, { name }));
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  return put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: 'mid', ...style, inner }) + extra, [shape], { bias, piece });
}
const disc = (name, F, s0, s1, r, style, opts) => turned(name, F, [[s0, r], [s1, r]], style, opts);
function prism(name, F, poly, s0, s1, style = {}, opts = {}) {
  const { extra = '', inner = '', bias = 0, piece } = opts;
  const shape = R.solid(A.prism(F, poly, s0, s1, { name }));
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const centre = G.add3(G.add3(G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), G.mul3(F.u, cx)), G.mul3(F.v, cy));
  return put(name, centre, S(G.prismOf(F, poly, s0, s1, P), { tone: 'mid', ...style, inner }) + extra, [shape], { bias, piece });
}
const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
function ball(name, c, r, style = {}, opts = {}) {
  const { bias = 0, piece, extra = '' } = opts;
  const shape = R.solid(A.ball(c, r, { name }));
  return put(name, c, S(G.sphereOf(c, r, P, { steps: 32 }), { tone: 'mid', ...style }) + extra, [shape], { bias, piece });
}
// A vertical face drawn flat: local u runs along +x, local v runs down from z.
const faceMatrix = (x, y, z) => k.sideMatrix([x, y], z, P, 'left');

const CABLES = [];
function cable(name, points, r = 0.55, { tone = 'mid', bend = 3, piece = 'line', shells = [false, false], bias = 0.05, maxLength = 18 } = {}) {
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = Math.max(1.6, r * 2.4);
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : [])];
  R.route(name, route, r, { gaps, limp: true, rims: shells.map((on) => (on ? r * 1.9 : r)), piece });
  CABLES.push(name);
  tubePieces(route, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps }).forEach((pieceOf, index) =>
    put(`${name}:${index}`, pieceOf.mid, tubeSvg(pieceOf, { tone }), [A.tube(pieceOf.points, pieceOf.radii)], { bias, piece, route: name, chunk: index }),
  );
  [0, 1].forEach((index) => {
    const end = index ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, index ? total : 0);
    if (shells[index]) {
      const F = G.frameAlong(end, tangent);
      const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
      const shape = R.solid(A.disc(F, s0, s1, r * 1.9, { name: `${name}.shell${index}`, owner: name }));
      put(`${name}.shell${index}`, G.add3(end, G.mul3(tangent, (s0 + s1) / 2)), S(G.disc(s0, s1, r * 1.9, F, P, { steps: 20 }), { tone: 'mid' }), [shape], { bias: bias + 0.1, piece });
    } else {
      const size = Math.max(0.5, r * KS * 0.9);
      put(`${name}.end${index}`, end, Dots([at(end)], { size, tone: 'hi' }), [A.ball(end, size / KS, { name: `${name}.end${index}`, owner: name })], { bias: bias + 0.15, piece });
    }
  });
  return route;
}

// ---------------------------------------------------------------- the bench
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const FEET = [...k.corners(PLATE, 26), [PLATE.x + PLATE.w / 2, PLATE.y + 26], [PLATE.x + PLATE.w / 2, PLATE.y + PLATE.d - 26]];
for (const [x, y] of byDepth(FEET)) {
  back.push(S(k.cylinder(x, y, 7.4, -PLATE_H - FOOT_H, 1.8, P, 28), { tone: 'lo' }));
  back.push(S(k.cylinder(x, y, 5.6, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: 'mid' }));
  R.solid(A.cylinder(x, y, 7.4, -PLATE_H - FOOT_H, FOOT_H, { name: 'stand.foot', ground: true }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: 'mid', inner: Ln(k.sideSeam(PLATE, -5, P, 8), { tone: 'faint' }) }));
R.solid(A.slab(PLATE, -PLATE_H, PLATE_H, { name: 'stand.plate', ground: true }, 8));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: 'lo' }));
const plateScrews = k.corners(PLATE, 11);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.3, 0, P, 16)).join(''), { tone: 'lo' }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
const STRIP = { x: -262, y: PLATE.y + PLATE.d - 14, w: 470, d: 6.4, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: 'lo', crease: 'none' }));
{
  const ticks = k.topTicks(STRIP.x + 2, STRIP.x + STRIP.w - 2, 4, 4, STRIP.y, 0.6, [1.8, 3.6], P);
  back.push(Ln(ticks.minor, { tone: 'lo' }), Ln(ticks.major, { tone: 'mid' }));
  back.push(Dots([at([STRIP.x + 1.2, STRIP.y + 3.2, 0.6]), at([STRIP.x + STRIP.w - 1.2, STRIP.y + 3.2, 0.6])], { size: 0.45 }));
}
// A T slot in the bench top, in front of the track, where fixtures bolt down.
back.push(Ln(k.planOutline({ x: -96, y: 27, w: 284, d: 3.6, r: 1.8 }, 0, P, 4), { tone: 'lo' }) + Ln(k.planOutline({ x: -95, y: 28, w: 282, d: 1.6, r: 0.8 }, 0, P, 3), { tone: 'faint' }));
// The one engraved label: the maker's plate at the front right corner.
const LABEL = { x: 214, y: PLATE.y + PLATE.d - 40, w: 50, d: 18, r: 1.4 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: 'lo', crease: 'none' }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.6), 0.8, P, 3), { tone: 'faint' }));
back.push(k.faceTextSvg(k.topMatrix([LABEL.x + 4.6, LABEL.y + 8], 0.8, P, 'x'), 'driftbench', { size: 4.6, tone: 'mid' }));
back.push(Ln([30, 22].map((w, i) => k.lineOnTop([LABEL.x + 4.6, LABEL.y + 11.6 + i * 2.6], [LABEL.x + 4.6 + w, LABEL.y + 11.6 + i * 2.6], 0.8, P)).join(''), { tone: 'lo', free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 2.8, LABEL.y + 2.8, 0.8]), at([LABEL.x + LABEL.w - 2.8, LABEL.y + LABEL.d - 2.8, 0.8])], { size: 0.45 }));

// ---------------------------------------------------------------- the track
box('track.bed', [TRACK.x, TRACK.y, 0], [TRACK.x + TRACK.w, TRACK.y + TRACK.d, TRACK_TOP], { tone: 'mid' }, {
  r: 3,
  steps: 4,
  bevel: 0.6,
  inner: Ln(k.sideSeam(TRACK, 4, P, 4), { tone: 'faint' }),
  extra: Ln(k.planOutline({ x: TRACK.x + 6, y: -5, w: TRACK.w - 12, d: 10, r: 2 }, TRACK_TOP, P, 3), { tone: 'lo' }),
  bias: -2,
});
for (const [y0, y1] of [[-15, -10], [10, 15]]) {
  const rail = { x: TRACK.x + 4, y: y0, w: TRACK.w - 8, d: y1 - y0, r: 0.8 };
  box(`track.rail`, [rail.x, y0, TRACK_TOP], [rail.x + rail.w, y1, RAIL_TOP], { tone: 'mid' }, {
    r: 0.8,
    steps: 2,
    bevel: 0.3,
    extra: Dots(Array.from({ length: 14 }, (_, i) => at([rail.x + 14 + i * 32, (y0 + y1) / 2, RAIL_TOP])), { size: 0.4 }),
    bias: -1,
  });
}
// Slot marks: one major tick per station on a strip along the front of the bed.
{
  const strip = { x: TRACK.x + 6, y: 15.6, w: TRACK.w - 12, d: 2.8, r: 0.4 };
  const marks = k.topTicks(strip.x + 2, strip.x + strip.w - 2, PITCH / 4, 4, strip.y, TRACK_TOP + 0.3, [1, 2.2], P);
  put('track.strip', [0, 17, TRACK_TOP], S(k.slabOf(strip, TRACK_TOP, 0.3, P, 2), { tone: 'lo', crease: 'none' }) + Ln(marks.minor, { tone: 'lo' }) + Ln(marks.major, { tone: 'mid' }), [R.solid(A.slab(strip, TRACK_TOP, 0.3, { name: 'track.strip' }, 2))], { bias: 0.2 });
}
box('track.stop', [TRACK.x - 6, -16, 0], [TRACK.x, 16, 16], { tone: 'mid' }, { r: 1.2, bevel: 0.4, extra: Dots([at([TRACK.x - 3, -10, 16]), at([TRACK.x - 3, 10, 16])], { size: 0.45 }) });

// ---------------------------------------------------------------- 02 the mode lever, front left
const LEVER = { x: -170, y: 40, w: 60, d: 18, r: 2 };
const LEVER_X = { T: -158, F: -140, P: -122 };
box('lever.box', [LEVER.x, LEVER.y, 0], [LEVER.x + LEVER.w, LEVER.y + LEVER.d, 8], { tone: 'mid' }, {
  r: 2,
  steps: 4,
  bevel: 0.5,
  piece: 'lever',
  inner: Ln(k.sideSeam(LEVER, 3.4, P, 4), { tone: 'faint' }),
  extra:
    Ln(k.planOutline({ x: LEVER_X.T - 3, y: LEVER.y + 7.4, w: LEVER_X.P - LEVER_X.T + 6, d: 3.2, r: 1.6 }, 8, P, 4), { tone: 'lo' }) +
    Ln(Object.values(LEVER_X).map((x) => k.lineOnTop([x, LEVER.y + 11.4], [x, LEVER.y + 14.4], 8, P)).join(''), { tone: 'mid' }) +
    Dots(k.corners(LEVER, 3).map(([x, y]) => at([x, y, 8])), { size: 0.45 }),
});
put('lever.knob', [LEVER_X.T, LEVER.y + 9, 14], `<g data-part="lever">${S(k.cylinder(LEVER_X.T, LEVER.y + 9, 1.3, 8, 10, P, 16), { tone: 'mid', crease: 'none' })}${S(G.sphereOf([LEVER_X.T, LEVER.y + 9, 20.9], 3, P, { steps: 28 }), { tone: 'hi' })}</g>`, [R.solid(A.cylinder(LEVER_X.T, LEVER.y + 9, 1.3, 8, 10, { name: 'lever.post' })), R.solid(A.ball([LEVER_X.T, LEVER.y + 9, 20.9], 3, { name: 'lever.knob' }))], { piece: 'lever', bias: 0.4 });
// The golden rack beside the lever: the canonical Givens a teacher forced block starts from, one per block.
const GOLD = { x: -262, y: 40, w: 66, d: 18, r: 2 };
box('golden.rack', [GOLD.x, GOLD.y, 0], [GOLD.x + GOLD.w, GOLD.y + GOLD.d, 6], { tone: 'mid' }, {
  r: 2,
  steps: 4,
  bevel: 0.5,
  piece: 'lever',
  inner: Ln(k.sideSeam(GOLD, 2.6, P, 4), { tone: 'faint' }),
  extra: Dots(k.corners(GOLD, 2.4).map(([x, y]) => at([x, y, 6])), { size: 0.45 }),
});
for (let i = 0; i < 5; i++) {
  const x = GOLD.x + 9 + i * 12;
  const y = GOLD.y + 9;
  post('golden.capsule', x, y, 6, 15, 4.4, { tone: 'hi' }, { piece: 'lever', inner: Ln(k.sideArc(x, y, 4.4, 10.4, P, 20), { tone: 'faint' }) });
  post('golden.cap', x, y, 15, 16.8, 4.9, { tone: 'mid' }, { piece: 'lever', extra: Ln(k.ring(x, y, 2.6, 16.8, P, 20), { tone: 'lo' }) });
}

// ---------------------------------------------------------------- 01 the generation hopper over slot 0
const X0 = SLOTS[0];
const GUIDE = 23;
for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  const x = X0 + sx * GUIDE;
  const y = sy * GUIDE;
  box('magazine.post', [x - 1.6, y - 1.6, 2], [x + 1.6, y + 1.6, 84], { tone: 'mid' }, { r: 0.4, steps: 2, piece: 'hopper', bias: sy > 0 ? 0.5 : 0 });
  box('magazine.foot', [x - 3.4, y - 3.4, 0], [x + 3.4, y + 3.4, 2], { tone: 'lo' }, { r: 0.8, piece: 'hopper', extra: Dots([at([x - 2.4, y + 2.4, 2]), at([x + 2.4, y - 2.4, 2])], { size: 0.4 }) });
}
box('magazine.frame', [X0 - 27, -27, 84], [X0 + 27, 27, 88], { tone: 'mid' }, {
  r: 2,
  steps: 4,
  bevel: 0.5,
  piece: 'hopper',
  extra: Dots(k.corners({ x: X0 - 27, y: -27, w: 54, d: 54 }, 4).map(([x, y]) => at([x, y, 88])), { size: 0.5 }),
});
const HOP = upAt(X0, 0, 88);
const hopperProfile = [[0, 26], [8, 26], [8, 27.4], [10, 27.4], [10, 26.4], [36, 45], [38, 45], [38, 47], [41, 47], [41, 0]];
turned('hopper.body', HOP, hopperProfile, { tone: 'mid' }, {
  piece: 'hopper',
  inner: Ln(G.arcOf(HOP, 4, 26, P), { tone: 'faint' }),
  extra: Dots(G.dotsOf(HOP, 41, 43, 16, P, { all: true }), { size: 0.45, tone: 'mid' }),
});
// Three inlets on the lid, one per source of generated blocks: a prompt (a stack of cards), a
// specification (a binder) and past conversations (a reel of transcripts).
const LID = 129;
const INLETS = [
  { id: 'prompt', a: 3.62 },
  { id: 'spec', a: 4.5 },
  { id: 'past', a: 5.38 },
].map((inlet) => ({ ...inlet, x: X0 + 29 * Math.cos(inlet.a), y: 29 * Math.sin(inlet.a) }));
const FUNNEL = [[0, 0], [0, 4.8], [2.2, 4.8], [9, 9.2], [10, 9.2], [10, 8.4], [3.2, 4], [3.2, 0]];
for (const inlet of INLETS) {
  const F = upAt(inlet.x, inlet.y, LID);
  put(`inlet.${inlet.id}`, [inlet.x, inlet.y, LID + 5], S(G.lathe(FUNNEL, F, P, { steps: 48 }), { tone: 'mid' }), [R.solid(A.lathe(F, FUNNEL, { name: `inlet.${inlet.id}` }))], { piece: 'hopper' });
}
{
  const { x, y } = INLETS[0];
  for (let i = 0; i < 3; i++) box('inlet.prompt.card', [x - 9.6 + i * 0.8, y - 4.6 - i * 0.6, LID + 10 + i * 0.7], [x + 9.6 + i * 0.8, y + 4.6 - i * 0.6, LID + 10.7 + i * 0.7], { tone: 'hi' }, { r: 0.4, steps: 1, piece: 'hopper', bias: 0.2 + i * 0.1, extra: i === 2 ? Ln([5.6, 9.2, 3.8].map((w, j) => k.lineOnTop([x - 7 + i * 0.8, y - 2 - i * 0.6 + j * 1.8], [x - 7 + i * 0.8 + w, y - 2 - i * 0.6 + j * 1.8], LID + 10.7 + i * 0.7, P)).join(''), { tone: 'lo', free: true }) : '' });
}
{
  const { x, y } = INLETS[1];
  const top = LID + 13.4;
  box('inlet.spec.binder', [x - 9.6, y - 6.4, LID + 10], [x + 9.6, y + 6.4, top], { tone: 'hi' }, {
    r: 0.8,
    piece: 'hopper',
    bias: 0.3,
    inner: Ln(k.sideSeam({ x: x - 9.6, y: y - 6.4, w: 19.2, d: 12.8, r: 0.8 }, LID + 11.6, P, 3), { tone: 'faint' }),
    extra: Ln(k.lineOnTop([x - 6.4, y - 6.4], [x - 6.4, y + 6.4], top, P), { tone: 'lo' }) + Ln([0, 1, 2].map((j) => k.lineOnTop([x - 3.6, y - 3 + j * 2.6], [x + 6.8 - j * 2.2, y - 3 + j * 2.6], top, P)).join(''), { tone: 'lo', free: true }) + Dots([at([x - 6.4, y - 3.2, top]), at([x - 6.4, y + 3.2, top])], { size: 0.6, tone: 'hi' }),
  });
}
{
  const { x, y } = INLETS[2];
  box('inlet.past.bracket', [x + 9.2, y - 1, LID], [x + 11.2, y + 1, LID + 24], { tone: 'mid' }, { r: 0.4, steps: 2, piece: 'hopper' });
  const RF = alongX(x + 9.2, y, LID + 20);
  disc('inlet.past.axle', RF, -4.6, 0, 0.8, { tone: 'mid' }, { piece: 'hopper' });
  disc('inlet.past.flange', RF, -6.2, -4.6, 7.4, { tone: 'hi' }, { piece: 'hopper', extra: Ln(G.circleOf(RF, -4.6, 2.4, P, 24), { tone: 'lo' }) });
  disc('inlet.past.tape', RF, -8.6, -6.2, 5.8, { tone: 'mid' }, { piece: 'hopper' });
  disc('inlet.past.flange2', RF, -10.2, -8.6, 7.4, { tone: 'hi' }, { piece: 'hopper', extra: Ln(G.circleOf(RF, -10.2, 2.4, P, 24), { tone: 'lo' }) });
}
// The hatch on the lid.
box('hopper.hatch', [X0 + 6, -10, 129], [X0 + 26, 10, 130.4], { tone: 'mid' }, { r: 1.2, piece: 'hopper', extra: Dots([at([X0 + 8.4, -7.6, 130.4]), at([X0 + 23.6, 7.6, 130.4]), at([X0 + 8.4, 7.6, 130.4]), at([X0 + 23.6, -7.6, 130.4])], { size: 0.4 }) });
// The coverage gauge: a pegboard of flow by deviation cells on the magazine's front plate.
const PEG = { x0: X0 - 20, z0: 82, cols: 10, rows: 5, gap: 3.6 };
box('coverage.plate', [X0 - 22, GUIDE + 1.6, 58], [X0 + 22, GUIDE + 3.2, 84], { tone: 'mid' }, {
  r: 0.5,
  steps: 2,
  piece: 'hopper',
  bias: 1,
  extra: `<g data-part="pegs">${Array.from({ length: PEG.rows * PEG.cols }, (_, i) => {
    const c = i % PEG.cols;
    const r = Math.floor(i / PEG.cols);
    const p = at([X0 - 16.2 + c * PEG.gap, GUIDE + 3.25, 80 - r * PEG.gap]);
    return `<circle class="an-peg" data-peg="${i}" cx="${f2(p[0])}" cy="${f2(p[1])}" r="0.9"/>`;
  }).join('')}</g>` + Dots([at([X0 - 20, GUIDE + 3.25, 82]), at([X0 + 20, GUIDE + 3.25, 82]), at([X0 - 20, GUIDE + 3.25, 60]), at([X0 + 20, GUIDE + 3.25, 60])], { size: 0.4 }),
});
// The validity gate: a flap on the side outlet, a chute and the reject tray behind the magazine.
const REJECT = { x: -284, y: -8, w: 30, d: 26 };
box('reject.floor', [REJECT.x, REJECT.y, 0], [REJECT.x + REJECT.w, REJECT.y + REJECT.d, 1.2], { tone: 'lo' }, { piece: 'hopper' });
box('reject.back', [REJECT.x, REJECT.y, 1.2], [REJECT.x + REJECT.w, REJECT.y + 1.2, 9], { tone: 'mid' }, { piece: 'hopper' });
box('reject.left', [REJECT.x, REJECT.y + 1.2, 1.2], [REJECT.x + 1.2, REJECT.y + REJECT.d, 9], { tone: 'mid' }, { piece: 'hopper' });
for (const [i, [x, y]] of [[-280, -4], [-269, 2], [-279, 9]].entries()) box('reject.block', [x, y, 1.2], [x + 8, y + 5.6, 2.8 + (i === 1 ? 0.6 : 0)], { tone: 'hi' }, { r: 0.6, steps: 2, piece: 'hopper', extra: Ln(k.lineOnTop([x + 1.6, y + 2.8], [x + 6.4, y + 2.8], 2.8 + (i === 1 ? 0.6 : 0), P), { tone: 'lo', free: true }) });
box('reject.right', [REJECT.x + REJECT.w - 1.2, REJECT.y + 1.2, 1.2], [REJECT.x + REJECT.w, REJECT.y + REJECT.d, 9], { tone: 'mid' }, { piece: 'hopper', bias: 0.4 });
box('reject.front', [REJECT.x + 1.2, REJECT.y + REJECT.d - 1.2, 1.2], [REJECT.x + REJECT.w - 1.2, REJECT.y + REJECT.d, 9], { tone: 'mid' }, { piece: 'hopper', bias: 0.6 });
// The validity gate: a housing on the magazine with a flap; a candidate that fails a check slides down the chute.
box('gate.housing', [X0 - 33, -14, 66], [X0 - 25, 14, 84], { tone: 'mid' }, {
  r: 0.8,
  bevel: 0.3,
  piece: 'hopper',
  inner: Ln(k.sideSeam({ x: X0 - 33, y: -14, w: 8, d: 28, r: 0.8 }, 79, P, 3), { tone: 'faint' }),
  extra: Dots([at([X0 - 33, 10, 70]), at([X0 - 33, -10, 70]), at([X0 - 33, 10, 81.4]), at([X0 - 33, -10, 81.4])], { size: 0.45 }),
});
put('gate.flap', [X0 - 33.6, 0, 75], `<g data-part="flap">${S(k.slabOf({ x: X0 - 34.2, y: -7, w: 1.2, d: 14, r: 0.4 }, 70.6, 8.8, P, 1), { tone: 'hi' })}</g>`, [R.solid(A.slab({ x: X0 - 34.2, y: -7, w: 1.2, d: 14, r: 0.4 }, 70.6, 8.8, { name: 'gate.flap' }, 1))], { piece: 'hopper', bias: 0.3 });
{
  const from = [X0 - 33, 4, 68];
  const to = [REJECT.x + 15, 4, 12];
  const d = G.unit3(G.sub3(to, from));
  const u = [0, 1, 0];
  const F = G.frameOf(from, d, u, G.unit3(G.cross3(d, u)));
  const length = G.len3(G.sub3(to, from));
  prism('gate.chute', F, [[-6, -0.5], [6, -0.5], [6, 0.5], [-6, 0.5]], 0, length, { tone: 'mid' }, { piece: 'hopper', bias: 0.2 });
  for (const side of [-1, 1]) prism('gate.chute.lip', F, [[side * 6 - 0.5, -2.6], [side * 6 + 0.5, -2.6], [side * 6 + 0.5, 0.5], [side * 6 - 0.5, 0.5]], 0, length, { tone: 'mid' }, { piece: 'hopper', bias: side > 0 ? 0.4 : 0.1 });
}

// ---------------------------------------------------------------- 03 the deviation punch over slot 1
const X1 = SLOTS[1];
box('punch.column', [X1 - 5, -46, 3], [X1 + 5, -36, 76], { tone: 'mid' }, { r: 1.2, bevel: 0.5, piece: 'punch', inner: Ln([20, 52].map((z) => k.sideSeam({ x: X1 - 5, y: -46, w: 10, d: 10, r: 1.2 }, z, P, 3)).join(''), { tone: 'faint' }) });
box('punch.foot', [X1 - 9, -50, 0], [X1 + 9, -32, 3], { tone: 'lo' }, { r: 1.4, piece: 'punch', extra: Dots(k.corners({ x: X1 - 9, y: -50, w: 18, d: 18 }, 2.4).map(([x, y]) => at([x, y, 3])), { size: 0.45 }) });
box('punch.arm', [X1 - 4, -36, 68], [X1 + 4, 2, 76], { tone: 'mid' }, { r: 1.2, bevel: 0.4, piece: 'punch', bias: 1 });
const PUNCH = upAt(X1, -2, 0);
turned('punch.housing', PUNCH, [[48, 6.4], [58, 6.4], [58, 5.2], [68, 5.2]], { tone: 'mid' }, { piece: 'punch', inner: Ln(G.arcOf(PUNCH, 53, 6.4, P), { tone: 'faint' }), bias: 1.2 });
put('punch.lamp', [X1 + 6.4, -2, 63], `<g class="an-spark" data-part="spark">${S(G.sphereOf([X1 + 5.6, 1.2, 62], 1.5, P, { steps: 20 }), { tone: 'mid' })}<circle class="an-spark-dot" cx="${f2(at([X1 + 5.6, 1.2, 62])[0])}" cy="${f2(at([X1 + 5.6, 1.2, 62])[1])}" r="1.1"/></g>`, [R.solid(A.ball([X1 + 5.6, 1.2, 62], 1.5, { name: 'punch.lamp' }))], { piece: 'punch', bias: 1.4 });
put('punch.ram', [X1, -2, 44], `<g data-part="ram">${S(k.cylinder(X1, -2, 2.2, 38, 10, P, 20), { tone: 'hi' })}${S(k.cylinder(X1, -2, 3.4, 36.4, 1.6, P, 24), { tone: 'mid' })}</g>`, [R.solid(A.cylinder(X1, -2, 3.4, 36.4, 11.6, { name: 'punch.ram' }))], { piece: 'punch', bias: 1.1 });

// ---------------------------------------------------------------- 04 the agent cell over slot 2
const X2 = SLOTS[2];
const BOOTH = { x0: X2 - 28, x1: X2 + 28, y0: -46, y1: 34, z: 78 };
for (const [x, y] of [[BOOTH.x0, BOOTH.y0], [BOOTH.x1, BOOTH.y0], [BOOTH.x0, BOOTH.y1], [BOOTH.x1, BOOTH.y1]]) {
  box('booth.post', [x - 1.8, y - 1.8, 2], [x + 1.8, y + 1.8, BOOTH.z], { tone: 'mid' }, { r: 0.5, steps: 2, piece: 'agent', bias: y > 0 ? 0.6 : 0 });
  box('booth.foot', [x - 3.6, y - 3.6, 0], [x + 3.6, y + 3.6, 2], { tone: 'lo' }, { r: 0.8, piece: 'agent' });
}
// An open frame on the four posts, so the adapters stay in view; the shuttle rail runs front to back.
for (const y of [BOOTH.y0, BOOTH.y1]) {
  box('booth.beam', [BOOTH.x0 - 1.8, y - 1.8, BOOTH.z], [BOOTH.x1 + 1.8, y + 1.8, BOOTH.z + 4], { tone: 'mid' }, { r: 0.6, steps: 2, bevel: 0.3, piece: 'agent', bias: y > 0 ? 0.9 : 0, extra: Dots([at([BOOTH.x0, y, BOOTH.z + 4]), at([BOOTH.x1, y, BOOTH.z + 4])], { size: 0.5 }) });
}
for (const x of [BOOTH.x0, BOOTH.x1]) box('booth.beam', [x - 1.8, BOOTH.y0 + 1.8, BOOTH.z], [x + 1.8, BOOTH.y1 - 1.8, BOOTH.z + 4], { tone: 'mid' }, { r: 0.6, steps: 2, bevel: 0.3, piece: 'agent', bias: 0.2 });
// The glass front: a frame with two glare strokes, so the block stays in view.
box('booth.sill', [BOOTH.x0 + 1.8, BOOTH.y1 - 1, 30], [BOOTH.x1 - 1.8, BOOTH.y1 + 1, 32], { tone: 'mid' }, { r: 0.3, steps: 1, piece: 'agent', bias: 0.8 });
// The shuttle rail under the roof and the two adapters it carries.
box('booth.rail', [X2 - 3.4, BOOTH.y0 + 1.8, BOOTH.z], [X2 + 3.4, BOOTH.y1 - 1.8, BOOTH.z + 4], { tone: 'mid' }, { r: 0.6, piece: 'agent', bias: 0.5, extra: Dots([-30, -12, 6, 24].map((y) => at([X2, y, BOOTH.z + 4])), { size: 0.45 }) });
// The shuttle carries both adapters 24 apart; it slides so the one the block needs hangs over the track.
const ADAPT_Y = { conversation: -12, task: 12 };
const SHUTTLE_SVG = (() => {
  const out = [];
  // the code interpreter adapter, behind: a box module with its workspace drawer
  const y = -12;
  out.push(`<g data-part="adapter-work">`);
  out.push(S(k.slabOf({ x: X2 - 4, y: y - 4, w: 8, d: 8, r: 1 }, 74, 4, P, 2), { tone: 'mid' }));
  out.push(S(k.slabOf({ x: X2 - 9, y: y - 7, w: 18, d: 14, r: 1.2 }, 58, 16, P, 3, 0.4), { tone: 'hi', inner: Ln(k.sideSeam({ x: X2 - 9, y: y - 7, w: 18, d: 14, r: 1.2 }, 63, P, 3), { tone: 'faint' }) }));
  out.push(`<g data-part="drawer">`);
  out.push(S(k.slabOf({ x: X2 + 3, y: y - 5.6, w: 8, d: 11.2, r: 0.6 }, 59, 3.6, P, 2), { tone: 'mid' }));
  out.push(Ln([0, 1, 2].map((i) => k.lineOnTop([X2 + 5.2 + i * 2.2, y - 5.6], [X2 + 5.2 + i * 2.2, y + 5.6], 62.6, P)).join(''), { tone: 'lo' }));
  out.push(`</g>`);
  out.push(S(k.cylinder(X2, y, 2.6, 50, 8, P, 20), { tone: 'mid' }));
  out.push(S(k.cylinder(X2, y, 3.8, 47, 3, P, 24), { tone: 'mid' }));
  out.push(`</g>`);
  // the conversational adapter, in front: a round module with a grille
  const C = upAt(X2, 12, 0);
  out.push(`<g data-part="adapter-talk">`);
  out.push(S(k.slabOf({ x: X2 - 4, y: 8, w: 8, d: 8, r: 1 }, 74, 4, P, 2), { tone: 'mid' }));
  out.push(S(G.solidOf([[58, 8], [72, 8], [72, 6.4], [74, 6.4]], C, P), { tone: 'hi', inner: Ln(G.arcOf(C, 65, 8, P), { tone: 'faint' }) }));
  out.push(k.fadedSvg(G.ribsOf(C, 59.4, 70.6, 8, 32, P, { fade: [0.1, 0.55], seams: true }), { tone: 'lo' }));
  out.push(S(G.solidOf([[50, 2.6], [58, 2.6]], C, P), { tone: 'mid' }));
  out.push(S(G.solidOf([[47, 3.8], [50, 3.8]], C, P), { tone: 'mid' }));
  out.push(`</g>`);
  return out.join('');
})();
put('agent.shuttle', [X2, 0, 60], `<g data-part="shuttle">${SHUTTLE_SVG}</g>`, [R.solid(A.box([X2 - 9, -19, 47], [X2 + 11, 20, 78], { name: 'agent.shuttle' }))], { piece: 'agent', bias: 0.4 });

// ---------------------------------------------------------------- 05 the check gantry over slot 3
const X3 = SLOTS[3];
const GX = X3 + 14.7;
for (const y of [-30, 30]) {
  box('gantry.post', [GX - 4, y - 3, 2.4], [GX + 4, y + 3, 70], { tone: 'mid' }, { r: 1, bevel: 0.4, piece: 'gantry', bias: y > 0 ? 0.6 : 0, inner: Ln(k.sideSeam({ x: GX - 4, y: y - 3, w: 8, d: 6, r: 1 }, 40, P, 3), { tone: 'faint' }) });
  box('gantry.foot', [GX - 7, y - 6, 0], [GX + 7, y + 6, 2.4], { tone: 'lo' }, { r: 1.2, piece: 'gantry', extra: Dots(k.corners({ x: GX - 7, y: y - 6, w: 14, d: 12 }, 2).map(([x, yy]) => at([x, yy, 2.4])), { size: 0.4 }) });
}
box('gantry.beam', [GX - 5, -34, 70], [GX + 5, 34, 78], { tone: 'mid' }, { r: 1.2, bevel: 0.5, piece: 'gantry', bias: 0.8, extra: Dots([-28, 28].map((y) => at([GX, y, 78])), { size: 0.5 }) });
for (const y of [-10, 10]) post('gantry.guide', GX, y, 48, 70, 1.1, { tone: 'mid', crease: 'none' }, { piece: 'gantry', bias: 0.5 });
const PADS = M.CHECKS.map((name, i) => ({ name, x: 10.9 + (i % 3) * 3.8, y: -8.6 + Math.floor(i / 3) * 8 }));
const HEAD_SVG = (() => {
  const out = [];
  const pins = [...PADS].sort((a, b) => k.depthOf([a.x, a.y, 0], P) - k.depthOf([b.x, b.y, 0], P));
  for (const pad of pins) out.push(S(k.cylinder(X3 + pad.x, pad.y, 0.6, 37, 7, P, 12), { tone: 'hi', crease: 'none' }));
  out.push(S(k.slabOf({ x: X3 + 8.4, y: -13, w: 12.6, d: 24.4, r: 1.2 }, 44, 4, P, 3, 0.4), { tone: 'mid' }));
  out.push(`<g data-part="flags">${PADS.map((pad) => `<g data-flag="${pad.name}">${S(k.slabOf({ x: X3 + pad.x - 0.8, y: pad.y - 1.4, w: 1.6, d: 2.8, r: 0.3 }, 48, 3, P, 1), { tone: 'hi' })}</g>`).join('')}</g>`);
  return out.join('');
})();
put('gantry.head', [X3 + 14.7, -0.6, 44], `<g data-part="head">${HEAD_SVG}</g>`, [R.solid(A.box([X3 + 8.4, -13, 44], [X3 + 21, 11.4, 48], { name: 'gantry.head' })), R.solid(A.box([X3 + 10.2, -9.3, 37], [X3 + 19.2, 8.1, 44], { name: 'gantry.pins' }))], { piece: 'gantry', bias: 0.7 });

// ---------------------------------------------------------------- 06 the judge council behind slot 4
const X4 = SLOTS[4];
const BENCH = { x: X4 - 44, y: -94, w: 88, d: 56, r: 3 };
box('council.bench', [BENCH.x, BENCH.y, 0], [BENCH.x + BENCH.w, BENCH.y + BENCH.d, 16], { tone: 'mid' }, {
  r: 3,
  steps: 4,
  bevel: 0.5,
  piece: 'council',
  inner: Ln(k.sideSeam(BENCH, 11, P, 4), { tone: 'faint' }),
  extra: Dots(k.corners(BENCH, 3.4).map(([x, y]) => at([x, y, 16])), { size: 0.5 }),
});
// the reading arm over the block
box('council.mast', [X4 - 3, -42, 16], [X4 + 3, -36, 48], { tone: 'mid' }, { r: 0.8, piece: 'council', inner: Ln(k.sideSeam({ x: X4 - 3, y: -42, w: 6, d: 6, r: 0.8 }, 30, P, 2), { tone: 'faint' }) });
box('council.arm', [X4 - 3, -42, 48], [X4 + 3, 2, 52], { tone: 'mid' }, { r: 0.8, bevel: 0.3, piece: 'council', bias: 0.6 });
turned('council.reader', upAt(X4, -2, 0), [[38, 4], [44, 4], [44, 3], [48, 3]], { tone: 'hi' }, { piece: 'council', bias: 0.7, inner: Ln(G.arcOf(upAt(X4, -2, 0), 41, 4, P), { tone: 'faint' }) });
// two rows of three balances: system 1 in front, system 2 behind with a reasoning drum each
const JUDGES = [];
for (const [row, cls, y, size] of [[0, 'system1', -50, 1], [1, 'system2', -80, 1.2]]) {
  for (let i = 0; i < 3; i++) {
    const x = X4 - 27 + i * 27;
    const id = `${cls}.${i}`;
    JUDGES.push({ id, cls, x, y, size });
    post(`judge.base`, x, y, 16, 18, 4.6 * size, { tone: 'lo' }, { piece: 'council' });
    post(`judge.pillar`, x, y, 18, 18 + 12 * size, 0.9 * size, { tone: 'mid', crease: 'none' }, { piece: 'council' });
    box('judge.fulcrum', [x - 1.4 * size, y - 1.4 * size, 18 + 12 * size], [x + 1.4 * size, y + 1.4 * size, 18 + 14 * size], { tone: 'mid' }, { r: 0.3, steps: 1, piece: 'council' });
    if (cls === 'system2') {
      const D = alongY(x, y - 6.6, 21.4);
      disc('judge.drum', D, 0, 3, 3.4, { tone: 'hi' }, { piece: 'council', extra: Ln(G.circleOf(D, 3, 1.2, P, 16), { tone: 'lo' }) });
      box('judge.drum.cheek', [x - 4.2, y - 8.6, 18], [x - 3.4, y - 3.6, 26], { tone: 'lo' }, { r: 0.2, steps: 1, piece: 'council' });
    }
    put(`judge.beam`, [x, y, 18 + 15 * size], `<g data-judge="${id}"></g>`, [R.solid(A.box([x - 7.5 * size - 3.4 * size, y - 3.4 * size, 18 + 14 * size], [x + 7.5 * size + 3.4 * size, y + 3.4 * size, 18 + 17.8 * size], { name: 'judge.beam' }))], { piece: 'council', bias: 0.5 });
  }
}
// the selector that engages a class, and the fixture pair that earned it
box('council.selector', [X4 - 8, BENCH.y + BENCH.d - 0.2, 4], [X4 + 8, BENCH.y + BENCH.d + 1.6, 12], { tone: 'lo' }, { r: 0.4, piece: 'council', extra: Ln(path3([[X4 - 5.6, BENCH.y + BENCH.d + 1.62, 7.3], [X4 + 5.6, BENCH.y + BENCH.d + 1.62, 7.3], [X4 + 5.6, BENCH.y + BENCH.d + 1.62, 8.7], [X4 - 5.6, BENCH.y + BENCH.d + 1.62, 8.7]], true), { tone: 'lo' }) });
put('council.key', [X4, BENCH.y + BENCH.d + 2.6, 8], `<g data-part="key">${S(k.slabOf({ x: X4 - 1.2, y: BENCH.y + BENCH.d + 1.6, w: 2.4, d: 2, r: 0.4 }, 6.2, 3.6, P, 2), { tone: 'hi' })}</g>`, [R.solid(A.box([X4 - 6.2, BENCH.y + BENCH.d + 1.6, 6.2], [X4 + 6.2, BENCH.y + BENCH.d + 3.6, 9.8], { name: 'council.key' }))], { piece: 'council', bias: 0.4 });
const FIX = { x: X4 + 34, y: -62 };
box('fixture.stand', [FIX.x - 1, FIX.y, 16], [FIX.x + 9, FIX.y + 22, 18], { tone: 'lo' }, { r: 0.6, piece: 'council' });
for (const [i, clean] of [[0, false], [1, true]]) {
  const y = FIX.y + 2 + i * 11;
  box('fixture.block', [FIX.x, y, 18], [FIX.x + 8, y + 8, 21], { tone: 'hi' }, {
    r: 0.6,
    piece: 'council',
    extra: clean
      ? Dots([at([FIX.x + 4, y + 4, 21])], { size: 0.7, tone: 'hi' })
      : Ln(k.lineOnTop([FIX.x + 2, y + 2], [FIX.x + 6, y + 6], 21, P) + k.lineOnTop([FIX.x + 6, y + 2], [FIX.x + 2, y + 6], 21, P), { tone: 'hi' }),
  });
}

// ---------------------------------------------------------------- the verdict reader over slot 5
const X5 = SLOTS[5];
for (const y of [-21, 21]) {
  box('reader.post', [X5 + 17, y - 1.6, 0], [X5 + 20, y + 1.6, 24], { tone: 'mid' }, { r: 0.4, steps: 2, piece: 'chart', bias: y > 0 ? 0.6 : 0 });
  box('reader.eye', [X5 + 15.6, y > 0 ? y - 4.6 : y + 1.6, 18], [X5 + 21.4, y > 0 ? y - 1.6 : y + 4.6, 23], { tone: 'hi' }, { r: 0.4, piece: 'chart', bias: y > 0 ? 0.7 : 0.1 });
}

// ---------------------------------------------------------------- the store at the end of the line
box('store.floor', [STORE.x, STORE.y, 0], [STORE.x + STORE.w, STORE.y + STORE.d, 1.4], { tone: 'lo' }, { piece: 'store' });
box('store.back', [STORE.x, STORE.y, 1.4], [STORE.x + STORE.w, STORE.y + 1.4, STORE_H], { tone: 'mid' }, { piece: 'store', bias: -0.5 });
box('store.left', [STORE.x, STORE.y + 1.4, 1.4], [STORE.x + 1.4, STORE.y + STORE.d, 8], { tone: 'mid' }, { piece: 'store', bias: -0.5 });
box('store.right', [STORE.x + STORE.w - 1.4, STORE.y + 1.4, 1.4], [STORE.x + STORE.w, STORE.y + STORE.d, STORE_H], { tone: 'mid' }, { piece: 'store', bias: 3 });
box('store.front', [STORE.x + 1.4, STORE.y + STORE.d - 1.4, 1.4], [STORE.x + STORE.w - 1.4, STORE.y + STORE.d, STORE_H], { tone: 'mid' }, {
  piece: 'store',
  bias: 3.2,
  inner: Ln(k.sideSeam({ x: STORE.x + 1.4, y: STORE.y + STORE.d - 1.4, w: STORE.w - 2.8, d: 1.4, r: 0.5 }, STORE_H - 5, P, 3), { tone: 'faint' }),
  extra: Dots([at([STORE.x + 5, STORE.y + STORE.d, STORE_H - 2.5]), at([STORE.x + STORE.w - 5, STORE.y + STORE.d, STORE_H - 2.5])], { size: 0.45 }),
});

// ---------------------------------------------------------------- 07 to 09 the console: chart, dial, counters
box('console.cabinet', [CONSOLE.x, CONSOLE.y, 0], [CONSOLE.x + CONSOLE.w, CONSOLE.y + CONSOLE.d, CONSOLE_H], { tone: 'mid' }, {
  r: 3,
  steps: 4,
  bevel: 0.6,
  piece: 'console',
  bias: -3,
  inner: Ln(k.sideSeam(CONSOLE, 30, P, 4), { tone: 'faint' }),
  extra:
    Dots(k.corners(CONSOLE, 4).map(([x, y]) => at([x, y, CONSOLE_H])), { size: 0.5 }) +
    Ln(Array.from({ length: 6 }, (_, i) => k.planOutline({ x: CONSOLE.x + 150 + i * 12, y: CONSOLE.y + 7, w: 3, d: 14, r: 1.5 }, CONSOLE_H, P, 3)).join(''), { tone: 'faint' }) +
    Ln(path3([[CONSOLE.x + CONSOLE.w + 0.02, CONSOLE.y + 5, 40], [CONSOLE.x + CONSOLE.w + 0.02, CONSOLE.y + CONSOLE.d - 5, 40], [CONSOLE.x + CONSOLE.w + 0.02, CONSOLE.y + CONSOLE.d - 5, 96], [CONSOLE.x + CONSOLE.w + 0.02, CONSOLE.y + 5, 96]], true), { tone: 'faint' }) +
    Dots([[CONSOLE.y + 8, 43], [CONSOLE.y + CONSOLE.d - 8, 43], [CONSOLE.y + 8, 93], [CONSOLE.y + CONSOLE.d - 8, 93]].map(([y, z]) => at([CONSOLE.x + CONSOLE.w + 0.02, y, z])), { size: 0.45 }),
});
const CHART = { x: CONSOLE.x + 10, w: 116, z0: 98, h: 44 };
const DIAL = { x: CONSOLE.x + 160, z: 76, r: 24 };
const COUNT = { x: CONSOLE.x + 194, z0: 98 };
const faceAt = (u, z) => [CONSOLE.x + u, FACE_Y, z];
// chart recorder: bezel, two paper rollers and the window drawn in the face plane
box('chart.bezel', [CHART.x - 4, FACE_Y, CHART.z0 - CHART.h - 4], [CHART.x + CHART.w + 4, FACE_Y + 2, CHART.z0 + 4], { tone: 'mid' }, { r: 1.2, steps: 3, piece: 'chart', bias: 0.2 });
for (const x of [CHART.x - 1, CHART.x + CHART.w + 1]) post('chart.roller', x, FACE_Y + 3.4, CHART.z0 - CHART.h - 2, CHART.z0 + 2, 1.6, { tone: 'hi' }, { piece: 'chart', bias: 0.6 });
put('chart.window', [CHART.x + CHART.w / 2, FACE_Y + 2.1, CHART.z0 - CHART.h / 2], `<g transform="${faceMatrix(CHART.x, FACE_Y + 2.05, CHART.z0)}"><rect class="an-paper" x="0" y="0" width="${CHART.w}" height="${CHART.h}"/><g data-part="chart-grid"></g><g data-part="chart-trace"></g><path class="an-chart-mid" d="M0 ${CHART.h / 2}H${CHART.w}"/><g data-part="pen"></g></g>`, [R.solid(A.box([CHART.x, FACE_Y + 2, CHART.z0 - CHART.h], [CHART.x + CHART.w, FACE_Y + 2.1, CHART.z0], { name: 'chart.window' }))], { piece: 'chart', bias: 0.5 });
// mode lamps under the chart: the lit one is the mode the campaign runs in
const LAMPS = M.MODES.map((mode, i) => ({ mode, x: CHART.x + 8 + i * 12, z: CHART.z0 - CHART.h - 12 }));
for (const lamp of LAMPS) {
  const LF = alongY(lamp.x, FACE_Y, lamp.z);
  disc('console.lamp.ring', LF, 0, 1.2, 3.4, { tone: 'mid' }, { piece: 'console', bias: 0.3 });
  put('console.lamp', [lamp.x, FACE_Y + 2.1, lamp.z], `<g data-lamp="${lamp.mode}">${S(G.solidOf([[1.2, 2.4], [1.8, 2.4], [2.6, 1.6, 1], [3, 0.6, 1]], LF, P), { tone: 'hi' })}</g>`, [R.solid(A.solid(LF, [[1.2, 2.4], [1.8, 2.4], [2.6, 1.6], [3, 0.6]], { name: 'console.lamp' }))], { piece: 'console', bias: 0.4 });
}
put('console.vents', [CONSOLE.x + 200, FACE_Y + 0.05, 22], Ln(Array.from({ length: 7 }, (_, i) => path3([[CONSOLE.x + 176 + i * 7, FACE_Y + 0.02, 12], [CONSOLE.x + 179 + i * 7, FACE_Y + 0.02, 12], [CONSOLE.x + 179 + i * 7, FACE_Y + 0.02, 30], [CONSOLE.x + 176 + i * 7, FACE_Y + 0.02, 30]], true)).join(''), { tone: 'faint' }), [R.solid(A.box([CONSOLE.x + 176, FACE_Y, 12], [CONSOLE.x + 224, FACE_Y + 0.05, 30], { name: 'console.vents' }))], { piece: 'console', bias: 0.1 });
box('console.plate', [CONSOLE.x + 20, FACE_Y, 14], [CONSOLE.x + 60, FACE_Y + 0.8, 28], { tone: 'lo' }, { r: 0.8, piece: 'console', bias: 0.1, extra: Ln([22, 30, 16].map((w, i) => path3([[CONSOLE.x + 24, FACE_Y + 0.82, 25 - i * 3.6], [CONSOLE.x + 24 + w, FACE_Y + 0.82, 25 - i * 3.6]])).join(''), { tone: 'lo', free: true }) + Dots([at([CONSOLE.x + 57, FACE_Y + 0.82, 25]), at([CONSOLE.x + 57, FACE_Y + 0.82, 17])], { size: 0.45 }) });

// dial: a bezel ring on the face, the paper dial drawn flat, needle and two drag pointers
const DF = alongY(DIAL.x, FACE_Y, DIAL.z);
turned('dial.bezel', DF, [[0, DIAL.r + 3], [3, DIAL.r + 3], [3, DIAL.r + 1.6], [3.6, DIAL.r + 1.6], [3.6, 0]], { tone: 'mid' }, { piece: 'dial', bias: 0.4 });
put('dial.face', [DIAL.x, FACE_Y + 3.7, DIAL.z], `<g transform="${faceMatrix(DIAL.x, FACE_Y + 3.65, DIAL.z)}" data-part="dial"></g>`, [R.solid(A.box([DIAL.x - DIAL.r, FACE_Y + 3.6, DIAL.z - DIAL.r], [DIAL.x + DIAL.r, FACE_Y + 3.7, DIAL.z + DIAL.r], { name: 'dial.face' }))], { piece: 'dial', bias: 0.6 });
// counters: three windows of number wheels
box('counter.housing', [COUNT.x, FACE_Y, COUNT.z0 - 46], [COUNT.x + 40, FACE_Y + 4, COUNT.z0], { tone: 'mid' }, { r: 1.4, steps: 3, bevel: 0.4, piece: 'dial', bias: 0.3, extra: Dots([[COUNT.x + 3, COUNT.z0 - 3], [COUNT.x + 37, COUNT.z0 - 3], [COUNT.x + 3, COUNT.z0 - 43], [COUNT.x + 37, COUNT.z0 - 43]].map(([x, z]) => at([x, FACE_Y + 4, z])), { size: 0.45 }) });
put('counter.windows', [COUNT.x + 20, FACE_Y + 4.1, COUNT.z0 - 23], `<g transform="${faceMatrix(COUNT.x, FACE_Y + 4.05, COUNT.z0)}">${[0, 1, 2]
  .map((i) => `<rect class="an-window" x="6" y="${5 + i * 13.4}" width="28" height="9" rx="1"/><text class="an-digits" data-counter="${i}" x="20" y="${12.1 + i * 13.4}" text-anchor="middle">--</text>`)
  .join('')}</g>`, [R.solid(A.box([COUNT.x + 6, FACE_Y + 4, COUNT.z0 - 43], [COUNT.x + 34, FACE_Y + 4.1, COUNT.z0 - 5], { name: 'counter.windows' }))], { piece: 'dial', bias: 0.5 });

// ---------------------------------------------------------------- 10 the CI gate at the far right
const GATE = { x: 272, y: -40 };
box('gate.post', [GATE.x - 3.4, GATE.y - 3.4, 2.4], [GATE.x + 3.4, GATE.y + 3.4, 54], { tone: 'mid' }, { r: 1, bevel: 0.4, piece: 'gate', inner: Ln(k.sideSeam({ x: GATE.x - 3.4, y: GATE.y - 3.4, w: 6.8, d: 6.8, r: 1 }, 30, P, 3), { tone: 'faint' }) });
box('gate.foot', [GATE.x - 7, GATE.y - 7, 0], [GATE.x + 7, GATE.y + 7, 2.4], { tone: 'lo' }, { r: 1.2, piece: 'gate', extra: Dots(k.corners({ x: GATE.x - 7, y: GATE.y - 7, w: 14, d: 14 }, 2).map(([x, y]) => at([x, y, 2.4])), { size: 0.45 }) });
disc('gate.hub', alongX(GATE.x + 3.4, GATE.y, 50), 0, 2.4, 4.4, { tone: 'mid' }, { piece: 'gate', bias: 0.6 });
put('gate.arm', [GATE.x + 6, GATE.y + 30, 50], `<g data-part="gate-arm"></g>`, [R.solid(A.box([GATE.x + 5.8, GATE.y - 10.5, 47.4], [GATE.x + 8, GATE.y + 58.5, 52.6], { name: 'gate.arm' }))], { piece: 'gate', bias: 0.8 });

// ---------------------------------------------------------------- signal cables from the stations to the console
cable('signal.gantry', [[GX, -33, 56], [GX, -37, 56], [GX, -37, 1.4], [GX - 7.4, -46, 1.4], [GX - 7.4, FACE_Y, 1.4]], 0.7, { tone: 'mid', bend: 4, piece: 'gantry', shells: [false, true] });
cable('signal.council', [[BENCH.x + 30, BENCH.y, 8], [BENCH.x + 30, FACE_Y, 8]], 0.7, { tone: 'mid', bend: 4, piece: 'council', shells: [false, true] });
// the console drives the gate: a cable from its right end along the floor to the gate's foot
cable('signal.gate', [[CONSOLE.x + CONSOLE.w, -114, 1.4], [GATE.x, -114, 1.4], [GATE.x, GATE.y - 7, 1.4]], 0.7, { tone: 'mid', bend: 6, piece: 'gate', shells: [true, false] });
// the mode lever sets the couplings: a cable from its box along the floor into the track bed
cable('signal.lever', [[LEVER.x + LEVER.w - 8, LEVER.y, 1.4], [LEVER.x + LEVER.w - 8, TRACK.y + TRACK.d, 1.4]], 0.7, { tone: 'mid', bend: 6, piece: 'lever', shells: [true, true] });

// ---------------------------------------------------------------- probes for the carriages: one block at every slot
const BLOCK_SHAPE = (x, name) => [A.slab({ x: x - 23, y: -16, w: 46, d: 32, r: 2.4 }, RAIL_TOP, DECK_TOP - RAIL_TOP, { name }), A.box([x - 5.8, -2.8, DECK_TOP], [x + 5.8, -1.4, CARD_TOP], { name: `${name}.card` }), A.cylinder(x - 14.5, -1, 5.5, DECK_TOP, 10.8, { name: `${name}.given` })];
const PROBE_X = [...SLOTS, EXIT_X - 20];
PROBE_X.forEach((x, i) => put(`probe.${i}`, [x, 0, 18], '', BLOCK_SHAPE(x, `probe.${i}`), { piece: 'blocks', probe: true }));

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

// Reserve the carriage layer in the settled order. The layer goes in just before the first probe, so a
// static item drawn after that point must be in front of every block it overlaps; a pair where the solver
// put a static item behind a later probe is a conflict the drawing would get wrong.
const firstKey = Math.min(...R.items.filter((item) => item.probe).map((item) => item.key));
const conflicts = [];
for (const pair of R.settled.overlaps.pairs) {
  const a = R.settled.items[pair.a];
  const b = R.settled.items[pair.b];
  if (a.probe === b.probe) continue;
  const [probe, item] = a.probe ? [a, b] : [b, a];
  if (item.key > firstKey && item.key < probe.key) conflicts.push(`${item.name} behind ${probe.name}`);
}
const drawn = R.items.filter((item) => !item.probe);
const insertAt = drawn.findIndex((item) => item.key > firstKey);

const groups = drawn.map((item) => `<g class="it" data-name="${item.name}" data-piece="${item.piece}">${item.svg}</g>`);
const LIVE_LAYER = `<g data-part="beam"></g><g data-part="cars"></g>`;
groups.splice(insertAt < 0 ? groups.length : insertAt, 0, LIVE_LAYER);

const LABEL_TEXT =
  'driftbench as a machine: an indexing test line on a cast bench. Blocks, each carrying its Given, When and Then, drop from a generation hopper fed by a prompt, a specification and past conversations, with a coverage pegboard and a validity gate. They index along a track through a deviation punch, the agent cell with a conversational adapter and a code interpreter adapter with its workspace drawer, a gantry of nine check pins, and a judge council of balances, then into the store. A mode lever beside a rack of golden Givens couples or uncouples the blocks. At the back, a chart recorder traces drift and recovery, a dial shows the pass rate with its interval and the gate threshold, counters show passes, pass^3 and recoveries, and a CI gate arm lifts or holds.';
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="an-line">${groups.join('')}</g>`] });

// ---------------------------------------------------------------- data for the page
const campaigns = Object.fromEntries(M.MODES.map((mode) => [mode, M.campaignOf(mode)]));
const DATA = {
  P,
  V,
  W,
  H,
  slots: SLOTS,
  pitch: PITCH,
  exitX: EXIT_X,
  store: STORE,
  railTop: RAIL_TOP,
  deckTop: DECK_TOP,
  cardTop: CARD_TOP,
  x0: X0,
  lever: LEVER_X,
  leverY: LEVER.y + 9,
  pads: PADS,
  judges: JUDGES,
  adaptY: ADAPT_Y,
  chart: CHART,
  dial: DIAL,
  gate: GATE,
  peg: PEG,
  campaigns,
  coverage: M.COVERAGE,
  candidates: M.CANDIDATES,
  model: { runs: M.RUNS, k: M.K, baseline: M.BASELINE, margin: M.MARGIN, threshold: M.THRESHOLD, checks: M.CHECKS, modeNames: M.MODE_NAMES },
};

const kitLicense = `/* The Anatomy kit, https://github.com/wheresryan22/anatomy, inlined below (iso-kit.mjs and lathe.mjs).\n${readFileSync(join(KIT, 'LICENSE'), 'utf8').trim()}\n*/\n`;
const kitSource = kitLicense + readFileSync(join(KIT, 'kit', 'iso-kit.mjs'), 'utf8').replace(/^export /gm, '');
const latheSource = readFileSync(join(KIT, 'kit', 'lathe.mjs'), 'utf8').replace(/^import .*$/m, '').replace(/^export /gm, '');
const latheScript = `const G = (() => {${latheSource}\nreturn { viewOf, scaleOf, frameAlong, frameOf, pointOf, disc, solidOf, sphereOf, prismOf, circleOf, arcOf, dot3, add3, sub3, mul3, unit3, cross3, len3, lightOf, toneOf, radialOf };})();\n`;
const modelScript = readFileSync(join(HERE, 'model.mjs'), 'utf8').replace(/^export /gm, '');
const CSS = readFileSync(join(HERE, 'anatomy.css'), 'utf8');
const LIVE = readFileSync(join(HERE, 'live.js'), 'utf8').replace('__DATA__', JSON.stringify(DATA));

const PIECES = [
  ['hopper', '01', 'Generation hopper', 'Blocks generated from a prompt, a specification or past conversations. The pegboard counts coverage; the gate rejects invalid blocks.'],
  ['lever', '02', 'Mode lever and golden rack', 'Teacher forced starts every block from the golden rack. Free running couples the blocks: what one block leaves rides into the next. Perturbed adds the punch.'],
  ['punch', '03', 'Deviation punch', 'In perturbed mode it injects a deviation at a chosen block.'],
  ['agent', '04', 'Agent cell', 'The agent under test, through an adapter: a conversation, or a code interpreter task step with its workspace drawer.'],
  ['gantry', '05', 'Check pins', 'Nine machine checks first: tools, text, language, stage, guards, skills, artifacts, workspace, safety. A machine fail is final.'],
  ['council', '06', 'Judge council', 'System 1 and system 2 balances, three per criterion, majority wins; the class that earned the criterion on its fixture pair votes.'],
  ['chart', '07', 'Drift chart', 'The pen leaves the line when a block drifts and comes back when the agent recovers.'],
  ['dial', '08', 'Interval dial and counters', 'Pass rate with its Wilson interval, the gate threshold, pass^3 and recoveries.'],
  ['gate', '09', 'CI gate', 'Lifts when the campaign is noninferior: the interval clears the baseline minus the margin.'],
];
const body = `<div class="an" data-part="root">
  <header class="an-head"><p class="an-kicker">Fig 7 · the anatomy of driftbench</p><h1 class="an-title">An indexing test line, one block per carriage.</h1></header>
  <div class="an-frame">${k.plateHtml({
    fig: 'Fig 7',
    title: 'driftbench test line',
    hint: '1 2 3 modes · space pause · hover a part',
    readout: 'teacher forced · run 0 of 10',
    keys: [],
    caption: '',
    body: `<div class="iso-stage an-stage" tabindex="0" role="group" aria-label="driftbench as a test line. Press 1, 2 or 3 to run the campaign teacher forced, free running or perturbed. Space pauses. Arrow keys step through the parts.">${svg}<span class="an-sr" role="status" aria-live="polite" data-status></span></div>`,
  })}</div>
  <ol class="an-parts">${PIECES.map(([id, n, name, text]) => `<li><button type="button" class="an-part" data-piece="${id}"><span class="an-n">${n}</span><span class="an-name">${name}</span><span class="an-text">${text}</span></button></li>`).join('')}</ol>
  <p class="an-caption">A campaign is ten runs: five of the Acme plan upgrade conversation (five blocks) and five of the Acme price sheet task (three steps), alternating, so the same line tests both kinds of agent. Each block is one carriage: its Given (a state capsule, or a workspace of files), its When (the message or instruction card) and its Then (nine test pads). The dial needle is the run pass rate; its two pointers are the 95% Wilson interval. The gate lifts when the lower bound clears ${M.THRESHOLD.toFixed(2)}: a baseline of ${M.BASELINE.toFixed(2)} minus a margin of ${M.MARGIN.toFixed(2)}, set for this figure. Every number comes from the figure's own seeded model of a fictional agent.</p>
  <div class="an-tools"><button type="button" class="an-theme" data-theme-toggle>dark theme</button></div>
</div>`;

const page = k
  .pageHtml({ title: 'The anatomy of driftbench', theme: 'light', body: `<style>${CSS}</style>${body}`, script: kitSource + latheScript + modelScript + LIVE, width: 1100 })
  .replace('<head>', '<head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..600&family=Geist+Mono:wght@400;500&family=Libre+Caslon+Display&display=swap" rel="stylesheet">');
writeFileSync(join(HERE, 'index.html'), page);
console.log(`wrote index.html ${(page.length / 1024).toFixed(0)} KB · ${drawn.length} items · ${R.solids.length} shapes · ${CABLES.length} cables · scale ${KS.toFixed(3)} · carriage layer at ${insertAt} · conflicts ${conflicts.length ? [...new Set(conflicts)].join(', ') : 'none'}`);

// ---------------------------------------------------------------- the README hero: the same machine, with callouts
// The hero frame is 1600 by HERO_H px. The machine is drawn at MS px per unit with its origin at MO; the callouts
// are placed in machine units, so they move with it. Each callout: a dot on the part, a short thin leader with one bend,
// and a one line Geist Mono title on a short rule.
const HERO_H = 900;
const MS = 1.16;
const MO = [470, 150];
const ANCHORS = {
  generation: [X0 - 6, -14, 146],
  validity: [X0 - 34.2, 0, 74],
  agent: [X2, 12, 72],
  checks: [GX, 13, 74],
  council: [X4 + 27, -50, 33],
  drift: [CHART.x + 52, FACE_Y + 2, CHART.z0 - 12],
  interval: [DIAL.x + 12, FACE_Y + 3.6, DIAL.z + 12],
  gate: [GATE.x + 3.4, GATE.y, 24],
};
if (process.argv.includes('--anchors')) for (const [name, p] of Object.entries(ANCHORS)) console.log(name, at(p).map(f2).join(' '));
const CALLOUTS = JSON.parse(readFileSync(join(HERE, 'callouts.json'), 'utf8'));
const calloutSvg = CALLOUTS.map((c) => {
  const [ax, ay] = at(ANCHORS[c.id]);
  const [x0, x1] = c.rule;
  const jx = c.join ?? ax;
  const bend = c.bend ? `L${f2(c.bend[0])} ${f2(c.bend[1])}` : `L${f2(jx)} ${f2(ay)}`;
  const path = `M${f2(ax)} ${f2(ay)}${bend}L${f2(jx)} ${f2(c.y)}M${f2(x0)} ${f2(c.y)}L${f2(x1)} ${f2(c.y)}`;
  const tx = c.text === 'end' ? x1 - (c.inset ?? 0) : x0 + (c.inset ?? 0);
  const anchor = c.text === 'end' ? 'end' : 'start';
  return `<g class="an-callout" data-callout="${c.id}"><path class="an-leader" d="${path}"/><circle class="an-pin-ring" cx="${f2(ax)}" cy="${f2(ay)}" r="3.4"/><circle class="an-pin" cx="${f2(ax)}" cy="${f2(ay)}" r="1.6"/><text class="an-callout-name" x="${f2(tx)}" y="${f2(c.y - 4)}" text-anchor="${anchor}">${c.name}</text></g>`;
}).join('');
const VB = [-MO[0] / MS, -MO[1] / MS, 1600 / MS, HERO_H / MS].map(f2);
const heroSvg = svg.replace(`viewBox="0 0 ${W} ${H}"`, `viewBox="${VB.join(' ')}"`).replace(/<\/svg>$/, `<g class="an-callouts">${calloutSvg}</g></svg>`);
const HERO_CSS = readFileSync(join(HERE, 'hero.css'), 'utf8');
const heroBody = `<div class="an an-hero" data-part="root" id="frame">
  <img class="hero-logo hero-logo--ink" src="../nexus-logo-ink.svg" alt="Nexus"><img class="hero-logo hero-logo--white" src="../nexus-logo-white.svg" alt="Nexus">
  <div class="hero-copy">
    <div class="hero-kicker">An agent evaluation framework</div>
    <h1 class="hero-title">driftbench.<span class="hero-soft">Every exchange is a unit&nbsp;test.</span></h1>
    <p class="hero-intro">Every number carries an interval. Drift and recovery are measured, block by block.</p>
  </div>
  <span class="hero-label">Open source · MIT</span>
  <div class="iso-stage an-stage hero-stage" tabindex="0" role="group" aria-label="driftbench drawn as one machine, with callouts on its parts.">${heroSvg}<span class="an-sr" role="status" aria-live="polite" data-status></span></div>
  <span class="hero-hidden" data-readout></span><button type="button" class="hero-hidden" data-theme-toggle>dark theme</button>
</div>`;
const heroPage = k
  .pageHtml({ title: 'driftbench hero', theme: 'light', body: `<style>${CSS}${HERO_CSS}</style>${heroBody}`, script: kitSource + latheScript + modelScript + LIVE, width: 1600 })
  .replace('<head>', '<head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..600&family=Geist+Mono:wght@400;500&family=Libre+Caslon+Display&display=swap" rel="stylesheet">');
writeFileSync(join(HERE, 'hero.html'), heroPage);
console.log(`wrote hero.html ${(heroPage.length / 1024).toFixed(0)} KB · ${CALLOUTS.length} callouts`);

A.auditOrExit(R, P, {});
