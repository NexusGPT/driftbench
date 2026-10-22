import type { ItemContext } from '../bank/item';
import { itemRng, type Rng } from '../bank/util';

/**
 * The names the blind items write into the estate: tools, fields and values. An item spells each of them as a
 * token (`lex('router_tool')`, `lex('alpha')`); the lexicon of the running item gives the token a made-up name
 * that depends on the seed and the item, so the same item writes other names on another seed. The shape of the
 * token is kept: a name that ends in `_tool` stays one, a letter and a digit stay a word and a digit. Names never
 * hold one another, so a quote that ends where its value ends cannot be found inside another quote.
 *
 * Items run one at a time in a process, so one lexicon is current at any moment: `beginLexicon` sets it when an
 * item starts. Outside an item, a token stands for itself.
 */

const SYLLABLES = ['ba', 'ko', 'mi', 'ru', 'te', 'so', 'la', 've', 'ni', 'do', 'pa', 'gu', 'hi', 'za', 'fe', 'jo'] as const;

type Lexicon = { rng: Rng; names: Map<string, string>; frame?: number; layout?: number };

let current: Lexicon | undefined;

export function beginLexicon(ctx: ItemContext): void {
  current = { rng: itemRng(ctx.seed, `${ctx.id}#lexicon`), names: new Map() };
}

function word(rng: Rng): string {
  let out = '';
  for (let i = rng.int(2, 3); i > 0; i -= 1) out += rng.pick(SYLLABLES);
  return out;
}

function related(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

/** The name the running item gives to a token. */
export function lex(token: string): string {
  if (!current) return token;
  const known = current.names.get(token);
  if (known !== undefined) return known;
  const tool = token.endsWith('_tool');
  const digit = /^[a-z]\d$/.test(token) ? token.slice(1) : '';
  const used = [...current.names.values()];
  let name = '';
  for (let tries = 0; tries < 200; tries += 1) {
    const base = word(current.rng);
    name = tool ? `${base}_tool` : `${base}${digit}`;
    if (!used.some((u) => related(u, name))) break;
  }
  current.names.set(token, name);
  return name;
}

type Frame = (tool: string, field: string, value: string) => string;

/** The sentences that name a tool, one of its fields and a value of it. Each ends the value with a delimiter. */
const FRAMES: readonly Frame[] = [
  (t, f, v) => `When the ${f} of ${t} is ${v}, the agent acts on it.`,
  (t, f, v) => `Use ${t} with ${f} set to ${v} for this case.`,
  (t, f, v) => `- ${t}: ${f} = ${v};`,
  (t, f, v) => `For ${t}, the ${f} may be ${v}.`,
  (t, f, v) => `The ${f} argument of ${t} accepts ${v}.`,
  (t, f, v) => `${t} takes ${f} "${v}" when the customer asks for it.`,
];

/** The frame of the running item: one per item, so every quote of an item has the same shape. */
export function frame(): Frame {
  if (!current) return FRAMES[0] as Frame;
  current.frame ??= current.rng.int(0, FRAMES.length - 1);
  return FRAMES[current.frame] as Frame;
}

/** A seeded layout choice for the file around the quotes: 0 plain lines, 1 bullets, 2 numbered, 3 one block per tool. */
export function layout(): number {
  if (!current) return 0;
  current.layout ??= current.rng.int(0, 3);
  return current.layout;
}
