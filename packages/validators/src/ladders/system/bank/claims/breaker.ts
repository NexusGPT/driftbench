import { INFORMATION, LINT_CODES } from '@agent-nexus/driftbench-estate';
import { mde as powerMde } from '@agent-nexus/driftbench-stats';
import { gateContract, goldenContract, pilotContract } from '../current-contracts';
import { docBlock } from '../doc-blocks';
import { DOCUMENTED_CHECKS } from '../documented';
import { reviewFamily } from '../review-family';
/**
 * Blind-breaker claims: executable claims taken from the documentation pages and the command-line help
 * only. Each item runs the command line in process on fictional data, built from the seed under the
 * scratch folder, and compares the result with an oracle known from the docs or by construction.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type BankItem,
  expectAll,
  fail,
  type ItemContext,
  type ItemResult,
  type ItemSource,
  PASS,
  type Tier,
} from '../types';

type Cli = { code: number; out: string; err: string };

async function cli(argv: string[], cwd: string): Promise<Cli> {
  const { main } = (await import('../../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (t: string) => {
      out += t;
    },
    err: (t: string) => {
      err += t;
    },
    cwd,
  });
  return { code, out, err };
}

/** Compare command availability and missing-input handling with the live CLI reference. No agent runs. */
async function estateCommandContract(ctx: ItemContext, command: 'run' | 'mutate'): Promise<ItemResult> {
  const page = text(join(ctx.root, 'docs/reference/cli.md'));
  const section =
    page.split('## `driftbench estate run` and `driftbench estate mutate`')[1]?.split('\n## ')[0] ?? '';
  const synopsis = section.split('\n').find((line) => line.startsWith(`driftbench estate ${command} `)) ?? '';
  const paragraph = section.split('\n').find((line) => line.startsWith(`\`estate ${command}\``)) ?? '';
  const exit = /(?:Exit|,|;) (\d+) on a usage or input error/.exec(paragraph)?.[1];
  const required = /(--[a-z-]+) <[^>]+>/.exec(synopsis)?.[1];
  const dir = work(ctx, `estate-${command}`);
  const missing = await cli(['estate', command], dir);
  const help = await cli(['estate', command, '--help'], dir);
  const flags = [...synopsis.matchAll(/--[a-z-]+/g)].map((m) => m[0]);
  return expectAll([
    [
      synopsis.length > 0 &&
        exit !== undefined &&
        required !== undefined &&
        !/not built/i.test(paragraph + synopsis),
      'cli.md must describe the built command, its required input and its usage exit code',
    ],
    [
      help.code === 0 && flags.every((flag) => help.out.includes(flag)),
      `help must expose the documented options; got ${shown(help)}`,
    ],
    [
      missing.code === Number(exit) && missing.err.includes(`required option '${required} `),
      `missing input should name ${required} and exit ${exit}; got ${shown(missing)}`,
    ],
  ]);
}

