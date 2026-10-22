/**
 * The programs of the frame's runs, written to drawn files (docs/validators.md, "The frame: the product runs apart,
 * the parent decides"). Every identifier in them is drawn per run, and so is the way the twin driver listens on
 * stdin: no helper name on the stack and no line of an entry file is the same from one run to the next, so a
 * product cannot recognise the frame by a fixed text (review of PR 892: a product keyed on the fixed helper
 * `nested` on the stack, or on the driver's fixed readline line read through `process.argv[1]`, passed under the
 * frame and was wrong for users).
 *
 * - The twin driver (runs A and B): its first line on stdin is its setup (the loader to register, the uptime shift,
 *   the call depth, the module or the command, the token); for a module, each further line is one call, and each
 *   answer is one line on stdout that starts with the token, so a line the product prints is never an answer.
 * - The plain entry (run C): a short module that imports the product, makes one call with arguments read from a file,
 *   and writes the answer to a file, as a user's own script would call the product. It has no stdin protocol.
 */

import { rngOf } from './twins';

/** Distinct drawn identifiers, each holding an upper-case letter, so none is a keyword of the language. */
function namer(seed: number, tag: string): (key: string) => string {
  const rng = rngOf(seed, `driver:${tag}`);
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const taken = new Set<string>();
  const names = new Map<string, string>();
  return (key) => {
    const known = names.get(key);
    if (known) return known;
    for (;;) {
      const length = 4 + Math.floor(rng() * 9);
      let out = '';
      while (out.length < length) out += lower[Math.floor(rng() * lower.length)];
      const at = 1 + Math.floor(rng() * (length - 1));
      out = `${out.slice(0, at)}${(out[at] as string).toUpperCase()}${out.slice(at + 1)}`;
      if (taken.has(out)) continue;
      taken.add(out);
      names.set(key, out);
      return out;
    }
  };
}

/** Fills the «name» slots of a template with drawn identifiers. */
function fill(template: string, name: (key: string) => string): string {
  return template.replace(/«([a-zA-Z]+)»/g, (_whole, key: string) => name(key));
}

