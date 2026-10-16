import { between, pick, type RawSpec, type Rng, rngFor, SHOP } from './harness';
import { type Action, type FileAction, type Kind, token } from './kinds';

/**
 * The recipe: from a hidden seed, a planted agent of one kind and the spec it plays, with the truth kept apart.
 * A block plan says what the block is (its parent, its Given layers) and what the agent does on it (pass, or one
 * fault of the catalogue). The recipe writes three things: the raw spec the product loads, the action plan the
 * fake agent plays (behaviour only), and the truth (each block's verdict, cause, parent, blamed section and fix),
 * which only the item holds. Every id, marker and file name is a neutral token: nothing the product can read
 * names a verdict or a fault.
 */

export type Fault = {
  /** The fault's id: never written into a spec, an id or a file. */
  id: string;
  kind: Kind;
  /** The prompt section the fault violates, by its role in the planted prompt. */
  section: string;
  /** The one change that would make the block pass: the fix cause of every item it fails. */
  fix: string;
  /** The agent's action with the fault planted, from the passing action of the block. */
  apply(action: Action, block: Built, rng: Rng): Action;
};

export type Fate = 'pass' | 'fail' | 'not_run';

export type BlockPlan = {
  fate: Fate;
  /** For a failing block: the planted fault; default the kind's basic fault. */
  fault?: Fault;
  /** The index of this block's parent, when the spec declares parent links. */
  parent?: number;
  /** A forced tool result in this block's Given: a layer the planted adapters cannot apply (not_run). */
  stub?: boolean;
  /** A written prefix in this block's Given. */
  prefix?: boolean;
};

/** One block as built: its neutral id and marker, and the values its expectation and its agent share. */
export type Built = {
  index: number;
  id: string;
  marker: string;
  /** NORMAL: the code the reply must say. CODE: the value the file's checked cell must hold. */
  value: number;
  code: string;
  /** CODE: the file the block's instruction asks for. */
  file?: FileAction;
};

export type Truth = {
  verdict: 'pass' | 'fail' | 'not_run' | 'blocked';
  /** The fix cause of a failing block; for a blocked block, the cause of its root. */
  cause?: string;
  section?: string;
  parent?: string;
  /** For a blocked block: the parent that blocks it and the first cause above it. */
  blockedBy?: string;
  root?: string;
};

export type Recipe = {
  kind: Kind;
  raw: RawSpec;
  actions: Map<string, Action>;
  blocks: Built[];
  /** Kept by the item only. */
  truth: Map<string, Truth>;
};

const FORMATS = ['xlsx', 'csv', 'json', 'docx', 'pdf'] as const;

/** The file block i of a CODE recipe asks for, with the planted value in the place its check reads. */
function codeFile(rng: Rng, seed: number, tag: string, index: number, value: number): FileAction {
  const format = FORMATS[(index + between(rng, 0, 4)) % FORMATS.length] as (typeof FORMATS)[number];
  const name = `out/${token(seed, `${tag}#file#${index}`)}.${format}`;
  const bike = pick(rng, SHOP.bikes);
  if (format === 'xlsx')
    return {
      path: name,
      format,
      data: {
        sheets: [
          {
            name: 'Rentals',
            rows: [
              ['Bike', 'Days'],
              [bike, value],
            ],
          },
          { name: 'Notes', rows: [['Kept']] },
        ],
      },
    };
  if (format === 'csv')
    return {
      path: name,
      format,
      data: [
        ['bike', 'days'],
        [bike, value],
      ],
    };
  if (format === 'json') return { path: name, format, data: { bike, days: value } };
  if (format === 'docx')
    return { path: name, format, data: { paragraphs: ['Rental note', `${bike} rented for ${value} days.`] } };
  return {
    path: name,
    format,
    data: { pages: Array.from({ length: (value % 4) + 1 }, (_, p) => `Page ${p + 1} of the ${bike} report`) },
  };
}

/** The checks a CODE block declares on its file: the value at its planted place. */
function fileChecks(file: FileAction, value: number): Record<string, unknown>[] {
  if (file.format === 'xlsx')
    return [{ sheets: ['Rentals', 'Notes'] }, { value: { sheet: 'Rentals', cell: 'B2', equals: value } }];
  if (file.format === 'csv') return [{ value: { column: 'days', row: 2, equals: value } }];
  if (file.format === 'json') return [{ value: { path: 'days', equals: value } }];
  if (file.format === 'docx') return [{ contains: `for ${value} days` }];
  return [{ page_count: (value % 4) + 1 }];
}