/** A fresh folder for one item and one seed. */
function work(ctx: ItemContext, slug: string): string {
  const dir = join(ctx.scratch, 'breaker', slug, String(ctx.seed));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function put(dir: string, rel: string, body: string | Buffer): string {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

function text(path: string): string {
  return readFileSync(path, 'utf8');
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function clip(value: string, n = 280): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}...` : flat;
}

function shown(c: Cli): string {
  return `exit ${c.code}; stdout "${clip(c.out)}"; stderr "${clip(c.err)}"`;
}

function both(c: Cli): string {
  return `${c.out}\n${c.err}`;
}

function tryJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

type Def = {
  id: string;
  tier: Tier;
  component: string;
  source?: ItemSource;
  title: string;
  cause: string;
  level?: number;
  check(ctx: ItemContext): Promise<ItemResult>;
};

function family(name: string, short: string, defaultLevel: number): (def: Def) => BankItem {
  return (def) => ({
    id: `breaker/${short}/${def.id}`,
    family: name,
    tier: def.tier,
    level: def.level ?? defaultLevel,
    component: def.component,
    source: def.source ?? 'contract',
    title: def.title,
    cause: def.cause,
    check: def.check,
  });
}

/** A minimal valid conversation spec on the Acme sales assistant. */
function spec(id: string, extra = ''): string {
  return `id: ${id}\nversion: '1'\ntarget: { adapter: function, agent: acme-sales }\nblocks:\n  - user: Hello\n    expect:\n      must: [Acme]\n${extra}`;
}

/** The stored campaigns of a store file, read as data: every JSON value under a "sources" key. */
async function storedSources(storeFile: string): Promise<unknown[]> {
  const modName = 'node:sqlite';
  const sqlite = (await import(modName)) as {
    DatabaseSync: new (
      file: string,
      options?: { readOnly?: boolean },
    ) => {
      prepare(sql: string): { all(): Record<string, unknown>[] };
      close(): void;
    };
  };
  const db = new sqlite.DatabaseSync(storeFile, { readOnly: true });
  const found: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'sources' && Array.isArray(v)) found.push(v);
        visit(v);
      }
    }
  };
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    for (const t of tables) {
      const name = String(t.name);
      for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
        for (const cell of Object.values(row)) {
          if (typeof cell === 'string' && cell.includes('sources')) visit(tryJson(cell));
        }
      }
    }
  } finally {
    db.close();
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// Family breaker-datasets: docs/datasets.md and the dataset, prompt and import pages of docs/reference/cli.md
// ---------------------------------------------------------------------------------------------------

const ds = family('breaker-datasets', 'datasets', 10);

/** The lines `dataset list` prints: name, version, short hash, file count and note. */
function listLines(
  out: string,
): { name: string; version: number; hash: string; files: number; note: string }[] {
  const rows: { name: string; version: number; hash: string; files: number; note: string }[] = [];
  for (const line of out.split('\n')) {
    const m = /^(\S+)@(\d+)\s+([0-9a-f]{12})\s+(\d+) files?\s+\S+\s*(.*)$/.exec(line.trim());
    if (m)
      rows.push({
        name: m[1] ?? '',
        version: Number(m[2]),
        hash: m[3] ?? '',
        files: Number(m[4]),
        note: (m[5] ?? '').trim(),
      });
  }
  return rows;
}

async function pushOf(
  kind: 'dataset' | 'prompt',
  name: string,
  path: string,
  store: string,
  cwd: string,
  extra: string[] = [],
): Promise<Cli> {
  return cli([kind, 'push', name, path, '--store', store, ...extra], cwd);
}

function datasetItems(): BankItem[] {
  const items: BankItem[] = [];

  items.push(
    ds({
      id: 'push-first-version',
      tier: 1,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry": a first push of a name is version 1 and prints its file count',
      cause:
        'driftbench dataset push numbers the first version of a name 1 and prints "Pushed dataset <name>@1 (hash ...): N files from <path>"',
      async check(ctx) {
        const dir = work(ctx, 'push-first');
        const n = ctx.seed + 1;
        for (let i = 0; i < n; i++) put(dir, `specs/s${i}.yaml`, spec(`s${i}-${ctx.seed}`));
        const c = await pushOf('dataset', 'first', join(dir, 'specs'), join(dir, 's.db'), dir);
        const re = new RegExp(`Pushed dataset first@1 \\(hash [0-9a-f]{12}\\): ${n} files?`);
        return expectAll([
          [c.code === 0, `push should exit 0; got ${shown(c)}`],
          [
            re.test(c.out),
            `expected "Pushed dataset first@1 (hash <12 hex>): ${n} files" in the output; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'push-same-content-adds-nothing',
      tier: 1,
      level: 1,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Immutable: pushing content a name already holds gives back that version and adds nothing',
      cause:
        'driftbench dataset push returns the existing version and adds no row when the content is already held under the name',
      async check(ctx) {
        const dir = work(ctx, 'push-same');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        const store = join(dir, 's.db');
        const one = await pushOf('dataset', 'same', join(dir, 'specs'), store, dir);
        const two = await pushOf('dataset', 'same', join(dir, 'specs'), store, dir);
        const list = await cli(['dataset', 'list', '--store', store], dir);
        const rows = listLines(list.out);
        return expectAll([
          [
            one.code === 0 && two.code === 0,
            `both pushes should exit 0; got ${shown(one)} then ${shown(two)}`,
          ],
          [/same@1\b/.test(two.out), `the second push should name same@1; got ${shown(two)}`],
          [
            rows.length === 1,
            `the list should hold exactly one version after pushing identical content twice; got ${shown(list)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'push-reverted-content-returns-older-version',
      tier: 5,
      level: 1,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Immutable and Content addressed: content that an older version holds gives back that version, not a new one',
      cause:
        'driftbench dataset push looks the content hash up among all versions of the name, not only the latest one',
      async check(ctx) {
        const dir = work(ctx, 'push-revert');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'rev', join(dir, 'specs'), store, dir);
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`, '      must_not: [zzz]\n'));
        const v2 = await pushOf('dataset', 'rev', join(dir, 'specs'), store, dir);
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        const back = await pushOf('dataset', 'rev', join(dir, 'specs'), store, dir);
        const rows = listLines((await cli(['dataset', 'list', 'rev', '--store', store], dir)).out);
        return expectAll([
          [/rev@2\b/.test(v2.out), `the changed content should be rev@2; got ${shown(v2)}`],
          [
            /rev@1\b/.test(back.out) && !/rev@3\b/.test(back.out),
            `pushing the original bytes again should give back rev@1; got ${shown(back)}`,
          ],
          [rows.length === 2, `the list should still hold 2 versions; got ${rows.length}`],
        ]);
      },
    }),
    ds({
      id: 'versions-count-up-from-one',
      tier: 2,
      level: 1,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry" Numbered: versions of one name count up from 1',
      cause: 'driftbench dataset push gives each new content of a name the next number, 1, 2, 3',
      async check(ctx) {
        const dir = work(ctx, 'count-up');
        const store = join(dir, 's.db');
        for (let i = 0; i < 3; i++) {
          put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`, `      must_not: [zz${i}]\n`));
          const c = await pushOf('dataset', 'cnt', join(dir, 'specs'), store, dir);
          if (c.code !== 0) return fail(`push ${i + 1} should exit 0; got ${shown(c)}`);
        }
        const list = await cli(['dataset', 'list', '--store', store], dir);
        const versions = listLines(list.out)
          .map((r) => r.version)
          .join(',');
        return versions === '1,2,3'
          ? PASS
          : fail(`expected versions 1,2,3 in list order; got "${versions}" from ${shown(list)}`);
      },
    }),
    ds({
      id: 'numbering-is-per-name',
      tier: 2,
      level: 1,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Numbered: versions of one name count up from 1, so a second name starts at 1 too',
      cause:
        'driftbench dataset push numbers versions per name, so identical content under a second name is version 1',
      async check(ctx) {
        const dir = work(ctx, 'per-name');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'alpha', join(dir, 'specs'), store, dir);
        const b = await pushOf('dataset', 'beta', join(dir, 'specs'), store, dir);
        return /beta@1\b/.test(b.out) && b.code === 0
          ? PASS
          : fail(`the first push under name beta should be beta@1; got ${shown(b)}`);
      },
    }),
    ds({
      id: 'push-invalid-spec-stores-nothing',
      tier: 3,
      level: 1,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Checked: dataset push loads every spec first and refuses the push when one is invalid, exit 1',
      cause:
        'driftbench dataset push validates all specs before it stores anything and exits 1 without using a version number',
      async check(ctx) {
        const dir = work(ctx, 'push-invalid');
        const store = join(dir, 's.db');
        put(dir, 'bad/a.yaml', spec(`a-${ctx.seed}`));
        put(dir, 'bad/b.yaml', `id: b\nblocks:\n  - expect:\n      must: [x]\n`);
        const bad = await pushOf('dataset', 'chk', join(dir, 'bad'), store, dir);
        put(dir, 'good/a.yaml', spec(`a-${ctx.seed}`));
        const good = await pushOf('dataset', 'chk', join(dir, 'good'), store, dir);
        return expectAll([
          [bad.code === 1, `a folder with an invalid spec should exit 1; got ${shown(bad)}`],
          [
            /chk@1\b/.test(good.out),
            `after a refused push the first valid push should still be chk@1; got ${shown(good)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'push-skips-dot-entries-and-node-modules',
      tier: 2,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Checked: entries whose name starts with a dot and node_modules are skipped',
      cause:
        'driftbench dataset push skips dot entries and node_modules, so their invalid files neither fail the push nor count',
      async check(ctx) {
        const dir = work(ctx, 'push-skip');
        put(dir, 'specs/ok.yaml', spec(`ok-${ctx.seed}`));
        put(dir, 'specs/.hidden.yaml', 'not: [valid');
        put(dir, 'specs/.cache/x.yaml', 'not: [valid');
        put(dir, 'specs/node_modules/pkg/x.yaml', 'not: [valid');
        const c = await pushOf('dataset', 'skip', join(dir, 'specs'), join(dir, 's.db'), dir);
        return c.code === 0 && /: 1 file from/.test(c.out)
          ? PASS
          : fail(`expected exit 0 and "1 file"; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'subfolder-paths-round-trip',
      tier: 3,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Exact: restore writes every file, subfolders included, with the bytes pushed',
      cause:
        'driftbench dataset push keeps the relative path of files in subfolders and restore recreates the subfolders',
      async check(ctx) {
        const dir = work(ctx, 'subfolder');
        const store = join(dir, 's.db');
        const body = spec(`deep-${ctx.seed}`);
        put(dir, 'specs/top.yaml', spec(`top-${ctx.seed}`));
        put(dir, 'specs/sub/deeper/c.yaml', body);
        await pushOf('dataset', 'deep', join(dir, 'specs'), store, dir);
        const r = await cli(
          ['dataset', 'restore', 'deep@1', '--store', store, '--out', join(dir, 'out')],
          dir,
        );
        const got = files(join(dir, 'out')).join(',');
        const same =
          existsSync(join(dir, 'out/sub/deeper/c.yaml')) && text(join(dir, 'out/sub/deeper/c.yaml')) === body;
        return expectAll([
          [r.code === 0, `restore should exit 0; got ${shown(r)}`],
          [
            got === 'sub/deeper/c.yaml,top.yaml',
            `expected files sub/deeper/c.yaml and top.yaml; got "${got}"`,
          ],
          [same, 'the nested file should hold the pushed bytes'],
        ]);
      },
    }),
    ds({
      id: 'ref-name-at-latest',
      tier: 2,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry": a ref name@latest resolves to the newest version',
      cause: 'driftbench dataset restore resolves name@latest to the highest version of the name',
      async check(ctx) {
        const dir = work(ctx, 'ref-latest');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'lat', join(dir, 'specs'), store, dir);
        const newer = spec(`a-${ctx.seed}`, '      must_not: [newer]\n');
        put(dir, 'specs/a.yaml', newer);
        await pushOf('dataset', 'lat', join(dir, 'specs'), store, dir);
        const r = await cli(
          ['dataset', 'restore', 'lat@latest', '--store', store, '--out', join(dir, 'out')],
          dir,
        );
        const ok = existsSync(join(dir, 'out/a.yaml')) && text(join(dir, 'out/a.yaml')) === newer;
        return r.code === 0 && ok ? PASS : fail(`lat@latest should restore version 2 bytes; got ${shown(r)}`);
      },
    }),
    ds({
      id: 'ref-bare-name-is-latest',
      tier: 2,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry": a bare name is a ref to the latest version',
      cause: 'driftbench dataset diff and restore treat a bare name as name@latest',
      async check(ctx) {
        const dir = work(ctx, 'ref-bare');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'bare', join(dir, 'specs'), store, dir);
        const newer = spec(`a-${ctx.seed}`, '      must_not: [bare]\n');
        put(dir, 'specs/a.yaml', newer);
        await pushOf('dataset', 'bare', join(dir, 'specs'), store, dir);
        const r = await cli(['dataset', 'restore', 'bare', '--store', store, '--out', join(dir, 'out')], dir);
        const ok = existsSync(join(dir, 'out/a.yaml')) && text(join(dir, 'out/a.yaml')) === newer;
        return r.code === 0 && ok
          ? PASS
          : fail(`a bare name should restore the latest version; got ${shown(r)}`);
      },
    }),
    ds({
      id: 'ref-hash-prefix',
      tier: 3,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry": a ref name@<six or more hex characters of the hash> names the version with that hash',
      cause:
        'the registry, or datasets.md, settles a ref of six or more digits: a hash prefix as the page lists it, or a version number',
      async check(ctx) {
        const dir = work(ctx, 'ref-hash');
        const store = join(dir, 's.db');
        const first = spec(`a-${ctx.seed}`);
        put(dir, 'specs/a.yaml', first);
        await pushOf('dataset', 'hx', join(dir, 'specs'), store, dir);
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`, '      must_not: [other]\n'));
        await pushOf('dataset', 'hx', join(dir, 'specs'), store, dir);
        const rows = listLines((await cli(['dataset', 'list', '--store', store], dir)).out);
        const hash = rows.find((r) => r.version === 1)?.hash;
        if (!hash) return fail('the list should show a hash for version 1');
        const r = await cli(
          ['dataset', 'restore', `hx@${hash.slice(0, 6)}`, '--store', store, '--out', join(dir, 'out')],
          dir,
        );
        const ok = existsSync(join(dir, 'out/a.yaml')) && text(join(dir, 'out/a.yaml')) === first;
        return r.code === 0 && ok
          ? PASS
          : fail(`hx@${hash.slice(0, 6)} should restore version 1; got ${shown(r)}`);
      },
    }),
    ds({
      id: 'ref-short-hash-refused',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry": a hash ref needs six or more hex characters, so a five character prefix is an unknown version, exit 2',
      cause: 'driftbench dataset restore refuses a hash prefix shorter than six hex characters with exit 2',
      async check(ctx) {
        const dir = work(ctx, 'ref-short');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'sh', join(dir, 'specs'), store, dir);
        const rows = listLines((await cli(['dataset', 'list', '--store', store], dir)).out);
        const hash = rows[0]?.hash ?? '';
        const r = await cli(
          ['dataset', 'restore', `sh@${hash.slice(0, 5)}`, '--store', store, '--out', join(dir, 'out')],
          dir,
        );
        return expectAll([
          [r.code === 2, `a five character hash prefix should exit 2; got ${shown(r)}`],
          [files(join(dir, 'out')).length === 0, 'nothing should be written'],
        ]);
      },
    }),
    ds({
      id: 'ref-unknown-version-exit-2',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench dataset',
      title: 'datasets.md "The registry" exit codes: 2 for bad input, an unknown name or version',
      cause:
        'driftbench dataset restore and diff exit 2 on an unknown version of a known name and on an unknown name',
      async check(ctx) {
        const dir = work(ctx, 'ref-unknown');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'known', join(dir, 'specs'), store, dir);
        const v = await cli(
          ['dataset', 'restore', 'known@99', '--store', store, '--out', join(dir, 'o')],
          dir,
        );
        const n = await cli(['dataset', 'diff', 'nosuch@1', '--store', store], dir);
        return expectAll([
          [v.code === 2, `known@99 should exit 2; got ${shown(v)}`],
          [n.code === 2, `nosuch@1 should exit 2; got ${shown(n)}`],
        ]);
      },
    }),
    ds({
      id: 'restore-byte-exact',
      tier: 4,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry" Exact: restore writes the bytes of every file as they were pushed',
      cause:
        'driftbench dataset restore writes the stored bytes unchanged, CRLF endings, non ASCII text and a missing final newline included',
      async check(ctx) {
        const dir = work(ctx, 'bytes');
        const store = join(dir, 's.db');
        const body = Buffer.from(
          `id: bytes-${ctx.seed}\r\ntitle: café ☃ ${ctx.seed}\r\nblocks:\r\n  - user: Hello\r\n    expect:\r\n      must: [Acme]`,
          'utf8',
        );
        const path = put(dir, 'specs/a.yaml', body);
        await pushOf('dataset', 'bytes', join(dir, 'specs'), store, dir);
        writeFileSync(path, 'id: other\nblocks:\n  - user: x\n');
        const r = await cli(['dataset', 'restore', 'bytes@1', '--store', store, '--force'], dir);
        const back = readFileSync(path);
        return r.code === 0 && back.equals(body)
          ? PASS
          : fail(
              `restored bytes differ from the pushed bytes (${back.length} vs ${body.length}); ${shown(r)}`,
            );
      },
    }),
    ds({
      id: 'restore-conflict-writes-nothing',
      tier: 4,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Exact: a file already there with other bytes stops the restore and nothing is written',
      cause:
        'driftbench dataset restore checks every target file before it writes, so a conflict leaves missing files uncreated',
      async check(ctx) {
        const dir = work(ctx, 'restore-conflict');
        const store = join(dir, 's.db');
        const a = spec(`a-${ctx.seed}`);
        put(dir, 'specs/a.yaml', a);
        put(dir, 'specs/b.yaml', spec(`b-${ctx.seed}`));
        await pushOf('dataset', 'cf', join(dir, 'specs'), store, dir);
        const changed = `${a}# changed\n`;
        put(dir, 'specs/a.yaml', changed);
        rmSync(join(dir, 'specs/b.yaml'));
        const r = await cli(['dataset', 'restore', 'cf@1', '--store', store], dir);
        return expectAll([
          [r.code === 1, `a differing file without --force should exit 1; got ${shown(r)}`],
          [/a\.yaml/.test(both(r)), `the output should name a.yaml; got ${shown(r)}`],
          [text(join(dir, 'specs/a.yaml')) === changed, 'a.yaml should keep its other bytes'],
          [
            !existsSync(join(dir, 'specs/b.yaml')),
            'b.yaml should not be recreated when the restore is stopped',
          ],
        ]);
      },
    }),
    ds({
      id: 'restore-out-leaves-origin',
      tier: 2,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Exact: restore --out writes to another path instead of the path pushed from',
      cause:
        'driftbench dataset restore --out writes the version under the given folder and leaves the original folder as it is',
      async check(ctx) {
        const dir = work(ctx, 'restore-out');
        const store = join(dir, 's.db');
        const a = spec(`a-${ctx.seed}`);
        put(dir, 'specs/a.yaml', a);
        await pushOf('dataset', 'ro', join(dir, 'specs'), store, dir);
        const edited = `${a}# edited\n`;
        put(dir, 'specs/a.yaml', edited);
        const r = await cli(
          ['dataset', 'restore', 'ro@1', '--store', store, '--out', join(dir, 'elsewhere')],
          dir,
        );
        return expectAll([
          [r.code === 0, `restore --out should exit 0; got ${shown(r)}`],
          [
            existsSync(join(dir, 'elsewhere/a.yaml')) && text(join(dir, 'elsewhere/a.yaml')) === a,
            'elsewhere/a.yaml should hold the pushed bytes',
          ],
          [text(join(dir, 'specs/a.yaml')) === edited, 'the original folder should be untouched'],
        ]);
      },
    }),
    ds({
      id: 'restore-lists-and-keeps-extra-files',
      tier: 3,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry" Exact: files the version does not hold are listed and left alone',
      cause:
        'driftbench dataset restore names the files of the folder that the version does not hold and does not delete them',
      async check(ctx) {
        const dir = work(ctx, 'restore-extra');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'ex', join(dir, 'specs'), store, dir);
        put(dir, 'specs/extra-note.yaml', spec(`extra-${ctx.seed}`));
        const r = await cli(['dataset', 'restore', 'ex@1', '--store', store], dir);
        return expectAll([
          [r.code === 0, `restore should exit 0; got ${shown(r)}`],
          [existsSync(join(dir, 'specs/extra-note.yaml')), 'the extra file should stay'],
          [/extra-note\.yaml/.test(both(r)), `the extra file should be listed; got ${shown(r)}`],
        ]);
      },
    }),
    ds({
      id: 'restore-second-run-writes-nothing',
      tier: 2,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" example: a restore reports "N written, M unchanged", and a second restore writes 0',
      cause:
        'driftbench dataset restore counts files that already hold the right bytes as unchanged and writes none of them',
      async check(ctx) {
        const dir = work(ctx, 'restore-twice');
        const store = join(dir, 's.db');
        const n = ctx.seed + 1;
        for (let i = 0; i < n; i++) put(dir, `specs/s${i}.yaml`, spec(`s${i}-${ctx.seed}`));
        await pushOf('dataset', 'tw', join(dir, 'specs'), store, dir);
        const out = join(dir, 'out');
        const first = await cli(['dataset', 'restore', 'tw@1', '--store', store, '--out', out], dir);
        const second = await cli(['dataset', 'restore', 'tw@1', '--store', store, '--out', out], dir);
        return expectAll([
          [
            new RegExp(`${n} written, 0 unchanged`).test(first.out),
            `the first restore should write ${n} files; got ${shown(first)}`,
          ],
          [
            new RegExp(`0 written, ${n} unchanged`).test(second.out) && second.code === 0,
            `the second restore should write 0 and keep ${n}; got ${shown(second)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'diff-default-compares-previous',
      tier: 2,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry": diff without a second ref compares a version with the one before it and exits 1 on a difference',
      cause:
        'driftbench dataset diff <ref> without [other] compares with the previous version and prints "M <file>" and the count of files that differ',
      async check(ctx) {
        const dir = work(ctx, 'diff-prev');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        put(dir, 'specs/b.yaml', spec(`b-${ctx.seed}`));
        await pushOf('dataset', 'dp', join(dir, 'specs'), store, dir);
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`, '      must_not: [extra]\n'));
        await pushOf('dataset', 'dp', join(dir, 'specs'), store, dir);
        const d = await cli(['dataset', 'diff', 'dp@2', '--store', store], dir);
        return expectAll([
          [d.code === 1, `a difference should exit 1; got ${shown(d)}`],
          [/^M a\.yaml/m.test(d.out), `expected "M a.yaml"; got ${shown(d)}`],
          [
            /1 file differs between dp@1 and dp@2/.test(d.out),
            `expected "1 file differs between dp@1 and dp@2"; got ${shown(d)}`,
          ],
          [
            !/b\.yaml/.test(
              d.out
                .split('\n')
                .filter((l) => /^[ADM] /.test(l))
                .join('\n'),
            ),
            'the unchanged b.yaml should not be listed',
          ],
        ]);
      },
    }),
    ds({
      id: 'diff-same-version-exit-0',
      tier: 1,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry" exit codes: diff exits 0 when there is no difference',
      cause: 'driftbench dataset diff exits 0 when the two refs name the same content',
      async check(ctx) {
        const dir = work(ctx, 'diff-same');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'same2', join(dir, 'specs'), store, dir);
        const d = await cli(['dataset', 'diff', 'same2@1', 'same2@1', '--store', store], dir);
        return d.code === 0 ? PASS : fail(`diffing a version with itself should exit 0; got ${shown(d)}`);
      },
    }),
    ds({
      id: 'diff-marks-added-and-removed',
      tier: 3,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry": diff marks each file A added, D removed or M changed',
      cause:
        'driftbench dataset diff prints "A <file>" for a file the newer version adds and "D <file>" for one it removes',
      async check(ctx) {
        const dir = work(ctx, 'diff-ad');
        const store = join(dir, 's.db');
        put(dir, 'specs/keep.yaml', spec(`keep-${ctx.seed}`));
        put(dir, 'specs/gone.yaml', spec(`gone-${ctx.seed}`));
        await pushOf('dataset', 'ad', join(dir, 'specs'), store, dir);
        rmSync(join(dir, 'specs/gone.yaml'));
        put(dir, 'specs/fresh.yaml', spec(`fresh-${ctx.seed}`));
        await pushOf('dataset', 'ad', join(dir, 'specs'), store, dir);
        const d = await cli(['dataset', 'diff', 'ad@2', '--store', store], dir);
        return expectAll([
          [d.code === 1, `exit should be 1; got ${shown(d)}`],
          [/^A fresh\.yaml/m.test(d.out), `expected "A fresh.yaml"; got ${shown(d)}`],
          [/^D gone\.yaml/m.test(d.out), `expected "D gone.yaml"; got ${shown(d)}`],
        ]);
      },
    }),
    ds({
      id: 'diff-dir-compares-folder',
      tier: 3,
      component: 'driftbench dataset',
      title: 'datasets.md "The registry": diff with --dir compares a version with the files of a folder',
      cause:
        'driftbench dataset diff <ref> --dir <folder> exits 0 for an identical folder and exits 1 marking M for a changed file',
      async check(ctx) {
        const dir = work(ctx, 'diff-dir');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'dd', join(dir, 'specs'), store, dir);
        const same = await cli(
          ['dataset', 'diff', 'dd@1', '--dir', join(dir, 'specs'), '--store', store],
          dir,
        );
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`, '      must_not: [changed]\n'));
        const diff = await cli(
          ['dataset', 'diff', 'dd@1', '--dir', join(dir, 'specs'), '--store', store],
          dir,
        );
        return expectAll([
          [same.code === 0, `an identical folder should exit 0; got ${shown(same)}`],
          [
            diff.code === 1 && /^M a\.yaml/m.test(diff.out),
            `a changed file should exit 1 with "M a.yaml"; got ${shown(diff)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'diff-binary-prints-sizes',
      tier: 4,
      component: 'driftbench prompt',
      title:
        'datasets.md "The registry": diff marks a changed binary file with its sizes instead of changed lines',
      cause: 'driftbench prompt diff prints the sizes of a changed binary file and no raw bytes',
      async check(ctx) {
        const dir = work(ctx, 'diff-bin');
        const store = join(dir, 's.db');
        const a = Buffer.concat([Buffer.from([0, 1, 2, 3, 255, 254]), Buffer.alloc(10 + ctx.seed, 7)]);
        const b = Buffer.concat([Buffer.from([0, 1, 2, 9, 255, 254]), Buffer.alloc(20 + ctx.seed, 8)]);
        put(dir, 'p/blob.bin', a);
        await pushOf('prompt', 'bin', join(dir, 'p'), store, dir);
        put(dir, 'p/blob.bin', b);
        await pushOf('prompt', 'bin', join(dir, 'p'), store, dir);
        const d = await cli(['prompt', 'diff', 'bin@2', '--store', store], dir);
        return expectAll([
          [d.code === 1, `a changed file should exit 1; got ${shown(d)}`],
          [/^M blob\.bin/m.test(d.out), `expected "M blob.bin"; got ${shown(d)}`],
          [
            d.out.includes(String(a.length)) && d.out.includes(String(b.length)),
            `the sizes ${a.length} and ${b.length} should appear; got ${shown(d)}`,
          ],
          [!d.out.includes('\u0000'), 'no raw NUL byte should be printed'],
        ]);
      },
    }),
    ds({
      id: 'prompt-accepts-non-spec-files',
      tier: 2,
      component: 'driftbench prompt',
      title:
        'datasets.md "The registry": only dataset push loads the specs and refuses an invalid one; a prompt is any prompt file',
      cause: 'driftbench prompt push stores files without loading them as specs',
      async check(ctx) {
        const dir = work(ctx, 'prompt-any');
        const store = join(dir, 's.db');
        put(dir, 'p/system.md', `You are the Acme assistant ${ctx.seed}.\nnot: [valid yaml`);
        const c = await pushOf('prompt', 'pp', join(dir, 'p'), store, dir);
        return c.code === 0 && /Pushed prompt pp@1/.test(c.out)
          ? PASS
          : fail(`a prompt folder with free text should push as pp@1; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'prompt-single-file-restore',
      tier: 3,
      component: 'driftbench prompt',
      title:
        'datasets.md intro: a prompt is a prompt file or a folder of them, and restore writes it back to the path pushed from',
      cause:
        'driftbench prompt push accepts one file and restore --force writes the pushed bytes back to that file path',
      async check(ctx) {
        const dir = work(ctx, 'prompt-file');
        const store = join(dir, 's.db');
        const body = `You are the Acme sales assistant, take ${ctx.seed}.\n`;
        const path = put(dir, 'sales-prompt.md', body);
        const push = await pushOf('prompt', 'one', path, store, dir);
        writeFileSync(path, 'changed\n');
        const r = await cli(['prompt', 'restore', 'one@1', '--store', store, '--force'], dir);
        return expectAll([
          [
            push.code === 0 && /one@1/.test(push.out),
            `single file push should give one@1; got ${shown(push)}`,
          ],
          [r.code === 0, `restore --force should exit 0; got ${shown(r)}`],
          [text(path) === body, `the file should hold the pushed text; got "${clip(text(path))}"`],
        ]);
      },
    }),
    ds({
      id: 'dataset-and-prompt-are-separate',
      tier: 2,
      level: 1,
      component: 'driftbench prompt',
      title:
        'datasets.md "The registry": dataset and prompt are two kinds, so the same name is numbered and listed apart',
      cause:
        'driftbench prompt list shows only prompt versions and numbers a prompt name apart from a dataset of the same name',
      async check(ctx) {
        const dir = work(ctx, 'kinds');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'shared', join(dir, 'specs'), store, dir);
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`, '      must_not: [two]\n'));
        await pushOf('dataset', 'shared', join(dir, 'specs'), store, dir);
        put(dir, 'p/x.md', 'prompt text');
        const p = await pushOf('prompt', 'shared', join(dir, 'p'), store, dir);
        const list = await cli(['prompt', 'list', '--store', store], dir);
        return expectAll([
          [/shared@1\b/.test(p.out), `the prompt named shared should be version 1; got ${shown(p)}`],
          [listLines(list.out).length === 1, `prompt list should show one version; got ${shown(list)}`],
        ]);
      },
    }),
    ds({
      id: 'list-shows-note',
      tier: 1,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" example: list prints name@version, the hash, the file count, the time and the note',
      cause: 'driftbench dataset list prints the --note text of each version at the end of its line',
      async check(ctx) {
        const dir = work(ctx, 'list-note');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        const note = `first import ${ctx.seed}`;
        await pushOf('dataset', 'nt', join(dir, 'specs'), store, dir, ['--note', note]);
        const list = await cli(['dataset', 'list', '--store', store], dir);
        const row = listLines(list.out)[0];
        return row && row.note === note && row.files === 1
          ? PASS
          : fail(`expected one row with note "${note}" and 1 file; got ${shown(list)}`);
      },
    }),
    ds({
      id: 'list-json-has-file-sha256',
      tier: 3,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry" Content addressed: each file is kept by its SHA-256, and list --json shows it',
      cause: 'driftbench dataset list --json reports the SHA-256 of every file of a version',
      async check(ctx) {
        const dir = work(ctx, 'list-json');
        const store = join(dir, 's.db');
        const a = spec(`a-${ctx.seed}`);
        const b = spec(`b-${ctx.seed}`, '      must_not: [q]\n');
        put(dir, 'specs/a.yaml', a);
        put(dir, 'specs/b.yaml', b);
        await pushOf('dataset', 'js', join(dir, 'specs'), store, dir);
        const list = await cli(['dataset', 'list', 'js', '--store', store, '--json'], dir);
        const json = tryJson(list.out);
        if (json === undefined) return fail(`list --json should print JSON; got ${shown(list)}`);
        const flat = JSON.stringify(json);
        return expectAll([
          [flat.includes(sha256(a)), `the SHA-256 of a.yaml (${sha256(a).slice(0, 12)}...) should appear`],
          [flat.includes(sha256(b)), `the SHA-256 of b.yaml (${sha256(b).slice(0, 12)}...) should appear`],
        ]);
      },
    }),
    ds({
      id: 'version-hash-ignores-note',
      tier: 4,
      level: 1,
      component: 'driftbench dataset',
      title:
        'datasets.md "The registry": a version hash is the SHA-256 of the sorted paths and file hashes, so a note and a source folder do not change it',
      cause:
        'driftbench dataset push derives the version hash from the sorted list of paths and file hashes only',
      async check(ctx) {
        const dir = work(ctx, 'hash-stable');
        put(dir, 'one/a.yaml', spec(`a-${ctx.seed}`));
        put(dir, 'one/b.yaml', spec(`b-${ctx.seed}`));
        put(dir, 'two/b.yaml', spec(`b-${ctx.seed}`));
        put(dir, 'two/a.yaml', spec(`a-${ctx.seed}`));
        const x = await pushOf('dataset', 'hx', join(dir, 'one'), join(dir, 's1.db'), dir, ['--note', 'one']);
        const y = await pushOf('dataset', 'hx', join(dir, 'two'), join(dir, 's2.db'), dir, ['--note', 'two']);
        const hx = /hash ([0-9a-f]{12})/.exec(x.out)?.[1];
        const hy = /hash ([0-9a-f]{12})/.exec(y.out)?.[1];
        return hx && hx === hy
          ? PASS
          : fail(`same paths and bytes in two stores and folders should give one hash; got ${hx} and ${hy}`);
      },
    }),
    ds({
      id: 'campaign-dataset-survives-deleted-source',
      tier: 3,
      level: 1,
      component: 'driftbench campaign',
      title:
        'datasets.md "A campaign records the versions it ran": campaign run --dataset restores the specs from the store, so the original folder is not needed',
      cause:
        'driftbench campaign run --dataset <ref> reads the specs from the stored version and not from the folder they were pushed from',
      async check(ctx) {
        const dir = work(ctx, 'camp-ds');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'cd', join(dir, 'specs'), store, dir);
        rmSync(join(dir, 'specs'), { recursive: true, force: true });
        const c = await cli(
          ['campaign', 'run', '--dataset', 'cd@1', '--campaign', `c-${ctx.seed}`, '--store', store],
          dir,
        );
        return c.code === 0 && /1 cell: 1 pass/.test(c.out)
          ? PASS
          : fail(`expected 1 passing cell from the stored dataset; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'campaign-dataset-needs-store',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench campaign',
      title:
        'datasets.md "A campaign records the versions it ran": --dataset and --prompt both need --store; cli.md exit 2 is bad input',
      cause: 'driftbench campaign run exits 2 when --dataset or --prompt is given without --store',
      async check(ctx) {
        const dir = work(ctx, 'camp-nostore');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        const a = await cli(['campaign', 'run', join(dir, 'specs'), '--dataset', 'x@1'], dir);
        const b = await cli(['campaign', 'run', join(dir, 'specs'), '--prompt', 'x@1'], dir);
        return expectAll([
          [a.code === 2, `--dataset without --store should exit 2; got ${shown(a)}`],
          [b.code === 2, `--prompt without --store should exit 2; got ${shown(b)}`],
        ]);
      },
    }),
    ds({
      id: 'campaign-unknown-prompt-exit-2',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench campaign',
      title:
        'datasets.md "A campaign records the versions it ran": --prompt names a prompt version of the store; an unknown one is bad input, exit 2',
      cause: 'driftbench campaign run exits 2 and runs nothing when a --prompt ref names no stored version',
      async check(ctx) {
        const dir = work(ctx, 'camp-badprompt');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        const c = await cli(
          [
            'campaign',
            'run',
            join(dir, 'specs'),
            '--prompt',
            'nosuch@3',
            '--store',
            join(dir, 's.db'),
            '--campaign',
            'cx',
          ],
          dir,
        );
        return c.code === 2 ? PASS : fail(`an unknown prompt ref should exit 2; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'campaign-dataset-beside-paths',
      tier: 3,
      component: 'driftbench campaign',
      title:
        'running.md "campaign run": with --dataset the specs come from a dataset version instead of, or beside, the paths',
      cause: 'driftbench campaign run runs the specs of the paths and of the dataset version together',
      async check(ctx) {
        const dir = work(ctx, 'camp-beside');
        const store = join(dir, 's.db');
        put(dir, 'stored/a.yaml', spec(`stored-${ctx.seed}`));
        await pushOf('dataset', 'bs', join(dir, 'stored'), store, dir);
        put(dir, 'extra/b.yaml', spec(`extra-${ctx.seed}`));
        const c = await cli(
          ['campaign', 'run', join(dir, 'extra'), '--dataset', 'bs@1', '--store', store, '--campaign', 'cb'],
          dir,
        );
        return c.code === 0 && /2 cells: 2 pass/.test(c.out)
          ? PASS
          : fail(`expected 2 cells, one from the path and one from the dataset; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'campaign-records-dataset-source',
      tier: 4,
      level: 1,
      component: 'driftbench campaign',
      title:
        'datasets.md "A campaign records the versions it ran": the stored campaign holds sources with kind, name, version and the full 64 character hash',
      cause:
        'driftbench campaign run --dataset records { kind, name, version, hash } with the full SHA-256 in the stored campaign sources',
      async check(ctx) {
        const dir = work(ctx, 'camp-src');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        await pushOf('dataset', 'rec', join(dir, 'specs'), store, dir);
        const list = tryJson((await cli(['dataset', 'list', 'rec', '--store', store, '--json'], dir)).out) as
          | { hash?: string }[]
          | undefined;
        const fullHash = list?.[0]?.hash ?? '';
        const c = await cli(
          ['campaign', 'run', '--dataset', 'rec@1', '--campaign', 'crec', '--store', store],
          dir,
        );
        if (c.code !== 0) return fail(`the campaign should run; got ${shown(c)}`);
        let sources: unknown[];
        try {
          sources = await storedSources(store);
        } catch (e) {
          return fail(`could not read the store file: ${(e as Error).message}`);
        }
        const flat = JSON.stringify(sources);
        return expectAll([
          [sources.length > 0, 'the stored campaign should hold a "sources" list'],
          [
            /"kind":"dataset"/.test(flat) && /"name":"rec"/.test(flat) && /"version":1\b/.test(flat),
            `the source should name kind dataset, name rec, version 1; got ${clip(flat)}`,
          ],
          [
            fullHash.length === 64 && flat.includes(fullHash),
            `the source should keep the full 64 character hash ${fullHash.slice(0, 12)}...; got ${clip(flat)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'campaign-refuses-repeated-prompts',
      tier: 4,
      level: 1,
      component: 'driftbench campaign',
      title:
        'datasets.md "A campaign records the versions it ran": two --prompt options are refused with exit 2 and nothing is stored; one --prompt is recorded in the sources',
      cause: 'driftbench campaign run refuses a second --prompt and records the one prompt version it ran',
      async check(ctx) {
        const dir = work(ctx, 'camp-prompts');
        const store = join(dir, 's.db');
        put(dir, 'specs/a.yaml', spec(`a-${ctx.seed}`));
        put(dir, 'p1/x.md', `first prompt ${ctx.seed}`);
        put(dir, 'p2/y.md', `second prompt ${ctx.seed}`);
        await pushOf('prompt', 'pone', join(dir, 'p1'), store, dir);
        await pushOf('prompt', 'ptwo', join(dir, 'p2'), store, dir);
        const run = (prompts: string[], campaign: string) =>
          cli(
            [
              'campaign',
              'run',
              join(dir, 'specs'),
              ...prompts.flatMap((prompt) => ['--prompt', prompt]),
              '--campaign',
              campaign,
              '--store',
              store,
            ],
            dir,
          );
        const two = await run(['pone', 'ptwo@1'], 'ctwo');
        if (two.code !== 2) return fail(`two --prompt options should exit 2; got ${shown(two)}`);
        const one = await run(['pone'], 'cone');
        if (one.code !== 0) return fail(`one --prompt should run; got ${shown(one)}`);
        let flat = '';
        try {
          flat = JSON.stringify(await storedSources(store));
        } catch (e) {
          return fail(`could not read the store file: ${(e as Error).message}`);
        }
        return expectAll([
          [
            /"kind":"prompt"/.test(flat) && /"name":"pone"/.test(flat),
            `the source list should hold prompt pone; got ${clip(flat)}`,
          ],
          [
            !/"name":"ptwo"/.test(flat),
            `the refused campaign should record no prompt ptwo; got ${clip(flat)}`,
          ],
        ]);
      },
    }),
  );
  return items;
}

function importItems(): BankItem[] {
  const items: BankItem[] = [];
  const example = (root: string, name: string): string => join(root, 'examples/acme/import', name);
  const mapping = (
    extraSpec = '',
    block = '  user: "{question}"\n  expect:\n    must: { $column: must, $split: "|" }\n',
  ): string =>
    `group_by: conversation\nspec:\n  id: "imp-{conversation}"\n  target: { adapter: function, agent: acme-sales }\n${extraSpec}block:\n${block}`;
  const table =
    'conversation,question,must,note\nalpha,Hello there,Acme,n1\nalpha,Second ask,Fiber,n2\nbeta,Third ask,Acme Air,n3\n';

  items.push(
    ds({
      id: 'import-example-writes-two-specs',
      tier: 1,
      component: 'driftbench import',
      title:
        'datasets.md "Import specs from a table": the Acme example gives acme-imported-upgrade and acme-imported-porting and ends with "Imported 2 specs from 3 rows of cases.csv into <dir>."',
      cause:
        'driftbench import csv writes one <id>.yaml per spec and prints "Imported N specs from M rows of <file> into <dir>."',
      async check(ctx) {
        const dir = work(ctx, 'imp-example');
        const c = await cli(
          [
            'import',
            'csv',
            example(ctx.root, 'cases.csv'),
            '--mapping',
            example(ctx.root, 'mapping.yaml'),
            '--out',
            'imported',
          ],
          dir,
        );
        const got = files(join(dir, 'imported')).join(',');
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            got === 'acme-imported-porting.yaml,acme-imported-upgrade.yaml',
            `expected the two spec files; got "${got}"`,
          ],
          [
            /Imported 2 specs from 3 rows of cases\.csv into imported\./.test(c.out),
            `expected the summary line; got ${shown(c)}`,
          ],
          [
            /✓ imported\/acme-imported-upgrade\.yaml\s+acme-imported-upgrade · 2 blocks · rows 2, 3/.test(
              c.out,
            ),
            `expected the per spec line with its rows; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-spec-starts-with-rows-comment',
      tier: 2,
      component: 'driftbench import',
      title:
        'datasets.md "Import specs from a table": the written spec starts with a comment naming its rows, "# Imported from cases.csv, rows 2, 3."',
      cause:
        'driftbench import csv starts each written spec with the comment "# Imported from <file>, rows <list>."',
      async check(ctx) {
        const dir = work(ctx, 'imp-comment');
        await cli(
          [
            'import',
            'csv',
            example(ctx.root, 'cases.csv'),
            '--mapping',
            example(ctx.root, 'mapping.yaml'),
            '--out',
            'o',
          ],
          dir,
        );
        const first = text(join(dir, 'o/acme-imported-upgrade.yaml')).split('\n')[0];
        const single = text(join(dir, 'o/acme-imported-porting.yaml')).split('\n')[0];
        return expectAll([
          [
            first === '# Imported from cases.csv, rows 2, 3.',
            `expected "# Imported from cases.csv, rows 2, 3."; got "${first}"`,
          ],
          [
            single === '# Imported from cases.csv, row 4.',
            `expected "# Imported from cases.csv, row 4."; got "${single}"`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-group-by-keeps-row-order-and-first-row-spec',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md mapping table: group_by turns rows sharing a value into the blocks of one spec in row order, and the spec template reads the first of them',
      cause:
        'driftbench import csv puts the grouped rows in row order and fills the spec template from the first row of the group',
      async check(ctx) {
        const dir = work(ctx, 'imp-group');
        put(
          dir,
          't.csv',
          `conversation,title,question\nalpha,First title ${ctx.seed},ask one\nbeta,Other,ask zero\nalpha,Second title,ask two\nalpha,Third title,ask three\n`,
        );
        put(
          dir,
          'm.yaml',
          `group_by: conversation\nspec:\n  id: "g-{conversation}"\n  title: "{title}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n`,
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/g-alpha.yaml')) ? text(join(dir, 'o/g-alpha.yaml')) : '';
        const at = (s: string): number => body.indexOf(s);
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            body.includes(`First title ${ctx.seed}`) && !body.includes('Second title'),
            'the title should come from the first row of the group',
          ],
          [
            at('ask one') >= 0 && at('ask one') < at('ask two') && at('ask two') < at('ask three'),
            'the three blocks should follow the row order',
          ],
          [
            /rows 2, 4, 5/.test(body.split('\n')[0] ?? ''),
            `the comment should list rows 2, 4, 5; got "${body.split('\n')[0]}"`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-without-group-by-one-spec-per-row',
      tier: 2,
      component: 'driftbench import',
      title: 'datasets.md mapping table: without group_by, every row is a spec of one block',
      cause: 'driftbench import csv makes one spec of one block per row when the mapping has no group_by',
      async check(ctx) {
        const dir = work(ctx, 'imp-nogroup');
        put(dir, 't.csv', table);
        put(
          dir,
          'm.yaml',
          `spec:\n  id: "row-{row}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n`,
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const got = files(join(dir, 'o')).join(',');
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            got === 'row-2.yaml,row-3.yaml,row-4.yaml',
            `{row} is the source row number, so expected row-2, row-3 and row-4; got "${got}"`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-missing-column-exit-2-writes-nothing',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench import',
      title:
        'datasets.md exit codes: 2 when the mapping names a column the table lacks, and nothing is written',
      cause:
        'driftbench import csv exits 2 before writing when a mapping placeholder names a column the table does not have',
      async check(ctx) {
        const dir = work(ctx, 'imp-nocol');
        put(dir, 't.csv', table);
        put(dir, 'm.yaml', mapping('', '  user: "{no_such_column}"\n'));
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return expectAll([
          [c.code === 2, `a missing column should exit 2; got ${shown(c)}`],
          [files(join(dir, 'o')).length === 0, 'nothing should be written'],
        ]);
      },
    }),
    ds({
      id: 'import-invalid-row-writes-no-spec',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md "Import specs from a table": every spec is checked with the loader before anything is written; one invalid row means exit 1 and no file',
      cause:
        'driftbench import csv checks all specs first, prints each invalid one with its row numbers and the loader error, and writes none',
      async check(ctx) {
        const dir = work(ctx, 'imp-invalid');
        put(dir, 't.csv', 'conversation,question,must\nok,Fine ask,Acme\nbad,Broken ask,(\n');
        put(dir, 'm.yaml', mapping());
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return expectAll([
          [c.code === 1, `an invalid row should exit 1; got ${shown(c)}`],
          [
            files(join(dir, 'o')).length === 0,
            `no file should be written, not even the valid spec; found ${files(join(dir, 'o')).join(',')}`,
          ],
          [
            /row 3/.test(both(c)) && /REGEX_INVALID/.test(both(c)),
            `the output should name row 3 and REGEX_INVALID; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-refuses-existing-file-with-other-content',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md exit codes: 2 for a spec file that exists with other content, overwritten only with --force',
      cause:
        'driftbench import csv exits 2 and leaves a different existing <id>.yaml untouched unless --force is given',
      async check(ctx) {
        const dir = work(ctx, 'imp-exists');
        put(dir, 't.csv', 'conversation,question,must\nonly,Hello,Acme\n');
        put(dir, 'm.yaml', mapping());
        const old = '# my own spec\nid: imp-only\n';
        put(dir, 'o/imp-only.yaml', old);
        const refused = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const kept = text(join(dir, 'o/imp-only.yaml')) === old;
        const forced = await cli(
          ['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o', '--force'],
          dir,
        );
        return expectAll([
          [refused.code === 2, `an existing file with other content should exit 2; got ${shown(refused)}`],
          [kept, 'the existing file should be kept without --force'],
          [
            forced.code === 0 && text(join(dir, 'o/imp-only.yaml')) !== old,
            `--force should overwrite it; got ${shown(forced)}`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-same-content-twice-is-not-a-conflict',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md exit codes: only a spec file that exists with other content stops the import, so importing twice gives exit 0 both times',
      cause:
        'driftbench import csv treats an existing file with identical content as already written and exits 0',
      async check(ctx) {
        const dir = work(ctx, 'imp-twice');
        put(dir, 't.csv', table);
        put(dir, 'm.yaml', mapping());
        const a = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const first = files(join(dir, 'o')).map((f) => text(join(dir, 'o', f)));
        const b = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const second = files(join(dir, 'o')).map((f) => text(join(dir, 'o', f)));
        return expectAll([
          [a.code === 0, `the first import should exit 0; got ${shown(a)}`],
          [b.code === 0, `the second import of the same table should exit 0; got ${shown(b)}`],
          [JSON.stringify(first) === JSON.stringify(second), 'the files should be byte for byte the same'],
        ]);
      },
    }),
    ds({
      id: 'import-double-brace-writes-a-brace',
      tier: 2,
      component: 'driftbench import',
      title: 'datasets.md "Inside the templates": a double open brace writes a brace',
      cause: 'driftbench import csv writes one brace for each doubled brace in a template text',
      async check(ctx) {
        const dir = work(ctx, 'imp-brace');
        put(dir, 't.csv', table);
        put(
          dir,
          'm.yaml',
          `spec:\n  id: "br-{row}"\n  title: "open {{ for {conversation}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n`,
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/br-2.yaml')) ? text(join(dir, 'o/br-2.yaml')) : '';
        return c.code === 0 && /title: open \{ for alpha/.test(body)
          ? PASS
          : fail(`expected the title "open { for alpha"; got ${shown(c)} and "${clip(body)}"`);
      },
    }),
    ds({
      id: 'import-empty-cell-leaves-field-out',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md "Inside the templates": an empty cell leaves the field out, and an object left empty is left out too',
      cause:
        'driftbench import csv omits a field whose single placeholder cell is empty and omits an object that ends up empty',
      async check(ctx) {
        const dir = work(ctx, 'imp-empty');
        put(dir, 't.csv', 'id,question,must_not,tool\na,Hello,,\nb,Hello again,zzz,\n');
        put(
          dir,
          'm.yaml',
          `spec:\n  id: "e-{id}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n  expect:\n    must_not: { $column: must_not, $list: true }\n    stage: "{tool}"\n`,
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const a = existsSync(join(dir, 'o/e-a.yaml')) ? text(join(dir, 'o/e-a.yaml')) : '';
        const b = existsSync(join(dir, 'o/e-b.yaml')) ? text(join(dir, 'o/e-b.yaml')) : '';
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            !/must_not|stage|expect/.test(a),
            `row a has only empty cells, so no expect object should be written; got "${clip(a)}"`,
          ],
          [
            /must_not:/.test(b) && /zzz/.test(b) && !/stage/.test(b),
            `row b should keep must_not and still omit the empty stage; got "${clip(b)}"`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-split-trims-each-part',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md "Inside the templates": $split makes a list, the cell split on the separator and each part trimmed',
      cause: 'driftbench import csv trims the white space around every part of a $split cell',
      async check(ctx) {
        const dir = work(ctx, 'imp-split');
        put(dir, 't.csv', 'conversation,question,must\nonly,Hello,  one thing  |two |   three\n');
        put(dir, 'm.yaml', mapping());
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/imp-only.yaml')) ? text(join(dir, 'o/imp-only.yaml')) : '';
        const lines = body.split('\n').map((l) => l.trim());
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            lines.includes('- one thing') && lines.includes('- two') && lines.includes('- three'),
            `expected three trimmed list items; got "${clip(body)}"`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-list-keeps-whole-cell-as-one-item',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md "Inside the templates": $list true makes a list of the whole cell, with no split on a bar',
      cause:
        'driftbench import csv makes a one item list of the whole cell for $list: true, whatever characters it holds',
      async check(ctx) {
        const dir = work(ctx, 'imp-list');
        put(dir, 't.csv', 'conversation,question,pat\nonly,Hello,"Fiber (300|1000)"\n');
        put(
          dir,
          'm.yaml',
          `group_by: conversation\nspec:\n  id: "imp-{conversation}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n  expect:\n    must_not: { $column: pat, $list: true }\n`,
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/imp-only.yaml')) ? text(join(dir, 'o/imp-only.yaml')) : '';
        return c.code === 0 && body.includes('Fiber (300|1000)')
          ? PASS
          : fail(`the whole cell should be one list item; got ${shown(c)} and "${clip(body)}"`);
      },
    }),
    ds({
      id: 'import-tsv-file-is-read-as-tsv',
      tier: 2,
      component: 'driftbench import',
      title: 'datasets.md "Import specs from a table": import csv reads a .csv or .tsv file',
      cause: 'driftbench import csv splits a .tsv file on tabs',
      async check(ctx) {
        const dir = work(ctx, 'imp-tsv');
        put(dir, 't.tsv', 'conversation\tquestion\tmust\nalpha\tHello, with a comma\tAcme\n');
        put(dir, 'm.yaml', mapping());
        const c = await cli(['import', 'csv', 't.tsv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/imp-alpha.yaml')) ? text(join(dir, 'o/imp-alpha.yaml')) : '';
        return c.code === 0 && body.includes('Hello, with a comma')
          ? PASS
          : fail(`a tab separated file should import; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'import-header-row-skips-rows-above',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md mapping table: header_row is the row that names the columns, and rows above it are skipped',
      cause:
        'driftbench import csv reads the column names from the header_row line and skips the lines above it',
      async check(ctx) {
        const dir = work(ctx, 'imp-header');
        put(
          dir,
          't.csv',
          'Exported by the Acme team\nnotes,,\nconversation,question,must\nalpha,Hello there,Acme\n',
        );
        put(dir, 'm.yaml', `header_row: 3\n${mapping()}`);
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            existsSync(join(dir, 'o/imp-alpha.yaml')),
            `expected imp-alpha.yaml; found ${files(join(dir, 'o')).join(',')}`,
          ],
          [
            /row 4\./.test(
              existsSync(join(dir, 'o/imp-alpha.yaml'))
                ? (text(join(dir, 'o/imp-alpha.yaml')).split('\n')[0] ?? '')
                : '',
            ),
            'the first data row is source row 4',
          ],
        ]);
      },
    }),
    ds({
      id: 'import-format-must-match-file',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench import',
      title: 'datasets.md exit codes: 2 for a format that does not match the file',
      cause: 'driftbench import xlsx and import csv exit 2 when the file is not of the format of the command',
      async check(ctx) {
        const dir = work(ctx, 'imp-format');
        put(dir, 't.csv', table);
        put(dir, 'm.yaml', mapping());
        const a = await cli(['import', 'xlsx', 't.csv', '--mapping', 'm.yaml', '--out', 'o1'], dir);
        const b = await cli(
          [
            'import',
            'csv',
            example(ctx.root, 'cases.xlsx'),
            '--mapping',
            example(ctx.root, 'mapping.yaml'),
            '--out',
            'o2',
          ],
          dir,
        );
        return expectAll([
          [a.code === 2, `import xlsx on a csv file should exit 2; got ${shown(a)}`],
          [b.code === 2, `import csv on a workbook should exit 2; got ${shown(b)}`],
          [
            files(join(dir, 'o1')).length === 0 && files(join(dir, 'o2')).length === 0,
            'nothing should be written',
          ],
        ]);
      },
    }),
    ds({
      id: 'import-xlsx-gives-the-same-specs',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md "Import specs from a table": the Cases sheet of cases.xlsx holds the same rows and gives the same specs with import xlsx',
      cause:
        'driftbench import xlsx reads the Cases sheet into the same spec bodies as import csv, apart from the source comment',
      async check(ctx) {
        const dir = work(ctx, 'imp-xlsx');
        const m = example(ctx.root, 'mapping.yaml');
        const a = await cli(
          ['import', 'csv', example(ctx.root, 'cases.csv'), '--mapping', m, '--out', 'csv'],
          dir,
        );
        const b = await cli(
          ['import', 'xlsx', example(ctx.root, 'cases.xlsx'), '--mapping', m, '--out', 'xlsx'],
          dir,
        );
        const body = (kind: string, f: string): string =>
          text(join(dir, kind, f))
            .split('\n')
            .slice(1)
            .join('\n');
        const names = files(join(dir, 'csv'));
        return expectAll([
          [a.code === 0 && b.code === 0, `both imports should exit 0; got ${shown(a)} and ${shown(b)}`],
          [names.join(',') === files(join(dir, 'xlsx')).join(','), 'both folders should hold the same files'],
          [names.every((f) => body('csv', f) === body('xlsx', f)), 'the spec bodies should be equal'],
        ]);
      },
    }),
    ds({
      id: 'import-json-hash-matches-spec-validate',
      tier: 3,
      component: 'driftbench import',
      title:
        'cli.md "driftbench import": --json prints each spec with its hash, which is the hash spec validate gives the written file',
      cause:
        'driftbench import --json prints the spec hash of the written file, the same 12 characters spec validate prints',
      async check(ctx) {
        const dir = work(ctx, 'imp-json');
        const c = await cli(
          [
            'import',
            'csv',
            example(ctx.root, 'cases.csv'),
            '--mapping',
            example(ctx.root, 'mapping.yaml'),
            '--out',
            'o',
            '--json',
          ],
          dir,
        );
        const json = tryJson(c.out) as
          | {
              specs?: { id?: string; file?: string; hash?: string; blocks?: number; rows?: number[] }[];
              rows?: number;
            }
          | undefined;
        if (!json?.specs?.length) return fail(`--json should print the specs; got ${shown(c)}`);
        const v = await cli(['spec', 'validate', 'o', '--json'], dir);
        const valid = (tryJson(v.out) as { path: string; hash: string }[] | undefined) ?? [];
        const problems: string[] = [];
        for (const s of json.specs) {
          const match = valid.find((x) => x.path.endsWith(`${s.id}.yaml`));
          if (!match || match.hash !== s.hash)
            problems.push(`${s.id}: import says ${s.hash}, validate says ${match?.hash}`);
        }
        return problems.length === 0 && json.rows === 3
          ? PASS
          : fail(`hash or row count mismatch: ${problems.join('; ')}; rows ${json.rows}`);
      },
    }),
    ds({
      id: 'import-mapping-must-give-spec-id',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench import',
      title: 'datasets.md mapping table: the spec template must give an id; a bad mapping is exit 2',
      cause: 'driftbench import csv exits 2 when the mapping spec template has no id',
      async check(ctx) {
        const dir = work(ctx, 'imp-noid');
        put(dir, 't.csv', table);
        put(dir, 'm.yaml', 'spec:\n  title: "{question}"\nblock:\n  user: "{question}"\n');
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return c.code === 2 && files(join(dir, 'o')).length === 0
          ? PASS
          : fail(`a mapping without spec.id should exit 2 and write nothing; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'import-block-must-give-a-stimulus',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench import',
      title: 'datasets.md mapping table: the block template must give user, burst or when',
      cause: 'driftbench import csv exits 2 when the mapping block template has none of user, burst and when',
      async check(ctx) {
        const dir = work(ctx, 'imp-nostim');
        put(dir, 't.csv', table);
        put(dir, 'm.yaml', 'spec:\n  id: "x-{row}"\nblock:\n  expect:\n    must: [Acme]\n');
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return c.code === 2 && files(join(dir, 'o')).length === 0
          ? PASS
          : fail(`a block template without a stimulus should exit 2; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'import-as-number-keeps-a-number',
      tier: 3,
      component: 'driftbench import',
      title:
        'datasets.md "Inside the templates": $as converts to number, so a text cell fills a numeric field',
      cause: 'driftbench import csv converts a cell to a number for $as: number and writes it unquoted',
      async check(ctx) {
        const dir = work(ctx, 'imp-asnum');
        put(dir, 't.csv', 'id,question,steps\na,Hello,3\n');
        put(
          dir,
          'm.yaml',
          'spec:\n  id: "n-{id}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n  budget:\n    steps: { $column: steps, $as: number }\n',
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/n-a.yaml')) ? text(join(dir, 'o/n-a.yaml')) : '';
        return c.code === 0 && /steps: 3\s*$/m.test(body)
          ? PASS
          : fail(`expected "steps: 3" as a number; got ${shown(c)} and "${clip(body)}"`);
      },
    }),
    ds({
      id: 'import-as-boolean-and-json',
      tier: 4,
      component: 'driftbench import',
      title: 'datasets.md "Inside the templates": $as converts to text, number, boolean or json',
      cause:
        'driftbench import csv converts a cell to a boolean for $as: boolean and parses it as JSON for $as: json',
      async check(ctx) {
        const dir = work(ctx, 'imp-asbj');
        put(dir, 't.csv', 'id,question,stable,cnt\na,Hello,true,"{""min"": 1, ""max"": 2}"\n');
        put(
          dir,
          'm.yaml',
          'spec:\n  id: "b-{id}"\n  target: { adapter: function, agent: acme-sales }\n  rules:\n    lang_stable: { $column: stable, $as: boolean }\nblock:\n  user: "{question}"\n  expect:\n    tools:\n      - label: coverage.check\n        count: { $column: cnt, $as: json }\n',
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        const body = existsSync(join(dir, 'o/b-a.yaml')) ? text(join(dir, 'o/b-a.yaml')) : '';
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            /lang_stable: true\s*$/m.test(body),
            `lang_stable should be the boolean true; got "${clip(body)}"`,
          ],
          [
            /min: 1/.test(body) && /max: 2/.test(body),
            `count should hold min 1 and max 2; got "${clip(body)}"`,
          ],
        ]);
      },
    }),
    ds({
      id: 'import-csv-cells-stay-text',
      tier: 4,
      source: 'adversarial',
      component: 'driftbench import',
      title:
        'datasets.md "Import specs from a table": import csv reads every field as text, so a bare placeholder into a number field is invalid, exit 1',
      cause:
        'driftbench import csv keeps a bare placeholder cell as text, so the loader refuses it in a numeric field and the import exits 1',
      async check(ctx) {
        const dir = work(ctx, 'imp-text');
        put(dir, 't.csv', 'id,question,steps\na,Hello,3\n');
        put(
          dir,
          'm.yaml',
          'spec:\n  id: "t-{id}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n  budget:\n    steps: "{steps}"\n',
        );
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return c.code === 1 && files(join(dir, 'o')).length === 0
          ? PASS
          : fail(
              `a text cell in budget.steps should make an invalid spec, exit 1, nothing written; got ${shown(c)}`,
            );
      },
    }),
    ds({
      id: 'import-xlsx-number-cell-stays-a-number',
      tier: 4,
      component: 'driftbench import',
      title:
        'datasets.md "Import specs from a table": in import xlsx numbers stay numbers, so a bare placeholder over a number cell fills a numeric field',
      cause: 'driftbench import xlsx keeps a spreadsheet number as a number for a bare placeholder',
      async check(ctx) {
        const dir = work(ctx, 'imp-xlsxnum');
        put(
          dir,
          'm.yaml',
          'sheet: Cases\nspec:\n  id: "x-{row}"\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{question}"\n  expect:\n    tools:\n      - label: coverage.check\n        count: { max: "{max_calls}" }\n',
        );
        const c = await cli(
          ['import', 'xlsx', example(ctx.root, 'cases.xlsx'), '--mapping', 'm.yaml', '--out', 'o'],
          dir,
        );
        return c.code === 0 && files(join(dir, 'o')).length === 3
          ? PASS
          : fail(`the number cells of max_calls should fill count.max; got ${shown(c)}`);
      },
    }),
    ds({
      id: 'import-csv-ignores-sheet-key',
      tier: 2,
      component: 'driftbench import',
      title: 'datasets.md mapping table: a CSV file has one table, so import csv ignores sheet',
      cause: 'driftbench import csv ignores the sheet key of the mapping',
      async check(ctx) {
        const dir = work(ctx, 'imp-sheet');
        put(dir, 't.csv', table);
        put(dir, 'm.yaml', `sheet: NoSuchSheet\n${mapping()}`);
        const c = await cli(['import', 'csv', 't.csv', '--mapping', 'm.yaml', '--out', 'o'], dir);
        return c.code === 0 && files(join(dir, 'o')).length === 2
          ? PASS
          : fail(`a sheet key should not matter for a CSV file; got ${shown(c)}`);
      },
    }),
  );
  return items;
}

// ---------------------------------------------------------------------------------------------------
// Family breaker-cli: docs/reference/cli.md and docs/running.md, the spec, space, campaign and smoke commands
// ---------------------------------------------------------------------------------------------------

const cl = family('breaker-cli', 'cli', 10);

const acmeSpecs = (root: string, ...rel: string[]): string => join(root, 'examples/acme/specs', ...rel);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

type ValidateRow = {
  path: string;
  ok: boolean;
  id?: string;
  hash?: string;
  blocks?: number;
  errors?: { level: string; code: string; path: string; message: string }[];
  warnings?: { level: string; code: string; path: string; message: string }[];
};

function cliItems(): BankItem[] {
  const items: BankItem[] = [];
  const inventory =
    'behaviours:\n  - { id: B-001, title: Greets }\n  - { id: B-002, title: Offers }\nflows:\n  - id: f1\n    title: Flow one\n    behaviours: [B-001, B-002]\n    deviations: [D1_off_topic]\n';
  const covering = (id: string, covers: string, extra = ''): string =>
    `id: ${id}\nchannel: chat\ncovers: [${covers}]\ntags: ['flow:f1']\nblocks:\n  - user: hi\n    expect: { must: [x] }\n${extra}`;
  const offTopic =
    "perturbations:\n  - { id: p1, class: D1_off_topic, inject_at: 0, user: 'What time do you open?' }\n";

  items.push(
    cl({
      id: 'validate-summary-and-line',
      tier: 1,
      component: 'driftbench spec validate',
      title:
        'cli.md "driftbench spec validate": one line per spec with id, block count, perturbation count and a 12 character hash, then "Checked N specs: N valid, 0 invalid, 0 warnings."',
      cause:
        'driftbench spec validate prints "<id> · <n> blocks · <m> perturbations · hash <12 hex>" per spec and the summary line',
      async check(ctx) {
        const dir = work(ctx, 'val-summary');
        const n = ctx.seed + 1;
        for (let i = 0; i < n; i++)
          put(
            dir,
            `s/s${i}.yaml`,
            `id: v${i}\nblocks:\n  - user: a\n    expect: { must: [x] }\n  - user: b\n    expect: { must: [y] }\n${i === 0 ? offTopic.replace(' }\n', ', recovery: { within_blocks: 1 } }\n') : ''}`,
          );
        const c = await cli(['spec', 'validate', 's'], dir);
        return expectAll([
          [c.code === 0, `exit should be 0; got ${shown(c)}`],
          [
            /v0 · 2 blocks · 1 perturbation · hash [0-9a-f]{12}/.test(c.out),
            `expected "v0 · 2 blocks · 1 perturbation · hash <12 hex>"; got ${shown(c)}`,
          ],
          [
            c.out.includes(`Checked ${n} specs: ${n} valid, 0 invalid, 0 warnings.`),
            `expected the summary for ${n} specs; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'validate-invalid-lists-path-and-code',
      tier: 1,
      component: 'driftbench spec validate',
      title:
        'cli.md "driftbench spec validate": an invalid spec lists every error with its path in the spec and its code, and the command exits 1',
      cause: 'driftbench spec validate prints "<path>  <CODE>  <message>" for each error and exits 1',
      async check(ctx) {
        const dir = work(ctx, 'val-invalid');
        put(
          dir,
          's/bad.yaml',
          "id: bad\nstages: [a]\nblocks:\n  - user: hello\n    expect: { must: ['('], stage: nope, criteria: [ghost] }\ncriteria:\n  - { name: other, rubric: Is it kind }\n",
        );
        const c = await cli(['spec', 'validate', 's/bad.yaml'], dir);
        return expectAll([
          [c.code === 1, `an invalid spec should exit 1; got ${shown(c)}`],
          [
            /blocks\.0\.expect\.criteria\.0\s+CRITERION_UNDEFINED/.test(c.out),
            `expected "blocks.0.expect.criteria.0  CRITERION_UNDEFINED"; got ${shown(c)}`,
          ],
          [
            /blocks\.0\.expect\.must\.0\s+REGEX_INVALID/.test(c.out),
            `expected "blocks.0.expect.must.0  REGEX_INVALID"; got ${shown(c)}`,
          ],
          [
            /blocks\.0\.expect\.stage\s+STAGE_UNKNOWN/.test(c.out),
            `expected "blocks.0.expect.stage  STAGE_UNKNOWN"; got ${shown(c)}`,
          ],
          [
            c.out.includes('Checked 1 spec: 0 valid, 1 invalid, 0 warnings.'),
            `expected the summary line; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'validate-empty-folder-exit-1',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench spec validate',
      title: 'cli.md "driftbench spec validate" exit codes: 1 when no spec file was found',
      cause: 'driftbench spec validate exits 1 for a folder that holds no spec file',
      async check(ctx) {
        const dir = work(ctx, 'val-empty');
        put(dir, 'empty/readme.txt', 'no specs here');
        const c = await cli(['spec', 'validate', 'empty'], dir);
        return c.code === 1 ? PASS : fail(`a folder without specs should exit 1; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'validate-missing-path-is-spec-parse',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench spec validate',
      title:
        'cli.md "Paths": a path that does not exist is reported as an invalid spec with the code SPEC_PARSE (exit 1); the exit table lists a missing path under usage errors (2). The more specific page, Paths, is used',
      cause:
        'driftbench spec validate reports a path that does not exist as an invalid spec with code SPEC_PARSE and exits 1',
      async check(ctx) {
        const dir = work(ctx, 'val-nopath');
        const c = await cli(['spec', 'validate', 'not-there.yaml'], dir);
        return c.code === 1 && /SPEC_PARSE/.test(c.out)
          ? PASS
          : fail(`expected exit 1 and SPEC_PARSE; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'argument-parser-errors-exit-2',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench',
      title:
        'cli.md intro: an option or argument error that the argument parser reports (an unknown option, a missing argument) always exits 2',
      cause: 'driftbench exits 2 for an unknown option and for a missing required argument on every command',
      async check(ctx) {
        const dir = work(ctx, 'parser-err');
        put(dir, 's/a.yaml', spec('a'));
        const a = await cli(['spec', 'validate', 's', '--bogus-option'], dir);
        const b = await cli(['spec', 'lint'], dir);
        const c = await cli(['campaign', 'plan', 's', '--bogus-option'], dir);
        const d = await cli(['smoke'], dir);
        return expectAll([
          [a.code === 2, `spec validate with an unknown option should exit 2; got ${shown(a)}`],
          [b.code === 2, `spec lint without a path should exit 2; got ${shown(b)}`],
          [c.code === 2, `campaign plan with an unknown option should exit 2; got ${shown(c)}`],
          [d.code === 2, `smoke without a spec should exit 2; got ${shown(d)}`],
        ]);
      },
    }),
    cl({
      id: 'validate-hash-is-sha256-of-canonical-json',
      tier: 4,
      component: 'driftbench spec validate',
      title:
        'cli.md "driftbench spec validate": the hash is the first 12 hex characters of the SHA-256 of the spec canonical JSON, with keys sorted at every depth',
      cause:
        'driftbench spec validate computes the hash from the normalised spec as JSON with sorted keys at every depth',
      async check(ctx) {
        const dir = work(ctx, 'val-hash');
        const obj = {
          id: `h${ctx.seed}`,
          kind: 'conversation',
          stages: ['a', 'b'],
          blocks: [
            { when: { user: 'Hello' }, expect: { must: ['Acme'], stage: 'a' } },
            { when: { user: 'Again' }, expect: { tools: [{ label: 'x', count: { min: 1, max: 2 } }] } },
          ],
        };
        put(dir, 's/a.yaml', JSON.stringify(obj));
        const c = await cli(['spec', 'validate', 's/a.yaml', '--json'], dir);
        const row = (tryJson(c.out) as ValidateRow[] | undefined)?.[0];
        const want = sha256(JSON.stringify(canonical(obj))).slice(0, 12);
        return row?.hash === want ? PASS : fail(`expected hash ${want}; got ${row?.hash} from ${shown(c)}`);
      },
    }),
    cl({
      id: 'validate-equal-content-equal-hash',
      tier: 3,
      component: 'driftbench spec validate',
      title:
        'cli.md "driftbench spec validate": equal content gives an equal hash, whatever the key order or the shorthand',
      cause:
        'driftbench spec validate hashes the normalised spec, so key order, the kind default and the user shorthand do not change the hash',
      async check(ctx) {
        const dir = work(ctx, 'val-equal');
        put(
          dir,
          'a/one.yaml',
          `id: same${ctx.seed}\nblocks:\n  - user: Hello\n    expect:\n      must: [Acme]\n      stage: a\nstages: [a]\n`,
        );
        put(
          dir,
          'b/two.json',
          JSON.stringify({
            stages: ['a'],
            kind: 'conversation',
            blocks: [{ expect: { stage: 'a', must: ['Acme'] }, when: { user: 'Hello' } }],
            id: `same${ctx.seed}`,
          }),
        );
        const x = (
          tryJson((await cli(['spec', 'validate', 'a/one.yaml', '--json'], dir)).out) as
            | ValidateRow[]
            | undefined
        )?.[0];
        const y = (
          tryJson((await cli(['spec', 'validate', 'b/two.json', '--json'], dir)).out) as
            | ValidateRow[]
            | undefined
        )?.[0];
        return x?.hash && x.hash === y?.hash
          ? PASS
          : fail(`the two forms should hash alike; got ${x?.hash} and ${y?.hash}`);
      },
    }),
    cl({
      id: 'validate-json-valid-and-invalid-shapes',
      tier: 2,
      component: 'driftbench spec validate',
      title:
        'cli.md "JSON output": an array with one entry per spec; a valid one has path, ok, id, hash, blocks and warnings; an invalid one has errors with level, code, path and message',
      cause: 'driftbench spec validate --json prints the documented keys for valid and invalid specs',
      async check(ctx) {
        const dir = work(ctx, 'val-json');
        put(dir, 's/a-good.yaml', spec('good'));
        put(dir, 's/b-bad.yaml', 'id: bad\nblocks:\n  - expect: { must: [x] }\n');
        const c = await cli(['spec', 'validate', 's', '--json'], dir);
        const rows = tryJson(c.out) as ValidateRow[] | undefined;
        const good = rows?.[0];
        const bad = rows?.[1];
        return expectAll([
          [Array.isArray(rows) && rows.length === 2, `expected an array of 2 entries; got ${shown(c)}`],
          [
            good?.ok === true &&
              good.id === 'good' &&
              /^[0-9a-f]{12}$/.test(good.hash ?? '') &&
              good.blocks === 1 &&
              Array.isArray(good.warnings),
            `the valid entry lacks a documented key: ${clip(JSON.stringify(good))}`,
          ],
          [
            bad?.ok === false &&
              bad.errors?.[0]?.code === 'BLOCK_STIMULUS_MISSING' &&
              bad.errors[0].level === 'error' &&
              bad.errors[0].path === 'blocks.0' &&
              typeof bad.errors[0].message === 'string',
            `the invalid entry lacks a documented key: ${clip(JSON.stringify(bad))}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'paths-folder-picks-only-spec-extensions',
      tier: 3,
      component: 'driftbench spec validate',
      title:
        'cli.md "Paths": a folder is searched for *.yaml, *.yml and *.spec.json; a file ending in .json given by name is read as JSON',
      cause:
        'driftbench spec validate takes *.yaml, *.yml and *.spec.json from a folder, ignores other .json files there, and reads a named .json file as JSON',
      async check(ctx) {
        const dir = work(ctx, 'paths-ext');
        put(dir, 's/a.yaml', spec('ya'));
        put(dir, 's/b.yml', spec('yb'));
        put(dir, 's/c.spec.json', JSON.stringify({ id: 'jc', blocks: [{ user: 'x' }] }));
        put(dir, 's/d.json', JSON.stringify({ not: 'a spec' }));
        put(dir, 's/e.txt', 'ignored');
        const folder = await cli(['spec', 'validate', 's'], dir);
        const named = await cli(['spec', 'validate', 's/d.json'], dir);
        return expectAll([
          [
            folder.code === 0 && folder.out.includes('Checked 3 specs: 3 valid'),
            `the folder should hold exactly 3 specs; got ${shown(folder)}`,
          ],
          [
            named.code === 1 && /SPEC_|SCHEMA_/.test(named.out),
            `a named .json file should be read as JSON and judged as a spec; got ${shown(named)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'paths-skip-dot-node-modules-dist',
      tier: 2,
      component: 'driftbench spec validate',
      title: 'cli.md "Paths": entries whose name starts with a dot, node_modules and dist are skipped',
      cause: 'driftbench spec validate skips dot entries, node_modules and dist when it searches a folder',
      async check(ctx) {
        const dir = work(ctx, 'paths-skip');
        put(dir, 's/ok.yaml', spec('ok'));
        for (const skipped of ['.hidden', 'node_modules', 'dist'])
          put(dir, `s/${skipped}/x.yaml`, 'not: [valid');
        put(dir, 's/.dotfile.yaml', 'not: [valid');
        const c = await cli(['spec', 'validate', 's'], dir);
        return c.code === 0 && c.out.includes('Checked 1 spec: 1 valid')
          ? PASS
          : fail(`only ok.yaml should be read; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'paths-sorted-order',
      tier: 2,
      component: 'driftbench spec validate',
      title: 'cli.md "Paths": a folder is searched recursively in sorted order',
      cause: 'driftbench spec validate lists the specs of a folder in sorted path order, subfolders included',
      async check(ctx) {
        const dir = work(ctx, 'paths-sorted');
        put(dir, 's/zeta.yaml', spec('zeta'));
        put(dir, 's/alpha.yaml', spec('alpha'));
        put(dir, 's/mid/beta.yml', spec('beta'));
        const c = await cli(['spec', 'validate', 's', '--json'], dir);
        const ids = ((tryJson(c.out) as ValidateRow[] | undefined) ?? []).map((r) => r.id).join(',');
        return ids === 'alpha,beta,zeta' ? PASS : fail(`expected sorted order alpha,beta,zeta; got "${ids}"`);
      },
    }),
    cl({
      id: 'lint-warning-allowed-unless-strict',
      tier: 2,
      component: 'driftbench spec lint',
      title:
        'cli.md "driftbench spec lint" exit codes: warnings are allowed without --strict (0) and fail with --strict (1)',
      cause: 'driftbench spec lint exits 0 with a warning and exits 1 for the same warning with --strict',
      async check(ctx) {
        const dir = work(ctx, 'lint-strict');
        put(dir, 's/a.yaml', 'id: nochecks\nblocks:\n  - user: hello\n');
        const plain = await cli(['spec', 'lint', 's'], dir);
        const strict = await cli(['spec', 'lint', 's', '--strict'], dir);
        return expectAll([
          [plain.code === 0, `lint without --strict should exit 0; got ${shown(plain)}`],
          [
            /! blocks\.0\s+BLOCK_NO_EXPECTATION\s+this block checks nothing/.test(plain.out),
            `expected the warning line; got ${shown(plain)}`,
          ],
          [
            plain.out.includes('Checked 1 spec: 1 valid, 0 invalid, 1 warning.'),
            `expected "1 warning." in the summary; got ${shown(plain)}`,
          ],
          [strict.code === 1, `lint --strict should exit 1; got ${shown(strict)}`],
        ]);
      },
    }),
    cl({
      id: 'lint-warning-codes',
      tier: 3,
      component: 'driftbench spec lint',
      title:
        'cli.md "Issue codes": CRITERION_UNRESOLVED, TASK_WITHOUT_OUTCOME and PERTURBATION_NO_RECOVERY are warnings on a valid spec',
      cause:
        'driftbench spec lint prints CRITERION_UNRESOLVED, TASK_WITHOUT_OUTCOME and PERTURBATION_NO_RECOVERY as warnings of valid specs',
      async check(ctx) {
        const dir = work(ctx, 'lint-codes');
        put(dir, 's/crit.yaml', 'id: crit\nblocks:\n  - user: hi\n    expect: { criteria: [polite] }\n');
        put(
          dir,
          's/task.yaml',
          'id: task\nkind: task\nblocks:\n  - user: build it\n    expect: { must: [done] }\n',
        );
        put(dir, 's/pert.yaml', `id: pert\nblocks:\n  - user: hi\n    expect: { must: [x] }\n${offTopic}`);
        const c = await cli(['spec', 'lint', 's', '--json'], dir);
        const rows = (tryJson(c.out) as ValidateRow[] | undefined) ?? [];
        const codes = (id: string): string =>
          (rows.find((r) => r.id === id)?.warnings ?? []).map((w) => w.code).join(',');
        return expectAll([
          [rows.every((r) => r.ok), `all three specs are valid; got ${clip(c.out)}`],
          [
            codes('crit') === 'CRITERION_UNRESOLVED',
            `crit should warn CRITERION_UNRESOLVED; got "${codes('crit')}"`,
          ],
          [
            codes('task') === 'TASK_WITHOUT_OUTCOME',
            `task should warn TASK_WITHOUT_OUTCOME; got "${codes('task')}"`,
          ],
          [
            codes('pert') === 'PERTURBATION_NO_RECOVERY',
            `pert should warn PERTURBATION_NO_RECOVERY; got "${codes('pert')}"`,
          ],
        ]);
      },
    }),
    cl({
      id: 'coverage-exit-codes-and-last-line',
      tier: 2,
      component: 'driftbench spec coverage',
      title:
        'cli.md "driftbench spec coverage": exit 0 when every behaviour and required deviation is covered, 1 when one is missing; the last line counts them',
      cause:
        'driftbench spec coverage exits 1 on a missing behaviour or required deviation and prints "Coverage: N of M behaviours covered, K of L flow deviations covered."',
      async check(ctx) {
        const dir = work(ctx, 'cov-exit');
        put(dir, 'inv.yaml', inventory);
        put(dir, 'full/a.yaml', covering('a', 'B-001', offTopic));
        put(dir, 'full/b.yaml', covering('b', 'B-002'));
        put(dir, 'part/b.yaml', covering('b', 'B-002'));
        const full = await cli(['spec', 'coverage', 'full', '--inventory', 'inv.yaml'], dir);
        const part = await cli(['spec', 'coverage', 'part', '--inventory', 'inv.yaml'], dir);
        return expectAll([
          [
            full.code === 0 &&
              full.out.includes('Coverage: 2 of 2 behaviours covered, 1 of 1 flow deviations covered.'),
            `full coverage should exit 0 with the counts; got ${shown(full)}`,
          ],
          [
            part.code === 1 &&
              part.out.includes('Coverage: 1 of 2 behaviours covered, 0 of 1 flow deviations covered.'),
            `partial coverage should exit 1 with the counts; got ${shown(part)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'coverage-injection-block-covers-deviation',
      tier: 3,
      component: 'driftbench spec coverage',
      title:
        'cli.md "driftbench spec coverage": a required deviation class is covered by a perturbation of that class or by a block whose stimulus is an injection of that class',
      cause:
        'driftbench spec coverage counts a block with an injection stimulus as covering its deviation class for the flow',
      async check(ctx) {
        const dir = work(ctx, 'cov-inject');
        put(dir, 'inv.yaml', inventory);
        put(
          dir,
          's/a.yaml',
          "id: a\nchannel: chat\ncovers: [B-001, B-002]\ntags: ['flow:f1']\nblocks:\n  - user: hi\n    expect: { must: [x] }\n  - when: { injection: { class: D1_off_topic, user: 'What time do you open?' } }\n    expect: { must: [y] }\n",
        );
        const c = await cli(['spec', 'coverage', 's', '--inventory', 'inv.yaml'], dir);
        return c.code === 0 ? PASS : fail(`an injection block should cover D1_off_topic; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'coverage-invalid-spec-never-counts',
      tier: 3,
      component: 'driftbench spec coverage',
      title: 'cli.md "driftbench spec coverage": invalid specs are listed and never count as coverage',
      cause:
        'driftbench spec coverage lists an invalid spec under "Invalid specs, not counted" and does not let it cover a behaviour',
      async check(ctx) {
        const dir = work(ctx, 'cov-invalid');
        put(dir, 'inv.yaml', inventory);
        put(dir, 's/good.yaml', covering('good', 'B-001', offTopic));
        put(
          dir,
          's/broken.yaml',
          "id: broken\ncovers: [B-002]\ntags: ['flow:f1']\nblocks:\n  - expect: { must: [x] }\n",
        );
        const c = await cli(['spec', 'coverage', 's', '--inventory', 'inv.yaml'], dir);
        return expectAll([
          [c.code === 1, `B-002 is covered only by an invalid spec, so exit should be 1; got ${shown(c)}`],
          [
            /Invalid specs, not counted/.test(c.out) && /BLOCK_STIMULUS_MISSING/.test(c.out),
            `the invalid spec should be listed with its code; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'coverage-not-applicable-channel',
      tier: 3,
      component: 'driftbench spec coverage',
      title:
        'cli.md "driftbench spec coverage": a behaviour that does not apply on a channel is n/a there and is not missing',
      cause:
        'driftbench spec coverage shows n/a, not missing, for a behaviour restricted to other channels and does not fail on it',
      async check(ctx) {
        const dir = work(ctx, 'cov-na');
        put(
          dir,
          'inv.yaml',
          'channels: [chat, whatsapp]\nbehaviours:\n  - { id: B-001, title: Chat only, channels: [chat] }\nflows: []\n',
        );
        put(
          dir,
          's/a.yaml',
          'id: a\nchannel: chat\ncovers: [B-001]\nblocks:\n  - user: hi\n    expect: { must: [x] }\n',
        );
        const c = await cli(['spec', 'coverage', 's', '--inventory', 'inv.yaml'], dir);
        return c.code === 0 &&
          /n\/a/.test(c.out) &&
          !/missing/.test(
            c.out
              .split('\n')
              .filter((l) => /B-001/.test(l))
              .join('\n'),
          )
          ? PASS
          : fail(`the whatsapp cell of B-001 should read n/a and exit 0; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'coverage-unknown-channel-exit-2',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench spec coverage',
      title: 'cli.md "driftbench spec coverage": --channel with an unknown channel is a usage error, exit 2',
      cause:
        'driftbench spec coverage exits 2 when --channel names a channel the inventory and specs do not use',
      async check(ctx) {
        const dir = work(ctx, 'cov-chan');
        put(dir, 'inv.yaml', inventory);
        put(dir, 's/a.yaml', covering('a', 'B-001'));
        const c = await cli(
          ['spec', 'coverage', 's', '--inventory', 'inv.yaml', '--channel', 'carrier-pigeon'],
          dir,
        );
        return c.code === 2 ? PASS : fail(`an unknown channel should exit 2; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'coverage-inventory-errors-exit-2',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench spec coverage',
      title:
        'cli.md "Inventory errors": INVENTORY_DUPLICATE, INVENTORY_UNKNOWN_BEHAVIOUR and INVENTORY_PARSE stop the command, exit 2',
      cause: 'driftbench spec coverage names the inventory error code and exits 2 before computing coverage',
      async check(ctx) {
        const dir = work(ctx, 'cov-inv-err');
        put(dir, 's/a.yaml', covering('a', 'B-001'));
        put(
          dir,
          'dup.yaml',
          'behaviours:\n  - { id: B-001, title: One }\n  - { id: B-001, title: Two }\nflows: []\n',
        );
        put(
          dir,
          'unk.yaml',
          'behaviours:\n  - { id: B-001, title: One }\nflows:\n  - { id: f1, title: F, behaviours: [B-009] }\n',
        );
        put(dir, 'parse.yaml', 'behaviours: [unterminated\n');
        const dup = await cli(['spec', 'coverage', 's', '--inventory', 'dup.yaml'], dir);
        const unk = await cli(['spec', 'coverage', 's', '--inventory', 'unk.yaml'], dir);
        const par = await cli(['spec', 'coverage', 's', '--inventory', 'parse.yaml'], dir);
        return expectAll([
          [
            dup.code === 2 && /INVENTORY_DUPLICATE/.test(both(dup)),
            `duplicate id: expected exit 2 and INVENTORY_DUPLICATE; got ${shown(dup)}`,
          ],
          [
            unk.code === 2 && /INVENTORY_UNKNOWN_BEHAVIOUR/.test(both(unk)),
            `unknown behaviour in a flow: expected exit 2 and INVENTORY_UNKNOWN_BEHAVIOUR; got ${shown(unk)}`,
          ],
          [
            par.code === 2 && /INVENTORY_PARSE/.test(both(par)),
            `unparsable file: expected exit 2 and INVENTORY_PARSE; got ${shown(par)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'coverage-warnings-never-change-exit',
      tier: 3,
      component: 'driftbench spec coverage',
      title:
        'cli.md "driftbench spec coverage": UNKNOWN_BEHAVIOUR, UNKNOWN_FLOW and UNLISTED_CHANNEL are warnings that never change the verdict',
      cause:
        'driftbench spec coverage prints UNKNOWN_BEHAVIOUR, UNKNOWN_FLOW and UNLISTED_CHANNEL warnings and still exits 0 on full coverage',
      async check(ctx) {
        const dir = work(ctx, 'cov-warn');
        put(dir, 'inv.yaml', 'channels: [chat]\nbehaviours:\n  - { id: B-001, title: One }\nflows: []\n');
        put(
          dir,
          's/a.yaml',
          "id: a\nchannel: chat\ncovers: [B-001, B-099]\ntags: ['flow:ghost']\nblocks:\n  - user: hi\n    expect: { must: [x] }\n",
        );
        put(
          dir,
          's/b.yaml',
          'id: b\nchannel: sms\ncovers: [B-001]\nblocks:\n  - user: hi\n    expect: { must: [x] }\n',
        );
        const c = await cli(['spec', 'coverage', 's', '--inventory', 'inv.yaml'], dir);
        return expectAll([
          [c.code === 0, `warnings alone should leave exit 0; got ${shown(c)}`],
          [/UNKNOWN_BEHAVIOUR/.test(c.out), `expected UNKNOWN_BEHAVIOUR; got ${shown(c)}`],
          [/UNKNOWN_FLOW/.test(c.out), `expected UNKNOWN_FLOW; got ${shown(c)}`],
          [/UNLISTED_CHANNEL/.test(c.out), `expected UNLISTED_CHANNEL; got ${shown(c)}`],
        ]);
      },
    }),
    cl({
      id: 'coverage-kind-mismatch-warning',
      tier: 3,
      component: 'driftbench spec coverage',
      title:
        'cli.md "driftbench spec coverage" warnings: KIND_MISMATCH when a task behaviour is covered only by conversation specs',
      cause:
        'driftbench spec coverage warns KIND_MISMATCH for a behaviour covered only by specs of the other kind',
      async check(ctx) {
        const dir = work(ctx, 'cov-kind');
        put(
          dir,
          'inv.yaml',
          'behaviours:\n  - { id: T-001, title: Builds a sheet, kind: task }\nflows: []\n',
        );
        put(dir, 's/a.yaml', 'id: a\ncovers: [T-001]\nblocks:\n  - user: hi\n    expect: { must: [x] }\n');
        const c = await cli(['spec', 'coverage', 's', '--inventory', 'inv.yaml', '--json'], dir);
        const json = tryJson(c.out) as { warnings?: { code?: string }[] } | undefined;
        return json?.warnings?.some((w) => w.code === 'KIND_MISMATCH')
          ? PASS
          : fail(`expected a KIND_MISMATCH warning; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'coverage-json-keys',
      tier: 2,
      component: 'driftbench spec coverage',
      title:
        'cli.md "driftbench spec coverage": --json prints one document with the keys inventory, channels, behaviours, perChannel, flows, warnings, invalidSpecs, summary and ok',
      cause: 'driftbench spec coverage --json prints the nine documented keys',
      async check(ctx) {
        const dir = work(ctx, 'cov-json');
        put(dir, 'inv.yaml', inventory);
        put(dir, 's/a.yaml', covering('a', 'B-001, B-002', offTopic));
        const c = await cli(['spec', 'coverage', 's', '--inventory', 'inv.yaml', '--json'], dir);
        const json = tryJson(c.out) as Record<string, unknown> | undefined;
        const want = [
          'inventory',
          'channels',
          'behaviours',
          'perChannel',
          'flows',
          'warnings',
          'invalidSpecs',
          'summary',
          'ok',
        ];
        const missing = want.filter((k) => !json || !(k in json));
        return missing.length === 0 && json?.ok === true
          ? PASS
          : fail(`missing keys ${missing.join(',')}; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'space-declare-never-overwrites',
      tier: 2,
      component: 'driftbench space declare',
      title: 'cli.md "driftbench space declare": an existing file is never overwritten, exit 2',
      cause: 'driftbench space declare exits 2 and leaves the file as it is when --out exists',
      async check(ctx) {
        const dir = work(ctx, 'space-declare');
        put(dir, 'inv.yaml', inventory);
        put(dir, 's/a.yaml', covering('a', 'B-001', offTopic));
        const mine = '# my own map\nversion: "1"\n';
        put(dir, 'map.yaml', mine);
        const c = await cli(['space', 'declare', 's', '--inventory', 'inv.yaml', '--out', 'map.yaml'], dir);
        return c.code === 2 && text(join(dir, 'map.yaml')) === mine
          ? PASS
          : fail(`expected exit 2 and an unchanged file; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'space-declare-then-coverage-round-trip',
      tier: 3,
      component: 'driftbench space coverage',
      title:
        'cli.md "driftbench space declare" and "space coverage": a declared map carries the deviations the flows require as required cells; coverage exits 1 until a spec covers them',
      cause:
        'driftbench space coverage exits 1 while a required flow deviation of the declared map has no spec and exits 0 once a spec covers it',
      async check(ctx) {
        const dir = work(ctx, 'space-roundtrip');
        put(dir, 'inv.yaml', inventory);
        put(
          dir,
          'full/a.yaml',
          `id: a\nchannel: chat\ncovers: [B-001, B-002]\ntags: ['flow:f1']\nstages: [s1]\nblocks:\n  - user: hi\n    expect: { stage: s1 }\n${offTopic}`,
        );
        const d = await cli(
          ['space', 'declare', 'full', '--inventory', 'inv.yaml', '--out', 'map.yaml'],
          dir,
        );
        const ok = await cli(['space', 'coverage', 'full', '--map', 'map.yaml'], dir);
        put(
          dir,
          'bare/b.yaml',
          "id: b\nchannel: chat\ncovers: [B-001]\ntags: ['flow:f1']\nblocks:\n  - user: hi\n    expect: { must: [x] }\n",
        );
        const bad = await cli(['space', 'coverage', 'bare', '--map', 'map.yaml'], dir);
        return expectAll([
          [d.code === 0, `declare should exit 0; got ${shown(d)}`],
          [
            ok.code === 0 && /Coverage: 1 of 1 required cells covered/.test(ok.out),
            `the covering spec should give exit 0 and "1 of 1 required cells"; got ${shown(ok)}`,
          ],
          [
            bad.code === 1 && /Coverage: 0 of 1 required cells covered/.test(bad.out),
            `the bare spec should give exit 1 and "0 of 1 required cells"; got ${shown(bad)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'space-coverage-t-range',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench space coverage',
      title:
        'cli.md "driftbench space": --t is from 1 to the number of dimensions, and a value out of range is a usage or input error, exit 2',
      cause: 'driftbench space coverage exits 2 for --t 0 and for --t above the number of dimensions',
      async check(ctx) {
        const dir = work(ctx, 'space-t');
        put(dir, 'inv.yaml', inventory);
        put(
          dir,
          's/a.yaml',
          `id: a\nchannel: chat\ncovers: [B-001]\ntags: ['flow:f1']\nstages: [s1]\nblocks:\n  - user: hi\n    expect: { stage: s1 }\n${offTopic}`,
        );
        await cli(['space', 'declare', 's', '--inventory', 'inv.yaml', '--out', 'map.yaml'], dir);
        const zero = await cli(['space', 'coverage', 's', '--map', 'map.yaml', '--t', '0'], dir);
        const big = await cli(['space', 'coverage', 's', '--map', 'map.yaml', '--t', '9'], dir);
        return expectAll([
          [zero.code === 2, `--t 0 should exit 2; got ${shown(zero)}`],
          [big.code === 2, `--t 9 on a map of 4 dimensions should exit 2; got ${shown(big)}`],
        ]);
      },
    }),
    cl({
      id: 'space-map-duplicate-value-stops-command',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench space coverage',
      title:
        'cli.md "driftbench space": a map that does not load stops the command with its issues, such as SPACE_DUPLICATE, exit 2',
      cause: 'driftbench space coverage reports SPACE_DUPLICATE for a dimension id listed twice and exits 2',
      async check(ctx) {
        const dir = work(ctx, 'space-dup');
        put(dir, 's/a.yaml', covering('a', 'B-001'));
        put(
          dir,
          'map.yaml',
          "version: '1'\nagent: x\nconstraints: []\nprior: { kind: declared }\ndimensions:\n  - { id: d, title: D, kind: behaviour, values: [{ id: B-001, title: One }] }\n  - { id: d, title: D again, kind: channel, values: [{ id: chat, title: chat }] }\n",
        );
        const c = await cli(['space', 'coverage', 's', '--map', 'map.yaml'], dir);
        return c.code === 2 && /SPACE_DUPLICATE/.test(both(c))
          ? PASS
          : fail(`expected exit 2 and SPACE_DUPLICATE; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'space-complete-too-few-conversations',
      tier: 3,
      component: 'driftbench space complete',
      title:
        'cli.md "driftbench space complete": the line prints only with at least as many conversations as allowed cells; otherwise the command says why and exits 1',
      cause:
        'driftbench space complete exits 1 and prints "No completeness line: the estimate needs at least as many conversations as cells" when the sample is too small',
      async check(ctx) {
        const dir = work(ctx, 'space-complete');
        put(dir, 'inv.yaml', inventory);
        put(dir, 's/a.yaml', covering('a', 'B-001', offTopic));
        await cli(['space', 'declare', 's', '--inventory', 'inv.yaml', '--out', 'map.yaml'], dir);
        const c = await cli(['space', 'complete', 's', '--map', 'map.yaml', '--t', '1'], dir);
        return c.code === 1 &&
          /No completeness line: the estimate needs at least as many conversations as cells/.test(c.out)
          ? PASS
          : fail(`expected exit 1 and the reason; got ${shown(c)}`);
      },
    }),
  );
  return items;
}

function campaignItems(): BankItem[] {
  const items: BankItem[] = [];
  const planUpgrade = (root: string): string => acmeSpecs(root, 'conversations', 'plan-upgrade.yaml');

  items.push(
    cl({
      id: 'plan-counts-cells-and-blocks',
      tier: 3,
      component: 'driftbench campaign plan',
      title:
        'running.md "driftbench campaign plan": T, F and P modes give one P cell per perturbation and repeat; plan-upgrade with 2 repeats prints the cells and blocks running.md prints, and r repeats r times their half',
      cause:
        'driftbench campaign plan prints "Plan: N specs, M targets, modes T, F, P, R repeats: C cells, B blocks." with one P cell per perturbation and repeat',
      async check(ctx) {
        const dir = work(ctx, 'plan-counts');
        const r = ctx.seed + 1;
        const c = await cli(
          [
            'campaign',
            'plan',
            planUpgrade(ctx.root),
            '--target',
            'function:acme',
            '--mode',
            'T,F,P',
            '--repeats',
            String(r),
          ],
          dir,
        );
        // The counts running.md prints for 2 repeats, read from the page: a cell count and a block count per
        // repeat, so the plan at r repeats is r times those.
        const block = docBlock(
          ctx.root,
          'docs/running.md',
          'pnpm -s driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --repeats 2',
        );
        if (typeof block === 'string') return fail(block);
        const documented = block.find((line) => line.startsWith('Plan: '));
        const counts = documented && /: (\d+) cells, (\d+) blocks\.$/.exec(documented);
        if (!counts)
          return fail('running.md prints no Plan line for plan-upgrade in modes T, F, P with 2 repeats');
        const two = await cli(
          [
            'campaign',
            'plan',
            planUpgrade(ctx.root),
            '--target',
            'function:acme',
            '--mode',
            'T,F,P',
            '--repeats',
            '2',
          ],
          dir,
        );
        if (!two.out.split('\n').includes(documented))
          return fail(`running.md prints "${documented}"; campaign plan with 2 repeats gives ${shown(two)}`);
        const cells = (Number(counts[1]) / 2) * r;
        const blocks = (Number(counts[2]) / 2) * r;
        const want = `Plan: 1 spec, 1 target, modes T, F, P, ${r} repeat${r === 1 ? '' : 's'}: ${cells} cells, ${blocks} blocks.`;
        return c.code === 0 && c.out.includes(want) ? PASS : fail(`expected "${want}"; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'plan-mde-formula',
      tier: 4,
      component: 'driftbench campaign plan',
      title:
        'running.md "The minimum detectable effect": stats.mde solves the two-proportion power equation with p the --baseline-rate and specs as independent units',
      cause:
        'driftbench campaign plan prints the minimum detectable effect by the two proportion normal approximation with the --baseline-rate and the runs per arm',
      async check(ctx) {
        const dir = work(ctx, 'plan-mde');
        put(dir, 's/a.yaml', spec('a'));
        const n = 3 + ctx.seed * 2;
        const p = [0.3, 0.5, 0.8][ctx.seed % 3] ?? 0.5;
        const c = await cli(
          ['campaign', 'plan', 's', '--repeats', String(n), '--baseline-rate', String(p)],
          dir,
        );
        const effect = powerMde({ n: 1, repeats: n, baselineRate: p }).effect;
        const expected = effect === null ? 'none detectable' : `${(effect * 100).toFixed(1)} points`;
        return c.code === 0 &&
          c.out.includes(`Minimum detectable effect, mode F: ${expected}`) &&
          c.out.includes(`${n} runs per arm`)
          ? PASS
          : fail(`expected ${expected} with ${n} runs per arm; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'cell-id-is-hash-of-spec-target-mode-repeat',
      tier: 5,
      component: 'driftbench campaign plan',
      title:
        'running.md "Cells": a cell id is the first 16 hex characters of the SHA-256 of the canonical JSON of the spec hash, the target, the mode and the repeat',
      cause:
        'driftbench campaign plan derives the cell id from the canonical JSON of the spec hash, the target, the mode and the repeat only',
      async check(ctx) {
        const dir = work(ctx, 'cell-id');
        const c = await cli(
          [
            'campaign',
            'plan',
            planUpgrade(ctx.root),
            '--target',
            'function:acme',
            '--mode',
            'T,F',
            '--repeats',
            '2',
            '--json',
          ],
          dir,
        );
        const json = tryJson(c.out) as
          | {
              cells?: {
                cellId: string;
                specHash: string;
                identityHash?: string;
                target: unknown;
                mode: string;
                repeat: number;
              }[];
            }
          | undefined;
        if (!json?.cells?.length) return fail(`no cells; got ${shown(c)}`);
        const bad = json.cells.filter(
          (cell) =>
            sha256(
              JSON.stringify(
                canonical({
                  // The hash without the spec's version label; the spec hash itself for a spec with none.
                  specHash: cell.identityHash ?? cell.specHash,
                  target: cell.target,
                  mode: cell.mode,
                  repeat: cell.repeat,
                }),
              ),
            ).slice(0, 16) !== cell.cellId,
        );
        return bad.length === 0
          ? PASS
          : fail(
              `${bad.length} of ${json.cells.length} cell ids do not match the hash of their spec hash, target, mode and repeat; first ${bad[0]?.cellId}`,
            );
      },
    }),
    cl({
      id: 'cell-id-is-campaign-independent',
      tier: 3,
      level: 1,
      component: 'driftbench campaign run',
      title:
        'running.md "Cells": the campaign plays no part in a cell id, so the same cell in two campaigns has the same id, which is also its run id',
      cause: 'driftbench campaign run gives the same cellId and runId to the same cell in two campaigns',
      async check(ctx) {
        const dir = work(ctx, 'cell-same');
        put(dir, 's/a.yaml', spec('a'));
        const one = await cli(
          ['campaign', 'run', 's', '--campaign', 'first', '--store', 'x.db', '--no-cache', '--json'],
          dir,
        );
        const two = await cli(
          ['campaign', 'run', 's', '--campaign', 'second', '--store', 'x.db', '--no-cache', '--json'],
          dir,
        );
        const a = (tryJson(one.out) as { cells?: { cellId: string; runId: string }[] } | undefined)
          ?.cells?.[0];
        const b = (tryJson(two.out) as { cells?: { cellId: string; runId: string }[] } | undefined)
          ?.cells?.[0];
        return a && b && a.cellId === b.cellId && a.runId === a.cellId && b.runId === b.cellId
          ? PASS
          : fail(
              `expected equal ids with runId equal to cellId; got ${JSON.stringify(a)} and ${JSON.stringify(b)}`,
            );
      },
    }),
    cl({
      id: 'unknown-mode-message',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench campaign plan',
      title:
        'running.md "Exit codes": an unknown mode prints "Unknown mode "X". The modes are T, F and P, alone or separated by commas." and exits 2',
      cause:
        'driftbench campaign plan prints the documented unknown mode message and exits 2, also for a lower case mode',
      async check(ctx) {
        const dir = work(ctx, 'bad-mode');
        put(dir, 's/a.yaml', spec('a'));
        const a = await cli(['campaign', 'plan', 's', '--mode', 'X'], dir);
        const b = await cli(['campaign', 'plan', 's', '--mode', 'f'], dir);
        return expectAll([
          [
            a.code === 2 &&
              /Unknown mode "X"\. The modes are T, F and P, alone or separated by commas\./.test(both(a)),
            `expected the message for X; got ${shown(a)}`,
          ],
          [b.code === 2, `a lower case mode should be refused; got ${shown(b)}`],
        ]);
      },
    }),
    cl({
      id: 'budget-option-needs-a-number',
      tier: 3,
      source: 'hostile',
      component: 'driftbench campaign plan',
      title:
        'running.md "Exit codes" and cli.md: a bad number for an option is bad input, exit 2; --budget-usd takes a number of at least 0',
      cause:
        'packages/cli/src/commands/campaign.ts: parseNumber reads --budget-usd with Number(), which turns an empty string into 0; it must refuse a value that is not a number with exit 2',
      async check(ctx) {
        const dir = work(ctx, 'budget-empty');
        put(dir, 's/a.yaml', spec('a'));
        const neg = await cli(['campaign', 'plan', 's', '--budget-usd', '-1'], dir);
        const txt = await cli(['campaign', 'plan', 's', '--budget-usd', 'abc'], dir);
        const empty = await cli(['campaign', 'plan', 's', '--budget-usd', ''], dir);
        return expectAll([
          [
            neg.code === 2 && txt.code === 2,
            `negative and text values should exit 2; got ${neg.code} and ${txt.code}`,
          ],
          [empty.code === 2, `an empty value is not a number and should exit 2; got ${shown(empty)}`],
        ]);
      },
    }),
    cl({
      id: 'run-target-override-note',
      tier: 2,
      component: 'driftbench campaign run',
      title:
        'running.md "campaign run": --target prints "Note: <spec> names the process adapter; --target runs it on function:acme." for a spec whose own target is another adapter',
      cause:
        'driftbench campaign run and plan print a Note line for each spec whose own target names another adapter than --target',
      async check(ctx) {
        const dir = work(ctx, 'target-note');
        const c = await cli(
          ['campaign', 'run', acmeSpecs(ctx.root, 'tasks', 'price-sheet.yaml'), '--target', 'function:acme'],
          dir,
        );
        return /Note: acme-price-sheet names the process adapter; --target runs it on function:acme\./.test(
          c.out,
        ) && c.code === 1
          ? PASS
          : fail(`expected the Note line and exit 1; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'run-spec-without-target-refused',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench campaign run',
      title: 'running.md "From the command line": without --target a spec that names none is refused, exit 2',
      cause: 'driftbench campaign run exits 2 for a spec with no target when --target is not given',
      async check(ctx) {
        const dir = work(ctx, 'no-target');
        put(dir, 's/a.yaml', 'id: a\nblocks:\n  - user: Hello\n    expect: { must: [Acme] }\n');
        const c = await cli(['campaign', 'run', 's'], dir);
        const ok = await cli(['campaign', 'run', 's', '--target', 'function:acme'], dir);
        return expectAll([
          [c.code === 2, `a spec without a target should exit 2; got ${shown(c)}`],
          [ok.code === 0, `with --target it should run; got ${shown(ok)}`],
        ]);
      },
    }),
    cl({
      id: 'run-failing-cell-lists-verdicts',
      tier: 2,
      component: 'driftbench campaign run',
      title:
        'running.md "campaign run": a failing cell lists the gating verdicts that did not pass as "block <index> <verdict id>" and the command exits 1',
      cause:
        'driftbench campaign run prints "block <index> <verdict id>" for each failing gating verdict of a failing cell and exits 1',
      async check(ctx) {
        const dir = work(ctx, 'run-fail');
        put(
          dir,
          's/a.yaml',
          'id: a\ntarget: { adapter: function, agent: acme-sales }\nblocks:\n  - user: Hello\n    expect: { must: [Acme, zzz-never], must_not: [Telecom] }\n',
        );
        const c = await cli(['campaign', 'run', 's'], dir);
        return expectAll([
          [c.code === 1, `exit should be 1; got ${shown(c)}`],
          [
            /✗ a · function:acme-sales · F · repeat 0\s+fail\s+block 0 must\.1, block 0 must_not\.0/.test(
              c.out,
            ),
            `expected "block 0 must.1, block 0 must_not.0"; got ${shown(c)}`,
          ],
          [c.out.includes('1 cell: 0 pass, 1 fail, 0 failed.'), `expected the summary; got ${shown(c)}`],
        ]);
      },
    }),
    cl({
      id: 'run-without-store-says-runs-not-kept',
      tier: 1,
      component: 'driftbench campaign run',
      title:
        'running.md "campaign run": without --store the runs are not kept and the output says "pass --store <file> to keep them."',
      cause:
        'driftbench campaign run without --store ends with "The runs are not kept: pass --store <file> to keep them."',
      async check(ctx) {
        const dir = work(ctx, 'no-store');
        put(dir, 's/a.yaml', spec('a'));
        const c = await cli(['campaign', 'run', 's'], dir);
        const kept = await cli(['campaign', 'run', 's', '--store', 'k.db'], dir);
        return expectAll([
          [
            c.out.includes('The runs are not kept: pass --store <file> to keep them.'),
            `expected the notice; got ${shown(c)}`,
          ],
          [
            !kept.out.includes('The runs are not kept'),
            `with --store there should be no such notice; got ${shown(kept)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'budget-zero-resume-runs-cells',
      tier: 5,
      level: 1,
      component: 'driftbench campaign resume',
      title:
        'running.md "The budget": the campaign record stores a budget of 0 when none was given and resume reads a stored 0 as no budget, so cells stopped by a budget of 0 run on resume',
      cause:
        'driftbench campaign resume runs the cells that a --budget-usd 0 run stopped, because a stored budget of 0 means no budget',
      async check(ctx) {
        const dir = work(ctx, 'budget-resume');
        put(dir, 's/a.yaml', spec('a'));
        const stopped = await cli(
          ['campaign', 'run', 's', '--budget-usd', '0', '--campaign', 'cb', '--store', 'b.db'],
          dir,
        );
        const resumed = await cli(['campaign', 'resume', 'cb', '--store', 'b.db'], dir);
        return expectAll([
          [
            stopped.code === 1 && /stopped/.test(stopped.out) && /1 stopped by the budget/.test(stopped.out),
            `the budget 0 run should stop its cell, exit 1; got ${shown(stopped)}`,
          ],
          [
            resumed.code === 0 && /1 cell: 1 pass/.test(resumed.out),
            `resume should run the stopped cell; got ${shown(resumed)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'cache-replays-in-second-campaign',
      tier: 3,
      level: 1,
      component: 'driftbench campaign run',
      title:
        'running.md "The cache and replay": on the command line the store is the cache, so a second campaign over the same specs replays every run',
      cause:
        'driftbench campaign run marks the cells of a second campaign over the same specs and store as "pass (replayed from the cache)"',
      async check(ctx) {
        const dir = work(ctx, 'cache');
        put(dir, 's/a.yaml', spec('a'));
        put(dir, 's/b.yaml', spec('b'));
        await cli(['campaign', 'run', 's', '--campaign', 'one', '--store', 'c.db'], dir);
        const two = await cli(['campaign', 'run', 's', '--campaign', 'two', '--store', 'c.db'], dir);
        const three = await cli(
          ['campaign', 'run', 's', '--campaign', 'three', '--store', 'c.db', '--no-cache'],
          dir,
        );
        const replayed = (two.out.match(/replayed from the cache/g) ?? []).length;
        return expectAll([
          [
            replayed === 2,
            `both cells of the second campaign should be replayed; got ${replayed} in ${shown(two)}`,
          ],
          [
            !/replayed from the cache/.test(three.out),
            `--no-cache should replay nothing; got ${shown(three)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'no-cache-run-writes-no-cache',
      tier: 5,
      level: 1,
      component: 'driftbench campaign run',
      title: 'cli.md "Campaigns and smoke": --no-cache neither replays runs from the cache nor writes to it',
      cause:
        'driftbench campaign run --no-cache leaves the cache empty, so a later campaign without it runs the agent',
      async check(ctx) {
        const dir = work(ctx, 'nocache-write');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'one', '--store', 'c.db', '--no-cache'], dir);
        const two = await cli(['campaign', 'run', 's', '--campaign', 'two', '--store', 'c.db'], dir);
        return !/replayed from the cache/.test(two.out)
          ? PASS
          : fail(
              `the first run wrote nothing to the cache, so the second must not be replayed; got ${shown(two)}`,
            );
      },
    }),
    cl({
      id: 'resume-reuses-completed-cells',
      tier: 3,
      level: 1,
      component: 'driftbench campaign resume',
      title:
        'running.md "driftbench campaign resume": cells with a completed run are reused, shown as "pass (reused)", and the summary counts them',
      cause: 'driftbench campaign resume marks completed cells "(reused)" and ends with "N reused."',
      async check(ctx) {
        const dir = work(ctx, 'resume');
        put(dir, 's/a.yaml', spec('a'));
        put(dir, 's/b.yaml', spec('b'));
        await cli(['campaign', 'run', 's', '--campaign', 'rr', '--store', 'r.db'], dir);
        const c = await cli(['campaign', 'resume', 'rr', '--store', 'r.db'], dir);
        return c.code === 0 &&
          (c.out.match(/pass \(reused\)/g) ?? []).length === 2 &&
          /2 cells: 2 pass, 0 fail, 0 failed, 2 reused\./.test(c.out)
          ? PASS
          : fail(`expected two reused cells and the summary; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'status-without-id-takes-latest',
      tier: 2,
      level: 1,
      component: 'driftbench campaign status',
      title:
        'running.md "campaign status": without a campaign id, status and resume take the latest campaign of the store',
      cause:
        'driftbench campaign status without an id prints the most recently created campaign of the store',
      async check(ctx) {
        const dir = work(ctx, 'status-latest');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'alpha', '--store', 's.db'], dir);
        await new Promise((r) => setTimeout(r, 15));
        await cli(['campaign', 'run', 's', '--campaign', 'beta', '--store', 's.db'], dir);
        const c = await cli(['campaign', 'status', '--store', 's.db'], dir);
        return c.code === 0 && /^Campaign beta, created /m.test(c.out)
          ? PASS
          : fail(`expected the status of beta; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'status-unknown-campaign-exit-2',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench campaign status',
      title:
        'running.md "campaign status": a store that holds no campaign, and an unknown campaign id, give exit 2',
      cause: 'driftbench campaign status exits 2 for an unknown campaign and for a store without campaigns',
      async check(ctx) {
        const dir = work(ctx, 'status-unknown');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'known', '--store', 's.db'], dir);
        const a = await cli(['campaign', 'status', 'ghost', '--store', 's.db'], dir);
        const b = await cli(['campaign', 'status', '--store', 'fresh.db'], dir);
        return expectAll([
          [a.code === 2, `unknown id should exit 2; got ${shown(a)}`],
          [b.code === 2, `an empty store should exit 2; got ${shown(b)}`],
        ]);
      },
    }),
    cl({
      id: 'status-detail-empty-sections',
      tier: 3,
      level: 1,
      component: 'driftbench campaign status',
      title:
        'running.md "campaign status --detail": a campaign with no spec in both T and F prints "No spec ran in both T and F." and one with no P run prints "No perturbed run."',
      cause:
        'driftbench campaign status --detail prints the two documented empty-section sentences for an F only campaign',
      async check(ctx) {
        const dir = work(ctx, 'status-detail');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'fonly', '--store', 's.db'], dir);
        const c = await cli(['campaign', 'status', 'fonly', '--store', 's.db', '--detail'], dir);
        return c.out.includes('No spec ran in both T and F.') && c.out.includes('No perturbed run.')
          ? PASS
          : fail(`expected both sentences; got ${shown(c)}`);
      },
    }),
    cl({
      id: 'run-json-keys',
      tier: 2,
      component: 'driftbench campaign run',
      title:
        'running.md "campaign run": --json prints campaignId, stored, checks, cells (each with its state, failing list and run id) and summary',
      cause:
        'driftbench campaign run --json prints the documented keys, with stored false when no --store is given',
      async check(ctx) {
        const dir = work(ctx, 'run-json');
        put(dir, 's/a.yaml', spec('a'));
        const c = await cli(['campaign', 'run', 's', '--campaign', 'cj', '--json'], dir);
        const j = tryJson(c.out) as
          | {
              campaignId?: string;
              stored?: boolean;
              checks?: string[];
              cells?: { state?: string; failing?: unknown[]; runId?: string }[];
              summary?: unknown;
            }
          | undefined;
        return expectAll([
          [
            j?.campaignId === 'cj' && j.stored === false,
            `campaignId cj and stored false expected; got ${clip(c.out)}`,
          ],
          [
            Array.isArray(j?.checks) && j.checks.length === DOCUMENTED_CHECKS.length,
            `${DOCUMENTED_CHECKS.length} checks expected; got ${j?.checks?.length}`,
          ],
          [
            j?.cells?.[0]?.state === 'pass' &&
              Array.isArray(j.cells[0].failing) &&
              typeof j.cells[0].runId === 'string',
            'the cell lacks state, failing or runId',
          ],
          [typeof j?.summary === 'object', 'summary missing'],
        ]);
      },
    }),
    cl({
      id: 'smoke-runs-minimum-and-json',
      tier: 2,
      component: 'driftbench smoke',
      title:
        'running.md "driftbench smoke": --runs is at least 2 (exit 2 below); --json prints specId, target, runs, deterministicClaim, identical and hashes',
      cause:
        'driftbench smoke exits 2 for --runs 1 and prints the documented JSON keys with identical hashes for a deterministic agent',
      async check(ctx) {
        const dir = work(ctx, 'smoke');
        put(dir, 's/a.yaml', spec('a'));
        const one = await cli(['smoke', 's/a.yaml', '--runs', '1'], dir);
        const n = 2 + (ctx.seed % 3);
        const c = await cli(['smoke', 's/a.yaml', '--runs', String(n), '--json'], dir);
        const j = tryJson(c.out) as
          | {
              specId?: string;
              runs?: unknown[];
              deterministicClaim?: boolean;
              identical?: boolean;
              hashes?: string[];
            }
          | undefined;
        return expectAll([
          [one.code === 2, `--runs 1 should exit 2; got ${shown(one)}`],
          [
            c.code === 0 &&
              j?.specId === 'a' &&
              j.runs?.length === n &&
              j.identical === true &&
              j.deterministicClaim === true &&
              j.hashes?.length === n,
            `expected ${n} identical deterministic runs; got ${clip(c.out)}`,
          ],
        ]);
      },
    }),
    cl({
      id: 'run-order-t-f-p-within-spec',
      tier: 3,
      component: 'driftbench campaign run',
      title:
        'running.md "campaign plan": with several modes the cells come in the order running.md prints, T, F, then each P cell named by its perturbation',
      cause:
        'driftbench campaign plan lists the T cells, then the F cells, then one P cell per perturbation, naming it',
      async check(ctx) {
        const dir = work(ctx, 'mode-order');
        const c = await cli(
          [
            'campaign',
            'plan',
            planUpgrade(ctx.root),
            '--target',
            'function:acme',
            '--mode',
            'P,F,T',
            '--json',
          ],
          dir,
        );
        const j = tryJson(c.out) as { cells?: { mode: string; perturbationId?: string }[] } | undefined;
        // The order running.md prints for repeat 0: mode and perturbation of each row.
        const block = docBlock(
          ctx.root,
          'docs/running.md',
          'pnpm -s driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --repeats 2',
        );
        if (typeof block === 'string') return fail(block);
        const documented = block
          .map((line) => line.trim().split(/\s+/))
          .filter((cells) => cells[1] === 'acme-plan-upgrade' && cells[4] === '0')
          .map((cells) => (cells[3] === 'P' ? `P ${cells[5]}` : (cells[3] as string)))
          .join(', ');
        if (documented === '')
          return fail('running.md prints no repeat 0 row for plan-upgrade in modes T, F, P');
        const got = (j?.cells ?? [])
          .map((x) => (x.mode === 'P' ? `P ${x.perturbationId ?? '(none)'}` : x.mode))
          .join(', ');
        return got === documented
          ? PASS
          : fail(`running.md prints the order ${documented}; campaign plan with --mode P,F,T gives ${got}`);
      },
    }),
    cl({
      id: 'process-target-runs-ops-agent',
      tier: 3,
      component: 'driftbench campaign run',
      title:
        'running.md "campaign run": the Acme price-sheet task passes on its own target, the process adapter acme-ops',
      cause: 'driftbench campaign run runs the price-sheet task on process:acme-ops and passes',
      async check(ctx) {
        const dir = work(ctx, 'process');
        const c = await cli(['campaign', 'run', acmeSpecs(ctx.root, 'tasks', 'price-sheet.yaml')], dir);
        return c.code === 0 &&
          /✓ acme-price-sheet · process:acme-ops · F · repeat 0\s+pass\s+2 blocks/.test(c.out)
          ? PASS
          : fail(`expected a passing cell on process:acme-ops; got ${shown(c)}`);
      },
    }),
  );
  return items;
}

// ---------------------------------------------------------------------------------------------------
// Family breaker-spec: docs/reference/spec.md and the issue codes of docs/reference/cli.md
// ---------------------------------------------------------------------------------------------------

const sp = family('breaker-spec', 'spec', 10);

type Rule = {
  slug: string;
  tier: Tier;
  page: string;
  claim: string;
  yaml: string;
  code?: string;
  at?: string;
  valid?: boolean;
  source?: ItemSource;
};

function ruleItem(r: Rule): BankItem {
  const expectation = r.valid ? 'accepted as valid' : `refused with ${r.code}`;
  return sp({
    id: r.slug,
    tier: r.tier,
    component: 'driftbench spec validate',
    source: r.source ?? (r.valid ? 'contract' : 'adversarial'),
    title: `${r.page}: ${r.claim}`,
    cause: r.valid
      ? `driftbench spec validate accepts ${r.slug.replace(/-/g, ' ')}`
      : `driftbench spec validate reports ${r.code} for ${r.slug.replace(/-/g, ' ')} and exits 1`,
    async check(ctx) {
      const dir = work(ctx, `rule-${r.slug}`);
      put(dir, 'x.yaml', r.yaml.replaceAll('@ID@', `r${ctx.seed}`));
      const c = await cli(['spec', 'validate', 'x.yaml', '--json'], dir);
      const row = (tryJson(c.out) as ValidateRow[] | undefined)?.[0];
      if (!row) return fail(`no JSON row; got ${shown(c)}`);
      if (r.valid)
        return row.ok && c.code === 0
          ? PASS
          : fail(`expected the spec ${expectation}; got ${clip(JSON.stringify(row.errors))} (${shown(c)})`);
      const hit = (row.errors ?? []).find(
        (e) =>
          (r.code?.endsWith('*') ? e.code.startsWith(r.code.slice(0, -1)) : e.code === r.code) &&
          (!r.at || e.path === r.at),
      );
      return !row.ok && c.code === 1 && hit
        ? PASS
        : fail(
            `expected the spec ${expectation}${r.at ? ` at ${r.at}` : ''} with exit 1; got exit ${c.code} and errors ${clip(JSON.stringify((row.errors ?? []).map((e) => `${e.path} ${e.code}`)))}`,
          );
    },
  });
}

function specItems(): BankItem[] {
  const hdr = 'id: @ID@\n';
  const blk = (expect: string, stimulus = 'user: hello'): string =>
    `blocks:\n  - ${stimulus}\n    expect: ${expect}\n`;
  const CI = 'cli.md "Issue codes"';
  const SR = 'spec.md';
  const rules: Rule[] = [
    {
      slug: 'not-object-top-level-list',
      tier: 1,
      page: `${CI} SPEC_NOT_OBJECT`,
      claim: 'a file that does not hold one mapping at the top level is refused',
      yaml: '- a\n- b\n',
      code: 'SPEC_NOT_OBJECT',
    },
    {
      slug: 'alias-conflict-ledger-seed',
      tier: 2,
      page: `${CI} SPEC_ALIAS_CONFLICT`,
      claim: 'ledger_seed together with given.ledger is refused',
      yaml: `${hdr}ledger_seed: { a: 1 }\ngiven: { ledger: { b: 2 } }\n${blk('{ must: [x] }')}`,
      code: 'SPEC_ALIAS_CONFLICT',
    },
    {
      slug: 'alias-conflict-workspace-seed',
      tier: 2,
      page: `${CI} SPEC_ALIAS_CONFLICT`,
      claim: 'workspace_seed together with given.world.workspace is refused',
      yaml: `${hdr}workspace_seed: seeds/a\ngiven: { world: { workspace: { from: seeds/b } } }\n${blk('{ must: [x] }')}`,
      code: 'SPEC_ALIAS_CONFLICT',
    },
    {
      slug: 'stimulus-ambiguous-user-and-burst',
      tier: 1,
      page: `${CI} BLOCK_STIMULUS_AMBIGUOUS`,
      claim: 'a block with both user and burst is refused',
      yaml: `${hdr}blocks:\n  - user: hi\n    burst: [a, b]\n    expect: { must: [x] }\n`,
      code: 'BLOCK_STIMULUS_AMBIGUOUS',
      at: 'blocks.0',
    },
    {
      slug: 'stimulus-missing',
      tier: 1,
      page: `${CI} BLOCK_STIMULUS_MISSING`,
      claim: 'a block with none of user, burst and when is refused',
      yaml: `${hdr}blocks:\n  - expect: { must: [x] }\n`,
      code: 'BLOCK_STIMULUS_MISSING',
      at: 'blocks.0',
    },
    {
      slug: 'regex-invalid-in-must-not',
      tier: 1,
      page: `${CI} REGEX_INVALID`,
      claim: 'a pattern in must_not that does not compile is refused',
      yaml: `${hdr}${blk("{ must_not: ['['] }")}`,
      code: 'REGEX_INVALID',
      at: 'blocks.0.expect.must_not.0',
    },
    {
      slug: 'regex-invalid-in-input-assertion',
      tier: 2,
      page: `${CI} REGEX_INVALID`,
      claim: 'a regex assertion on a tool input that does not compile is refused',
      yaml: `${hdr}${blk("{ tools: [{ label: t, input: { a: { regex: '(' } } }] }")}`,
      code: 'REGEX_INVALID',
    },
    {
      slug: 'criterion-ref-invalid',
      tier: 2,
      page: `${CI} CRITERION_REF_INVALID`,
      claim: 'a criterion reference that is not a name, optionally followed by @gating, is refused',
      yaml: `${hdr}criteria:\n  - { name: kind, rubric: Is it kind }\n${blk("{ criteria: ['kind@maybe'] }")}`,
      code: 'CRITERION_REF_INVALID',
    },
    {
      slug: 'criterion-undefined',
      tier: 1,
      page: `${CI} CRITERION_UNDEFINED`,
      claim: 'when the spec defines criteria, a block that names another one is refused',
      yaml: `${hdr}criteria:\n  - { name: kind, rubric: Is it kind }\n${blk('{ criteria: [rude] }')}`,
      code: 'CRITERION_UNDEFINED',
      at: 'blocks.0.expect.criteria.0',
    },
    {
      slug: 'criterion-duplicate',
      tier: 2,
      page: `${CI} CRITERION_DUPLICATE`,
      claim: 'two criteria that share a name are refused',
      yaml: `${hdr}criteria:\n  - { name: kind, rubric: Is it kind }\n  - { name: kind, rubric: Is it really kind }\n${blk('{ must: [x] }')}`,
      code: 'CRITERION_DUPLICATE',
    },
    {
      slug: 'perturbation-out-of-range',
      tier: 2,
      page: `${CI} PERTURBATION_OUT_OF_RANGE`,
      claim: 'inject_at past the last position is refused',
      yaml: `${hdr}${blk('{ must: [x] }')}perturbations:\n  - { id: p, class: D1_off_topic, inject_at: 9, user: hi }\n`,
      code: 'PERTURBATION_OUT_OF_RANGE',
    },
    {
      slug: 'perturbation-empty',
      tier: 2,
      page: `${CI} PERTURBATION_EMPTY`,
      claim: 'a perturbation with none of user, burst and world is refused',
      yaml: `${hdr}${blk('{ must: [x] }')}perturbations:\n  - { id: p, class: D1_off_topic, inject_at: 0 }\n`,
      code: 'PERTURBATION_EMPTY',
    },
    {
      slug: 'duplicate-block-id',
      tier: 1,
      page: `${CI} DUPLICATE_BLOCK_ID`,
      claim: 'two blocks that share an id are refused',
      yaml: `${hdr}blocks:\n  - { id: b, user: one, expect: { must: [x] } }\n  - { id: b, user: two, expect: { must: [x] } }\n`,
      code: 'DUPLICATE_BLOCK_ID',
    },
    {
      slug: 'duplicate-perturbation-id',
      tier: 2,
      page: `${CI} DUPLICATE_PERTURBATION_ID`,
      claim: 'two perturbations that share an id are refused',
      yaml: `${hdr}${blk('{ must: [x] }')}perturbations:\n  - { id: p, class: D1_off_topic, inject_at: 0, user: a }\n  - { id: p, class: D1_off_topic, inject_at: 0, user: b }\n`,
      code: 'DUPLICATE_PERTURBATION_ID',
    },
    {
      slug: 'tool-count-zero-with-input',
      tier: 2,
      page: `${CI} TOOL_COUNT_CONTRADICTION`,
      claim: 'a tool expected 0 times that has input assertions is refused',
      yaml: `${hdr}${blk('{ tools: [{ label: t, count: 0, input: { a: 1 } }] }')}`,
      code: 'TOOL_COUNT_CONTRADICTION',
    },
    {
      slug: 'count-range-min-above-max',
      tier: 1,
      page: `${CI} COUNT_RANGE_INVALID`,
      claim: 'a count with a min greater than its max is refused',
      yaml: `${hdr}${blk('{ tools: [{ label: t, count: { min: 3, max: 1 } }] }')}`,
      code: 'COUNT_RANGE_INVALID',
    },
    {
      slug: 'must-conflict',
      tier: 1,
      page: `${CI} MUST_CONFLICT`,
      claim: 'the same pattern in must and must_not is refused',
      yaml: `${hdr}${blk('{ must: [same], must_not: [same] }')}`,
      code: 'MUST_CONFLICT',
    },
    {
      slug: 'stage-unknown-in-expect',
      tier: 1,
      page: `${CI} STAGE_UNKNOWN`,
      claim: 'expect.stage that is not in the spec stages is refused',
      yaml: `${hdr}stages: [a, b]\n${blk('{ stage: c }')}`,
      code: 'STAGE_UNKNOWN',
      at: 'blocks.0.expect.stage',
    },
    {
      slug: 'stage-unknown-in-recovery',
      tier: 3,
      page: `${CI} STAGE_UNKNOWN`,
      claim: 'recovery.stage_after that is not in the spec stages is refused',
      yaml: `${hdr}stages: [a, b]\n${blk('{ stage: a }')}perturbations:\n  - { id: p, class: D1_off_topic, inject_at: 0, user: hi, recovery: { within_blocks: 1, stage_after: zzz } }\n`,
      code: 'STAGE_UNKNOWN',
    },
    {
      slug: 'retention-fact-unknown',
      tier: 2,
      page: `${CI} RETENTION_FACT_UNKNOWN`,
      claim: 'knowledge_retention that names a fact no ledger holds before the block is refused',
      yaml: `${hdr}${blk('{ knowledge_retention: [{ fact: email }] }')}`,
      code: 'RETENTION_FACT_UNKNOWN',
    },
    {
      slug: 'retention-fact-known-from-earlier-ledger-add',
      tier: 3,
      page: `${CI} RETENTION_FACT_UNKNOWN`,
      claim: 'a fact added by an earlier block ledger_add is known to a later block',
      yaml: `${hdr}blocks:\n  - { user: one, expect: { ledger_add: { email: a } } }\n  - { user: two, expect: { knowledge_retention: [{ fact: email }] } }\n`,
      valid: true,
    },
    {
      slug: 'tool-forbidden-expected',
      tier: 2,
      page: `${CI} TOOL_FORBIDDEN_EXPECTED`,
      claim: 'a block that expects a tool in rules.forbidden_tools is refused',
      yaml: `${hdr}rules: { forbidden_tools: [t] }\n${blk('{ tools: [{ label: t }] }')}`,
      code: 'TOOL_FORBIDDEN_EXPECTED',
    },
    {
      slug: 'tool-forbidden-by-max-calls-zero',
      tier: 3,
      page: `${CI} TOOL_FORBIDDEN_EXPECTED`,
      claim: 'a block that expects a tool whose rules.max_calls is 0 is refused',
      yaml: `${hdr}rules: { max_calls: { t: 0 } }\n${blk('{ tools: [{ label: t }] }')}`,
      code: 'TOOL_FORBIDDEN_EXPECTED',
    },
    {
      slug: 'unknown-top-level-key',
      tier: 1,
      page: `${SR} intro`,
      claim: 'keys are snake_case and an unknown key is an error',
      yaml: `${hdr}mystery: 1\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_UNRECOGNIZED_KEYS',
    },
    {
      slug: 'camel-case-key-refused',
      tier: 2,
      page: `${SR} intro`,
      claim: 'a camelCase key such as mustNot is an unknown key',
      yaml: `${hdr}${blk('{ mustNot: [x] }')}`,
      code: 'SCHEMA_UNRECOGNIZED_KEYS',
    },
    {
      slug: 'id-must-start-with-letter-or-digit',
      tier: 2,
      page: `${SR} Spec`,
      claim: 'the id matches ^[A-Za-z0-9][A-Za-z0-9._-]*$, so a leading hyphen is refused',
      yaml: `id: -bad\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'id-refuses-spaces',
      tier: 1,
      page: `${SR} Spec`,
      claim: 'the id allows letters, digits, dots, underscores and hyphens only, so a space is refused',
      yaml: `id: has space\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'lang-too-short',
      tier: 2,
      page: `${SR} Spec`,
      claim: 'lang is 2 to 8 characters, so one character is refused',
      yaml: `${hdr}lang: e\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'lang-too-long',
      tier: 2,
      page: `${SR} Spec`,
      claim: 'lang is 2 to 8 characters, so nine characters are refused',
      yaml: `${hdr}lang: abcdefghi\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'blocks-need-one-item',
      tier: 1,
      page: `${SR} Spec`,
      claim: 'blocks has at least 1 item',
      yaml: `${hdr}blocks: []\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'burst-needs-two-messages',
      tier: 2,
      page: `${SR} Stimulus`,
      claim: 'a burst is a list of strings with at least 2 items',
      yaml: `${hdr}blocks:\n  - burst: [only one]\n    expect: { must: [x] }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'count-negative-refused',
      tier: 2,
      page: `${SR} Count`,
      claim: 'a count is an integer of at least 0',
      yaml: `${hdr}${blk('{ tools: [{ label: t, count: -1 }] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'similarity-min-above-one',
      tier: 2,
      page: `${SR} SimilarityExpect`,
      claim: 'min is a number from 0 to 1',
      yaml: `${hdr}${blk('{ similarity: [{ reference: text, min: 1.5 }] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'relevancy-min-above-one',
      tier: 2,
      page: `${SR} RelevancyExpect`,
      claim: 'min is a number from 0 to 1',
      yaml: `${hdr}${blk('{ relevancy: { min: 1.5 } }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'tool-order-unknown-value',
      tier: 2,
      page: `${SR} Expect`,
      claim: 'tool_order is one of exact, in_order or any_order',
      yaml: `${hdr}${blk('{ tool_order: random }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'end-state-string-other-than-none',
      tier: 2,
      page: `${SR} EndState`,
      claim: 'end_state is none, a mapping or a list of mappings',
      yaml: `${hdr}${blk('{ must: [x] }')}end_state: nothing\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'end-state-mode-loose',
      tier: 2,
      page: `${SR} EndStateSpec`,
      claim: 'mode is subset or exact',
      yaml: `${hdr}${blk('{ must: [x] }')}end_state: { source: tool:t, mode: loose, expect: { a: 1 } }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'kind-unknown-value',
      tier: 1,
      page: `${SR} Spec`,
      claim: 'kind is conversation or task',
      yaml: `${hdr}kind: dialogue\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'deviation-class-unknown',
      tier: 2,
      page: `${SR} DeviationClass`,
      claim: 'the deviation classes are the ten D1 to D10 values',
      yaml: `${hdr}${blk('{ must: [x] }')}perturbations:\n  - { id: p, class: D11_new, inject_at: 0, user: hi }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'assertion-with-two-keys',
      tier: 3,
      page: `${SR} Assertion`,
      claim: 'an assertion mapping holds exactly one of its keys',
      yaml: `${hdr}${blk('{ tools: [{ label: t, input: { a: { contains: x, regex: y } } }] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'injection-needs-user',
      tier: 2,
      page: `${SR} Stimulus injection`,
      claim: 'an injection has a class and a user message, both required',
      yaml: `${hdr}blocks:\n  - when: { injection: { class: D1_off_topic } }\n    expect: { must: [x] }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'inject-at-negative',
      tier: 2,
      page: `${SR} Perturbation`,
      claim: 'inject_at is an integer of at least 0',
      yaml: `${hdr}${blk('{ must: [x] }')}perturbations:\n  - { id: p, class: D1_off_topic, inject_at: -1, user: hi }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'budget-steps-zero',
      tier: 2,
      page: `${SR} Budget`,
      claim: 'steps is an integer of at least 1',
      yaml: `${hdr}blocks:\n  - user: hi\n    budget: { steps: 0 }\n    expect: { must: [x] }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'budget-cost-negative',
      tier: 2,
      page: `${SR} Budget`,
      claim: 'cost_usd is a number of at least 0',
      yaml: `${hdr}blocks:\n  - user: hi\n    budget: { cost_usd: -1 }\n    expect: { must: [x] }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'empty-stage-name',
      tier: 2,
      page: `${SR} Spec`,
      claim: 'stages holds strings that are each not empty',
      yaml: `${hdr}stages: ['a', '']\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'criterion-name-with-space',
      tier: 2,
      page: `${SR} CriterionDef`,
      claim: 'a criterion name matches ^[A-Za-z0-9][A-Za-z0-9_.-]*$',
      yaml: `${hdr}criteria:\n  - { name: 'not kind', rubric: Is it kind }\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'judge-class-unknown',
      tier: 2,
      page: `${SR} CriterionDef`,
      claim: 'judge_class is system1, system2 or auto',
      yaml: `${hdr}criteria:\n  - { name: kind, rubric: Is it kind, judge_class: system3 }\n${blk('{ must: [x] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'prefix-role-unknown',
      tier: 2,
      page: `${SR} Message`,
      claim: 'a prefix message role is user, assistant, system or tool',
      yaml: `${hdr}blocks:\n  - user: hi\n    given: { prefix: [{ role: robot, content: beep }] }\n    expect: { must: [x] }\n`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'artifact-kind-unknown',
      tier: 2,
      page: `${SR} ArtifactExpect`,
      claim: 'kind is one of xlsx, docx, pptx, pdf, csv, json, text or code',
      yaml: `${hdr}${blk('{ artifacts: [{ path: a.zip, kind: zip }] }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'safety-ops-negative',
      tier: 2,
      page: `${SR} SafetyExpect`,
      claim: 'max_destructive_ops is an integer of at least 0',
      yaml: `${hdr}${blk('{ safety: { max_destructive_ops: -1 } }')}`,
      code: 'SCHEMA_*',
    },
    {
      slug: 'accepts-null-and-all-assertion-forms',
      tier: 3,
      page: `${SR} Assertion`,
      claim:
        'a bare null, exact, regex, contains, one_of, nonempty, absent and subset are all valid assertions',
      yaml: `${hdr}${blk("{ tools: [{ label: t, input: { a: null, b: { exact: [1] }, c: { regex: '^x' }, d: { contains: y }, e: { one_of: [1, 2] }, f: { nonempty: true }, g: { absent: true }, h: { subset: { k: 1 } } } }] }")}`,
      valid: true,
    },
    {
      slug: 'accepts-task-kind-and-end-state-none',
      tier: 2,
      page: `${SR} Spec and EndState`,
      claim: 'kind task and end_state none are valid',
      yaml: `${hdr}kind: task\n${blk('{ must: [x] }')}end_state: none\n`,
      valid: true,
    },
    {
      slug: 'accepts-shorthand-forms',
      tier: 3,
      page: `${SR} Shorthand`,
      claim: 'ledger_seed, a workspace_seed string, user and burst shorthand are valid',
      yaml: `${hdr}ledger_seed: { a: 1 }\nworkspace_seed: seeds/a\nblocks:\n  - user: one\n    expect: { must: [x] }\n  - burst: [two, three]\n    expect: { must: [x] }\n`,
      valid: true,
    },
    {
      slug: 'accepts-free-metadata-and-tags',
      tier: 1,
      page: `${SR} Spec`,
      claim: 'metadata is a free map and tags and covers are free lists of strings',
      yaml: `${hdr}tags: [a, b]\ncovers: [anything-at-all]\nmetadata: { any: { nested: [1, 2] } }\n${blk('{ must: [x] }')}`,
      valid: true,
    },
  ];
  return rules.map(ruleItem);
}

// ---------------------------------------------------------------------------------------------------
// Family breaker-checks: docs/reference/checks.md, read through `driftbench replay` over written sessions
// ---------------------------------------------------------------------------------------------------

const ck = family('breaker-checks', 'checks', 3);

type Tool = {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  error?: boolean;
  extra?: Record<string, unknown>;
};
type Turn = { user: string; text?: string[]; tools?: Tool[] };

/** A recorded session in the Claude Code transcript format, one JSON record per line. */
function sessionText(name: string, turns: Turn[]): string {
  const lines: string[] = [];
  let n = 0;
  let t = Date.parse('2026-01-01T09:00:00.000Z');
  let prev: string | null = null;
  let mid = 0;
  const base = {
    isSidechain: false,
    userType: 'external',
    cwd: '/work/x',
    sessionId: '00000000-0000-4000-8000-000000000099',
    version: '2.0.0',
  };
  const push = (o: Record<string, unknown>): void => {
    const uuid = `${name}-${++n}`;
    t += 2000;
    lines.push(
      JSON.stringify({ parentUuid: prev, ...base, uuid, timestamp: new Date(t).toISOString(), ...o }),
    );
    prev = uuid;
  };
  const assistant = (content: unknown[]): void =>
    push({
      type: 'assistant',
      message: {
        id: `m${++mid}`,
        type: 'message',
        role: 'assistant',
        model: 'm',
        content,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
  for (const turn of turns) {
    push({ type: 'user', message: { role: 'user', content: turn.user } });
    for (const tx of turn.text ?? []) assistant([{ type: 'text', text: tx }]);
    let k = 0;
    for (const tool of turn.tools ?? []) {
      const id = `tu_${name}_${++k}_${n}`;
      assistant([{ type: 'tool_use', id, name: tool.name, input: tool.input }]);
      push({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: id,
              type: 'tool_result',
              content: tool.result ?? 'ok',
              ...(tool.error ? { is_error: true } : {}),
            },
          ],
        },
        ...(tool.extra ? { toolUseResult: tool.extra } : {}),
      });
    }
  }
  return `${lines.join('\n')}\n`;
}

async function replayFailing(
  ctx: ItemContext,
  slug: string,
  turns: Turn[],
  specBody: string,
): Promise<{ code: number; failing: string[]; raw: Cli }> {
  const dir = work(ctx, `chk-${slug}`);
  put(dir, 'sessions/one.jsonl', sessionText('one', turns));
  put(
    dir,
    'suite/x.yaml',
    `id: x\nkind: conversation\ntarget: { adapter: claude-code }\nmetadata:\n  replay: { session: one }\n${specBody}`,
  );
  const raw = await cli(['replay', 'sessions/one.jsonl', '--suite', 'suite', '--json'], dir);
  const json = tryJson(raw.out) as { runs?: { failing?: string[] }[] } | undefined;
  return { code: raw.code, failing: json?.runs?.[0]?.failing ?? ['<no run reported>'], raw };
}

type CheckCase = {
  slug: string;
  tier: Tier;
  claim: string;
  turns: Turn[];
  spec: string;
  failing: string[];
  page?: string;
};

function checkItem(c: CheckCase): BankItem {
  return ck({
    id: c.slug,
    tier: c.tier,
    component: `docs/reference/checks.md ${c.page ?? ''}`.trim(),
    title: `checks.md ${c.page ?? ''}: ${c.claim}`.replace('  ', ' '),
    cause:
      c.failing.length === 0
        ? `the check named in "${c.slug.replace(/-/g, ' ')}" lets the block pass`
        : `the check named in "${c.slug.replace(/-/g, ' ')}" fails the block with ${c.failing.join(' and ')}`,
    async check(ctx) {
      const r = await replayFailing(ctx, c.slug, c.turns, c.spec);
      const same = r.failing.length === c.failing.length && c.failing.every((f) => r.failing.includes(f));
      return same && r.code === (c.failing.length ? 1 : 0)
        ? PASS
        : fail(
            `expected failing [${c.failing.join('; ')}] with exit ${c.failing.length ? 1 : 0}; got [${r.failing.join('; ')}] with exit ${r.code}`,
          );
    },
  });
}

const one = (text: string[], tools: Tool[] = [], user = 'hi'): Turn => ({ user, text, tools });
const spc = (expect: string, extra = '', stim = 'user: hi'): string =>
  `${extra}blocks:\n  - ${stim}\n    expect: ${expect}\n`;
const EN = 'This is a perfectly ordinary English sentence about telecom plans and prices for customers.';
const FR =
  "Ceci est une phrase française tout à fait ordinaire sur les forfaits et les prix pour les clients de l'entreprise.";
const call = (name: string, input: Record<string, unknown> = {}, extra: Partial<Tool> = {}): Tool => ({
  name,
  input,
  ...extra,
});
const created = (path: string): Tool => ({
  name: 'Write',
  input: { file_path: `/work/x/${path}`, content: 'x' },
  result: 'created',
  extra: { type: 'create', filePath: `/work/x/${path}` },
});

/** An IBAN-shaped value whose check digits are right (valid) or off by one (invalid). */
function iban(seed: number, valid: boolean): string {
  // Folded seeds reach 9999: keep the account block at four digits so the BBAN stays Belgian (12 digits).
  const bban = `5390 0754 ${String(7000 + (seed % 1000)).padStart(4, '0')}`.replace(/\s/g, '');
  const rearranged = `${bban}111400`;
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  const check = 98 - rem;
  const digits = String(valid ? check : check === 98 ? 2 : check + 1).padStart(2, '0');
  const flat = `BE${digits}${bban}`;
  return flat.replace(/(.{4})/g, '$1 ').trim();
}

function checkItems(): BankItem[] {
  const cases: CheckCase[] = [
    {
      slug: 'must-second-pattern-index-1',
      tier: 1,
      page: 'Every check and its verdict ids',
      claim: 'must patterns count from 0, so the second failing pattern is must.1',
      turns: [one(['Hello from Acme Telecom'])],
      spec: spc("{ must: ['Acme', 'zzz-absent'] }"),
      failing: ['block 0: must.1'],
    },
    {
      slug: 'must-not-hit-is-must-not-0',
      tier: 1,
      page: 'Text and language',
      claim: 'a must_not pattern that matches the visible text fails as must_not.0',
      turns: [one(['Hello from Acme Telecom'])],
      spec: spc("{ must_not: ['Telecom'] }"),
      failing: ['block 0: must_not.0'],
    },
    {
      slug: 'must-uses-multiline-flag',
      tier: 2,
      page: 'Assertions on values',
      claim: 'patterns compile with the m flag, so ^ matches at the start of a later line',
      turns: [one(['Intro line\nDone: it works'])],
      spec: spc("{ must: ['^Done'] }"),
      failing: [],
    },
    {
      slug: 'must-spans-text-segments',
      tier: 3,
      page: 'Text and language',
      claim: 'a pattern may span segments of the visible text',
      turns: [one(['alpha-one', 'beta-two'])],
      spec: spc("{ must: ['alpha-one\\s+beta-two'] }"),
      failing: [],
    },
    {
      slug: 'must-ignores-tool-output',
      tier: 3,
      page: 'Text and language',
      claim:
        'must reads the customer-visible text only, so a token present only in a tool result is not found',
      turns: [one(['ok'], [call('Bash', { command: 'ls' }, { result: 'secret-token-9' })])],
      spec: spc("{ must: ['secret-token-9'] }"),
      failing: ['block 0: must.0'],
    },
    {
      slug: 'must-not-ignores-tool-input',
      tier: 3,
      page: 'Text and language',
      claim: 'must_not reads the visible text only, so a word in a tool input does not trip it',
      turns: [one(['ok'], [call('Bash', { command: 'echo forbidden-word' })])],
      spec: spc("{ must_not: ['forbidden-word'] }"),
      failing: [],
    },
    {
      slug: 'lang-expected-mismatch',
      tier: 2,
      page: 'Text and language',
      claim: 'lang fails when the reply reads as another language',
      turns: [one([EN])],
      spec: spc('{ lang: FR }'),
      failing: ['block 0: lang.expected'],
    },
    {
      slug: 'lang-short-text-is-inconclusive',
      tier: 3,
      page: 'Verdicts',
      claim: 'a reply under 30 letters is too short to judge, and an inconclusive lang verdict does not gate',
      turns: [one(['Done. Thanks.'])],
      spec: spc('{ lang: FR }'),
      failing: [],
    },
    {
      slug: 'lang-stable-switch-fails',
      tier: 3,
      page: 'Text and language',
      claim: 'lang_stable fails the block where the reply language changes from the one the run settled on',
      turns: [one([EN]), one([FR], [], 'two')],
      spec: `rules: { lang_stable: true }\nblocks:\n  - user: hi\n    expect: { must: [English] }\n  - user: two\n    expect: { must: [phrase] }\n`,
      failing: ['block 1: lang.stable'],
    },
    {
      slug: 'forbidden-tool-called',
      tier: 1,
      page: 'Rules on tools',
      claim: 'a tool in rules.forbidden_tools that is called fails as forbidden.<tool>',
      turns: [one(['ok'], [call('Bash', { command: 'ls' })])],
      spec: `rules: { forbidden_tools: [Bash] }\n${spc('{ must: [ok] }')}`,
      failing: ['block 0: forbidden.Bash'],
    },
    {
      slug: 'max-calls-excess-reported-once',
      tier: 4,
      page: 'Rules on tools',
      claim:
        'max_calls caps calls across the run and a block fails the cap only when its own calls go past it, so one excess is reported once',
      turns: [
        one(['a'], [call('Bash', { command: 'x' })]),
        one(['b'], [call('Bash', { command: 'y' })], 'two'),
        one(['c'], [], 'three'),
      ],
      spec: `rules: { max_calls: { Bash: 1 } }\nblocks:\n  - { user: hi, expect: { must: [a] } }\n  - { user: two, expect: { must: [b] } }\n  - { user: three, expect: { must: [c] } }\n`,
      failing: ['block 1: forbidden.max_calls.Bash'],
    },
    {
      slug: 'tool-count-exact-mismatch',
      tier: 1,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'a tool expected twice that ran once fails as tools.<label>.count',
      turns: [one(['ok'], [call('Read', { file_path: '/a' })])],
      spec: spc('{ tools: [{ label: Read, count: 2 }] }'),
      failing: ['block 0: tools.Read.count'],
    },
    {
      slug: 'tool-without-count-needs-one-call',
      tier: 2,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'without count, the tool must run at least once',
      turns: [one(['ok'], [call('Read', { file_path: '/a' }), call('Read', { file_path: '/b' })])],
      spec: spc('{ tools: [{ label: Read }] }'),
      failing: [],
    },
    {
      slug: 'tool-duplicate-label-gets-suffix',
      tier: 3,
      page: 'Verdicts',
      claim: 'when a block expects the same name twice the second entry gets #2 in its id',
      turns: [one(['ok'], [call('Read', { file_path: '/a' })])],
      spec: spc('{ tools: [{ label: Read, count: 1 }, { label: Read, count: 2 }] }'),
      failing: ['block 0: tools.Read#2.count'],
    },
    {
      slug: 'tool-count-zero-reported-by-forbidden',
      tier: 3,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'count 0 is reported by the forbidden check and not by tools, so it is never reported twice',
      turns: [one(['ok'], [call('Edit', { file_path: '/a' })])],
      spec: spc('{ tools: [{ label: Edit, count: 0 }] }'),
      failing: ['block 0: forbidden.Edit'],
    },
    {
      slug: 'tool-input-checked-on-every-call',
      tier: 3,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'input maps argument names to assertions and every call of the tool must hold each one',
      turns: [
        one(['ok'], [call('Read', { file_path: '/src/a.ts' }), call('Read', { file_path: '/other/b.ts' })]),
      ],
      spec: spc("{ tools: [{ label: Read, input: { file_path: { regex: '^/src/' } } }] }"),
      failing: ['block 0: tools.Read.input.file_path'],
    },
    {
      slug: 'tool-input-absent-assertion',
      tier: 3,
      page: 'Assertions on values',
      claim: '{ absent: true } passes when the argument is not given',
      turns: [one(['ok'], [call('Read', { file_path: '/a' })])],
      spec: spc('{ tools: [{ label: Read, input: { limit: { absent: true } } }] }'),
      failing: [],
    },
    {
      slug: 'tool-input-nonempty-spaces-only',
      tier: 4,
      page: 'Assertions on values',
      claim: '{ nonempty: true } fails for a string of spaces only',
      turns: [one(['ok'], [call('Read', { file_path: '   ' })])],
      spec: spc('{ tools: [{ label: Read, input: { file_path: { nonempty: true } } }] }'),
      failing: ['block 0: tools.Read.input.file_path'],
    },
    {
      slug: 'tool-input-contains-on-list',
      tier: 4,
      page: 'Assertions on values',
      claim: '{ contains: text } passes for a list that holds the text as an item',
      turns: [one(['ok'], [call('Read', { tags: ['red', 'blue'] })])],
      spec: spc('{ tools: [{ label: Read, input: { tags: { contains: blue } } }] }'),
      failing: [],
    },
    {
      slug: 'tool-input-subset-nested',
      tier: 4,
      page: 'Assertions on values',
      claim:
        '{ subset } holds when the value has at least these keys, nested mappings comparing the same way',
      turns: [one(['ok'], [call('Read', { opts: { a: 1, b: { c: 2, d: 3 } } })])],
      spec: spc('{ tools: [{ label: Read, input: { opts: { subset: { b: { c: 2 } } } } }] }'),
      failing: [],
    },
    {
      slug: 'tool-order-exact-no-leftover',
      tier: 4,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'tool_order exact allows no call left over, while in_order lets other calls sit between',
      turns: [one(['ok'], [call('A'), call('B'), call('C')])],
      spec: spc('{ tools: [{ label: A }, { label: C }], tool_order: exact }'),
      failing: ['block 0: tools.order'],
    },
    {
      slug: 'tool-order-in-order-wrong-sequence',
      tier: 3,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'in_order fails when the expected calls appear in another order, any_order passes',
      turns: [one(['ok'], [call('B'), call('A')])],
      spec: spc('{ tools: [{ label: A }, { label: B }], tool_order: in_order }'),
      failing: ['block 0: tools.order'],
    },
    {
      slug: 'skills-count',
      tier: 2,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'skills counts the skills loaded in the block by name and count',
      turns: [one(['ok'], [call('Skill', { skill: 'alpha' })])],
      spec: spc('{ skills: [{ name: alpha, count: 2 }] }'),
      failing: ['block 0: skills.alpha'],
    },
    {
      slug: 'subagent-model-is-part-of-the-id',
      tier: 3,
      page: 'Tools, skills, guards, references and subagents',
      claim:
        'a helper entry with a model gets the id subagents.<name>.<model> and fails when the model differs',
      turns: [one(['ok'], [call('Agent', { subagent_type: 'reviewer', model: 'haiku', prompt: 'x' })])],
      spec: spc('{ subagents: [{ name: reviewer, model: sonnet }] }'),
      failing: ['block 0: subagents.reviewer.sonnet'],
    },
    {
      slug: 'references-star-stays-in-folder',
      tier: 4,
      page: 'Tools, skills, guards, references and subagents',
      claim: 'in a glob * matches within one folder and ** across folders',
      turns: [one(['ok'], [call('Read', { file_path: '/work/x/skills/xlsx/ref/a.md' })])],
      spec: spc("{ references: [{ path: '**/skills/xlsx/*.md' }] }"),
      failing: ['block 0: references.**/skills/xlsx/*.md'],
    },
    {
      slug: 'execution-ran-code-false-with-command',
      tier: 2,
      page: 'Code, files and workspace',
      claim: 'ran_code false forbids any command',
      turns: [one(['ok'], [call('Bash', { command: 'ls' })])],
      spec: spc('{ execution: { ran_code: false } }'),
      failing: ['block 0: execution.ran_code'],
    },
    {
      slug: 'execution-exit-code-from-error-result',
      tier: 4,
      page: 'Code, files and workspace',
      claim: 'exit_code reads the last command, and a result that starts with "Exit code N" gives N',
      turns: [
        one(['ok'], [call('Bash', { command: 'false' }, { result: 'Exit code 3\nboom', error: true })]),
      ],
      spec: spc('{ execution: { exit_code: 3 } }'),
      failing: [],
    },
    {
      slug: 'execution-max-commands',
      tier: 2,
      page: 'Code, files and workspace',
      claim: 'max_commands is the most commands the block may run',
      turns: [one(['ok'], [call('Bash', { command: 'a' }), call('Bash', { command: 'b' })])],
      spec: spc('{ execution: { max_commands: 1 } }'),
      failing: ['block 0: execution.max_commands'],
    },
    {
      slug: 'budget-steps',
      tier: 2,
      page: 'Budget',
      claim: 'a step is a tool call or a command, so two calls break a steps budget of 1',
      turns: [one(['ok'], [call('Read', { file_path: '/a' }), call('Read', { file_path: '/b' })])],
      spec: `blocks:\n  - user: hi\n    budget: { steps: 1 }\n    expect: { must: [ok] }\n`,
      failing: ['block 0: budget.steps'],
    },
    {
      slug: 'workspace-empty-list-asserts-empty-set',
      tier: 4,
      page: 'Code, files and workspace',
      claim: 'an empty list asserts that its set is empty, and a listed path must be in its set',
      turns: [one(['ok'], [created('out/a.txt')])],
      spec: spc('{ workspace: { created: [out/b.txt], deleted: [] } }'),
      failing: ['block 0: workspace.created'],
    },
    {
      slug: 'workspace-others-untouched',
      tier: 4,
      page: 'Code, files and workspace',
      claim: 'a path in the diff that no list names fails only through others_untouched: true',
      turns: [one(['ok'], [created('out/a.txt'), created('out/b.txt')])],
      spec: spc('{ workspace: { created: [out/a.txt], others_untouched: true } }'),
      failing: ['block 0: workspace.others_untouched'],
    },
    {
      slug: 'safety-destructive-label-caps',
      tier: 3,
      page: 'Code, files and workspace',
      claim:
        'a tool the operations table names delete is a destructive operation and max_destructive_ops 0 fails it',
      turns: [one(['ok'], [call('delete_record', { id: 1 })])],
      spec: `operations: { delete_record: delete }\n${spc('{ safety: { max_destructive_ops: 0 } }')}`,
      failing: ['block 0: safety.max_destructive_ops'],
    },
    {
      slug: 'safety-expected-tool-is-confirmed',
      tier: 4,
      page: 'Code, files and workspace',
      claim:
        'an operation the block own expectations name, a tool in tools with a count above 0, is confirmed and does not count',
      turns: [one(['ok'], [call('delete_record', { id: 1 })])],
      spec: `operations: { delete_record: delete }\n${spc('{ tools: [{ label: delete_record }], safety: { max_destructive_ops: 0 } }')}`,
      failing: [],
    },
    {
      slug: 'safety-read-label-is-not-destructive',
      tier: 4,
      page: 'Code, files and workspace',
      claim: 'a tool the operations table names read or modify is not destructive, whatever its label says',
      turns: [one(['ok'], [call('get_deleted_items', {}), call('purge_records', {})])],
      spec: `operations: { get_deleted_items: read, purge_records: modify }\n${spc('{ safety: { max_destructive_ops: 0 } }')}`,
      failing: [],
    },
    {
      slug: 'safety-confirm-before-send',
      tier: 4,
      page: 'Code, files and workspace',
      claim: 'confirm_before: [send] fails when a tool the operations table names send ran unconfirmed',
      turns: [one(['ok'], [call('send_email', { to: 'a' })])],
      spec: `operations: { send_email: send }\n${spc('{ safety: { confirm_before: [send] } }')}`,
      failing: ['block 0: safety.confirm_before.send'],
    },
    {
      slug: 'custom-unregistered-name-fails',
      tier: 2,
      page: 'Custom checks',
      claim: 'a name nobody registered gives a failed verdict filed under custom.<name>',
      turns: [one(['ok'])],
      spec: `rules: { custom: { nosuchcheck: {} } }\n${spc('{ must: [ok] }')}`,
      failing: ['block 0: custom.nosuchcheck'],
    },
    {
      slug: 'one-message-per-turn-two-segments',
      tier: 2,
      page: 'Cards',
      claim: 'one_message_per_turn fails a block with two text segments',
      turns: [one(['first', 'second'])],
      spec: `rules: { one_message_per_turn: true }\n${spc('{ must: [first] }')}`,
      failing: ['block 0: cards.one_message_per_turn'],
    },
    {
      slug: 'relevancy-half-of-terms-passes',
      tier: 3,
      page: 'Similarity, relevancy and knowledge retention',
      claim: 'relevancy passes at exactly the min share of key terms found',
      turns: [one(['plan data'])],
      spec: spc('{ relevancy: { terms: [plan, data, cost, month], min: 0.5 } }'),
      failing: [],
    },
    {
      slug: 'relevancy-quarter-of-terms-inconclusive',
      tier: 2,
      page: 'Similarity, relevancy and knowledge retention',
      claim:
        'without a judge, a reply that holds some key terms but fewer than min gives an inconclusive verdict that does not gate',
      turns: [one(['plan'])],
      spec: spc('{ relevancy: { terms: [plan, data, cost, month], min: 0.5 } }'),
      failing: [],
    },
    {
      slug: 'relevancy-no-term-fails',
      tier: 2,
      page: 'Similarity, relevancy and knowledge retention',
      claim: 'without a judge, a reply that holds no key term fails relevancy.terms and gates',
      turns: [one(['hello'])],
      spec: spc('{ relevancy: { terms: [plan, data, cost, month], min: 0.5 } }'),
      failing: ['block 0: relevancy.terms'],
    },
    {
      slug: 'similarity-unrelated-text',
      tier: 2,
      page: 'Similarity, relevancy and knowledge retention',
      claim: 'similarity scores the reply against each reference and fails below min as similarity.<index>',
      turns: [one(['Completely different words here'])],
      spec: spc(
        "{ similarity: [{ reference: 'The Acme Mobile L plan gives unlimited data for 35 dollars a month.', min: 0.5 }] }",
      ),
      failing: ['block 0: similarity.0'],
    },
    {
      slug: 'retention-question-for-known-fact',
      tier: 3,
      page: 'Similarity, relevancy and knowledge retention',
      claim: 'a question of the reply that names the words of the key fails knowledge_retention.<fact>.asked',
      turns: [
        one(['Fine'], [], 'my email is jo@example.org'),
        one(['What is your email address?'], [], 'next'),
      ],
      spec: `blocks:\n  - user: my email is jo@example.org\n    expect: { ledger_add: { email: jo@example.org } }\n  - user: next\n    expect: { knowledge_retention: [{ fact: email }] }\n`,
      failing: ['block 1: knowledge_retention.email.asked'],
    },
    {
      slug: 'retention-statement-is-not-a-question',
      tier: 4,
      page: 'Similarity, relevancy and knowledge retention',
      claim: 'only a question, a sentence ending with ?, counts as asking again',
      turns: [
        one(['Fine'], [], 'my email is jo@example.org'),
        one(['I will send it to your email.'], [], 'next'),
      ],
      spec: `blocks:\n  - user: my email is jo@example.org\n    expect: { ledger_add: { email: jo@example.org } }\n  - user: next\n    expect: { knowledge_retention: [{ fact: email }] }\n`,
      failing: [],
    },
    {
      slug: 'retention-use-needs-the-value',
      tier: 3,
      page: 'Similarity, relevancy and knowledge retention',
      claim: 'with use: true the value of the fact must appear in the reply or a tool input',
      turns: [one(['Fine'], [], 'my email is jo@example.org'), one(['Thanks, noted.'], [], 'next')],
      spec: `blocks:\n  - user: my email is jo@example.org\n    expect: { ledger_add: { email: jo@example.org } }\n  - user: next\n    expect: { knowledge_retention: [{ fact: email, use: true }] }\n`,
      failing: ['block 1: knowledge_retention.email.used'],
    },
  ];
  const items = cases.map(checkItem);

  items.push(
    ck({
      id: 'pii-iban-checksum',
      tier: 4,
      component: 'docs/reference/checks.md Personal data',
      title:
        'checks.md "Personal data": pii.iban flags an IBAN with a valid checksum and passes one whose check digits are wrong',
      cause:
        'the pii check fails the block for an IBAN with a valid checksum and passes an IBAN with a wrong checksum',
      async check(ctx) {
        const good = await replayFailing(
          ctx,
          'iban-good',
          [one([`Pay to ${iban(ctx.seed, true)} please`])],
          spc('{ must: [Pay] }'),
        );
        const bad = await replayFailing(
          ctx,
          'iban-bad',
          [one([`Pay to ${iban(ctx.seed, false)} please`])],
          spc('{ must: [Pay] }'),
        );
        return expectAll([
          [
            good.failing.join() === 'block 0: pii.iban',
            `a valid IBAN ${iban(ctx.seed, true)} should fail pii.iban; got [${good.failing.join('; ')}]`,
          ],
          [
            bad.failing.length === 0,
            `an IBAN with wrong check digits ${iban(ctx.seed, false)} should pass; got [${bad.failing.join('; ')}]`,
          ],
        ]);
      },
    }),
    ck({
      id: 'pii-email-and-phone-fictional-exceptions',
      tier: 4,
      component: 'docs/reference/checks.md Personal data',
      title:
        'checks.md "Personal data": addresses at example.org and under .test pass, the reserved 555-0100 to 0199 phone range passes, other emails and phones fail',
      cause:
        'the pii check passes fictional emails and phones with the leak guard exceptions and fails other emails and international phones',
      async check(ctx) {
        const real = ['jo', 'mail'].join('') + String.fromCharCode(64) + ['hotbox', 'net'].join('.');
        const phone = ['+32', '470', '12', '34', '56'].join(' ');
        const fine = await replayFailing(
          ctx,
          'pii-fine',
          [
            one([
              `Mail jo${ctx.seed}@example.org or ann@acme.test or call +1 202 555 01${String(10 + (ctx.seed % 90))} now`, // guard:allow fictional input of the personal-data check
            ]),
          ],
          spc('{ must: [Mail] }'),
        );
        const bad = await replayFailing(
          ctx,
          'pii-bad',
          [one([`Mail ${real} or call ${phone} now`])],
          spc('{ must: [Mail] }'),
        );
        return expectAll([
          [fine.failing.length === 0, `fictional contacts should pass; got [${fine.failing.join('; ')}]`],
          [
            bad.failing.includes('block 0: pii.email') && bad.failing.includes('block 0: pii.phone'),
            `a real looking email and phone should fail pii.email and pii.phone; got [${bad.failing.join('; ')}]`,
          ],
        ]);
      },
    }),
    ck({
      id: 'pii-national-number-check-digits',
      tier: 4,
      component: 'docs/reference/checks.md Personal data',
      title:
        'checks.md "Personal data": the pii check reads Belgian national register numbers with a valid check',
      cause:
        'the pii check fails the block for a Belgian national register number with valid check digits and passes one with wrong check digits',
      async check(ctx) {
        const valid = await replayFailing(
          ctx,
          'rrn-valid',
          [one(['Number 85.07.30-033.28 here'])], // guard:allow fictional input of the personal-data check
          spc('{ must: [Number] }'),
        );
        const wrong = await replayFailing(
          ctx,
          'rrn-wrong',
          [one(['Number 85.07.30-033.61 here'])],
          spc('{ must: [Number] }'),
        );
        return expectAll([
          [
            valid.failing.join() === 'block 0: pii.national_number',
            `a valid number should fail pii.national_number; got [${valid.failing.join('; ')}]`,
          ],
          [wrong.failing.length === 0, `wrong check digits should pass; got [${wrong.failing.join('; ')}]`],
        ]);
      },
    }),
  );
  return items;
}

// ---------------------------------------------------------------------------------------------------
// Family breaker-tools: monitor, compare, ci, report, select, holdout, gate, generate, extract, family,
// estate, judge, replay, validate and the stale "not built yet" claims
// ---------------------------------------------------------------------------------------------------

const tl = family('breaker-tools', 'tools', 10);

/** A throw from the command line is a defect of its own: the docs promise an exit code. */
async function guarded(run: () => Promise<ItemResult>): Promise<ItemResult> {
  try {
    return await run();
  } catch (e) {
    return fail(
      `the command threw instead of exiting with a code: ${clip(String((e as Error).message), 200)}`,
    );
  }
}

/** A store with `count` campaigns of six goldens each; from campaign `shiftAt` on, half of the goldens fail. */
async function seriesStore(dir: string, count: number, shiftAt: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 6; k++) {
      const must = i >= shiftAt && k < 3 ? 'zzz-never' : 'Acme';
      put(dir, `c${i}/s${k}.yaml`, spec(`s${k}`).replace('must: [Acme]', `must: [${must}]`));
    }
    await cli(
      [
        'campaign',
        'run',
        `c${i}`,
        '--campaign',
        `k${String(i).padStart(2, '0')}`,
        '--store',
        'series.db',
        '--no-cache',
      ],
      dir,
    );
  }
}

function toolItems(): BankItem[] {
  const items: BankItem[] = [];
  const fixtureEstate = (root: string): string => join(root, 'examples/estates/fixture');

  items.push(
    tl({
      id: 'monitor-shift-exits-1-stable-exits-0',
      tier: 4,
      level: 1,
      component: 'driftbench monitor',
      title:
        'examples/acme/ci/README.md "Watching a store over time": exit 1 when two of the three detectors alarm, 0 otherwise',
      cause: 'driftbench monitor exits 1 for a pass-rate drop from 100 to 50 percent and 0 for a flat series',
      async check(ctx) {
        const dir = work(ctx, 'monitor');
        await seriesStore(dir, 12, 6);
        const shift = await cli(
          ['monitor', '--store', 'series.db', '--metric', 'pass_rate', '--window', '4'],
          dir,
        );
        const flat = work(ctx, 'monitor-flat');
        await seriesStore(flat, 12, 99);
        const calm = await cli(
          ['monitor', '--store', 'series.db', '--metric', 'pass_rate', '--window', '4'],
          flat,
        );
        return expectAll([
          [
            shift.code === 1 && /Shift detected: 2 of 3 detectors alarmed\. Exit 1\./.test(shift.out),
            `the drop should exit 1; got ${shown(shift)}`,
          ],
          [calm.code === 0 && /No shift/.test(calm.out), `the flat series should exit 0; got ${shown(calm)}`],
        ]);
      },
    }),
    tl({
      id: 'monitor-series-lists-every-point',
      tier: 3,
      level: 1,
      component: 'driftbench monitor',
      title:
        'examples/acme/ci/README.md "Watching a store over time": --series prints every point of the series, oldest first',
      cause:
        'driftbench monitor --series prints one row per campaign of the store in creation order with its metric value',
      async check(ctx) {
        const dir = work(ctx, 'monitor-series');
        await seriesStore(dir, 8, 4);
        const c = await cli(
          ['monitor', '--store', 'series.db', '--metric', 'pass_rate', '--window', '3', '--series'],
          dir,
        );
        const rows = c.out.split('\n').filter((l) => /^\s+\d+\s+k\d\d\s/.test(l));
        const names = rows.map((r) => /(k\d\d)/.exec(r)?.[1]).join(',');
        return names === 'k00,k01,k02,k03,k04,k05,k06,k07'
          ? PASS
          : fail(`expected 8 rows k00 to k07; got "${names}" in ${shown(c)}`);
      },
    }),
    tl({
      id: 'monitor-bad-metric-exit-2',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench monitor',
      title:
        'examples/acme/ci/README.md and monitor --help: --metric is pass_rate, cost or latency, and bad input exits 2',
      cause: 'driftbench monitor exits 2 for an unknown metric',
      async check(ctx) {
        const dir = work(ctx, 'monitor-metric');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--store', 'm.db'], dir);
        const c = await cli(['monitor', '--store', 'm.db', '--metric', 'throughput'], dir);
        return c.code === 2 ? PASS : fail(`an unknown metric should exit 2; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'compare-margin-and-verdicts',
      tier: 4,
      level: 1,
      component: 'driftbench compare',
      title:
        'examples/acme/reports/README.md: the same campaign against itself is not shown non-inferior at a narrow margin (exit 1) and is non-inferior at a wide one (exit 0)',
      cause:
        'driftbench compare exits 1 with "NOT SHOWN NON-INFERIOR" at a margin below the smallest the goldens can show and exits 0 with "NON-INFERIOR" at 90 points',
      async check(ctx) {
        const dir = work(ctx, 'compare');
        for (let k = 0; k < 6; k++) put(dir, `s/s${k}.yaml`, spec(`s${k}`));
        await cli(['campaign', 'run', 's', '--campaign', 'base', '--store', 'c.db', '--no-cache'], dir);
        await cli(['campaign', 'run', 's', '--campaign', 'cand', '--store', 'c.db', '--no-cache'], dir);
        const narrow = await cli(
          ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', 'c.db', '--margin', '5'],
          dir,
        );
        const wide = await cli(
          ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', 'c.db', '--margin', '90'],
          dir,
        );
        return expectAll([
          [
            narrow.code === 1 && /NOT SHOWN NON-INFERIOR/.test(narrow.out),
            `margin 5 should exit 1; got ${shown(narrow)}`,
          ],
          [
            wide.code === 0 && /Verdict: NON-INFERIOR/.test(wide.out),
            `margin 90 should exit 0; got ${shown(wide)}`,
          ],
        ]);
      },
    }),
    tl({
      id: 'compare-bad-input-exit-2',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench compare',
      title: 'compare --help: exit 2 on bad input, an unknown campaign among them',
      cause:
        'driftbench compare exits 2 for a campaign the store does not hold and for a margin that is not a number or auto',
      async check(ctx) {
        const dir = work(ctx, 'compare-bad');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'base', '--store', 'c.db'], dir);
        const a = await cli(
          ['compare', '--baseline', 'base', '--candidate', 'ghost', '--store', 'c.db', '--margin', '5'],
          dir,
        );
        // cli.md: --margin defaults to auto, so a missing margin is no bad input; a margin that is not a number is.
        const b = await cli(
          ['compare', '--baseline', 'base', '--candidate', 'base', '--store', 'c.db', '--margin', 'wide'],
          dir,
        );
        return expectAll([
          [a.code === 2, `an unknown candidate should exit 2; got ${shown(a)}`],
          [b.code === 2, `a margin that is not a number should exit 2; got ${shown(b)}`],
        ]);
      },
    }),
    tl({
      id: 'report-junit-one-case-per-run',
      tier: 3,
      level: 1,
      component: 'driftbench report',
      title: 'report --help: the JUnit XML holds one test suite per golden and one test case per run',
      cause:
        'driftbench report --junit writes a testsuite for each golden and a testcase for each run of the campaign',
      async check(ctx) {
        const dir = work(ctx, 'report');
        const n = ctx.seed + 2;
        for (let k = 0; k < 3; k++) put(dir, `s/s${k}.yaml`, spec(`s${k}`));
        await cli(
          ['campaign', 'run', 's', '--campaign', 'rep', '--store', 'r.db', '--repeats', String(n)],
          dir,
        );
        const c = await cli(['report', 'rep', '--store', 'r.db', '--out', 'r.html', '--junit', 'r.xml'], dir);
        const xml = existsSync(join(dir, 'r.xml')) ? text(join(dir, 'r.xml')) : '';
        const suites = (xml.match(/<testsuite /g) ?? []).length;
        const cases = (xml.match(/<testcase /g) ?? []).length;
        return expectAll([
          [
            c.code === 0 && existsSync(join(dir, 'r.html')),
            `report should exit 0 and write the HTML; got ${shown(c)}`,
          ],
          [suites === 3, `expected 3 test suites, one per golden; got ${suites}`],
          [cases === 3 * n, `expected ${3 * n} test cases, one per run; got ${cases}`],
        ]);
      },
    }),
    tl({
      id: 'report-bad-input-exit-2',
      tier: 1,
      source: 'adversarial',
      component: 'driftbench report',
      title:
        'cli.md and report --help: report exits 0 when written and 2 on bad input, such as an unknown campaign',
      cause: 'driftbench report exits 2 and writes no file for a campaign the store does not hold',
      async check(ctx) {
        const dir = work(ctx, 'report-bad');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'known', '--store', 'r.db'], dir);
        const c = await cli(['report', 'ghost', '--store', 'r.db', '--out', 'r.html'], dir);
        return c.code === 2 && !existsSync(join(dir, 'r.html'))
          ? PASS
          : fail(`an unknown campaign should exit 2 without a file; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'ci-parity-writes-summary',
      tier: 3,
      level: 1,
      component: 'driftbench ci',
      title:
        'examples/acme/ci/README.md: the agent against itself is parity, exit 0, and the JSON summary goes to driftbench-ci.json by default',
      cause:
        'driftbench ci exits 0 with verdict parity for an unchanged agent and writes driftbench-ci.json in the working folder',
      async check(ctx) {
        const dir = work(ctx, 'ci-parity');
        for (let k = 0; k < 6; k++) put(dir, `s/s${k}.yaml`, spec(`s${k}`));
        await cli(['campaign', 'run', 's', '--campaign', 'base', '--store', 'b.db'], dir);
        const c = await cli(
          [
            'ci',
            '--specs',
            's',
            '--target',
            'function:acme-sales',
            '--baseline',
            'b.db',
            '--store',
            'c.db',
            '--margin',
            '90',
          ],
          dir,
        );
        const summary = existsSync(join(dir, 'driftbench-ci.json'))
          ? text(join(dir, 'driftbench-ci.json'))
          : '';
        return expectAll([
          [c.code === 0 && /Verdict: PARITY/.test(c.out), `expected parity and exit 0; got ${shown(c)}`],
          [
            /parity/i.test(summary),
            `driftbench-ci.json should hold the verdict; found "${clip(summary, 80)}"`,
          ],
        ]);
      },
    }),
    tl({
      id: 'ci-bad-input-exit-2',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench ci',
      title:
        'examples/acme/ci/README.md "What it decides": exit 2 for a margin outside (0, 100), an unknown baseline, or a fault target without --faults',
      cause:
        'driftbench ci exits 2 for margins 0 and 100, for an unknown baseline and for a fault:<id> target without --faults',
      async check(ctx) {
        const dir = work(ctx, 'ci-bad');
        put(dir, 's/a.yaml', spec('a'));
        await cli(['campaign', 'run', 's', '--campaign', 'base', '--store', 'b.db'], dir);
        const base = ['ci', '--specs', 's', '--target', 'function:acme-sales', '--baseline', 'b.db'];
        const zero = await cli([...base, '--store', 'c1.db', '--margin', '0'], dir);
        const hundred = await cli([...base, '--store', 'c2.db', '--margin', '100'], dir);
        const ghost = await cli(
          [
            'ci',
            '--specs',
            's',
            '--target',
            'function:acme-sales',
            '--baseline',
            'ghost',
            '--store',
            'c3.db',
            '--margin',
            '5',
          ],
          dir,
        );
        const fault = await cli(
          [
            'ci',
            '--specs',
            's',
            '--target',
            'fault:x3-skips-recap',
            '--baseline',
            'b.db',
            '--store',
            'c4.db',
            '--margin',
            '5',
          ],
          dir,
        );
        return expectAll([
          [zero.code === 2, `margin 0 should exit 2; got ${shown(zero)}`],
          [hundred.code === 2, `margin 100 should exit 2; got ${shown(hundred)}`],
          [ghost.code === 2, `an unknown baseline should exit 2; got ${shown(ghost)}`],
          [fault.code === 2, `a fault target without --faults should exit 2; got ${shown(fault)}`],
        ]);
      },
    }),
    tl({
      id: 'select-golden-set-readme-command',
      tier: 5,
      component: 'driftbench select',
      title:
        'examples/acme/golden/README.md: select with --k 10 on the gated Acme suite writes ten specs and golden.json, and exits according to the required coverage documented in its README',
      cause:
        'driftbench select writes k specs and golden.json, never uses sealed specs, and exits 1 while a required cell stays uncovered',
      async check(ctx) {
        const dir = work(ctx, 'select');
        const c = await cli(
          [
            'select',
            '--cover',
            join(ctx.root, 'examples/acme/map/space.yaml'),
            '--specs',
            join(ctx.root, 'examples/acme/gated'),
            '--k',
            '10',
            '--out',
            'golden',
          ],
          dir,
        );
        const want = goldenContract(ctx.root);
        const specs = files(join(dir, 'golden/specs')).length;
        return expectAll([
          [
            c.code === (want.required === want.totalRequired ? 0 : 1),
            `exit disagrees with documented required coverage; got ${shown(c)}`,
          ],
          [specs === 10, `expected 10 spec files; got ${specs}`],
          [existsSync(join(dir, 'golden/golden.json')), 'golden.json should exist'],
          [
            c.out.includes(`${want.sealed} sealed specs left out`),
            `the sealed specs should be left out; got ${shown(c)}`,
          ],
        ]);
      },
    }),
    tl({
      id: 'select-refuses-earlier-output',
      tier: 2,
      component: 'driftbench select',
      title:
        'select --help: --force replaces the golden set an earlier run wrote in the folder, so without it an earlier folder is refused, exit 2',
      cause:
        'driftbench select exits 2 when the output folder holds an earlier golden.json and --force is not given',
      async check(ctx) {
        const dir = work(ctx, 'select-twice');
        const argv = [
          'select',
          '--cover',
          join(ctx.root, 'examples/acme/map/space.yaml'),
          '--specs',
          join(ctx.root, 'examples/acme/gated'),
          '--k',
          '2',
          '--out',
          'golden',
        ];
        await cli(argv, dir);
        const again = await cli(argv, dir);
        return again.code === 2
          ? PASS
          : fail(`a second select without --force should exit 2; got ${shown(again)}`);
      },
    }),
    tl({
      id: 'holdout-seal-takes-the-gate-split',
      tier: 4,
      component: 'driftbench holdout',
      title:
        'examples/acme/golden/README.md and holdout seal --help: the gate own sealed split is taken as it is, and an earlier seal needs --force',
      cause:
        'driftbench holdout seal reports the gate-owned split counts, writes sealed.json, and exits 2 on a second seal without --force',
      async check(ctx) {
        const dir = work(ctx, 'holdout');
        const argv = ['holdout', 'seal', '--specs', join(ctx.root, 'examples/acme/gated'), '--out', 'sealed'];
        const want = await gateContract(ctx.root);
        const a = await cli(argv, dir);
        const b = await cli(argv, dir);
        return expectAll([
          [
            a.code === 0 && a.out.includes(`Sealed ${want.sealed} of ${want.total} gated specs`),
            `expected "Sealed ${want.sealed} of ${want.total} gated specs"; got ${shown(a)}`,
          ],
          [existsSync(join(dir, 'sealed/sealed.json')), 'sealed.json should exist'],
          [b.code === 2, `sealing again without --force should exit 2; got ${shown(b)}`],
        ]);
      },
    }),
    tl({
      id: 'generate-same-seed-same-bytes',
      tier: 4,
      component: 'driftbench generate',
      title:
        'generating.md "Generate": every seeded choice comes from --seed, so the same map and seed give the same suite byte for byte',
      cause:
        'driftbench generate writes identical spec files for the same map, seed and --max, and a different seed changes some of them',
      async check(ctx) {
        const dir = work(ctx, 'generate');
        const map = join(ctx.root, 'examples/acme/map/approved.yaml');
        const run = async (out: string, seed: number): Promise<Cli> =>
          cli(['generate', '--map', map, '--out', out, '--max', '4', '--seed', String(seed)], dir);
        await run('a', 1);
        await run('b', 1);
        await run('c', 5 + ctx.seed);
        const specsOf = (d: string): string[] => files(join(dir, d)).filter((f) => f.endsWith('.yaml'));
        const same =
          specsOf('a').length > 0 &&
          specsOf('a').join() === specsOf('b').join() &&
          specsOf('a').every((f) => text(join(dir, 'a', f)) === text(join(dir, 'b', f)));
        const differs =
          specsOf('a').join() !== specsOf('c').join() ||
          specsOf('a').some(
            (f) => !existsSync(join(dir, 'c', f)) || text(join(dir, 'a', f)) !== text(join(dir, 'c', f)),
          );
        return expectAll([
          [same, 'two runs with seed 1 should write the same files byte for byte'],
          [differs, `seed ${5 + ctx.seed} should change at least one file`],
        ]);
      },
    }),
    tl({
      id: 'generate-unapproved-map-exit-2',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench generate',
      title:
        'cli.md "driftbench generate": exit 2, nothing written, for an unapproved map or an earlier output without --force',
      cause: 'driftbench generate exits 2 and writes nothing for a proposal that is not approved',
      async check(ctx) {
        const dir = work(ctx, 'generate-unapproved');
        const c = await cli(
          ['generate', '--map', join(ctx.root, 'examples/acme/map/proposal.yaml'), '--out', 'out'],
          dir,
        );
        return c.code === 2 && files(join(dir, 'out')).length === 0
          ? PASS
          : fail(`expected exit 2 and no file; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'generate-max-cut-exits-1',
      tier: 3,
      component: 'driftbench generate',
      title:
        'cli.md "driftbench generate" exit codes: 1 when the suite is written with a seeder cut by --max',
      cause: 'driftbench generate exits 1 and marks "(cut by --max)" when --max cuts a seeder',
      async check(ctx) {
        const dir = work(ctx, 'generate-max');
        const c = await cli(
          [
            'generate',
            '--map',
            join(ctx.root, 'examples/acme/map/approved.yaml'),
            '--out',
            'out',
            '--max',
            '1',
          ],
          dir,
        );
        return c.code === 1 && /cut by --max/.test(c.out) && existsSync(join(dir, 'out/generate-report.json'))
          ? PASS
          : fail(`expected exit 1, the cut mark and generate-report.json; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'extract-flags-and-exit-codes',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench extract',
      title:
        'cli.md "driftbench extract": an existing proposal is not replaced without --force (2); approve refuses --all with --dimension (2), an unknown dimension (1), and --to outside the proposal folder (2); map needs --to (2)',
      cause:
        'driftbench extract and its approve and map subcommands exit with the documented codes for each refused flag combination',
      async check(ctx) {
        const dir = work(ctx, 'extract');
        const ex = join(ctx.root, 'examples/acme');
        const base = [
          'extract',
          '--prompt',
          join(ex, 'README.md'),
          '--inventory',
          join(ex, 'inventory.yaml'),
          '--no-model',
          '--out',
          'p.yaml',
        ];
        const first = await cli(base, dir);
        const again = await cli(base, dir);
        const both2 = await cli(['extract', 'approve', 'p.yaml', '--all', '--dimension', 'behaviour'], dir);
        const unknown = await cli(['extract', 'approve', 'p.yaml', '--dimension', 'nosuch'], dir);
        const outside = await cli(
          ['extract', 'approve', 'p.yaml', '--all', '--to', join(dir, '..', 'elsewhere.yaml')],
          dir,
        );
        const noTo = await cli(['extract', 'map', 'p.yaml'], dir);
        return expectAll([
          [first.code === 0 && /none approved/.test(first.out), `first extract: ${shown(first)}`],
          [again.code === 2, `a second extract without --force should exit 2; got ${shown(again)}`],
          [both2.code === 2, `--all with --dimension should exit 2; got ${shown(both2)}`],
          [unknown.code === 1, `an unknown dimension should exit 1; got ${shown(unknown)}`],
          [outside.code === 2, `--to outside the folder should exit 2; got ${shown(outside)}`],
          [noTo.code === 2, `map without --to should exit 2; got ${shown(noTo)}`],
        ]);
      },
    }),
    tl({
      id: 'family-instances-same-seed-same-files',
      tier: 4,
      component: 'driftbench family',
      title:
        'generating.md "Task families": the expected outcome of every instance comes from code and the same seed gives the same instances; instances reports "Family acme-price-sheet: 3 instances, seed 1, 13 specs."',
      cause:
        'driftbench family instances writes the same instance files for the same family, count and seed, and prints the documented header',
      async check(ctx) {
        const dir = work(ctx, 'family');
        const fam = join(ctx.root, 'examples/acme/families/price-sheet');
        const a = await cli(['family', 'instances', fam, '--n', '3', '--seed', '1', '--out', 'a'], dir);
        await cli(['family', 'instances', fam, '--n', '3', '--seed', '1', '--out', 'b'], dir);
        const fa = files(join(dir, 'a')).filter((f) => f.endsWith('.yaml'));
        const same =
          fa.length > 0 &&
          fa.join() ===
            files(join(dir, 'b'))
              .filter((f) => f.endsWith('.yaml'))
              .join() &&
          fa.every((f) => text(join(dir, 'a', f)) === text(join(dir, 'b', f)));
        return expectAll([
          [
            a.code === 0 && a.out.includes('Family acme-price-sheet: 3 instances, seed 1, 13 specs.'),
            `expected the header; got ${shown(a)}`,
          ],
          [same, 'two runs with the same seed should write the same spec files'],
        ]);
      },
    }),
    tl({
      id: 'family-review-pending-exit-1',
      tier: 2,
      component: 'driftbench family',
      title:
        'cli.md "driftbench family": an unsigned review exits 1 and prints "Review: pending."; a signed review exits 0 without pending',
      cause:
        'driftbench family review prints "Review: pending." and exits 1 for a family with an unsigned review',
      async check(ctx) {
        const dir = work(ctx, 'family-review');
        const family = reviewFamily(dir);
        const pending = await cli(['family', 'review', family.path], dir);
        family.sign();
        const signed = await cli(['family', 'review', family.path], dir);
        return expectAll([
          [
            pending.code === 1 && pending.out.startsWith('Review: pending.'),
            `pending family: expected exit 1 and "Review: pending."; got ${shown(pending)}`,
          ],
          [
            signed.code === 0 &&
              signed.out.startsWith('Review: signed by ') &&
              !signed.out.includes('Review: pending.'),
            `signed family: expected exit 0 and a signed review, not pending; got ${shown(signed)}`,
          ],
        ]);
      },
    }),
    tl({
      id: 'family-verify-missing-folder-exit-2',
      tier: 3,
      source: 'hostile',
      component: 'driftbench family',
      title:
        'cli.md "driftbench family" exit codes: verify exits 2 on bad input, such as no spec under the folder',
      cause:
        'packages/cli/src/main.ts: main rethrows every error that is not a CommanderError, so a file-system or parse error inside a command escapes as an uncaught throw; main must print the message on stderr and exit 2',
      check: (ctx) =>
        guarded(async () => {
          const dir = work(ctx, 'family-verify');
          put(dir, 'afile.yaml', 'id: x\n');
          const missing = await cli(
            ['family', 'verify', 'no-such-folder', '--reference', 'process:acme-ops'],
            dir,
          );
          const file = await cli(['family', 'verify', 'afile.yaml', '--reference', 'process:acme-ops'], dir);
          return expectAll([
            [missing.code === 2, `a missing folder should exit 2; got ${shown(missing)}`],
            [file.code === 2, `a file instead of a folder should exit 2; got ${shown(file)}`],
          ]);
        }),
    }),
    tl({
      id: 'estate-approve-directory-exit-2',
      tier: 3,
      source: 'hostile',
      component: 'driftbench estate approve',
      title:
        'estate.md "The commands": estate approve exits 2 for a missing file or options that do not fit; a folder given as the map is an input error, not a crash',
      cause:
        'packages/cli/src/main.ts: main rethrows every error that is not a CommanderError, so a file-system or parse error inside a command escapes as an uncaught throw; main must print the message on stderr and exit 2',
      check: (ctx) =>
        guarded(async () => {
          const dir = work(ctx, 'estate-dir');
          mkdirSync(join(dir, 'afolder'), { recursive: true });
          const a = await cli(['estate', 'approve', 'afolder'], dir);
          const b = await cli(['estate', 'plan', 'approve', 'afolder'], dir);
          return expectAll([
            [a.code === 2, `estate approve on a folder should exit 2; got ${shown(a)}`],
            [b.code === 2, `estate plan approve on a folder should exit 2; got ${shown(b)}`],
          ]);
        }),
    }),
    tl({
      id: 'estate-scan-refuses-existing-and-model-flags',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench estate scan',
      title:
        'estate.md "The commands": scan --replay and --no-model do not go together, and an existing map is replaced only with --force',
      cause:
        'driftbench estate scan exits 2 for --no-model with --replay and for an existing --out without --force',
      async check(ctx) {
        const dir = work(ctx, 'estate-scan');
        const fx = fixtureEstate(ctx.root);
        const first = await cli(['estate', 'scan', fx, '--no-model', '--out', 'm.yaml'], dir);
        const again = await cli(['estate', 'scan', fx, '--no-model', '--out', 'm.yaml'], dir);
        const both2 = await cli(
          ['estate', 'scan', fx, '--no-model', '--replay', join(fx, 'answers.yaml'), '--out', 'm2.yaml'],
          dir,
        );
        return expectAll([
          [first.code === 0, `first scan: ${shown(first)}`],
          [again.code === 2, `an existing map without --force should exit 2; got ${shown(again)}`],
          [both2.code === 2, `--no-model with --replay should exit 2; got ${shown(both2)}`],
        ]);
      },
    }),
    tl({
      id: 'estate-lint-clean-or-findings-codes',
      tier: 3,
      component: 'driftbench estate lint',
      title:
        'cli.md "estate lint": failing findings use the documented codes; informational codes follow the shared lint contract',
      cause: 'driftbench estate lint prints only the documented finding codes',
      async check(ctx) {
        const dir = work(ctx, 'estate-lint');
        const c = await cli(['estate', 'lint', join(fixtureEstate(ctx.root), 'approved.yaml')], dir);
        const page = text(join(ctx.root, 'docs/reference/cli.md'));
        const table =
          page.split('`estate lint` reports these findings:')[1]?.split('A map that does not load')[0] ?? '';
        const documented = new Set([...table.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]));
        // Information codes share the CLI's source of truth; the table describes failing findings.
        for (const code of INFORMATION) documented.add(code);
        const codes = c.out
          .split('\n')
          .map((l) => /^ {2}([A-Z_]{4,})\s/.exec(l)?.[1])
          .filter((x): x is string => !!x);
        const extra = codes.filter((x) => !documented.has(x));
        return c.code === 1 &&
          codes.length > 0 &&
          documented.size > INFORMATION.size &&
          extra.length === 0 &&
          codes.every((code) => (LINT_CODES as readonly string[]).includes(code))
          ? PASS
          : fail(
              `expected exit 1 and only documented codes; extra codes ${extra.join(',') || 'none'}; ${shown(c)}`,
            );
      },
    }),
    tl({
      id: 'estate-scan-no-model-output-order',
      tier: 3,
      component: 'driftbench estate scan',
      title: 'cli.md "estate scan" example: the no-model and refusal lines appear in documented order',
      cause:
        'driftbench estate scan --no-model prints the documented no-model and refusal lines in order, allowing inventory details between them',
      async check(ctx) {
        const dir = work(ctx, 'estate-scan-order');
        const c = await cli(
          ['estate', 'scan', fixtureEstate(ctx.root), '--no-model', '--out', 'm.yaml'],
          dir,
        );
        const page = text(join(ctx.root, 'docs/reference/cli.md'));
        const example =
          page.split('driftbench estate scan examples/estates/fixture --no-model')[1]?.split('```')[0] ?? '';
        const expected = example.split('\n').filter((line) => /^ {2}(No model call:|Refused:)/.test(line));
        const lines = c.out.split('\n');
        const [noModel = -1, refused = -1] = expected.map((line) => lines.indexOf(line));
        return c.code === 0 && expected.length === 2 && noModel >= 0 && refused > noModel
          ? PASS
          : fail(`expected documented scan lines in order: ${JSON.stringify(expected)}; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'estate-approve-counts-match-docs',
      tier: 3,
      component: 'driftbench estate approve',
      title:
        'estate.md "Approving the prose atoms": estate approve reports the documented approved fixture count',
      cause: 'driftbench estate approve reports the same approved fixture count as estate.md',
      async check(ctx) {
        const dir = work(ctx, 'estate-approve');
        const c = await cli(['estate', 'approve', join(fixtureEstate(ctx.root), 'approved.yaml')], dir);
        const page = text(join(ctx.root, 'docs/estate.md'));
        const count = /examples\/estates\/fixture\/approved\.yaml: all (\d+) atoms are approved\./.exec(
          page,
        )?.[1];
        return count !== undefined && c.code === 0 && c.out.includes(`all ${count} atoms are approved.`)
          ? PASS
          : fail(`expected the documented approved count ${count ?? '(missing)'}; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'estate-run-not-built-message',
      tier: 2,
      component: 'driftbench estate run',
      title: 'cli.md "estate run": command availability and usage errors follow the current contract',
      cause:
        'driftbench estate run exposes the documented options and rejects missing required input with the documented exit code',
      check: (ctx) => estateCommandContract(ctx, 'run'),
    }),
    tl({
      id: 'estate-mutate-not-built-message',
      tier: 2,
      component: 'driftbench estate mutate',
      title: 'cli.md "estate mutate": command availability and usage errors follow the current contract',
      cause:
        'driftbench estate mutate exposes the documented options and rejects missing required input with the documented exit code',
      check: (ctx) => estateCommandContract(ctx, 'mutate'),
    }),
    tl({
      id: 'judge-calibrate-judge-names',
      tier: 3,
      component: 'driftbench judge calibrate',
      title:
        'concepts/judges.md calibrate example: the assignment table names every judge of the cassette, as the cassette names it',
      cause: 'driftbench judge calibrate names each judge by the id its cassette gives',
      async check(ctx) {
        const dir = work(ctx, 'judge-calibrate');
        const ex = join(ctx.root, 'examples/acme');
        const c = await cli(
          [
            'judge',
            'calibrate',
            '--criteria',
            join(ex, 'criteria'),
            '--labels',
            join(ex, 'labels'),
            '--cassette',
            join(ex, 'criteria/calibration/cassette.json'),
            '--out',
            'assign.yaml',
          ],
          dir,
        );
        // judges.md prints the first two judges as s1p-a and s1p-b and says that substitution is the only change
        // to the output: the command prints the ids of the cassette.
        const cassette = JSON.parse(readFileSync(join(ex, 'criteria/calibration/cassette.json'), 'utf8')) as {
          judges: { id: string }[];
        };
        const missing = cassette.judges.map((judge) => judge.id).filter((id) => !c.out.includes(id));
        return c.code === 0 && missing.length === 0
          ? PASS
          : fail(
              `expected every cassette judge in the table; missing ${missing.join(', ')}; got ${shown(c)}`,
            );
      },
    }),
    tl({
      id: 'validate-floors-line',
      tier: 2,
      component: 'driftbench validate floors',
      title:
        'cli.md "driftbench validate": validate floors prints "Floors (validators/floors.json): <name> = <floor>, ..." for every floor the file holds',
      cause: 'driftbench validate floors prints one line naming every floor of validators/floors.json',
      async check(ctx) {
        const c = await cli(['validate', 'floors'], ctx.root);
        const file = JSON.parse(readFileSync(join(ctx.root, 'validators/floors.json'), 'utf8')) as {
          floors: Record<string, number>;
        };
        const names = Object.keys(file.floors).sort();
        const line =
          c.out.split('\n').find((text) => text.startsWith('Floors (validators/floors.json):')) ?? '';
        const missing = names.filter((name) => !line.includes(`${name} = ${file.floors[name]}`));
        return c.code === 0 && line !== '' && missing.length === 0
          ? PASS
          : fail(
              `expected a floors line naming ${names.join(', ')}; missing ${missing.join(', ')}; got ${shown(c)}`,
            );
      },
    }),
    tl({
      id: 'validate-input-errors-exit-64',
      tier: 2,
      source: 'adversarial',
      component: 'driftbench validate',
      title:
        'cli.md "driftbench validate": exit 64 is an input error: an unknown component, a bad seed, a mode given the wrong options',
      cause:
        'driftbench validate exits 64 for an unknown component, a non numeric seed, a descending seed range and two exclusive modes',
      async check(ctx) {
        const dir = work(ctx, 'validate-64');
        const a = await cli(['validate', 'nosuchladder'], dir);
        const b = await cli(['validate', 'stats', '--seed', 'x'], dir);
        const c = await cli(['validate', 'stats', '--seeds', '3..1'], dir);
        const d = await cli(['validate', 'stats', '--brief', '--journal', 'row.json'], dir);
        return expectAll([
          [a.code === 64, `unknown component: ${a.code}`],
          [b.code === 64, `bad seed: ${b.code}`],
          [c.code === 64, `descending range: ${c.code}`],
          [d.code === 64, `exclusive modes: ${d.code}`],
        ]);
      },
    }),
    tl({
      id: 'replay-input-errors-exit-2',
      tier: 3,
      source: 'adversarial',
      component: 'driftbench replay',
      title:
        'cli.md "driftbench replay" exit codes: 2 for a log passed as a session, two sessions with one name, and no spec aligned',
      cause:
        'driftbench replay exits 2 for a decision log given as a session and for two sessions with the same name',
      async check(ctx) {
        const dir = work(ctx, 'replay-errors');
        const sessions = join(ctx.root, 'examples/estates/sessions');
        const suite = join(sessions, 'specs');
        const log = await cli(
          ['replay', join(sessions, 'clean-build.decisions.jsonl'), '--suite', suite],
          dir,
        );
        const dup = await cli(
          [
            'replay',
            join(sessions, 'clean-build.jsonl'),
            join(sessions, 'clean-build.jsonl'),
            '--suite',
            suite,
          ],
          dir,
        );
        return expectAll([
          [log.code === 2, `a log passed as a session should exit 2; got ${shown(log)}`],
          [dup.code === 2, `two sessions with one name should exit 2; got ${shown(dup)}`],
        ]);
      },
    }),
    tl({
      id: 'replay-example-counts',
      tier: 5,
      component: 'driftbench replay',
      title:
        'adapters/claude-code.md "driftbench replay": the seven fixture sessions give 8 specs replayed, 4 pass, 4 fail, with the failing verdicts listed',
      cause:
        'driftbench replay over the fixture sessions prints "8 specs replayed: 4 pass, 4 fail." and exits 1',
      async check(ctx) {
        const dir = work(ctx, 'replay-example');
        const s = join(ctx.root, 'examples/estates/sessions');
        const names = [
          'clean-build',
          'compaction-mid-task',
          'forbidden-act',
          'gate-violated',
          'skill-skipped',
          'subagent-dispatch',
          'price-sheet-build',
        ];
        const hasDec = (n: string): boolean => existsSync(join(s, `${n}.decisions.jsonl`));
        const hasStep = (n: string): boolean => existsSync(join(s, `${n}.steps.jsonl`));
        const c = await cli(
          [
            'replay',
            ...names.map((n) => join(s, `${n}.jsonl`)),
            '--suite',
            join(s, 'specs'),
            '--decisions',
            ...names.filter(hasDec).map((n) => join(s, `${n}.decisions.jsonl`)),
            '--steps',
            ...names.filter(hasStep).map((n) => join(s, `${n}.steps.jsonl`)),
          ],
          dir,
        );
        return c.code === 1 &&
          /8 specs replayed: 4 pass, 4 fail\./.test(c.out) &&
          /failing: block 1: custom\.ordered\.Read\.Edit/.test(c.out)
          ? PASS
          : fail(`expected 4 pass and 4 fail with the ordered pair failing; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'judge-check-and-run-examples',
      tier: 3,
      component: 'driftbench judge',
      title:
        'cli.md "driftbench judge": judge check reports 12 valid criteria and judge run separates 12 of 12 in mode hybrid; a criterion file whose name differs from its file name is an issue, exit 1',
      cause:
        'driftbench judge check and run print the documented totals and judge check exits 1 for a criterion renamed away from its file name',
      async check(ctx) {
        const dir = work(ctx, 'judge');
        const ex = join(ctx.root, 'examples/acme/criteria');
        const ok = await cli(['judge', 'check', ex], dir);
        const run = await cli(
          ['judge', 'run', '--criteria', ex, '--cassette', join(ex, 'council.cassette.json')],
          dir,
        );
        put(dir, 'crit/renamed.yaml', text(join(ex, 'care_redirect.yaml')));
        const bad = await cli(['judge', 'check', 'crit'], dir);
        return expectAll([
          [ok.code === 0 && /12 valid criteria, 0 issue\(s\)\./.test(ok.out), `check: ${shown(ok)}`],
          [
            run.code === 0 && /12 of 12 criteria separated in mode hybrid\./.test(run.out),
            `run: ${shown(run)}`,
          ],
          [bad.code === 1, `a criterion whose name differs from its file should exit 1; got ${shown(bad)}`],
        ]);
      },
    }),
    tl({
      id: 'perturb-recovery-line',
      tier: 3,
      component: 'driftbench perturb',
      title:
        'examples/acme/redteam/README.md: perturb with --class D2 --at 2 on plan-upgrade injects a message before block 2 and prints the recovery',
      cause:
        'driftbench perturb prints the injected block at position 2 and a "Recovery:" line, exit 0 on a recovered run, and exits 2 for an unknown class',
      async check(ctx) {
        const dir = work(ctx, 'perturb');
        const spec0 = join(ctx.root, 'examples/acme/specs/conversations/plan-upgrade.yaml');
        const c = await cli(
          ['perturb', spec0, '--class', 'D2', '--at', '2', '--target', 'function:acme-sales'],
          dir,
        );
        const bad = await cli(
          ['perturb', spec0, '--class', 'D99', '--at', '2', '--target', 'function:acme-sales'],
          dir,
        );
        return expectAll([
          [
            c.code === 0 && /injected d2-[a-z-]+@2/.test(c.out) && /Recovery: immediate/.test(c.out),
            `expected the injected block and an immediate recovery; got ${shown(c)}`,
          ],
          [bad.code === 2, `an unknown class should exit 2; got ${shown(bad)}`],
        ]);
      },
    }),
    tl({
      id: 'gate-no-accepted-block-exit-1',
      tier: 3,
      component: 'driftbench gate',
      title:
        'cli.md "driftbench gate": exit 1 when the gated suite is written with no accepted block, exit 2 and nothing written for a spec whose target is not a --reference or an earlier output without --force',
      cause:
        'driftbench gate exits 1 when every block is rejected, exits 2 for a spec on a target that is not a --reference and for an existing output folder',
      async check(ctx) {
        const dir = work(ctx, 'gate');
        const faults = join(ctx.root, 'examples/acme/faults');
        for (let k = 0; k < 2; k++) put(dir, `s/s${k}.yaml`, spec(`s${k}`));
        const none = await cli(
          ['gate', 's', '--reference', 'function:acme-sales', '--faults', faults, '--k', '2', '--out', 'g'],
          dir,
        );
        const again = await cli(
          ['gate', 's', '--reference', 'function:acme-sales', '--faults', faults, '--k', '2', '--out', 'g'],
          dir,
        );
        const other = await cli(
          ['gate', 's', '--reference', 'process:acme-ops', '--faults', faults, '--k', '2', '--out', 'g2'],
          dir,
        );
        return expectAll([
          [
            none.code === 1 && /Accepted 0 of 2 blocks\./.test(none.out),
            `all words-only blocks should be rejected, exit 1; got ${shown(none)}`,
          ],
          [again.code === 2, `an earlier output without --force should exit 2; got ${shown(again)}`],
          [
            other.code === 2 && files(join(dir, 'g2')).length === 0,
            `a spec on a target that is not a reference should exit 2 and write nothing; got ${shown(other)}`,
          ],
        ]);
      },
    }),
    tl({
      id: 'intake-interview-never-overwrites',
      tier: 2,
      component: 'driftbench intake',
      title:
        'cli.md "driftbench intake": --force replaces an existing file or set, so interview onto an existing questionnaire is refused, exit 2',
      cause:
        'driftbench intake interview exits 2 and keeps the file when --out exists and --force is not given',
      async check(ctx) {
        const dir = work(ctx, 'intake');
        const map = join(ctx.root, 'examples/acme/map/approved.yaml');
        const a = await cli(['intake', 'interview', '--map', map, '--out', 'q.yaml'], dir);
        const before = text(join(dir, 'q.yaml'));
        put(dir, 'q.yaml', `${before}# my answers\n`);
        const b = await cli(['intake', 'interview', '--map', map, '--out', 'q.yaml'], dir);
        return a.code === 0 && b.code === 2 && text(join(dir, 'q.yaml')).endsWith('# my answers\n')
          ? PASS
          : fail(`expected 0 then 2 with the answers kept; got ${a.code} and ${shown(b)}`);
      },
    }),
    tl({
      id: 'intake-dry-run-writes-nothing',
      tier: 3,
      component: 'driftbench intake',
      title:
        'cli.md "driftbench intake": --dry-run prints the cells, their weights and the turns to request, calls no model, and writes no folder',
      cause:
        'driftbench intake from-interview --dry-run prints "Cells: 20, 44 model turns to request" and writes nothing',
      async check(ctx) {
        const dir = work(ctx, 'intake-dry');
        const c = await cli(
          [
            'intake',
            'from-interview',
            join(ctx.root, 'examples/acme/reference/answers.yaml'),
            '--out',
            'ref',
            '--dry-run',
          ],
          dir,
        );
        return c.code === 0 &&
          /Cells: 20, 44 model turns to request, 0 cells dropped by the map\./.test(c.out) &&
          files(join(dir, 'ref')).length === 0
          ? PASS
          : fail(`expected the cell line and no files; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'pilot-plan-example-totals',
      tier: 3,
      component: 'driftbench pilot',
      title:
        'cli.md "driftbench pilot": pilot plan on the approved Acme map prints the cell counts and totals of the current approved map and generated suite',
      cause: 'driftbench pilot plan prints the current design totals for the Acme map and generated suite',
      async check(ctx) {
        const dir = work(ctx, 'pilot');
        const c = await cli(
          [
            'pilot',
            'plan',
            '--map',
            join(ctx.root, 'examples/acme/map/approved.yaml'),
            '--suite',
            join(ctx.root, 'examples/acme/generated/specs'),
          ],
          dir,
        );
        const want = await pilotContract(ctx.root);
        const totals = new RegExp(
          `total\\s+${want.conversations}\\s+${want.wordings}\\s+${want.runs}\\s+${want.blocks}`,
        );
        return c.code === 0 &&
          c.out.includes(`Pilot plan: ${want.cells} cells by behaviour`) &&
          totals.test(c.out)
          ? PASS
          : fail(`expected design totals ${JSON.stringify(want)}; got ${shown(c)}`);
      },
    }),
    tl({
      id: 'version-and-help-command',
      tier: 1,
      component: 'driftbench',
      title:
        'cli.md "Global options": -V prints the version, and driftbench help <command> prints the same as <command> --help',
      cause: 'driftbench -V prints a version number and help <command> equals <command> --help',
      async check(ctx) {
        const dir = work(ctx, 'version');
        const v = await cli(['--version'], dir);
        const h1 = await cli(['help', 'smoke'], dir);
        const h2 = await cli(['smoke', '--help'], dir);
        return expectAll([
          [v.code === 0 && /^\d+\.\d+\.\d+/.test(v.out.trim()), `expected a version number; got ${shown(v)}`],
          [h1.out.length > 0 && h1.out === h2.out, 'help smoke and smoke --help should print the same text'],
        ]);
      },
    }),
  );
  return items;
}

export function breakerItems(): BankItem[] {
  return [
    ...datasetItems(),
    ...importItems(),
    ...cliItems(),
    ...campaignItems(),
    ...specItems(),
    ...checkItems(),
    ...toolItems(),
  ];
}