/** The value codec of the runs, the same as tape.ts: tags for what JSON cannot hold. */
const CODEC = String.raw`
const «open» = '$';
let «counter» = 0;
const «handles» = new Map();
const «esc» = («key») => («key».startsWith(«open») ? «open» + «key» : «key»);
const «unesc» = («key») => («key».startsWith(«open» + «open») ? «key».slice(1) : «key»);
function «encode»(«value», «seen» = new WeakSet()) {
  if («value» === null) return null;
  switch (typeof «value») {
    case 'string': case 'boolean': return «value»;
    case 'number': return Number.isFinite(«value») ? (Object.is(«value», -0) ? { $n: '-0' } : «value») : { $n: String(«value») };
    case 'undefined': return { $u: 1 };
    case 'bigint': return { $big: «value».toString() };
    case 'symbol': return { $opaque: typeof «value» };
    case 'function': { const «id» = ++«counter»; «handles».set(«id», «value»); return { $handle: «id» }; }
  }
  if («seen».has(«value»)) return { $opaque: 'cycle' };
  «seen».add(«value»);
  try {
    if («value» instanceof Map) return { $map: [...«value».entries()].map(([«k», «v»]) => [«encode»(«k», «seen»), «encode»(«v», «seen»)]) };
    if («value» instanceof Set) return { $set: [...«value».values()].map((«v») => «encode»(«v», «seen»)) };
    if («value» instanceof Error) return { $err: { name: «value».name, message: «value».message } };
    if (Array.isArray(«value»)) return «value».map((«v») => «encode»(«v», «seen»));
    if («value» instanceof Date) return { $date: «value».toISOString() };
    if (ArrayBuffer.isView(«value»)) return { $bytes: [...new Uint8Array(«value».buffer, «value».byteOffset, «value».byteLength)] };
    const «proto» = Object.getPrototypeOf(«value»);
    if («proto» !== Object.prototype && «proto» !== null) return { $opaque: («proto» && «proto».constructor && «proto».constructor.name) || 'object' };
    return Object.fromEntries(Object.entries(«value»).map(([«k», «v»]) => [«esc»(«k»), «encode»(«v», «seen»)]));
  } finally {
    «seen».delete(«value»);
  }
}
function «decode»(«x») {
  if («x» === null || typeof «x» !== 'object') return «x»;
  if (Array.isArray(«x»)) return «x».map(«decode»);
  if ('$n' in «x») return «x».$n === '-0' ? -0 : Number(«x».$n);
  if ('$u' in «x») return undefined;
  if ('$big' in «x») return BigInt(«x».$big);
  if ('$map' in «x») return new Map(«x».$map.map(([«k», «v»]) => [«decode»(«k»), «decode»(«v»)]));
  if ('$set' in «x») return new Set(«x».$set.map(«decode»));
  if ('$date' in «x») return new Date(«x».$date);
  if ('$bytes' in «x») return Uint8Array.from(«x».$bytes);
  if ('$handle' in «x») return «handles».get(«x».$handle);
  if ('$fn' in «x») return (0, eval)('(' + «x».$fn + ')');
  if ('$err' in «x») { const «Class» = { Error, RangeError, TypeError, SyntaxError, ReferenceError, EvalError, URIError }[«x».$err.name] || Error; const «e» = new «Class»(«x».$err.message); «e».name = «x».$err.name; return «e»; }
  return Object.fromEntries(Object.entries(«x»).map(([«k», «v»]) => [«unesc»(«k»), «decode»(«v»)]));
}
// Identity of the arguments (docs/validators.md section 12.9, "Objects the caller passes twice"): the parent names an
// object it passes again by an id, and the run keeps the objects it first built, filled again in place with what the
// parent sends now, nested objects too, so a product that keeps a cache keyed by an object it was given sees the
// same keys and the edits made in place. An argument the parent holds frozen is frozen in the run, and is not kept.
const «retained» = new Map();
const «setOwn» = («target», «key», «value») => Object.defineProperty(«target», «key», { value: «value», writable: true, enumerable: true, configurable: true });
function «fill»(«held», «fresh») {
  if (Array.isArray(«held»)) {
    for (let «i» = 0; «i» < «fresh».length; «i» += 1) {
      const «was» = «held»[«i»];
      const «now» = «fresh»[«i»];
      if («was» !== null && «now» !== null && typeof «was» === 'object' && typeof «now» === 'object' && Array.isArray(«was») === Array.isArray(«now»)) «fill»(«was», «now»);
      else «setOwn»(«held», «i», «now»);
    }
    «held».length = «fresh».length;
    return;
  }
  for (const «key» of Object.keys(«held»)) if (!Object.prototype.hasOwnProperty.call(«fresh», «key»)) delete «held»[«key»];
  for (const «key» of Object.keys(«fresh»)) {
    const «was» = Object.prototype.hasOwnProperty.call(«held», «key») ? «held»[«key»] : undefined;
    const «now» = «fresh»[«key»];
    if («was» !== null && «was» !== undefined && «now» !== null && typeof «was» === 'object' && typeof «now» === 'object' && Array.isArray(«was») === Array.isArray(«now»)) «fill»(«was», «now»);
    else «setOwn»(«held», «key», «now»);
  }
}
function «freeze»(«value») {
  if («value» !== null && typeof «value» === 'object' && !Object.isFrozen(«value»)) {
    Object.freeze(«value»);
    for (const «key» of Reflect.ownKeys(«value»)) «freeze»(«value»[«key»]);
  }
}
function «pin»(«args», «ids», «forget», «frozen») {
  if («forget») «retained».clear();
  for (let «i» = 0; «i» < «args».length; «i» += 1) {
    const «arg» = «args»[«i»];
    if («arg» === null || typeof «arg» !== 'object') continue;
    if («frozen» && «frozen»[«i»]) { «freeze»(«arg»); continue; }
    const «id» = «ids» ? «ids»[«i»] : null;
    if («id» === null || «id» === undefined) continue;
    const «held» = «retained».get(«id»);
    if («held» === undefined || Array.isArray(«held») !== Array.isArray(«arg») || Object.isFrozen(«held»)) { «retained».set(«id», «arg»); continue; }
    «fill»(«held», «arg»);
    «args»[«i»] = «held»;
  }
  return «args»;
}
// The ambient state a call may be run under (the clock, the random sources): applied around one call, then undone.
function «patchIn»(«specs») {
  const «undo» = [];
  if («specs») {
    for (let «i» = 0; «i» < «specs».length; «i» += 1) {
      const «spec» = «specs»[«i»];
      if («spec».kind === 'random') {
        const «saved» = Math.random;
        Math.random = () => { throw new Error('Math.random was called while planning: draw only from the seed'); };
        «undo»[«undo».length] = () => { Math.random = «saved»; };
      } else if («spec».kind === 'clock') {
        const «Real» = Date;
        const «at» = «spec».at;
        class «Frozen» extends «Real» {
          constructor(...«rest») { super(...(«rest».length ? «rest» : [«at»])); }
          static now() { return «at»; }
        }
        globalThis.Date = «Frozen»;
        «undo»[«undo».length] = () => { globalThis.Date = «Real»; };
      } else if («spec».kind === 'crypto') {
        const «c» = globalThis.crypto;
        const «savedValues» = «c».getRandomValues;
        const «savedUuid» = «c».randomUUID;
        const «boom» = () => { throw new Error('crypto random was called while planning: draw only from the seed'); };
        Object.defineProperty(«c», 'getRandomValues', { value: «boom», configurable: true, writable: true });
        Object.defineProperty(«c», 'randomUUID', { value: «boom», configurable: true, writable: true });
        «undo»[«undo».length] = () => {
          Object.defineProperty(«c», 'getRandomValues', { value: «savedValues», configurable: true, writable: true });
          Object.defineProperty(«c», 'randomUUID', { value: «savedUuid», configurable: true, writable: true });
        };
      }
    }
  }
  return () => { for (let «i» = «undo».length - 1; «i» >= 0; «i» -= 1) «undo»[«i»](); };
}
// A call made under ambient state: sync results are undone at once, a promise when it settles.
function «under»(«specs», «run») {
  const «undo» = «patchIn»(«specs»);
  let «out»;
  try {
    «out» = «run»();
  } catch («error») {
    «undo»();
    throw «error»;
  }
  if («out» !== null && typeof «out» === 'object' && typeof «out».then === 'function')
    return «out».then((«value») => { «undo»(); return «value»; }, («error») => { «undo»(); throw «error»; });
  «undo»();
  return «out»;
}
`;