/** The basic fault of each kind: the reply omits the code; the file holds the value plus one. */
export const BASIC: Record<Kind, Fault> = {
  normal: {
    id: 'normal-omits-code',
    kind: 'normal',
    section: 'reply',
    fix: 'The agent states the hold code the reply section requires.',
    apply: (action) => ({ ...action, reply: 'Let me check that for you.' }),
  },
  code: {
    id: 'code-off-by-one',
    kind: 'code',
    section: 'compute',
    fix: 'The script counts the rental days without the off-by-one.',
    apply: (action, block) => ({ ...action, files: [shifted(block.file as FileAction, 1)] }),
  },
};

/** The file with its planted value moved by `delta`. */
export function shifted(file: FileAction, delta: number): FileAction {
  const data = structuredClone(file.data) as Record<string, unknown>;
  if (file.format === 'xlsx') {
    const sheets = (data as { sheets: { rows: unknown[][] }[] }).sheets;
    const row = sheets[0]?.rows[1] as unknown[];
    row[1] = (row[1] as number) + delta;
  } else if (file.format === 'csv') {
    const rows = data as unknown as unknown[][];
    const row = rows[1] as unknown[];
    row[1] = (row[1] as number) + delta;
  } else if (file.format === 'json') {
    data.days = (data.days as number) + delta;
  } else if (file.format === 'docx') {
    const paragraphs = (data as { paragraphs: string[] }).paragraphs;
    paragraphs[1] = (paragraphs[1] as string).replace(
      /for (\d+) days/,
      (_, n) => `for ${Number(n) + delta} days`,
    );
  } else {
    const pages = (data as { pages: string[] }).pages;
    if (delta > 0) pages.push(`Page ${pages.length + 1}`);
    else pages.pop();
  }
  return { ...file, data };
}

/**
 * Builds a recipe of `kind` from the plans. Block i asks for its own value under a neutral marker; the agent
 * plays the passing action or the planted fault. With `parents`, every block names its plan's parent.
 */
export function recipe(
  seed: number,
  tag: string,
  kind: Kind,
  plans: readonly BlockPlan[],
  options: { parents?: boolean } = {},
): Recipe {
  const rng = rngFor(seed, `${tag}#recipe`);
  const customer = pick(rng, SHOP.customers);
  const blocks: Built[] = plans.map((_, index) => {
    const value = between(rng, 2, 60);
    const built: Built = {
      index,
      id: token(seed, `${tag}#id#${index}`),
      marker: token(seed, `${tag}#marker#${index}`, 8),
      value,
      code: `${token(seed, `${tag}#code#${index}`, 4).toUpperCase()}-${value}`,
    };
    if (kind === 'code') built.file = codeFile(rng, seed, tag, index, value);
    return built;
  });
  const actions = new Map<string, Action>();
  const truth = new Map<string, Truth>();
  const rawBlocks = plans.map((plan, index) => {
    const block = blocks[index] as Built;
    const passing: Action =
      kind === 'normal'
        ? {
            reply: `Yes, it is free. Your hold code is ${block.code}.`,
            calls: [{ label: 'bikes.lookup', input: { day: index + 1 }, output: { free: true } }],
          }
        : {
            reply: 'Done: the file is written.',
            files: [block.file as FileAction],
            commands: [{ command: `python make_${block.marker}.py`, exitCode: 0 }],
          };
    const fault = plan.fault ?? BASIC[kind];
    actions.set(block.marker, plan.fate === 'fail' ? fault.apply(passing, block, rng) : passing);
    const user =
      kind === 'normal'
        ? `${block.marker} ${customer} asks whether the ${pick(rng, SHOP.bikes)} is free on day ${between(rng, 1, 28)}.`
        : `${block.marker} Write ${block.file?.path} from the rental data.`;
    const expect =
      kind === 'normal'
        ? { must: [block.code], tools: [{ label: 'bikes.lookup', count: 1 }] }
        : {
            execution: { exit_code: 0 },
            artifacts: [
              {
                path: block.file?.path,
                kind: block.file?.format,
                checks: fileChecks(block.file as FileAction, block.value),
              },
            ],
            workspace: { created: [block.file?.path] },
          };
    const given = {
      ...(plan.prefix
        ? {
            prefix: [
              { role: 'user', content: `Hello, this is ${customer}.` },
              { role: 'assistant', content: 'Hello, Larkspur Cycles here.' },
            ],
          }
        : {}),
      ...(plan.stub ? { world: { tools: { 'bikes.lookup': { result: { free: true } } } } } : {}),
    };
    return {
      id: block.id,
      ...(options.parents && plan.parent !== undefined ? { parent: blocks[plan.parent]?.id } : {}),
      user,
      ...(Object.keys(given).length > 0 ? { given } : {}),
      expect,
    };
  });
  const raw: RawSpec = {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    ...(kind === 'code'
      ? { kind: 'task', workspace_seed: { files: { 'data/rentals.csv': 'bike,days\nFern 3,4\n' } } }
      : { channel: 'chat', lang: 'EN' }),
    blocks: rawBlocks,
  };
  plans.forEach((plan, index) => {
    const block = blocks[index] as Built;
    const fault = plan.fault ?? BASIC[kind];
    truth.set(block.id, {
      verdict: plan.fate,
      ...(plan.fate === 'fail' ? { cause: fault.fix, section: fault.section } : {}),
      ...(plan.parent !== undefined ? { parent: blocks[plan.parent]?.id } : {}),
    });
  });
  return { kind, raw, actions, blocks, truth };
}

