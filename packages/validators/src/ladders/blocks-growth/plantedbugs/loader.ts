import { join, relative } from 'node:path';
import { between, rngFor } from '../../blocks/harness';
import { type Action, plantedAgent } from '../../blocks/kinds';
import { runLoaded } from '../../blocks-breaker/kit';
import {
  type BankItem,
  type CheckEntry,
  CLI,
  CORE,
  cli,
  codesOf,
  folder,
  type ItemContext,
  loadFile,
  parseEntries,
  pitem,
  show,
  tok,
  writeAt,
} from './kit';

/**
 * plantedbugs.loader: rules of the spec files and their folders that the bank held only through the in-memory
 * validator or in one case.
 *
 * - `schema_version` names the spec format; a file written for a newer one is refused with SPEC_SCHEMA_VERSION
 *   (docs/reference/spec.md "Spec", docs/reference/cli.md "Issue codes"), by the file loader and the command line.
 * - A workspace `from` written ./<path> is read from the spec file's folder; any other relative path from the folder
 *   the run starts in (docs/reference/spec.md "WorldState workspace").
 * - A folder is searched recursively for *.yaml, *.yml and *.spec.json, in sorted order, dot entries, node_modules and
 *   dist skipped (docs/reference/cli.md "Paths").
 * - A YAML key written twice in one mapping is SPEC_PARSE (docs/reference/cli.md "Issue codes": not valid YAML; the
 *   help topic authoring-spec-format: YAML is parsed with unique keys), in any mapping and in either style.
 */

/** A valid spec of seeded words. */
function specOf(ctx: ItemContext, tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: tok(ctx, tag, 'spec', 9),
    ...extra,
    blocks: [
      {
        id: tok(ctx, tag, 'b0', 6),
        user: tok(ctx, tag, 'u0', 9),
        expect: { must: [tok(ctx, tag, 'm0', 8)] },
      },
    ],
  };
}

const entryFor = (entries: readonly CheckEntry[], name: string): CheckEntry | undefined =>
  entries.find((each) => (each.path ?? '') === name || (each.path ?? '').endsWith(`/${name}`));

/* ---------------------------------------------------------------------------------------------------------
 * schema_version: a newer format is refused with SPEC_SCHEMA_VERSION
 * ------------------------------------------------------------------------------------------------------- */

function versionItems(): BankItem[] {
  const out: BankItem[] = [];
  /** The files of one item: version 1, no version, the next version 2, and a later one; YAML or JSON. */
  const plant = (ctx: ItemContext, tag: string, ext: 'yaml' | 'spec.json') => {
    const dir = folder(ctx, tag);
    const later = between(rngFor(ctx.seed, `pb:${tag}:later`), 3, 9);
    const make = (slot: string, version: number | undefined) => {
      const name = `${tok(ctx, tag, `file:${slot}`, 8)}.${ext}`;
      const raw = specOf(ctx, `${tag}:${slot}`, version === undefined ? {} : { schema_version: version });
      writeAt(join(dir, name), ext === 'yaml' ? raw : `${JSON.stringify(raw, null, 2)}\n`);
      return { name, path: join(dir, name), version };
    };
    return {
      dir,
      good: [make('one', 1), make('none', undefined)],
      bad: [make('next', 2), make('later', later)],
    };
  };
  for (const ext of ['yaml', 'spec.json'] as const)
    out.push(
      pitem(
        `pb.schema-version.loader.${ext === 'yaml' ? 'yaml' : 'json'}`,
        3,
        3,
        CORE,
        'schema-version',
        `loadSpecFile refuses a ${ext} spec written for schema_version 2, the next format, and a later one with SPEC_SCHEMA_VERSION, and loads the same spec with schema_version 1 or none`,
        async (ctx) => {
          const files = plant(ctx, `schema-version.loader.${ext}`, ext);
          const problems: (string | false)[] = [];
          for (const each of files.good) {
            const got = await loadFile(ctx, each.path);
            problems.push(
              !got.ok &&
                `the spec with schema_version ${each.version ?? 'absent'} should load; it is refused with ${show(got.codes)}`,
            );
          }
          for (const each of files.bad) {
            const got = await loadFile(ctx, each.path);
            problems.push(
              (got.ok || !got.codes.includes('SPEC_SCHEMA_VERSION')) &&
                `the spec with schema_version ${each.version} names a format newer than 1 and should be refused with SPEC_SCHEMA_VERSION; it ${got.ok ? 'loads' : `is refused with ${show(got.codes)}`}`,
            );
          }
          return problems;
        },
      ),
    );
  for (const command of ['validate', 'lint'] as const)
    out.push(
      pitem(
        `pb.schema-version.cli.${command}`,
        3,
        3,
        CLI,
        'schema-version',
        `spec ${command} --json reports SPEC_SCHEMA_VERSION on a spec file written for schema_version 2 or later, and none on the same spec with schema_version 1 or none`,
        async (ctx) => {
          const files = plant(ctx, `schema-version.cli.${command}`, 'yaml');
          const result = await cli(ctx, ['spec', command, files.dir, '--json'], files.dir);
          const entries = parseEntries(result.out);
          if (typeof entries === 'string') return [`spec ${command} --json printed ${entries}`];
          return [
            ...files.good.map((each) => {
              const entry = entryFor(entries, each.name);
              return (
                (entry?.ok !== true || codesOf(entry.errors).length > 0) &&
                `${each.name} (schema_version ${each.version ?? 'absent'}) should be valid; spec ${command} gave ${show(entry)}`
              );
            }),
            ...files.bad.map((each) => {
              const entry = entryFor(entries, each.name);
              return (
                (entry?.ok !== false || !codesOf(entry.errors).includes('SPEC_SCHEMA_VERSION')) &&
                `${each.name} (schema_version ${each.version}) should be invalid with SPEC_SCHEMA_VERSION; spec ${command} gave ${show(entry)}`
              );
            }),
          ];
        },
      ),
    );
  return out;
}