const TWIN = String.raw`
import { pathToFileURL as «toUrl» } from 'node:url';
import { createHash as «createHash» } from 'node:crypto';
import { types as «utilTypes» } from 'node:util';
// What the aliasing watch uses, taken before the product loads and called only through these references, never
// through a property the product can reach: a product that patches the hash, the serialiser, Reflect or the
// iteration methods cannot blind the watch (review of PR 986, codex run 39709007729).
const «call» = Reflect.apply;
const «ownKeys» = Reflect.ownKeys;
const «describe» = Reflect.getOwnPropertyDescriptor;
const «protoOf» = Reflect.getPrototypeOf;
const «isArray» = Array.isArray;
const «isView» = ArrayBuffer.isView;
const «stringify» = JSON.stringify;
const «same» = Object.is;
const «hashStart» = «createHash»;
const «hashProto» = «protoOf»(«hashStart»('sha256'));
const «hashUpdate» = «hashProto».update;
const «hashDigest» = «hashProto».digest;
const «mapEntries» = Map.prototype.entries;
const «setValues» = Set.prototype.values;
const «mapNext» = «protoOf»(new Map().entries()).next;
const «setNext» = «protoOf»(new Set().values()).next;
const «dateTime» = Date.prototype.getTime;
const «seenHas» = WeakSet.prototype.has;
const «seenAdd» = WeakSet.prototype.add;
const «SeenSet» = WeakSet;
const «isProxy» = «utilTypes».isProxy;
const «pending» = [];
const «waiters» = [];
let «rest» = '';
let «ended» = false;
process.stdin.setEncoding('utf8');
process.stdin.«listen»('data', («chunk») => {
  «rest» += «chunk»;
  for (let «at» = «rest».indexOf('\n'); «at» >= 0; «at» = «rest».indexOf('\n')) {
    const «line» = «rest».slice(0, «at»);
    «rest» = «rest».slice(«at» + 1);
    const «waiter» = «waiters».shift();
    if («waiter») «waiter»(«line»);
    else «pending».push(«line»);
  }
});
process.stdin.«listen»('end', () => {
  «ended» = true;
  for (const «waiter» of «waiters».splice(0)) «waiter»(undefined);
});
const «next» = () =>
  «pending».length > 0
    ? Promise.resolve(«pending».shift())
    : «ended»
      ? Promise.resolve(undefined)
      : new Promise((«resolveIt») => «waiters».push(«resolveIt»));
const «setup» = JSON.parse(await «next»());
const «write» = process.stdout.write.bind(process.stdout);
const «cpuNow» = process.cpuUsage.bind(process);
const «answer» = («message») => «write»(«setup».token + ' ' + «stringify»(«message») + '\n');

if ('nodeOptions' in «setup») {
  if («setup».nodeOptions === null) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = «setup».nodeOptions;
}
if («setup».loader) {
  const { register: «register» } = await import(«toUrl»(«setup».loader).href);
  «register»();
}
if («setup».uptimeShift > 0) {
  const «shift» = «setup».uptimeShift;
  const «realUptime» = process.uptime;
  const «shifted» = { uptime() { return «realUptime».call(process) + «shift»; } }.uptime;
  Object.defineProperty(process, 'uptime', { value: «shifted», writable: true, configurable: true });
  const «realNow» = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', { value: { now() { return «realNow»() + «shift» * 1000; } }.now, writable: true, configurable: true });
}
«codec»
// Aliased results (docs/validators.md section 12.9): the live results of the last calls, each with a digest of what it
// held when it was returned. A later call that changed one of them, or filled the same object again, is reported in
// its answer; only that finding crosses to the validator, whose item never sees the live object. The digest walks
// the value with the captured references above, and builds its text with string concatenation only.
let «sawInvalid» = false;
const «fingerprint» = («root») => {
  const «hash» = «call»(«hashStart», undefined, ['sha256']);
  let «chunk» = '';
  const «put» = («piece») => {
    «chunk» += «piece»;
    if («chunk».length > 65536) {
      «call»(«hashUpdate», «hash», [«chunk»]);
      «chunk» = '';
    }
  };
  const «seen» = new «SeenSet»();
  const «walk» = («value», «level») => {
    // A Proxy runs the product's own code on every read: it is not read, it is reported (an invalid result).
    if ((typeof «value» === 'object' || typeof «value» === 'function') && «value» !== null && «isProxy»(«value»)) {
      «sawInvalid» = true;
      «put»('P;');
      return;
    }
    switch (typeof «value») {
      case 'undefined': «put»('u;'); return;
      case 'boolean': «put»(«value» ? 't;' : 'f;'); return;
      case 'number': «put»('n' + («same»(«value», -0) ? '-0' : '' + «value») + ';'); return;
      case 'bigint': «put»('b' + «value» + ';'); return;
      case 'string': «put»('s' + «value».length + ':' + «value» + ';'); return;
      case 'symbol': «put»('y;'); return;
      case 'function': «put»('F;'); return;
    }
    if («value» === null) { «put»('N;'); return; }
    if («call»(«seenHas», «seen», [«value»])) { «put»('C;'); return; }
    if («level» > 1000) { «put»('D;'); return; }
    «call»(«seenAdd», «seen», [«value»]);
    let «entries»;
    try { «entries» = «call»(«mapEntries», «value», []); } catch { «entries» = undefined; }
    if («entries» !== undefined) {
      «put»('M{');
      for (;;) {
        const «step» = «call»(«mapNext», «entries», []);
        if («step».done) break;
        «walk»(«step».value[0], «level» + 1);
        «walk»(«step».value[1], «level» + 1);
      }
      «put»('}');
      return;
    }
    let «values»;
    try { «values» = «call»(«setValues», «value», []); } catch { «values» = undefined; }
    if («values» !== undefined) {
      «put»('S{');
      for (;;) {
        const «step» = «call»(«setNext», «values», []);
        if («step».done) break;
        «walk»(«step».value, «level» + 1);
      }
      «put»('}');
      return;
    }
    let «time»;
    try { «time» = «call»(«dateTime», «value», []); } catch { «time» = undefined; }
    if («time» !== undefined) { «put»('T' + «time» + ';'); return; }
    if («isView»(«value»)) {
      «put»('V' + «value».length + ':');
      for (let «i» = 0; «i» < «value».length; «i» += 1) «put»('' + «value»[«i»] + ',');
      «put»(';');
      return;
    }
    if («isArray»(«value»)) {
      «put»('A' + «value».length + '[');
      for (let «i» = 0; «i» < «value».length; «i» += 1) «walk»(«value»[«i»], «level» + 1);
      «put»(']');
      return;
    }
    const «keys» = «ownKeys»(«value»);
    «put»('O' + «keys».length + '{');
    for (let «i» = 0; «i» < «keys».length; «i» += 1) {
      const «key» = «keys»[«i»];
      if (typeof «key» === 'symbol') «put»('y;');
      else «put»('k' + «key».length + ':' + «key»);
      const «desc» = «describe»(«value», «key»);
      const «descKeys» = «ownKeys»(«desc»);
      let «isData» = false;
      for (let «j» = 0; «j» < «descKeys».length; «j» += 1) if («descKeys»[«j»] === 'value') «isData» = true;
      if («isData») «walk»(«desc».value, «level» + 1);
      else {
        // An accessor runs the product's own code on every read: it is not called, it is reported.
        «sawInvalid» = true;
        «put»('G;');
      }
    }
    «put»('}');
  };
  «walk»(«root», 0);
  «call»(«hashUpdate», «hash», [«chunk»]);
  return «call»(«hashDigest», «hash», ['hex']);
};
// Shared objects (docs/validators.md section 12.9, "Objects the caller passes twice"): the objects a value reaches,
// walked with the references captured above, so a product that patches the iteration methods cannot blind it.
const «collect» = («root», «into») => {
  const «stack» = [«root»];
  let «top» = 1;
  while («top» > 0) {
    «top» -= 1;
    const «value» = «stack»[«top»];
    if («value» === null || (typeof «value» !== 'object' && typeof «value» !== 'function')) continue;
    if («isProxy»(«value»)) continue;
    if («call»(«seenHas», «into», [«value»])) continue;
    «call»(«seenAdd», «into», [«value»]);
    let «entries»;
    try { «entries» = «call»(«mapEntries», «value», []); } catch { «entries» = undefined; }
    if («entries» !== undefined) {
      for (;;) {
        const «step» = «call»(«mapNext», «entries», []);
        if («step».done) break;
        «stack»[«top»] = «step».value[0]; «top» += 1;
        «stack»[«top»] = «step».value[1]; «top» += 1;
      }
      continue;
    }
    let «values»;
    try { «values» = «call»(«setValues», «value», []); } catch { «values» = undefined; }
    if («values» !== undefined) {
      for (;;) {
        const «step» = «call»(«setNext», «values», []);
        if («step».done) break;
        «stack»[«top»] = «step».value; «top» += 1;
      }
      continue;
    }
    const «keys» = «ownKeys»(«value»);
    for (let «i» = 0; «i» < «keys».length; «i» += 1) {
      const «desc» = «describe»(«value», «keys»[«i»]);
      if («desc» !== undefined && 'value' in «desc») { «stack»[«top»] = «desc».value; «top» += 1; }
    }
  }
};
// The first object a value reaches that is in `first` ('input') or in `second` ('earlier'), or undefined.
const «meets» = («root», «first», «second») => {
  const «seen» = new «SeenSet»();
  const «stack» = [«root»];
  let «top» = 1;
  while («top» > 0) {
    «top» -= 1;
    const «value» = «stack»[«top»];
    if («value» === null || (typeof «value» !== 'object' && typeof «value» !== 'function')) continue;
    if («isProxy»(«value»)) continue;
    if («call»(«seenHas», «seen», [«value»])) continue;
    «call»(«seenAdd», «seen», [«value»]);
    if («call»(«seenHas», «first», [«value»])) return 'input';
    if («call»(«seenHas», «second», [«value»])) return 'earlier';
    let «entries»;
    try { «entries» = «call»(«mapEntries», «value», []); } catch { «entries» = undefined; }
    if («entries» !== undefined) {
      for (;;) {
        const «step» = «call»(«mapNext», «entries», []);
        if («step».done) break;
        «stack»[«top»] = «step».value[0]; «top» += 1;
        «stack»[«top»] = «step».value[1]; «top» += 1;
      }
      continue;
    }
    let «values»;
    try { «values» = «call»(«setValues», «value», []); } catch { «values» = undefined; }
    if («values» !== undefined) {
      for (;;) {
        const «step» = «call»(«setNext», «values», []);
        if («step».done) break;
        «stack»[«top»] = «step».value; «top» += 1;
      }
      continue;
    }
    const «keys» = «ownKeys»(«value»);
    for (let «i» = 0; «i» < «keys».length; «i» += 1) {
      const «desc» = «describe»(«value», «keys»[«i»]);
      if («desc» !== undefined && 'value' in «desc») { «stack»[«top»] = «desc».value; «top» += 1; }
    }
  }
  return undefined;
};
let «earlier» = new «SeenSet»();
const «recent» = new Array(16);
let «stored» = 0;
const «deeper» = («depth», «run») => («depth» <= 0 ? «run»() : «deeper»(«depth» - 1, «run»));

if («setup».command) {
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('end');
  process.stdin.pause();
  process.argv = [process.argv[0], «setup».script || «setup».command, ...«setup».args];
  await import(«toUrl»(«setup».command).href);
} else {
  let «product»;
  try {
    «product» = await import(«toUrl»(«setup».module).href);
    // A product module may hold its functions in an export of that name (`members`), as an object.
    if («setup».members) {
      for (let «i» = 0; «i» < «setup».members.length; «i» += 1) {
        const «held» = «product»[«setup».members[«i»]];
        if («held» !== null && typeof «held» === 'object') { «product» = «held»; break; }
      }
    }
    «answer»({ ready: true, shape: Object.fromEntries(Object.keys(«product»).map((key) => [key, typeof «product»[key] === 'function' ? { fn: 1 } : { value: «encode»(«product»[key]) }])) });
  } catch («error») {
    «answer»({ ready: false, error: String(«error» && «error».stack ? «error».stack : «error») });
  }
  for (let «text» = await «next»(); «text» !== undefined; «text» = await «next»()) {
    const «request» = JSON.parse(«text»);
    const «handle» = «request».call.startsWith('#');
    const «fn» = «handle»
      ? «handles».get(Number(«request».call.slice(1)))
      : «setup».invoke
        ? (...«rest») => «product»[«setup».invoke](«request».call, «rest»)
        : «product»[«request».call];
    try {
      if (typeof «fn» !== 'function') throw new TypeError('the product has no function ' + «request».call);
      const «args» = «pin»(«decode»(«request».args), «request».ids, «request».forget, «request».frozen);
      if («request».forget) «earlier» = new «SeenSet»();
      // Guards (docs/validators.md section 12.9, "Objects the caller passes twice"): a call under 'mutation' must leave
      // its arguments as they were; a call under 'sharing' must return nothing that is, or holds, an object of its
      // arguments or of an earlier guarded result. Only the finding crosses to the validator.
      let «watchMutation» = false;
      let «watchSharing» = false;
      if («request».guard) {
        for (let «i» = 0; «i» < «request».guard.length; «i» += 1) {
          if («request».guard[«i»] === 'mutation') «watchMutation» = true;
          // 'sharing' may be limited to some functions by name.
          if («request».guard[«i»] === 'sharing' && (!«request».guardNames || «request».guardNames.includes(«request».call))) «watchSharing» = true;
        }
      }
      const «digests» = [];
      const «argObjects» = new «SeenSet»();
      for (let «i» = 0; «i» < «args».length; «i» += 1) {
        if («watchMutation») «digests»[«i»] = «fingerprint»(«args»[«i»]);
        if («watchSharing») «collect»(«args»[«i»], «argObjects»);
      }
      const «before» = «cpuNow»();
      const «result» = await «deeper»(«setup».depth, () => «under»(«request».ambient, () => «fn»(...«args»)));
      const «used» = «cpuNow»(«before»);
      let «changed»;
      if («watchMutation») {
        «changed» = [];
        for (let «i» = 0; «i» < «args».length; «i» += 1) if («fingerprint»(«args»[«i»]) !== «digests»[«i»]) «changed»[«changed».length] = «i»;
      }
      let «shared»;
      if («watchSharing» && «result» !== null && typeof «result» === 'object') {
        «shared» = «meets»(«result», «argObjects», «earlier»);
        «collect»(«result», «earlier»);
      }
      const «ret» = «encode»(«result»);
      const «moved» = [];
      let «movedCount» = 0;
      let «invalid» = false;
      if («setup».aliasing) {
        const «kept» = «stored» < 16 ? «stored» : 16;
        for (let «i» = 0; «i» < «kept»; «i» += 1) {
          const «each» = «recent»[«i»];
          const «now» = «fingerprint»(«each».live);
          // A change is reported by the one call after which it is seen, not again by the calls that follow.
          if («now» !== «each».digest) { «moved»[«movedCount»] = «each».call; «movedCount» += 1; «each».digest = «now»; }
        }
        if («result» !== null && (typeof «result» === 'object' || typeof «result» === 'function')) {
          // A digest of every result, whatever its size: a result padded with an unused large field is watched too.
          «sawInvalid» = false;
          const «digest» = «fingerprint»(«result»);
          if («sawInvalid») «invalid» = true;
          else if (typeof «result» === 'object') {
            «recent»[«stored» % 16] = { call: «request».call, live: «result», digest: «digest» };
            «stored» += 1;
          }
        }
      }
      «answer»({ id: «request».id, ret: «ret», cpu: («used».user + «used».system) / 1000, ...(«movedCount» > 0 ? { moved: «moved» } : {}), ...(«invalid» ? { invalid: true } : {}), ...(«changed» !== undefined && «changed».length > 0 ? { mutated: «changed» } : {}), ...(«shared» !== undefined ? { shared: «shared» } : {}) });
    } catch («error») {
      «answer»({ id: «request».id, throws: «encode»(«error» instanceof Error ? «error» : new Error(String(«error»))) });
    }
  }
}
`;