/** What the run is: its mode, and the layers the planted adapter cannot apply. */
export type Setting = { mode: 'F' | 'T'; seedPrefix: boolean; toolStubs: boolean; parents: boolean };

/** The adapter capabilities of each kind: the function adapter applies both layers; the process adapter, no tool stub. */
export const KIND_CAPS: Record<Kind, { seedPrefix: boolean; toolStubs: boolean }> = {
  normal: { seedPrefix: true, toolStubs: true },
  code: { seedPrefix: true, toolStubs: false },
};

/**
 * The truth of every block under a setting, by the documented rules: a Given layer the adapter cannot apply is
 * not_run from the block that sets it on (in a forest, from the ancestor that sets it); a block under a failed,
 * unrun or blocked ancestor is blocked, by its parent, its root the topmost such ancestor, its cause the root's.
 */
export function settle(r: Recipe, plans: readonly BlockPlan[], setting: Setting): Map<string, Truth> {
  const ids = r.blocks.map((block) => block.id);
  const lineage = (i: number): number[] => {
    if (!setting.parents) return [...Array(i).keys()];
    const out: number[] = [];
    for (let p = plans[i]?.parent; p !== undefined; p = plans[p]?.parent) out.unshift(p);
    return out;
  };
  const own = (i: number): Truth['verdict'] => {
    const above = lineage(i);
    const layers = [...above, i];
    const prefixWritten = layers.some((at) => plans[at]?.prefix === true);
    const history = prefixWritten || (setting.mode === 'T' && (setting.parents ? above.length > 0 : i > 0));
    if (history && !setting.seedPrefix) return 'not_run';
    if (layers.some((at) => plans[at]?.stub === true) && !setting.toolStubs) return 'not_run';
    return plans[i]?.fate === 'fail' ? 'fail' : 'pass';
  };
  const out = new Map<string, Truth>();
  const verdicts: Truth['verdict'][] = [];
  const order = [...plans.keys()];
  for (const i of order) {
    const base = r.truth.get(ids[i] as string) ?? { verdict: 'pass' };
    if (setting.parents) {
      const above = lineage(i);
      const root = above.find((a) => own(a) !== 'pass');
      if (root !== undefined) {
        const rootTruth = r.truth.get(ids[root] as string);
        out.set(ids[i] as string, {
          verdict: 'blocked',
          blockedBy: ids[plans[i]?.parent as number] as string,
          root: ids[root] as string,
          ...(rootTruth?.cause ? { cause: rootTruth.cause } : {}),
          ...(base.parent ? { parent: base.parent } : {}),
        });
        verdicts.push('blocked');
        continue;
      }
    }
    const verdict = own(i);
    verdicts.push(verdict);
    out.set(ids[i] as string, {
      ...base,
      verdict,
      ...(verdict === 'not_run' ? { cause: undefined, section: undefined } : {}),
    });
  }
  return out;
}

/** The run's verdict by the documented rule: fail on any fail, else not_run, else blocked, else pass. */
export function runVerdict(truth: ReadonlyMap<string, Truth>): string {
  const all = [...truth.values()].map((each) => each.verdict);
  if (all.includes('fail') || all.length === 0) return 'fail';
  if (all.includes('not_run')) return 'not_run';
  if (all.includes('blocked')) return 'blocked';
  return 'pass';
}