/* ---------------------------------------------------------------------------------------------------------
 * workspace from: ./<path> from the spec's folder, any other relative path from the folder the run starts in
 * ------------------------------------------------------------------------------------------------------- */

type Where = 'spec' | 'block' | 'seed';

/** A spec of two blocks whose workspace starts from `from` at `where`; the file the agent saw on each block. */
async function fromRun(
  ctx: ItemContext,
  tag: string,
  specPath: string,
  from: string,
  where: Where,
  file: string,
): Promise<{ status: string; saw: boolean[] }> {
  const markers = [0, 1].map((b) => tok(ctx, tag, `marker${b}`, 9));
  const workspace = { from };
  const raw = {
    id: tok(ctx, tag, 'spec', 9),
    ...(where === 'spec' ? { given: { world: { workspace } } } : {}),
    ...(where === 'seed' ? { workspace_seed: from } : {}),
    blocks: markers.map((marker, b) => ({
      id: tok(ctx, tag, `block${b}`, 6),
      user: marker,
      ...(where === 'block' && b === 1 ? { given: { world: { workspace } } } : {}),
      expect: { must: ['Done'] },
    })),
  };
  writeAt(specPath, raw);
  const loaded = await loadFile(ctx, specPath);
  if (!loaded.ok) return { status: `refused ${show(loaded.codes)}`, saw: [false, false] };
  const actions = new Map<string, Action>(markers.map((marker) => [marker, { reply: 'Done.' }]));
  const agent = plantedAgent(ctx.product, 'code', actions, { scratch: ctx.scratch });
  const rec = await runLoaded(ctx.product, loaded.spec as never, agent.adapter);
  const delivered = agent.delivered();
  return {
    status: rec.status,
    saw: markers.map(
      (marker) =>
        delivered.find((turn) => turn.marker === marker)?.files?.some((each) => each.endsWith(file)) ?? false,
    ),
  };
}