/** The twin driver of one run, its identifiers and its stdin listener drawn from the seed and the tag. */
export function twinDriver(seed: number, tag: string): string {
  const name = namer(seed, `twin:${tag}`);
  const listen = rngOf(seed, `listen:${tag}`)() < 0.5 ? 'on' : 'addListener';
  const codec = fill(CODEC, name);
  // Function replacers: the codec holds '$', which a replacement string would read as a pattern.
  return fill(
    TWIN.replace('«codec»', () => codec).replace(/«listen»/g, () => listen),
    name,
  );
}

/**
 * The neutral wrapper module of run D: it imports the product and calls one of its functions by name through array
 * and function methods, so the product is called from another module and from native frames, not straight from the
 * driver. Its identifiers are drawn.
 */
export function wrapperModule(
  seed: number,
  tag: string,
  product: string,
  members: readonly string[] = [],
): { source: string; invoke: string } {
  const name = namer(seed, `wrapper:${tag}`);
  const source = [
    `import * as ${name('product')} from ${JSON.stringify(product)};`,
    `const ${name('holder')} = ${JSON.stringify(members)}.map((${name('key')}) => ${name('product')}[${name('key')}]).find((${name('each')}) => ${name('each')} !== null && typeof ${name('each')} === 'object') ?? ${name('product')};`,
    `export const ${name('invoke')} = async (${name('call')}, ${name('args')}) => {`,
    `  const ${name('fn')} = ${name('holder')}[${name('call')}];`,
    `  if (typeof ${name('fn')} !== 'function') throw new TypeError('the product has no function ' + ${name('call')});`,
    `  return [${name('args')}].map((${name('list')}) => Function.prototype.apply.call(${name('fn')}, undefined, ${name('list')}))[0];`,
    `};`,
    '',
  ].join('\n');
  return { source, invoke: name('invoke') };
}

