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
// Arguments reach the product frozen at every depth, in every run (docs/validators.md section 12.9, "Written
// inputs"): a write to an argument, a permanent one or one put back before the call returns, throws in the product.
// The functions are taken before the product loads.
const «freezeIt» = Object.freeze;
const «keysOf» = Reflect.ownKeys;
const «descOf» = Reflect.getOwnPropertyDescriptor;
const «isFrozenIt» = Object.isFrozen;
const «isViewIt» = ArrayBuffer.isView;
function «deepFreeze»(«x») {
  if («x» === null || typeof «x» !== 'object' || «isFrozenIt»(«x»)) return «x»;
  if («isViewIt»(«x»)) return «x»;
  «freezeIt»(«x»);
  const «ks» = «keysOf»(«x»);
  for (let «i» = 0; «i» < «ks».length; «i» += 1) {
    const «d» = «descOf»(«x», «ks»[«i»]);
    if («d» && 'value' in «d») «deepFreeze»(«d».value);
  }
  return «x»;
}
// The states the caller's own arguments have (frozen, sealed, not extensible), by path: each object at a path gets
// the state its caller's object has, so a write the caller's object refuses, one that puts the old value back
// included, is refused here too (review of PR 1403, codex run 39870167091: frozen inputs arrived as copies anyone
// could write).
const «sealIt» = Object.seal;
const «stopIt» = Object.preventExtensions;
function «markAll»(«root», «marks») {
  if (!«marks») return «root»;
  for (let «m» = 0; «m» < «marks».length; «m» += 1) {
    const «mark» = «marks»[«m»];
    const «path» = «mark»[0];
    let «at» = «root»;
    for (let «p» = 0; «p» < «path».length && «at» !== null && typeof «at» === 'object'; «p» += 1) {
      const «step» = «descOf»(«at», «path»[«p»]);
      «at» = «step» && 'value' in «step» ? «step».value : undefined;
    }
    if («at» === null || typeof «at» !== 'object') continue;
    if («mark»[1] === 'f') «freezeIt»(«at»);
    else if («mark»[1] === 's') «sealIt»(«at»);
    else «stopIt»(«at»);
  }
  return «root»;
}
// Ambient conditions an item sets for its calls (review of PR 1403, codex run 39870167091): a Math.random that throws,
// a clock that stands still at a given time, crypto random functions that throw. The caller's item sets them in its
// own process; the product runs here, so each call carries them and they hold for that call only. The originals are
// taken before the product loads, and every one is put back before the call is answered.
const «mathObject» = Math;
const «realRandom» = Math.random;
const «RealDate» = Date;
const «globalRef» = globalThis;
const «defineIt» = Object.defineProperty;
function «ambientOn»(«spec») {
  const «undo» = [];
  if («spec» && «spec».random) {
    «mathObject».random = function () {
      throw new Error('Math.random was called while planning: draw only from the seed');
    };
    «undo».push(() => {
      «mathObject».random = «realRandom»;
    });
  }
  if («spec» && typeof «spec».clock === 'number') {
    const «stillAt» = «spec».clock;
    class «Still» extends «RealDate» {
      constructor(...«given») {
        super(...(«given».length ? «given» : [«stillAt»]));
      }
      static now() {
        return «stillAt»;
      }
    }
    «globalRef».Date = «Still»;
    «undo».push(() => {
      «globalRef».Date = «RealDate»;
    });
  }
  if («spec» && «spec».crypto && «globalRef».crypto) {
    const «box» = «globalRef».crypto;
    const «boom» = function () {
      throw new Error('crypto random was called while planning: draw only from the seed');
    };
    «defineIt»(«box», 'getRandomValues', { value: «boom», configurable: true, writable: true });
    «defineIt»(«box», 'randomUUID', { value: «boom», configurable: true, writable: true });
    «undo».push(() => {
      delete «box».getRandomValues;
      delete «box».randomUUID;
    });
  }
  return () => {
    for (let «u» = «undo».length - 1; «u» >= 0; «u» -= 1) «undo»[«u»]();
  };
}
let «counter» = 0;
const «handles» = new Map();
const «esc» = («key») => («key».startsWith(«open») ? «open» + «key» : «key»);
const «unesc» = («key») => («key».startsWith(«open» + «open») ? «key».slice(1) : «key»);
// The objects the codec meets, for the identity watch: decode names each object it makes, encode each object it
// writes, so the watch counts exactly the objects that cross, accessors read by the codec included (review of PR 1403,
// codex run 39875360028: a cached array behind a getter was not counted).
// Identity across the boundary (review of PR 1403, codex runs 39875360028 and 39875900785). Every object that crosses
// has an id: the caller's objects carry the caller's ids, the objects a run makes get ids of the run (negative), the
// same in every run that makes the same calls. An argument object the run has seen before is the run's same object,
// changed in place to the caller's content, so a cache keyed by an object sees it again; a result object the caller
// has seen before comes back to the caller as its own object. The references are taken before the product loads.
const «applyIt» = Reflect.apply;
const «WeakMapIt» = WeakMap;
const «WeakRefIt» = WeakRef;
const «RegistryIt» = FinalizationRegistry;
const «MapIt» = Map;
const «SetIt» = Set;
const «DateIt» = Date;
const «isArrayIt» = Array.isArray;
const «protoOfIt» = Reflect.getPrototypeOf;
const «objectProto» = Object.prototype;
const «hasOwnIt» = Object.hasOwn;
const «wmGet» = WeakMap.prototype.get;
const «wmSet» = WeakMap.prototype.set;
const «derefIt» = WeakRef.prototype.deref;
const «registerIt» = FinalizationRegistry.prototype.register;
const «mGet» = Map.prototype.get;
const «mSet» = Map.prototype.set;
const «mDelete» = Map.prototype.delete;
const «mClear» = Map.prototype.clear;
const «mEach» = Map.prototype.forEach;
const «sAdd» = Set.prototype.add;
const «sClear» = Set.prototype.clear;
const «sEach» = Set.prototype.forEach;
const «timeOf» = Date.prototype.getTime;
const «timeTo» = Date.prototype.setTime;
function «identityState»() {
  const «byId» = new «MapIt»();
  const «registry» = new «RegistryIt»((«id») => «applyIt»(«mDelete», «byId», [«id»]));
  return { ids: new «WeakMapIt»(), byId: «byId», registry: «registry», next: -1 };
}
function «remember»(«state», «o», «id») {
  «applyIt»(«wmSet», «state».ids, [«o», «id»]);
  «applyIt»(«mSet», «state».byId, [«id», new «WeakRefIt»(«o»)]);
  «applyIt»(«registerIt», «state».registry, [«o», «id»]);
}
function «knownAs»(«state», «id») {
  const «ref» = «applyIt»(«mGet», «state».byId, [«id»]);
  return «ref» === undefined ? undefined : «applyIt»(«derefIt», «ref», []);
}
const «isPlainIt» = («o») => {
  const «p» = «protoOfIt»(«o»);
  return «p» === «objectProto» || «p» === null;
};
const «isExtensibleIt» = Object.isExtensible;
// The entries of a Map and the members of a Set, in order, read through the references captured above.
function «entriesOf»(«m») {
  const «out» = [];
  «applyIt»(«mEach», «m», [(«v», «k») => { «out»[«out».length] = [«k», «v»]; }]);
  return «out»;
}
function «membersOf»(«set») {
  const «out» = [];
  «applyIt»(«sEach», «set», [(«v») => { «out»[«out».length] = «v»; }]);
  return «out»;
}
// One step of a path: a key of an array or a plain object, or ['m', entry, 'k' | 'v'] into a Map's key or value,
// or ['s', member] into a Set.
function «stepInto»(«node», «seg») {
  if («node» === null || typeof «node» !== 'object') return undefined;
  if («isArrayIt»(«seg»)) {
    if («seg»[0] === 'm' && «node» instanceof «MapIt») {
      const «entry» = «entriesOf»(«node»)[«seg»[1]];
      return «entry» === undefined ? undefined : «seg»[2] === 'k' ? «entry»[0] : «entry»[1];
    }
    if («seg»[0] === 's' && «node» instanceof «SetIt») return «membersOf»(«node»)[«seg»[1]];
    return undefined;
  }
  const «d» = «descOf»(«node», «seg»);
  return «d» && 'value' in «d» ? «d».value : undefined;
}
// Puts in place of each object a decoded object holds the object it stands for («fin»).
function «swapChildren»(«node», «fin») {
  if («node» instanceof «MapIt») {
    const «all» = «entriesOf»(«node»);
    let «changed» = false;
    for (let «i» = 0; «i» < «all».length; «i» += 1) {
      const «k» = «fin»(«all»[«i»][0]);
      const «v» = «fin»(«all»[«i»][1]);
      if («k» !== «all»[«i»][0] || «v» !== «all»[«i»][1]) «changed» = true;
      «all»[«i»] = [«k», «v»];
    }
    if («changed») {
      «applyIt»(«mClear», «node», []);
      for (let «i» = 0; «i» < «all».length; «i» += 1) «applyIt»(«mSet», «node», «all»[«i»]);
    }
    return;
  }
  if («node» instanceof «SetIt») {
    const «all» = «membersOf»(«node»);
    let «changed» = false;
    for (let «i» = 0; «i» < «all».length; «i» += 1) {
      const «v» = «fin»(«all»[«i»]);
      if («v» !== «all»[«i»]) «changed» = true;
      «all»[«i»] = «v»;
    }
    if («changed») {
      «applyIt»(«sClear», «node», []);
      for (let «i» = 0; «i» < «all».length; «i» += 1) «applyIt»(«sAdd», «node», [«all»[«i»]]);
    }
    return;
  }
  if (!«isArrayIt»(«node») && !«isPlainIt»(«node»)) return;
  const «ks» = «keysOf»(«node»);
  for (let «i» = 0; «i» < «ks».length; «i» += 1) {
    const «d» = «descOf»(«node», «ks»[«i»]);
    if (!«d» || !('value' in «d») || «d».value === null || typeof «d».value !== 'object') continue;
    const «v» = «fin»(«d».value);
    if («v» !== «d».value) «node»[«ks»[«i»]] = «v»;
  }
}
// Whether the run's existing object already holds what the caller sent, entry for entry (an object it cannot change:
// frozen, sealed or not extensible, the caller's own copy of which cannot have changed either).
function «sameContent»(«existing», «node») {
  if («isArrayIt»(«existing») !== «isArrayIt»(«node»)) return false;
  if («existing» instanceof «MapIt» || «node» instanceof «MapIt») {
    if (!(«existing» instanceof «MapIt») || !(«node» instanceof «MapIt»)) return false;
    const «a» = «entriesOf»(«existing»);
    const «b» = «entriesOf»(«node»);
    if («a».length !== «b».length) return false;
    for (let «i» = 0; «i» < «a».length; «i» += 1) if (!Object.is(«a»[«i»][0], «b»[«i»][0]) || !Object.is(«a»[«i»][1], «b»[«i»][1])) return false;
    return true;
  }
  if («existing» instanceof «SetIt» || «node» instanceof «SetIt») {
    if (!(«existing» instanceof «SetIt») || !(«node» instanceof «SetIt»)) return false;
    const «a» = «membersOf»(«existing»);
    const «b» = «membersOf»(«node»);
    if («a».length !== «b».length) return false;
    for (let «i» = 0; «i» < «a».length; «i» += 1) if (!Object.is(«a»[«i»], «b»[«i»])) return false;
    return true;
  }
  if («existing» instanceof «DateIt» || «node» instanceof «DateIt»)
    return «existing» instanceof «DateIt» && «node» instanceof «DateIt» && Object.is(«applyIt»(«timeOf», «existing», []), «applyIt»(«timeOf», «node», []));
  const «a» = «keysOf»(«existing»);
  const «b» = «keysOf»(«node»);
  if («a».length !== «b».length) return false;
  for (let «i» = 0; «i» < «a».length; «i» += 1) {
    if («a»[«i»] !== «b»[«i»]) return false;
    const «x» = «descOf»(«existing», «a»[«i»]);
    const «y» = «descOf»(«node», «b»[«i»]);
    if (!«x» || !«y» || !('value' in «x») || !('value' in «y») || !Object.is(«x».value, «y».value)) return false;
  }
  return true;
}
// Changes the run's existing object in place to the content of the one the caller sent; false when they differ in
// kind or the existing one cannot be changed (frozen, sealed or not extensible).
function «refill»(«existing», «node») {
  if («isFrozenIt»(«existing») || !«isExtensibleIt»(«existing»)) return false;
  if («isArrayIt»(«existing») && «isArrayIt»(«node»)) {
    for (let «i» = 0; «i» < «node».length; «i» += 1) «existing»[«i»] = «node»[«i»];
    «existing».length = «node».length;
    return true;
  }
  if («existing» instanceof «MapIt» && «node» instanceof «MapIt») {
    «applyIt»(«mClear», «existing», []);
    «applyIt»(«mEach», «node», [(«v», «k») => «applyIt»(«mSet», «existing», [«k», «v»])]);
    return true;
  }
  if («existing» instanceof «SetIt» && «node» instanceof «SetIt») {
    «applyIt»(«sClear», «existing», []);
    «applyIt»(«sEach», «node», [(«v») => «applyIt»(«sAdd», «existing», [«v»])]);
    return true;
  }
  if («existing» instanceof «DateIt» && «node» instanceof «DateIt») {
    «applyIt»(«timeTo», «existing», [«applyIt»(«timeOf», «node», [])]);
    return true;
  }
  if («isPlainIt»(«existing») && «isPlainIt»(«node») && !«isArrayIt»(«existing») && !«isArrayIt»(«node»)) {
    const «old» = «keysOf»(«existing»);
    for (let «i» = 0; «i» < «old».length; «i» += 1) if (!«hasOwnIt»(«node», «old»[«i»])) delete «existing»[«old»[«i»]];
    const «fresh» = «keysOf»(«node»);
    for (let «i» = 0; «i» < «fresh».length; «i» += 1) «existing»[«fresh»[«i»]] = «node»[«fresh»[«i»]];
    return true;
  }
  return false;
}
// The arguments as the run decoded them: each object at a path of «refs» ([path, id]) becomes the run's object of
// that id when it has one, else is remembered under it. The deepest objects go first, so each object holds the
// run's objects before it is compared or copied. An object the run cannot change (frozen, sealed or not extensible)
// is reused when it already holds what the caller sent; else the call is refused by name («state».refused), since
// the product would see a new object where the caller's own call sees the same one.
function «applyRefs»(«root», «refs», «state») {
  «state».refused = undefined;
  if (!«refs») return «root»;
  const «nodes» = [];
  for (let «r» = 0; «r» < «refs».length; «r» += 1) {
    let «node» = «root»;
    const «path» = «refs»[«r»][0];
    for (let «p» = 0; «p» < «path».length && «node» !== undefined; «p» += 1) «node» = «stepInto»(«node», «path»[«p»]);
    «nodes»[«r»] = «node» !== null && typeof «node» === 'object' ? «node» : undefined;
  }
  const «finals» = new «WeakMapIt»();
  const «fin» = («o») => {
    if («o» === null || typeof «o» !== 'object') return «o»;
    const «f» = «applyIt»(«wmGet», «finals», [«o»]);
    return «f» === undefined ? «o» : «f»;
  };
  for (let «r» = «refs».length - 1; «r» >= 0; «r» -= 1) {
    const «node» = «nodes»[«r»];
    if («node» === undefined || «applyIt»(«wmGet», «finals», [«node»]) !== undefined) continue;
    const «id» = «refs»[«r»][1];
    «swapChildren»(«node», «fin»);
    const «existing» = «knownAs»(«state», «id»);
    let «final» = «node»;
    if («existing» === undefined || «existing» === «node») «remember»(«state», «node», «id»);
    else if («refill»(«existing», «node») || «sameContent»(«existing», «node»)) «final» = «existing»;
    else «state».refused ??= 'an object it holds from an earlier call, which it cannot change (frozen, sealed or not extensible), with another content';
    «applyIt»(«wmSet», «finals», [«node», «final»]);
  }
  «swapChildren»(«root», «fin»);
  return «root»;
}
// The ids of the objects a result's encoding met at a path ([path, object]): a known object keeps its id, a new one
// gets the next id of the run.
function «resultRefs»(«pairs», «state») {
  const «out» = [];
  for (let «i» = 0; «i» < «pairs».length; «i» += 1) {
    const «o» = «pairs»[«i»][1];
    let «id» = «applyIt»(«wmGet», «state».ids, [«o»]);
    if («id» === undefined) {
      «id» = «state».next;
      «state».next -= 1;
      «remember»(«state», «o», «id»);
    }
    «out»[«out».length] = [«pairs»[«i»][0], «id»];
  }
  return «out»;
}
// While a result is encoded: the objects met at a path (through arrays, plain objects, Maps and Sets), and the first part of the
// result the codec cannot carry (an accessor, a symbol or hidden key, a property of a Map, a Set or a Date, an object
// of a class), which a copy would hide from the caller.
let «collected»;
let «trail» = [];
let «uncarried»;
function «collectOn»() {
  «collected» = [];
  «trail» = [];
  «uncarried» = undefined;
}
function «collectOff»() {
  const «got» = { pairs: «collected», uncarried: «uncarried» };
  «collected» = undefined;
  return «got»;
}
const «encodeAt» = («v», «seen», «key») => {
  if («collected» === undefined || «v» === null || typeof «v» !== 'object') return «encode»(«v», «seen»);
  «trail»[«trail».length] = «key»;
  try {
    return «encode»(«v», «seen»);
  } finally {
    «trail».length -= 1;
  }
};
let «visitor»;
function «setVisitor»(«next») {
  «visitor» = «next»;
}
const «made» = («o») => {
  if («visitor») «visitor»(«o»);
  return «o»;
};
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
  if («visitor») «visitor»(«value»);
  if («collected» !== undefined) {
    const «at» = [];
    for (let «t» = 0; «t» < «trail».length; «t» += 1) «at»[«t»] = «trail»[«t»];
    «collected»[«collected».length] = [«at», «value»];
  }
  const «container» = «value» instanceof Map || «value» instanceof Set || «value» instanceof Date;
  if («collected» !== undefined && «container» && «uncarried» === undefined && «keysOf»(«value»).length > 0)
    «uncarried» = 'a property of a Map, a Set or a Date';
  try {
    if («value» instanceof Map) return { $map: [...«value».entries()].map(([«k», «v»], «i») => [«encodeAt»(«k», «seen», ['m', «i», 'k']), «encodeAt»(«v», «seen», ['m', «i», 'v'])]) };
    if («value» instanceof Set) return { $set: [...«value».values()].map((«v», «i») => «encodeAt»(«v», «seen», ['s', «i»])) };
    if («value» instanceof Error) return { $err: { name: «value».name, message: «value».message } };
    if (Array.isArray(«value»)) return «value».map((«v», «i») => «encodeAt»(«v», «seen», «i»));
    if («value» instanceof Date) return { $date: «value».toISOString() };
    if (ArrayBuffer.isView(«value»)) return { $bytes: [...new Uint8Array(«value».buffer, «value».byteOffset, «value».byteLength)] };
    const «proto» = Object.getPrototypeOf(«value»);
    if («proto» !== Object.prototype && «proto» !== null) {
      if («collected» !== undefined && «uncarried» === undefined) «uncarried» = 'an object of a class';
      return { $opaque: («proto» && «proto».constructor && «proto».constructor.name) || 'object' };
    }
    if («collected» !== undefined && «uncarried» === undefined) {
      const «ks» = «keysOf»(«value»);
      for (let «i» = 0; «i» < «ks».length && «uncarried» === undefined; «i» += 1) {
        const «d» = «descOf»(«value», «ks»[«i»]);
        if (typeof «ks»[«i»] !== 'string' || !«d».enumerable) «uncarried» = 'a symbol or hidden property';
        else if (!('value' in «d»)) «uncarried» = 'an accessor property';
      }
    }
    return Object.fromEntries(Object.entries(«value»).map(([«k», «v»]) => [«esc»(«k»), «encodeAt»(«v», «seen», «k»)]));
  } finally {
    «seen».delete(«value»);
  }
}
function «decode»(«x») {
  if («x» === null || typeof «x» !== 'object') return «x»;
  if (Array.isArray(«x»)) return «made»(«x».map((«v») => «decode»(«v»)));
  if ('$n' in «x») return «x».$n === '-0' ? -0 : Number(«x».$n);
  if ('$u' in «x») return undefined;
  if ('$big' in «x») return BigInt(«x».$big);
  if ('$map' in «x») return «made»(new Map(«x».$map.map(([«k», «v»]) => [«decode»(«k»), «decode»(«v»)])));
  if ('$set' in «x») return «made»(new Set(«x».$set.map((«v») => «decode»(«v»))));
  if ('$date' in «x») return «made»(new Date(«x».$date));
  if ('$bytes' in «x») return «made»(Uint8Array.from(«x».$bytes));
  if ('$handle' in «x») return «handles».get(«x».$handle);
  if ('$fn' in «x») return (0, eval)('(' + «x».$fn + ')');
  if ('$err' in «x») { const «Class» = { Error, RangeError, TypeError, SyntaxError, ReferenceError, EvalError, URIError }[«x».$err.name] || Error; const «e» = new «Class»(«x».$err.message); «e».name = «x».$err.name; return «made»(«e»); }
  return «made»(Object.fromEntries(Object.entries(«x»).map(([«k», «v»]) => [«unesc»(«k»), «decode»(«v»)])));
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
const «mapGet» = Map.prototype.get;
const «mapSet» = Map.prototype.set;
const «setValues» = Set.prototype.values;
const «mapNext» = «protoOf»(new Map().entries()).next;
const «setNext» = «protoOf»(new Set().values()).next;
const «dateTime» = Date.prototype.getTime;
const «seenHas» = WeakSet.prototype.has;
const «seenAdd» = WeakSet.prototype.add;
const «SeenSet» = WeakSet;
const «isProxy» = «utilTypes».isProxy;
const «hasOwn» = Object.hasOwn;
const «floatArray» = Float64Array;
const «isExt» = Object.isExtensible;
const «isMapKind» = «utilTypes».isMap;
const «isSetKind» = «utilTypes».isSet;
const «isDateKind» = «utilTypes».isDate;
const «isSealedIt» = Object.isSealed;
const «ids» = new WeakMap();
// The prototype of each kind of argument as the validator decodes it, by kind: plain, array, typed, Map, Set, Date.
const «canonical» = [Object.prototype, Array.prototype, null, Map.prototype, Set.prototype, Date.prototype];
const «idGet» = WeakMap.prototype.get;
const «idSet» = WeakMap.prototype.set;
let «idNext» = 0;
const «byteArray» = Uint8Array;
const «typedLength» = «describe»(«protoOf»(Uint8Array.prototype), 'length').get;
const «viewByteLength» = «describe»(DataView.prototype, 'byteLength').get;
const «viewByte» = DataView.prototype.getUint8;
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
// Aliased results and written arguments (docs/validators.md section 12.9): the live results of the last calls, each
// with a digest of what it held when it was returned, and the arguments of a call before and after it. The scan walks
// a value with the captured references above and builds its text with string concatenation only. It writes two
// digests: the DATA one holds what the frame can copy back to the caller (the values of array slots and their length,
// the enumerable string keys of a plain object, the content of a Map, a Set, a Date and a typed array), and the OTHER
// one holds everything it cannot copy back (a function value, an accessor, a symbol or non-enumerable key, an extra
// property of a container, a descriptor flag, the prototype, extensibility). A change in the OTHER digest is a change
// the frame cannot reproduce.
let «sawInvalid» = false;
const «scan» = («root», «prior») => {
  // The objects met in this scan, by the order they were first met, up to a cap (the arguments of the scale items hold
  // millions of rows, and a map of them costs more than the scan).
  const «known» = new Map();
  const «dataHash» = «call»(«hashStart», undefined, ['sha256']);
  const «otherHash» = «call»(«hashStart», undefined, ['sha256']);
  let «dataText» = '';
  let «otherText» = '';
  const «dataFlush» = () => {
    if («dataText».length > 0) «call»(«hashUpdate», «dataHash», [«dataText»]);
    «dataText» = '';
  };
  const «otherFlush» = () => {
    if («otherText».length > 0) «call»(«hashUpdate», «otherHash», [«otherText»]);
    «otherText» = '';
  };
  const «putData» = («piece») => {
    «dataText» += «piece»;
    if («dataText».length > 65536) «dataFlush»();
  };
  const «putOther» = («piece») => {
    «otherText» += «piece»;
    if («otherText».length > 65536) «otherFlush»();
  };
  // The objects on the way down to the value being walked, by depth: a value met again below itself is a cycle. No
  // set of every object met: the arguments of the scale items hold millions.
  const «ancestors» = new Array(1002);
  // A stable number for a function, a prototype or an object: the same one the next time it is met.
  const «idOf» = («thing») => {
    try {
      let «have» = «call»(«idGet», «ids», [«thing»]);
      if («have» === undefined) {
        «idNext» += 1;
        «have» = «idNext»;
        «call»(«idSet», «ids», [«thing», «have»]);
      }
      return «have»;
    } catch {
      return -1;
    }
  };
  const «isIndex» = («key») => {
    if (typeof «key» !== 'string') return false;
    const «n» = +«key»;
    return '' + «n» === «key» && «n» >= 0 && «n» % 1 === 0 && «n» < 4294967295;
  };
  // The flag inOther: everything below goes to the OTHER digest (a value under a key the frame cannot copy back).
  const «walk» = («value», «level», «inOther») => {
    const «put» = «inOther» ? «putOther» : «putData»;
    // A Proxy runs the product's own code on every read: it is not read, it is reported (an invalid result).
    if ((typeof «value» === 'object' || typeof «value» === 'function') && «value» !== null && «isProxy»(«value»)) {
      «sawInvalid» = true;
      «putOther»('P;');
      return;
    }
    switch (typeof «value») {
      case 'undefined': «put»('u;'); return;
      case 'boolean': «put»(«value» ? 't;' : 'f;'); return;
      case 'number': «put»('n' + («same»(«value», -0) ? '-0' : '' + «value») + ';'); return;
      case 'bigint': «put»('b' + «value» + ';'); return;
      case 'string': «put»('s' + «value».length + ':' + «value» + ';'); return;
      case 'symbol': «put»('y;'); «putOther»('Y' + «idOf»(«value») + ';'); return;
      case 'function': «put»('F;'); «putOther»('F' + «idOf»(«value») + ';'); return;
    }
    if («value» === null) { «put»('N;'); return; }
    if («level» > 1000) { «put»('D;'); return; }
    for (let «up» = 0; «up» < «level»; «up» += 1) {
      if («ancestors»[«up»] === «value») { «put»('C;'); return; }
    }
    «ancestors»[«level»] = «value»;
    // The identity of the object: the number of its first visit in the scan before the call, written each time it is
    // met. An object the product made after the call has no such number and writes nothing, so adding an object
    // changes nothing, while replacing an object by an equal copy, reaching one object by two keys, or moving
    // objects between slots does (review of PR 986, codex run 39780074824).
    if («prior» === undefined) {
      let «index» = «call»(«mapGet», «known», [«value»]);
      if («index» === undefined && «known».size < 100000) {
        «index» = «known».size;
        «call»(«mapSet», «known», [«value», «index»]);
      }
      if («index» !== undefined) «putOther»('I' + «index» + ';');
    } else {
      const «before» = «call»(«mapGet», «prior», [«value»]);
      if («before» !== undefined) «putOther»('I' + «before» + ';');
    }
    const «proto» = «protoOf»(«value»);

    // A frozen or sealed object is not extensible: the two flags are read only for a non-extensible object.
    if (!«isExt»(«value»)) «putOther»('X0' + («isFrozenIt»(«value») ? 1 : 0) + («isSealedIt»(«value») ? 1 : 0) + ';');
    // The kind of the object, and its content.
    let «kind» = 0;
    let «indices» = 0;
    let «entries»;
    if («isMapKind»(«value»)) «entries» = «call»(«mapEntries», «value», []);
    let «values»;
    let «time»;
    if («entries» !== undefined) {
      «kind» = 3;
      «put»('M{');
      for (;;) {
        const «step» = «call»(«mapNext», «entries», []);
        if («step».done) break;
        «walk»(«step».value[0], «level» + 1, «inOther»);
        «walk»(«step».value[1], «level» + 1, «inOther»);
      }
      «put»('}');
    } else {
      if («isSetKind»(«value»)) «values» = «call»(«setValues», «value», []);
      if («values» !== undefined) {
        «kind» = 4;
        «put»('S{');
        for (;;) {
          const «step» = «call»(«setNext», «values», []);
          if («step».done) break;
          «walk»(«step».value, «level» + 1, «inOther»);
        }
        «put»('}');
      } else {
        if («isDateKind»(«value»)) «time» = «call»(«dateTime», «value», []);
        if («time» !== undefined) {
          «kind» = 5;
          «put»('T' + «time» + ';');
        } else if («isView»(«value»)) {
          // The length of a typed array comes from the getter of %TypedArray%.prototype, never from the length
          // property, which an instance can define as its own; a DataView has no such length and is read byte by byte.
          let «size»;
          try { «size» = «call»(«typedLength», «value», []); } catch { «size» = undefined; }
          «kind» = 2;
          if («size» !== undefined) {
            «put»('V' + «size» + ':');
            for (let «i» = 0; «i» < «size»; «i» += 1) «put»(«same»(«value»[«i»], -0) ? '-0,' : '' + «value»[«i»] + ',');
          } else {
            const «bytes» = «call»(«viewByteLength», «value», []);
            «put»('W' + «bytes» + ':');
            for (let «i» = 0; «i» < «bytes»; «i» += 1) «put»('' + «call»(«viewByte», «value», [«i»]) + ',');
          }
          «put»(';');
        } else if («isArray»(«value»)) {
          «kind» = 1;
          // Each index is read through its descriptor: an accessor element is not called and a hole is not read. A run
          // of numbers goes into the digest as the bytes of a Float64Array, not as text: the arguments of the scale
          // items are millions of numbers, and a scan of them runs before and after every call.
          const «length» = «value».length;
          «put»('A' + «length» + '[');
          // A short array cannot fill a 4096-number chunk. Keep its exact bytes without allocating 32 KiB per row.
          const «run» = new «floatArray»(«length» < 4096 ? «length» : 4096);
          let «runLength» = 0;
          const «flushRun» = () => {
            if («runLength» === 0) return;
            «put»('N' + «runLength» + ':');
            if («inOther») «otherFlush»(); else «dataFlush»();
            «call»(«hashUpdate», «inOther» ? «otherHash» : «dataHash», [new «byteArray»(«run».buffer, 0, «runLength» * 8)]);
            «runLength» = 0;
          };
          for (let «i» = 0; «i» < «length»; «i» += 1) {
            const «cell» = «describe»(«value», «i»);
            if («cell» !== undefined) «indices» += 1;
            if («cell» === undefined) {
              «flushRun»();
              «put»('h;');
              // A hole cannot cross as data (JSON has none): its place is a change the frame cannot copy back.
              «putOther»('h' + «i» + ';');
            } else if («cell».get !== undefined || «cell».set !== undefined) {
              «flushRun»();
              «sawInvalid» = true;
              «putOther»('G' + «i» + ':' + («cell».get === undefined ? 0 : «idOf»(«cell».get)) + ',' + («cell».set === undefined ? 0 : «idOf»(«cell».set)) + ';');
              «put»('G;');
            } else {
              if (!«cell».writable || !«cell».enumerable || !«cell».configurable) «putOther»('f' + «i» + ':' + («cell».writable ? 1 : 0) + («cell».enumerable ? 1 : 0) + («cell».configurable ? 1 : 0) + ';');
              if (typeof «cell».value === 'number') {
                «run»[«runLength»] = «cell».value;
                «runLength» += 1;
                if («runLength» === 4096) «flushRun»();
              } else {
                «flushRun»();
                «walk»(«cell».value, «level» + 1, «inOther»);
              }
            }
          }
          «flushRun»();
          «put»(']');
        }
      }
    }
    // The prototype, by identity, for every object whose prototype is not the one the validator's own decoding gives
    // its kind (the base object prototype for a plain object, the array prototype for an array, the Map, Set and Date ones). A
    // swap to null, to a built-in one or to a custom one always changes the digest (review of PR 986, codex run
    // 39756451516). The canonical prototype is left out only so that an object a product adds or removes, which the
    // frame copies back and decodes with exactly that prototype, does not count as a change; a typed array and a
    // DataView are always recorded.
    if («kind» === 2 || «proto» !== «canonical»[«kind»]) «putOther»('P' + («proto» === null ? 0 : «idOf»(«proto»)) + ';');
    // Own properties. The ones the frame can copy back (the enumerable string keys of a plain object) go to the data
    // digest; every other one goes to the other digest with its descriptor, and what it holds.
    const «keys» = «ownKeys»(«value»);
    const «plain» = «kind» === 0;
    if («plain») «put»('O{');
    // Array own keys start with the present indices in numeric order. Their descriptors and values were all
    // scanned above; start at the remaining keys, still checking every extra property and the length descriptor.
    // Proxies were refused before this walk. Check the current boundary too: a tampered intrinsic getter can
    // change the array while its numeric runs are hashed. If the saved prefix now includes an extra key, rescan it.
    for (let «i» = «kind» === 1 && «indices» > 0 && «indices» <= «keys».length && «isIndex»(«keys»[«indices» - 1]) ? «indices» : 0; «i» < «keys».length; «i» += 1) {
      const «key» = «keys»[«i»];
      if («kind» === 1 && «key» === 'length') continue;
      if ((«kind» === 1 || «kind» === 2) && «isIndex»(«key»)) continue;
      const «desc» = «describe»(«value», «key»);
      // A descriptor with a getter or a setter is an accessor; a descriptor read through a polluted base prototype can only
      // look like an accessor, which fails the item.
      const «isData» = «desc».get === undefined && «desc».set === undefined;
      const «copyable» = «plain» && typeof «key» === 'string' && «isData» && «desc».writable && «desc».enumerable && «desc».configurable && !«inOther»;
      if («copyable») {
        «putData»('k' + «key».length + ':' + «key»);
        «walk»(«desc».value, «level» + 1, false);
        continue;
      }
      «putOther»('x' + (typeof «key» === 'symbol' ? 'Y' + «idOf»(«key») : «key».length + ':' + «key») + ':' + («desc».writable ? 1 : 0) + («desc».enumerable ? 1 : 0) + («desc».configurable ? 1 : 0) + ';');
      if («isData») «walk»(«desc».value, «level» + 1, true);
      else {
        // An accessor runs the product's own code on every read: it is not called, it is reported.
        «sawInvalid» = true;
        «putOther»('G' + («desc».get === undefined ? 0 : «idOf»(«desc».get)) + ',' + («desc».set === undefined ? 0 : «idOf»(«desc».set)) + ';');
      }
    }
    if («plain») «put»('}');
    if («kind» === 1) {
      const «lengthDesc» = «describe»(«value», 'length');
      if (!«lengthDesc».writable) «putOther»('L0;');
    }
  };
  «walk»(«root», 0, false);
  «dataFlush»();
  «otherFlush»();
  return { data: «call»(«hashDigest», «dataHash», ['hex']), other: «call»(«hashDigest», «otherHash», ['hex']), known: «known» };
};
const «fingerprint» = («root») => {
  const «parts» = «scan»(«root»);
  return «parts».data + «parts».other;
};
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
  // Built-in objects (docs/validators.md section 12.9, "Built-in objects"). A product that replaces a method of a
  // built-in object (Array.prototype.map, Math.sqrt, eval), adds or removes a property of one, changes a descriptor, a
  // prototype or the extensibility of one, or rebinds or adds a global name, changes how its caller's own code runs
  // after the call. A call in the caller's process shows it; a confined run keeps it in its own process (review of
  // PR 986, codex run 39782335737: a mean that replaced the array prototype's map after it computed the right answer
  // failed the mean-shift items directly and passed them through the frame). Before the product loads, the driver
  // records what the realm itself lists, never a hand list of names (review of PR 986, codex runs 39821091340 and
  // 39821718881: eval and Intl were missing from such a list): every own property of the global object, and from
  // there, to a depth of 8, every function, every object a function holds as its prototype, every prototype of a
  // recorded object and every object whose prototype is the base object prototype or null (a namespace such as
  // Math, Intl or Reflect), with the descriptor of each own property. Objects of any other kind (process, console,
  // a stream) hold the state of the process and are recorded only as the value of the property that holds them.
  // The global object's lazy properties (a getter that defines the value on first read) are read first, so their
  // first use by the product is not a change. After every call the driver compares the record through the
  // references captured above and names the first change.
  const «globalObject» = globalThis;
  const «baseProto» = Object.prototype;
  const «builtinDepth» = 8;
  for (const «lazyKey» of «ownKeys»(«globalObject»)) {
    const «lazy» = «describe»(«globalObject», «lazyKey»);
    if («lazy» && «lazy».get !== undefined) {
      try {
        void «globalObject»[«lazyKey»];
      } catch {
        // a getter that throws keeps throwing for the product too
      }
    }
  }
  // The objects, each with its place (the record that holds it and the label of the property or prototype step), its
  // prototype, extensibility, own keys in order with their labels, and their descriptors. The global object is the
  // first; its changes are named after those of the objects it holds. Every label is made before the product loads.
  const «builtins» = [];
  // The global names known before any call: those before the product loads, and those its loading added.
  const «knownNames» = Object.create(null);
  const «knowNames» = () => {
    const «present» = «ownKeys»(«globalObject»);
    for (let «k» = 0; «k» < «present».length; «k» += 1) «knownNames»[«present»[«k»]] = true;
  };
  «knowNames»();
  // The path of a record: its labels from the root, by concatenation only.
  const «pathOf» = («record») =>
    «record».parent === null || «record».parent.thing === «globalObject» ? «record».label : «pathOf»(«record».parent) + «record».label;
  {
    const «queue» = [[null, 'globalThis', «globalObject», 0]];
    // The intrinsics no property holds.
    for (const [«label», «thing»] of [
      ['%ArrayIteratorPrototype%', «protoOf»([][Symbol.iterator]())],
      ['%MapIteratorPrototype%', «protoOf»(new Map().entries())],
      ['%SetIteratorPrototype%', «protoOf»(new Set().values())],
      ['%StringIteratorPrototype%', «protoOf»(''[Symbol.iterator]())],
      ['%RegExpStringIteratorPrototype%', «protoOf»('a'.matchAll(/a/g))],
      ['%TypedArray%', «protoOf»(Int8Array)],
      ['%GeneratorFunction.prototype%', «protoOf»(function* () {})],
      ['%AsyncFunction.prototype%', «protoOf»(async function () {})],
      ['%AsyncGeneratorFunction.prototype%', «protoOf»(async function* () {})],
    ])
      «queue».push([null, «label», «thing», 1]);
    // An object met again keeps its record; a place through properties names it better than one through prototypes.
    const «met» = new Map();
    for (let «head» = 0; «head» < «queue».length; «head» += 1) {
      const [«parent», «label», «thing», «depth»] = «queue»[«head»];
      if («thing» === null || (typeof «thing» !== 'object' && typeof «thing» !== 'function')) continue;
      const «seenRecord» = «met».get(«thing»);
      if («seenRecord» !== undefined) {
        const «candidate» = { parent: «parent», label: «label», thing: «thing» };
        if («pathOf»(«seenRecord»).includes('[[Prototype]]') && !«pathOf»(«candidate»).includes('[[Prototype]]')) {
          «seenRecord».parent = «parent»;
          «seenRecord».label = «label»;
        }
        continue;
      }
      const «keys» = «ownKeys»(«thing»);
      const «descs» = «keys».map((«key») => «describe»(«thing», «key»));
      const «labels» = «keys».map((«key») => («thing» === «globalObject» ? String(«key») : '.' + String(«key»)));
      const «protoNow» = «protoOf»(«thing»);
      const «record» = { parent: «parent», label: «label», thing: «thing», proto: «protoNow», ext: «isExt»(«thing»), keys: «keys», labels: «labels», descs: «descs» };
      «met».set(«thing», «record»);
      «builtins».push(«record»);
      if («depth» >= «builtinDepth») continue;
      «queue».push([«record», «thing» === «globalObject» ? 'globalThis.[[Prototype]]' : '.[[Prototype]]', «protoNow», «depth» + 1]);
      for (let «k» = 0; «k» < «keys».length; «k» += 1) {
        const «desc» = «descs»[«k»];
        if (!«hasOwn»(«desc», 'value')) {
          «queue».push([«record», «labels»[«k»] + ' (getter)', «desc».get, «depth» + 1], [«record», «labels»[«k»] + ' (setter)', «desc».set, «depth» + 1]);
          continue;
        }
        const «held» = «desc».value;
        if (typeof «held» === 'function') «queue».push([«record», «labels»[«k»], «held», «depth» + 1]);
        else if («held» !== null && typeof «held» === 'object') {
          const «heldProto» = «protoOf»(«held»);
          if («keys»[«k»] === 'prototype' || «heldProto» === «baseProto» || «heldProto» === null) «queue».push([«record», «labels»[«k»], «held», «depth» + 1]);
        }
      }
    }
  }
  // Two descriptors are the same: the same kind, flags, and value or accessor functions. Only own fields are read.
  const «sameDescriptor» = («x», «y») => {
    const «xData» = «hasOwn»(«x», 'value');
    if («xData» !== «hasOwn»(«y», 'value')) return false;
    if («x».enumerable !== «y».enumerable || «x».configurable !== «y».configurable) return false;
    return «xData» ? «same»(«x».value, «y».value) && «x».writable === «y».writable : «x».get === «y».get && «x».set === «y».set;
  };
  // The first change in one recorded object, by its path, or undefined.
  const «changeOf» = («was») => {
    const «global» = «was».thing === «globalObject»;
    const «named» = «global» ? 'the global object' : «pathOf»(«was»);
    if («protoOf»(«was».thing) !== «was».proto) return 'the prototype of ' + «named»;
    if («isExt»(«was».thing) !== «was».ext) return 'the extensibility of ' + «named»;
    // The global object: a name the product adds is no change to its caller, whose code names only what it knows
    // (a library of the product keeps its settings in a global of its own name, as zod does). A name rebound or
    // removed is one.
    if («global») {
      for (let «k» = 0; «k» < «was».keys.length; «k» += 1) {
        const «bound» = «describe»(«was».thing, «was».keys[«k»]);
        if («bound» === undefined) return 'the global name ' + «was».labels[«k»] + ' (removed)';
        if (!«sameDescriptor»(«bound», «was».descs[«k»])) return 'the global name ' + «was».labels[«k»];
      }
      // A name added during a call is a change: the names the product added while it loaded are its own setting
      // (review of PR 1403, sonnet-review-c-2: a name added in weightInterval passed).
      const «namesNow» = «ownKeys»(«globalObject»);
      for (let «k» = 0; «k» < «namesNow».length; «k» += 1) {
        const «name» = «namesNow»[«k»];
        if (!«hasOwn»(«knownNames», «name»))
          return 'a global name added during a call' + (typeof «name» === 'string' ? ' (' + «name» + ')' : '');
      }
      return undefined;
    }
    const «keysNow» = «ownKeys»(«was».thing);
    if («keysNow».length !== «was».keys.length) {
      // The first key added (or, when none was, removed), named when it is a string: the report is read by a person.
      const «longer» = «keysNow».length > «was».keys.length ? «keysNow» : «was».keys;
      const «shorter» = «longer» === «keysNow» ? «was».keys : «keysNow»;
      let «odd»;
      for (let «k» = 0; «k» < «longer».length && «odd» === undefined; «k» += 1) {
        let «found» = false;
        for (let «j» = 0; «j» < «shorter».length; «j» += 1) if («shorter»[«j»] === «longer»[«k»]) «found» = true;
        if (!«found») «odd» = «longer»[«k»];
      }
      const «oddName» = typeof «odd» === 'string' ? ' (' + «odd» + ')' : '';
      return («longer» === «keysNow» ? 'a property added to ' : 'a property removed from ') + «named» + «oddName»;
    }
    for (let «k» = 0; «k» < «keysNow».length; «k» += 1) {
      if («keysNow»[«k»] !== «was».keys[«k»]) return 'the properties of ' + «named»;
      if (!«sameDescriptor»(«describe»(«was».thing, «keysNow»[«k»]), «was».descs[«k»]))
        return «global» ? 'the global name ' + «was».labels[«k»] : «named» + «was».labels[«k»];
    }
    return undefined;
  };
  // The first built-in object the product changed since it was recorded, by its path, or undefined.
  const «builtinChange» = () => {
    for (let «r» = 1; «r» < «builtins».length; «r» += 1) {
      const «change» = «changeOf»(«builtins»[«r»]);
      if («change» !== undefined) return «change»;
    }
    return «changeOf»(«builtins»[0]);
  };
  // The change reported with each answer: every call after the change reports it, as every later call in the
  // caller's process would run with it.
  const «altered» = () => {
    const «change» = «builtinChange»();
    return «change» === undefined ? {} : { altered: «change» };
  };
  // Identity facts (review of PR 1403, codex run 39870167091), for an item that checks that its results are fresh:
  // the objects of a result that are also objects of the call's arguments, or of a result returned before while the
  // same watch is on. A copy of the answer hides both from the caller, who would see them in a call of its own
  // process. Only the counts cross; the walk uses the references captured before the product loads.
  const «identity» = «identityState»();
  let «identityEpoch»;
  let «returned» = new «SeenSet»();
  // Opens the watch of one call: returns the set of the argument objects decoding made (pass it to decode's visitor).
  const «identityOpen» = («request») => {
    if («request».identity === undefined) return undefined;
    if («request».identity !== «identityEpoch») {
      «identityEpoch» = «request».identity;
      «returned» = new «SeenSet»();
    }
    return new «SeenSet»();
  };
  // Counts the objects the encoding of a result met that are argument objects or objects of an earlier result.
  const «identityCount» = («argSet», «outs») => {
    if («argSet» === undefined) return {};
    let «withArgs» = 0;
    let «withEarlier» = 0;
    for (let «o» = 0; «o» < «outs».length; «o» += 1) {
      if («call»(«seenHas», «argSet», [«outs»[«o»]])) «withArgs» += 1;
      else if («call»(«seenHas», «returned», [«outs»[«o»]])) «withEarlier» += 1;
    }
    for (let «o» = 0; «o» < «outs».length; «o» += 1) «call»(«seenAdd», «returned», [«outs»[«o»]]);
    return «withArgs» + «withEarlier» > 0 ? { shared: [«withArgs», «withEarlier»] } : {};
  };
  let «product»;
  try {
    «product» = await import(«toUrl»(«setup».module).href);
    «knowNames»();
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
    // Write back (docs/validators.md section 12.9, "Written inputs"): run A takes a digest of the arguments before the
    // call and, when the call changed them, answers with their state after it, so the validator can apply the change to
    // the caller's own arguments exactly as a call in its own process would have changed them. A write that threw is
    // reported the same way.
    let «argsRef»;
    let «argsBefore»;
    const «afterState» = () => {
      if («argsBefore» === undefined) return {};
      const «now» = «scan»(«argsRef», «argsBefore».known);
      // A change the frame cannot copy back (a function, an accessor, a symbol or hidden key, an extra property of a
      // container, a descriptor, the prototype, extensibility) is reported as such, never copied.
      if («now».other !== «argsBefore».other) return { cannot: true };
      if («now».data === «argsBefore».data) return {};
      return { argsAfter: «encode»(«argsRef») };
    };
    «identity».refused = undefined;
    try {
      if (typeof «fn» !== 'function') throw new TypeError('the product has no function ' + «request».call);
      // A strict call (the item declares a purity check): the arguments arrive frozen, and a digest of them before and
      // after the call tells a write the freeze cannot stop (a typed array, a Map or a Set).
      const «strict» = «request».freeze === true;
      const «argSet» = «identityOpen»(«request»);
      «setVisitor»(«argSet» === undefined ? undefined : («o») => «call»(«seenAdd», «argSet», [«o»]));
      let «decodedArgs»;
      try {
        «decodedArgs» = «decode»(«request».args);
      } finally {
        «setVisitor»(undefined);
      }
      const «decoded» = «markAll»(«applyRefs»(«decodedArgs», «request».refs, «identity»), «request».marks);
      const «unsent» = «identity».refused ? { unsent: «identity».refused } : {};
      const «args» = «strict» ? «deepFreeze»(«decoded») : «decoded»;
      «argsRef» = «args»;
      if («strict» || «setup».writeBack) «argsBefore» = «scan»(«args»);
      const «before» = «cpuNow»();
      const «ambientOff» = «ambientOn»(«request».ambient);
      let «result»;
      try {
        «result» = await «deeper»(«setup».depth, () => «fn»(...«args»));
      } finally {
        «ambientOff»();
      }
      const «used» = «cpuNow»(«before»);
      const «outs» = [];
      «setVisitor»(«argSet» === undefined ? undefined : («o») => {
        «outs»[«outs».length] = «o»;
      });
      let «ret»;
      let «carried»;
      «collectOn»();
      try {
        «ret» = «encode»(«result»);
      } finally {
        «carried» = «collectOff»();
        «setVisitor»(undefined);
      }
      const «rrefs» = «resultRefs»(«carried».pairs, «identity»);
      const «after» = «afterState»();
      const «written» = «strict» && «fingerprint»(«args») !== «argsBefore».data + «argsBefore».other;
      const «shares» = «identityCount»(«argSet», «outs»);
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
      «answer»({ id: «request».id, ret: «ret», cpu: («used».user + «used».system) / 1000, ...(«movedCount» > 0 ? { moved: «moved» } : {}), ...(«invalid» ? { invalid: true } : {}), ...(«written» ? { written: true } : {}), ...«shares», ...(«rrefs».length > 0 ? { rrefs: «rrefs» } : {}), ...(«carried».uncarried ? { uncarried: «carried».uncarried } : {}), ...«unsent», ...«after», ...«altered»() });
    } catch («error») {
      «answer»({ id: «request».id, throws: «encode»(«error» instanceof Error ? «error» : new Error(String(«error»))), ...(«identity».refused ? { unsent: «identity».refused } : {}), ...(«argsRef» !== undefined ? «afterState»() : {}), ...«altered»() });
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
): { source: string; invoke: string } {
  const name = namer(seed, `wrapper:${tag}`);
  const source = [
    `import * as ${name('product')} from ${JSON.stringify(product)};`,
    `export const ${name('invoke')} = async (${name('call')}, ${name('args')}) => {`,
    `  const ${name('fn')} = ${name('product')}[${name('call')}];`,
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
): {
  source: string;
  encode: string;
  decode: string;
  handles: string;
  deepFreeze: string;
  markAll: string;
  ambientOn: string;
  setVisitor: string;
  identityState: string;
  applyRefs: string;
  resultRefs: string;
  collectOn: string;
  collectOff: string;
} {
  const name = namer(seed, `codec:${tag}`);
  const source = `${fill(CODEC, name)}\nexport { ${name('encode')}, ${name('decode')}, ${name('handles')}, ${name('deepFreeze')}, ${name('markAll')}, ${name('ambientOn')}, ${name('setVisitor')}, ${name('identityState')}, ${name('applyRefs')}, ${name('resultRefs')}, ${name('collectOn')}, ${name('collectOff')} };\n`;
  return {
    source,
    encode: name('encode'),
    decode: name('decode'),
    handles: name('handles'),
    deepFreeze: name('deepFreeze'),
    markAll: name('markAll'),
    ambientOn: name('ambientOn'),
    setVisitor: name('setVisitor'),
    identityState: name('identityState'),
    applyRefs: name('applyRefs'),
    resultRefs: name('resultRefs'),
    collectOn: name('collectOn'),
    collectOff: name('collectOff'),
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
  codec: {
    encode: string;
    decode: string;
    handles: string;
    deepFreeze: string;
    markAll: string;
    ambientOn: string;
    setVisitor: string;
    identityState: string;
    applyRefs: string;
    resultRefs: string;
    collectOn: string;
    collectOff: string;
  },
): string {
  const name = namer(seed, `plain:${tag}`);
  const product = name('product');
  const each = name('each');
  const fn = name('fn');
  const answer = name('answer');
  const error = name('error');
  return [
    // The codec first: it takes the functions it freezes with before the product module runs.
    `import { ${codec.encode} as ${name('encode')}, ${codec.decode} as ${name('decode')}, ${codec.handles} as ${name('handles')}, ${codec.deepFreeze} as ${name('deepFreeze')}, ${codec.markAll} as ${name('markAll')}, ${codec.ambientOn} as ${name('ambientOn')}, ${codec.setVisitor} as ${name('setVisitor')}, ${codec.identityState} as ${name('identityState')}, ${codec.applyRefs} as ${name('applyRefs')}, ${codec.resultRefs} as ${name('resultRefs')}, ${codec.collectOn} as ${name('collectOn')}, ${codec.collectOff} as ${name('collectOff')} } from ${JSON.stringify(paths.codec)};`,
    `import * as ${product} from ${JSON.stringify(paths.module)};`,
    `import { createReadStream as ${name('stream')}, appendFileSync as ${name('append')} } from 'node:fs';`,
    `import { createInterface as ${name('lines')} } from 'node:readline';`,
    // The identity watch, as in the confined runs: run C counts the same shared objects.
    `const ${name('identity')} = ${name('identityState')}();`,
    `let ${name('epoch')};`,
    `let ${name('returned')} = new WeakSet();`,
    `for await (const ${name('line')} of ${name('lines')}({ input: ${name('stream')}(new URL(${JSON.stringify(paths.calls)})) })) {`,
    `  const ${each} = JSON.parse(${name('line')});`,
    `  let ${answer};`,
    `  ${name('identity')}.refused = undefined;`,
    `  try {`,
    `    const ${fn} = ${each}.call.startsWith('#') ? ${name('handles')}.get(Number(${each}.call.slice(1))) : ${product}[${each}.call];`,
    `    if (typeof ${fn} !== 'function') throw new TypeError('the product has no function ' + ${each}.call);`,
    `    const ${name('watched')} = ${each}.identity !== undefined;`,
    `    if (${name('watched')} && ${each}.identity !== ${name('epoch')}) { ${name('epoch')} = ${each}.identity; ${name('returned')} = new WeakSet(); }`,
    `    const ${name('argSet')} = new WeakSet();`,
    `    ${name('setVisitor')}(${name('watched')} ? (${name('o')}) => ${name('argSet')}.add(${name('o')}) : undefined);`,
    `    let ${name('given')};`,
    `    try { ${name('given')} = ${name('markAll')}(${name('applyRefs')}(${name('decode')}(${each}.args), ${each}.refs, ${name('identity')}), ${each}.marks); } finally { ${name('setVisitor')}(undefined); }`,
    `    const ${name('off')} = ${name('ambientOn')}(${each}.ambient);`,
    `    let ${name('result')};`,
    `    try {`,
    `      ${name('result')} = await ${fn}(...(${each}.freeze ? ${name('deepFreeze')}(${name('given')}) : ${name('given')}));`,
    `    } finally {`,
    `      ${name('off')}();`,
    `    }`,
    `    const ${name('outs')} = [];`,
    `    ${name('setVisitor')}(${name('watched')} ? (${name('o')}) => { ${name('outs')}[${name('outs')}.length] = ${name('o')}; } : undefined);`,
    `    let ${name('carried')};`,
    `    ${name('collectOn')}();`,
    `    try { ${answer} = { ret: ${name('encode')}(${name('result')}) }; } finally { ${name('carried')} = ${name('collectOff')}(); ${name('setVisitor')}(undefined); }`,
    `    const ${name('rrefs')} = ${name('resultRefs')}(${name('carried')}.pairs, ${name('identity')});`,
    `    if (${name('rrefs')}.length > 0) ${answer}.rrefs = ${name('rrefs')};`,
    `    if (${name('carried')}.uncarried) ${answer}.uncarried = ${name('carried')}.uncarried;`,
    `    if (${name('identity')}.refused) ${answer}.unsent = ${name('identity')}.refused;`,
    `    if (${name('watched')}) {`,
    `      let ${name('withArgs')} = 0;`,
    `      let ${name('withEarlier')} = 0;`,
    `      for (const ${name('o')} of ${name('outs')}) { if (${name('argSet')}.has(${name('o')})) ${name('withArgs')} += 1; else if (${name('returned')}.has(${name('o')})) ${name('withEarlier')} += 1; }`,
    `      for (const ${name('o')} of ${name('outs')}) ${name('returned')}.add(${name('o')});`,
    `      if (${name('withArgs')} + ${name('withEarlier')} > 0) ${answer}.shared = [${name('withArgs')}, ${name('withEarlier')}];`,
    `    }`,
    `  } catch (${error}) { ${answer} = { throws: ${name('encode')}(${error} instanceof Error ? ${error} : new Error(String(${error}))), ...(${name('identity')}.refused ? { unsent: ${name('identity')}.refused } : {}) }; }`,
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
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { workerData } from 'node:worker_threads';
const { port, signal, plans, setup } = workerData;
const began = Date.now();
const trace = (text) => {
  if (!setup.trace) return;
  try { appendFileSync(setup.trace, new Date().toISOString() + ' relay ' + setup.tag + ' +' + (Date.now() - began) + ' ms ' + text + '\n'); } catch {}
};
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
  trace('spawned run ' + plan.run);
  child.stderr.on('data', (chunk) => { run.stderr = (run.stderr + chunk).slice(-4000); });
  child.on('exit', (code, sig) => {
    trace('run ' + plan.run + ' exited ' + (sig ?? code));
    run.exited = 'the run ' + plan.run + ' ended (' + (sig ?? code) + '): ' + run.stderr.split('\n').slice(-6).join(' ');
    for (const waiter of run.waiting.splice(0)) waiter.resolve({ dead: run.exited });
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    // The answer starts the line, unless the product printed text without a newline just before it: then the answer
    // follows that text, and is still the answer.
    const at = line.indexOf(setup.token + ' ');
    if (at < 0) return;
    const message = JSON.parse(line.slice(at + setup.token.length + 1));
    trace('run ' + plan.run + ' answer id ' + message.id + ': ' + line.slice(at + setup.token.length + 1, at + setup.token.length + 121));
    const waiter = run.waiting.shift();
    if (!waiter) {
      trace('run ' + plan.run + ' sent an answer nobody waits for (id ' + message.id + ')');
      return;
    }
    // An answer belongs to the request it was asked for: the twin writes the id of the request in every answer. An
    // answer for another request is a desync of that run, named with both ids, never taken for the answer.
    if (waiter.id !== undefined && message.id !== waiter.id) {
      waiter.resolve({ desync: 'the run ' + plan.run + ' answered request ' + message.id + ' while request ' + waiter.id + ' was waiting' });
      return;
    }
    waiter.resolve(message);
  });
  child.stdin.write(JSON.stringify({ ...setup, ...plan.setup, uptimeShift: plan.uptimeShift, depth: plan.depth }) + '\n');
  return run;
});
const ask = (run, line, id) =>
  new Promise((resolve) => {
    if (run.exited) return resolve({ dead: run.exited });
    run.waiting.push({ resolve, id });
    if (line !== undefined) run.child.stdin.write(line + '\n');
  });
const ready = await Promise.all(runs.map((run) => ask(run).then((message) => { trace('run ' + run.plan.run + ' answered its start: ' + (message.ready === true ? 'ready' : 'not ready')); return message; })));
reply({ ready });
let id = 0;
port.on('message', async (message) => {
  if (message.close) {
    for (const run of runs) run.child.kill();
    reply({ closed: true });
    return;
  }
  id += 1;
  const line = JSON.stringify({ id, call: message.call, args: message.args, freeze: message.freeze === true, ...(message.marks ? { marks: message.marks } : {}), ...(message.ambient ? { ambient: message.ambient } : {}), ...(message.identity !== undefined ? { identity: message.identity } : {}), ...(message.refs ? { refs: message.refs } : {}) });
  const sentAt = Date.now();
  const answers = await Promise.all(runs.map((run) => ask(run, line, id).then((answer) => { const took = Date.now() - sentAt; if (took > 10000) trace('run ' + run.plan.run + ' answered ' + message.call + ' after ' + took + ' ms'); return answer; })));
  reply({ id, call: message.call, answers });
});
`;