function fromItems(): BankItem[] {
  const out: BankItem[] = [];
  /** Which block finds the workspace's files: both blocks for a spec-level folder, block 1 for a block's own. */
  const finds = (where: Where) => (where === 'block' ? [false, true] : [true, true]);
  for (const where of ['spec', 'block', 'seed'] as const) {
    const at =
      where === 'spec'
        ? "the spec's given"
        : where === 'block'
          ? "a block's given"
          : 'the workspace_seed string';
    if (where !== 'seed')
      out.push(
        pitem(
          `pb.workspace-from.${where}.plain-not-spec-folder`,
          3,
          1,
          CORE,
          'from-run-folder',
          `a workspace from written as a plain relative path in ${at} is not read from the spec file's folder: the agent never finds the files that folder holds, while the same folder named by its path from the folder the run starts in gives them${where === 'spec' ? ', and so does ./<path>' : ''}`,
          async (ctx) => {
            const tag = `workspace-from.${where}.plain-not-spec-folder`;
            const dir = folder(ctx, tag);
            const seed = tok(ctx, tag, 'seed', 8);
            const file = `${tok(ctx, tag, 'file', 7)}.txt`;
            writeAt(join(dir, 'specs', seed, file), `${tok(ctx, tag, 'line', 9)}\n`);
            const plain = await fromRun(
              ctx,
              `${tag}:plain`,
              join(dir, 'specs', 'plain.yaml'),
              seed,
              where,
              file,
            );
            const fromRunFolder = relative(process.cwd(), join(dir, 'specs', seed));
            const reached = await fromRun(
              ctx,
              `${tag}:reached`,
              join(dir, 'specs', 'reached.yaml'),
              fromRunFolder,
              where,
              file,
            );
            const dotted =
              where === 'spec'
                ? await fromRun(ctx, `${tag}:dot`, join(dir, 'specs', 'dot.yaml'), `./${seed}`, where, file)
                : undefined;
            const want = finds(where);
            return [
              reached.saw.join() !== want.join() &&
                `from ${fromRunFolder}, the same folder seen from the folder the run starts in, should give ${file} on blocks ${show(want)}; the agent found it on ${show(reached.saw)} (run ${reached.status})`,
              dotted &&
                dotted.saw.join() !== want.join() &&
                `from ./${seed} is read from the spec's folder, which holds ${file}: the agent should find it on blocks ${show(want)}; it found it on ${show(dotted.saw)} (run ${dotted.status})`,
              plain.saw.some(Boolean) &&
                `from ${seed}, with no ./, is read from the folder the run starts in, never from the spec's folder: the agent should never find ${file}; it found it on ${show(plain.saw)}`,
            ];
          },
        ),
      );
    out.push(
      pitem(
        `pb.workspace-from.${where}.plain-from-run-folder`,
        3,
        1,
        CORE,
        'from-run-folder',
        `a workspace from written as a plain relative path in ${at} is read from the folder the run starts in: the agent finds that folder's files, and the same path written ./<path> from the spec's folder finds nothing`,
        async (ctx) => {
          const tag = `workspace-from.${where}.plain-from-run-folder`;
          const dir = folder(ctx, tag);
          const seed = tok(ctx, tag, 'seed', 8);
          const file = `${tok(ctx, tag, 'file', 7)}.txt`;
          const target = join(dir, tok(ctx, tag, 'side', 8), seed);
          writeAt(join(target, file), `${tok(ctx, tag, 'line', 9)}\n`);
          // The folder seen from the folder the run starts in: a relative path that does not start with ./.
          const plainPath = relative(process.cwd(), target);
          const plain = await fromRun(
            ctx,
            `${tag}:plain`,
            join(dir, 'specs', 'plain.yaml'),
            plainPath,
            where,
            file,
          );
          const dotted = await fromRun(
            ctx,
            `${tag}:dot`,
            join(dir, 'specs', 'dot.yaml'),
            `./${seed}`,
            where,
            file,
          );
          const want = finds(where);
          return [
            plain.saw.join() !== want.join() &&
              `from ${plainPath}, with no ./, is read from the folder the run starts in, which leads to ${file}: the agent should find it on blocks ${show(want)}; it found it on ${show(plain.saw)} (run ${plain.status})`,
            dotted.saw.some(Boolean) &&
              `from ./${seed} is read from the spec's folder, which holds no ${seed}: the agent should never find ${file}; it found it on ${show(dotted.saw)}`,
          ];
        },
      ),
    );
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------
 * spec discovery: *.yaml, *.yml and *.spec.json, recursively, in sorted order, some entries skipped
 * ------------------------------------------------------------------------------------------------------- */

function discoveryItems(): BankItem[] {
  const out: BankItem[] = [];
  type Layout = { listed: string[]; unlisted: string[] };
  const check = async (
    ctx: ItemContext,
    tag: string,
    command: 'validate' | 'lint',
    layout: (name: (slot: string) => string) => Layout,
    sorted: boolean,
  ) => {
    const dir = folder(ctx, tag);
    const root = join(dir, tok(ctx, tag, 'root', 8));
    const files = layout((slot) => tok(ctx, tag, `name:${slot}`, 8));
    for (const [index, path] of [...files.listed, ...files.unlisted].entries()) {
      const raw = specOf(ctx, `${tag}:${index}`);
      writeAt(join(root, path), path.endsWith('.json') ? `${JSON.stringify(raw)}\n` : raw);
    }
    const result = await cli(ctx, ['spec', command, root, '--json'], dir);
    const entries = parseEntries(result.out);
    if (typeof entries === 'string') return [`spec ${command} --json printed ${entries}`];
    const seen = entries.map((each) => relative(root, join(dir, each.path ?? '')));
    const missing = files.listed.filter((path) => !seen.includes(path));
    const extra = seen.filter((path) => !files.listed.includes(path));
    const order = [...files.listed].sort();
    return [
      missing.length > 0 &&
        `spec ${command} should find ${show(missing)} in the folder; it read ${show(seen)}`,
      extra.length > 0 &&
        `spec ${command} should read only *.yaml, *.yml and *.spec.json outside dot entries, node_modules and dist; it also read ${show(extra)}`,
      sorted &&
        missing.length === 0 &&
        extra.length === 0 &&
        seen.join() !== order.join() &&
        `spec ${command} should read the files in sorted order ${show(order)}; it read ${show(seen)}`,
    ];
  };
  const mixed = (name: (slot: string) => string): Layout => ({
    listed: [
      `${name('a')}.yaml`,
      `${name('b')}.yml`,
      `${name('c')}.spec.json`,
      `${name('d')}/${name('e')}.yml`,
    ],
    unlisted: [`${name('f')}.json`, `${name('g')}.txt`, `${name('h')}.ymlx`],
  });
  const skipped = (name: (slot: string) => string): Layout => ({
    listed: [`${name('a')}/${name('b')}/${name('c')}.yml`, `${name('a')}/${name('d')}.yaml`],
    unlisted: [
      `.${name('e')}/${name('f')}.yml`,
      `.${name('g')}.yml`,
      `node_modules/${name('h')}.yml`,
      `dist/${name('i')}.yml`,
      `${name('a')}/node_modules/${name('j')}.yaml`,
    ],
  });
  const many = (name: (slot: string) => string): Layout => ({
    listed: ['a', 'b', 'c', 'd', 'e', 'f'].map((slot, i) => `${name(slot)}.${i % 2 === 0 ? 'yml' : 'yaml'}`),
    unlisted: [],
  });
  for (const command of ['validate', 'lint'] as const)
    out.push(
      pitem(
        `pb.discovery.${command}.yml-beside-yaml-and-json`,
        2,
        3,
        CLI,
        'discovery-yml',
        `spec ${command} on a folder reads its *.yml files, at the top and in a subfolder, beside *.yaml and *.spec.json, and no plain .json, .txt or other file`,
        (ctx) => check(ctx, `discovery.${command}.mixed`, command, mixed, false),
      ),
    );
  out.push(
    pitem(
      'pb.discovery.validate.yml-skipped-entries',
      3,
      3,
      CLI,
      'discovery-yml',
      'spec validate on a folder reads the *.yml files of nested folders, and skips those under a dot entry, node_modules or dist and a .yml file whose name starts with a dot',
      (ctx) => check(ctx, 'discovery.validate.skipped', 'validate', skipped, false),
    ),
  );
  out.push(
    pitem(
      'pb.discovery.validate.yml-sorted',
      2,
      3,
      CLI,
      'discovery-yml',
      'spec validate on a folder of *.yml and *.yaml files reads every one of them, in sorted order',
      (ctx) => check(ctx, 'discovery.validate.sorted', 'validate', many, true),
    ),
  );
  return out;
}

/* ---------------------------------------------------------------------------------------------------------
 * a YAML key written twice in one mapping is SPEC_PARSE
 * ------------------------------------------------------------------------------------------------------- */

type Shape = { id: string; title: string; text: (w: (slot: string) => string, twice: boolean) => string };

/** YAML texts of one valid spec, with one key written twice; the twin is the same text without the repeat. */
const SHAPES: readonly Shape[] = [
  {
    id: 'top-level',
    title: 'a key of the spec itself',
    text: (w, twice) =>
      `id: ${w('id')}\nversion: ${w('v1')}\n${twice ? `version: ${w('v2')}\n` : ''}blocks:\n  - id: ${w('b')}\n    user: ${w('u')}\n    expect:\n      must:\n        - ${w('m')}\n`,
  },
  {
    id: 'block',
    title: "a key of a block's mapping",
    text: (w, twice) =>
      `id: ${w('id')}\nblocks:\n  - id: ${w('b')}\n    user: ${w('u')}\n${twice ? `    id: ${w('b2')}\n` : ''}    expect:\n      must:\n        - ${w('m')}\n`,
  },
  {
    id: 'expect',
    title: "a key of a block's expect",
    text: (w, twice) =>
      `id: ${w('id')}\nblocks:\n  - id: ${w('b')}\n    user: ${w('u')}\n    expect:\n      must:\n        - ${w('m')}\n      ${twice ? 'must' : 'must_not'}:\n        - ${w('n')}\n`,
  },
  {
    id: 'nested-ledger',
    title: 'a fact of a nested given.ledger',
    text: (w, twice) =>
      `id: ${w('id')}\ngiven:\n  ledger:\n    ${w('f')}: ${w('x')}\n    ${twice ? w('f') : w('g')}: ${w('y')}\nblocks:\n  - id: ${w('b')}\n    user: ${w('u')}\n    expect:\n      must:\n        - ${w('m')}\n`,
  },
  {
    id: 'flow-mapping',
    title: 'a key of a flow mapping written in braces',
    text: (w, twice) =>
      `id: ${w('id')}\nblocks:\n  - { id: ${w('b')}, user: ${w('u')}, ${twice ? `user: ${w('u2')}, ` : ''}expect: { must: [${w('m')}] } }\n`,
  },
  {
    id: 'list-item',
    title: 'a key of a mapping inside a list, a tool expectation',
    text: (w, twice) =>
      `id: ${w('id')}\nblocks:\n  - id: ${w('b')}\n    user: ${w('u')}\n    expect:\n      tools:\n        - label: ${w('t')}\n${twice ? `          label: ${w('t2')}\n` : ''}`,
  },
];

function duplicateItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const shape of SHAPES)
    out.push(
      pitem(
        `pb.yaml-duplicate-key.${shape.id}`,
        3,
        3,
        CORE,
        'yaml-duplicate-key',
        `a YAML spec file that writes ${shape.title} twice is refused with SPEC_PARSE by loadSpecFile and by spec validate, and the same file without the repeat loads`,
        async (ctx) => {
          const tag = `yaml-duplicate-key.${shape.id}`;
          const dir = folder(ctx, tag);
          const w = (slot: string) => tok(ctx, tag, slot, 8);
          const twicePath = writeAt(join(dir, `${w('twice')}.yaml`), shape.text(w, true));
          const oncePath = writeAt(join(dir, `${w('once')}.yaml`), shape.text(w, false));
          const twice = await loadFile(ctx, twicePath);
          const once = await loadFile(ctx, oncePath);
          const result = await cli(ctx, ['spec', 'validate', twicePath, oncePath, '--json'], dir);
          const entries = parseEntries(result.out);
          const twiceEntry =
            typeof entries === 'string' ? undefined : entryFor(entries, `${w('twice')}.yaml`);
          const onceEntry = typeof entries === 'string' ? undefined : entryFor(entries, `${w('once')}.yaml`);
          return [
            !once.ok && `the file without a repeated key should load; it is refused with ${show(once.codes)}`,
            (twice.ok || !twice.codes.includes('SPEC_PARSE')) &&
              `loadSpecFile should refuse the file that writes ${shape.title} twice with SPEC_PARSE; it ${twice.ok ? 'loads it' : `refuses it with ${show(twice.codes)}`}`,
            typeof entries === 'string' && `spec validate --json printed ${entries}`,
            (onceEntry?.ok !== true || codesOf(onceEntry.errors).length > 0) &&
              `spec validate should find the file without a repeated key valid; it gave ${show(onceEntry)}`,
            (twiceEntry?.ok !== false || !codesOf(twiceEntry.errors).includes('SPEC_PARSE')) &&
              `spec validate should report SPEC_PARSE for the file that writes ${shape.title} twice; it gave ${show(twiceEntry)}`,
          ];
        },
      ),
    );
  return out;
}

export function loaderItems(): BankItem[] {
  return [...versionItems(), ...fromItems(), ...discoveryItems(), ...duplicateItems()];
}