/** The codec module of run C: the value codec and the table of handles, exported under drawn names. */
export function plainCodec(
  seed: number,
  tag: string,
): { source: string; encode: string; decode: string; handles: string; pin: string; under: string } {
  const name = namer(seed, `codec:${tag}`);
  const source = `${fill(CODEC, name)}\nexport { ${name('encode')}, ${name('decode')}, ${name('handles')}, ${name('pin')}, ${name('under')} };\n`;
  return {
    source,
    encode: name('encode'),
    decode: name('decode'),
    handles: name('handles'),
    pin: name('pin'),
    under: name('under'),
  };
}

/**
 * The entry of run C: one fresh process that imports the product and the codec, reads the recorded calls from a file
 * line by line, makes them in order and appends every answer to a file as one line. The state a call leaves (a
 * counter, a handle, a cache) is kept from one call to the next, as in the confined runs. Paths are file URLs.
 */
export function plainBatchEntry(
  seed: number,
  tag: string,
  paths: { module: string; codec: string; calls: string; out: string },
  codec: { encode: string; decode: string; handles: string; pin: string; under: string },
  members: readonly string[] = [],
): string {
  const name = namer(seed, `plain:${tag}`);
  const product = name('product');
  const holder = name('holder');
  const each = name('each');
  const fn = name('fn');
  const answer = name('answer');
  const error = name('error');
  return [
    `import * as ${product} from ${JSON.stringify(paths.module)};`,
    `import { createReadStream as ${name('stream')}, appendFileSync as ${name('append')} } from 'node:fs';`,
    `import { createInterface as ${name('lines')} } from 'node:readline';`,
    `import { ${codec.encode} as ${name('encode')}, ${codec.decode} as ${name('decode')}, ${codec.handles} as ${name('handles')}, ${codec.pin} as ${name('pin')}, ${codec.under} as ${name('under')} } from ${JSON.stringify(paths.codec)};`,
    `const ${holder} = ${JSON.stringify(members)}.map((${name('key')}) => ${product}[${name('key')}]).find((${name('item')}) => ${name('item')} !== null && typeof ${name('item')} === 'object') ?? ${product};`,
    `for await (const ${name('line')} of ${name('lines')}({ input: ${name('stream')}(new URL(${JSON.stringify(paths.calls)})) })) {`,
    `  const ${each} = JSON.parse(${name('line')});`,
    `  let ${answer};`,
    `  try {`,
    `    const ${fn} = ${each}.call.startsWith('#') ? ${name('handles')}.get(Number(${each}.call.slice(1))) : ${holder}[${each}.call];`,
    `    if (typeof ${fn} !== 'function') throw new TypeError('the product has no function ' + ${each}.call);`,
    `    const ${name('args')} = ${name('pin')}(${name('decode')}(${each}.args), ${each}.ids, ${each}.forget, ${each}.frozen);`,
    `    ${answer} = { ret: ${name('encode')}(await ${name('under')}(${each}.ambient, () => ${fn}(...${name('args')}))) };`,
    `  } catch (${error}) { ${answer} = { throws: ${name('encode')}(${error} instanceof Error ? ${error} : new Error(String(${error}))) }; }`,
    `  ${name('append')}(new URL(${JSON.stringify(paths.out)}), JSON.stringify(${answer}) + '\\n');`,
    `}`,
    '',
  ].join('\n');
}

/**
 * The relay: a worker thread of the validator's process that owns the two twin runs. The validator's thread posts a
 * call and waits on a shared flag; the relay sends it to both runs and posts back both answers. So the product's
 * calls stay synchronous for the item, and only one call is in flight.
 */
export const RELAY = String.raw`
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { workerData } from 'node:worker_threads';
const { port, signal, plans, setup } = workerData;
const flag = new Int32Array(signal);
const reply = (message) => { port.postMessage(message); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const runs = plans.map((plan) => {
  mkdirSync(plan.driverDir, { recursive: true });
  if (plan.cwd) mkdirSync(plan.cwd, { recursive: true });
  if (plan.home) mkdirSync(plan.home, { recursive: true });
  const file = join(plan.driverDir, plan.driverFile);
  writeFileSync(file, plan.driverSource);
  const child = spawn(process.execPath, [file, ...plan.argvTail], {
    cwd: plan.cwd ?? process.cwd(),
    env: plan.env ?? process.env,
    execArgv: [],
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const run = { plan, child, waiting: [], stderr: '', exited: undefined };
  child.stderr.on('data', (chunk) => { run.stderr = (run.stderr + chunk).slice(-4000); });
  child.on('exit', (code, sig) => {
    run.exited = 'the run ' + plan.run + ' ended (' + (sig ?? code) + '): ' + run.stderr.split('\n').slice(-6).join(' ');
    for (const waiter of run.waiting.splice(0)) waiter({ dead: run.exited });
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith(setup.token + ' ')) return;
    const message = JSON.parse(line.slice(setup.token.length + 1));
    const waiter = run.waiting.shift();
    if (waiter) waiter(message);
  });
  child.stdin.write(JSON.stringify({ ...setup, ...plan.setup, uptimeShift: plan.uptimeShift, depth: plan.depth }) + '\n');
  return run;
});
const ask = (run, line) =>
  new Promise((resolve) => {
    if (run.exited) return resolve({ dead: run.exited });
    run.waiting.push(resolve);
    if (line !== undefined) run.child.stdin.write(line + '\n');
  });
const ready = await Promise.all(runs.map((run) => ask(run)));
reply({ ready });
let id = 0;
port.on('message', async (message) => {
  if (message.close) {
    for (const run of runs) run.child.kill();
    reply({ closed: true });
    return;
  }
  id += 1;
  const line = JSON.stringify({ id, call: message.call, args: message.args, ids: message.ids, forget: message.forget, frozen: message.frozen, ambient: message.ambient, guard: message.guard, guardNames: message.guardNames });
  const answers = await Promise.all(runs.map((run) => ask(run, line)));
  reply({ answers });
});
`;
