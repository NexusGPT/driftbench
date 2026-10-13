import { relative, resolve } from 'node:path';
import { loadSpecs } from '@agent-nexus/driftbench-core';
import {
  diffFiles,
  openStore,
  parseVersionRef,
  type RegistryFile,
  type RegistryKind,
  type RegistryVersion,
  readTree,
  restoreFiles,
  type SqliteStore,
} from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import { reason as describe } from '../files';
import type { Io } from '../io';

type StoreOption = { store: string; json?: boolean };

const HELP: Record<RegistryKind, string> = {
  dataset: 'Version spec sets in the store: push, list, diff and restore immutable versions.',
  prompt: 'Version prompts in the store: push, list, diff and restore immutable versions.',
};

/**
 * `driftbench dataset push|list|diff|restore` and `driftbench prompt push|list|diff|restore`: the
 * content-addressed registry of the store. A version is immutable; restore writes its exact bytes.
 */
export function registerRegistryCommands(program: Command, io: Io, setExit: (code: number) => void): void {
  for (const kind of ['dataset', 'prompt'] as const) {
    const what = kind === 'dataset' ? 'a folder of spec files' : 'a prompt file, or a folder of them';
    const command = program.command(kind).description(HELP[kind]);
    command
      .command('push')
      .description(`Store ${what} as the next version of <name>; the same content again changes nothing.`)
      .argument('<name>', 'the name: letters, digits, dots, underscores and hyphens')
      .argument('<path>', kind === 'dataset' ? 'the folder of spec files' : 'the prompt file or folder')
      .requiredOption('--store <file>', 'the store that keeps the versions')
      .option('--note <text>', 'a note kept with the version')
      .option('--json', 'print one JSON document')
      .action(async (name: string, path: string, options: StoreOption & { note?: string }) => {
        setExit(await pushCommand(kind, name, path, options, io));
      });
    command
      .command('list')
      .description(`List the versions of every ${kind}, or of one.`)
      .argument('[name]', `the ${kind} name`)
      .requiredOption('--store <file>', 'the store that keeps the versions')
      .option('--json', 'print one JSON document')
      .action(async (name: string | undefined, options: StoreOption) => {
        setExit(await listCommand(kind, name, options, io));
      });
    command
      .command('diff')
      .description(
        'Show what changed between two versions, or between a version and a folder. Exit 1 when they differ.',
      )
      .argument('<ref>', 'name@version; the latest version without @')
      .argument(
        '[other]',
        'the version to compare with: name@version, @version or a number; the one before <ref> without it',
      )
      .requiredOption('--store <file>', 'the store that keeps the versions')
      .option('--dir <path>', 'compare with the files in this folder or file instead')
      .option('--json', 'print one JSON document')
      .action(async (ref: string, other: string | undefined, options: StoreOption & { dir?: string }) => {
        setExit(await diffCommand(kind, ref, other, options, io));
      });
    command
      .command('restore')
      .description('Write the exact files of a version back, to where they were pushed from or to --out.')
      .argument('<ref>', 'name@version; the latest version without @')
      .requiredOption('--store <file>', 'the store that keeps the versions')
      .option('--out <path>', 'where to write: a folder, or a file path for a version of one file')
      .option('--force', 'overwrite files that differ from the version')
      .option('--json', 'print one JSON document')
      .action(async (ref: string, options: StoreOption & { out?: string; force?: boolean }) => {
        setExit(await restoreCommand(kind, ref, options, io));
      });
  }
}

export async function pushCommand(
  kind: RegistryKind,
  name: string,
  path: string,
  options: StoreOption & { note?: string },
  io: Io,
): Promise<number> {
  const source = resolve(io.cwd, path);
  let tree: Awaited<ReturnType<typeof readTree>>;
  try {
    tree = await readTree(source);
  } catch (cause) {
    io.err(`Cannot read ${path}: ${describe(cause)}\n`);
    return 2;
  }
  if (tree.files.length === 0) {
    io.err(`${path} holds no file to push.\n`);
    return 2;
  }
  if (kind === 'dataset') {
    const results = await loadSpecs([source]);
    const invalid = results.filter((result) => !result.ok);
    if (results.length === 0) {
      io.err(`${path} holds no spec file: a dataset is a folder of *.yaml, *.yml or *.spec.json specs.\n`);
      return 2;
    }
    if (invalid.length > 0) {
      for (const result of invalid) {
        io.err(`✗ ${show(io, result.path)}\n`);
        if (!result.ok) {
          for (const issue of result.errors)
            io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
        }
      }
      io.err('Fix the invalid specs first: nothing was pushed.\n');
      return 1;
    }
  }
  return withStore(options.store, io, async (store) => {
    const pushed = await store.pushVersion(kind, name, tree.files, {
      source,
      single: tree.single,
      ...(options.note === undefined ? {} : { note: options.note }),
    });
    const { version } = pushed;
    const files = `${version.files.length} file${version.files.length === 1 ? '' : 's'}`;
    if (options.json) {
      io.out(`${JSON.stringify({ created: pushed.created, ...version }, null, 2)}\n`);
    } else if (pushed.created) {
      io.out(
        `Pushed ${kind} ${label(version)} (hash ${version.hash.slice(0, 12)}): ${files} from ${show(io, source)}.\n`,
      );
    } else {
      io.out(`Unchanged: ${kind} ${label(version)} already holds these ${files}.\n`);
    }
    return 0;
  });
}

async function listCommand(kind: RegistryKind, name: string | undefined, options: StoreOption, io: Io) {
  return withStore(options.store, io, async (store) => {
    const versions = await store.listVersions(kind, name);
    // A name the store does not hold is bad input, exit 2, as for diff and restore; an empty registry is not.
    if (name !== undefined && versions.length === 0) {
      io.err(`No ${kind} ${name} in ${options.store}.\n`);
      return 2;
    }
    if (options.json) {
      io.out(`${JSON.stringify(versions, null, 2)}\n`);
      return 0;
    }
    if (versions.length === 0) {
      io.out(`No ${kind}${name === undefined ? '' : ` ${name}`} in ${options.store}.\n`);
      return 0;
    }
    for (const version of versions) {
      const files = `${version.files.length} file${version.files.length === 1 ? '' : 's'}`;
      const columns = [label(version), version.hash.slice(0, 12), files, version.createdAt];
      if (version.note !== undefined) columns.push(version.note);
      io.out(`${columns.join('  ')}\n`);
    }
    return 0;
  });
}

async function diffCommand(
  kind: RegistryKind,
  ref: string,
  other: string | undefined,
  options: StoreOption & { dir?: string },
  io: Io,
): Promise<number> {
  return withStore(options.store, io, async (store) => {
    const left = await findVersion(store, kind, ref, options.store, io);
    if (!left) return 2;
    let before: RegistryVersion = left;
    let after: { label: string; files: RegistryFile[] };
    if (options.dir !== undefined) {
      const tree = await readTree(resolve(io.cwd, options.dir)).catch((cause: unknown) => {
        io.err(`Cannot read ${options.dir}: ${describe(cause)}\n`);
        return undefined;
      });
      if (!tree) return 2;
      after = { label: options.dir, files: tree.files };
    } else if (other !== undefined) {
      const otherRef = other.startsWith('@')
        ? `${left.name}${other}`
        : /^\d+$/.test(other)
          ? `${left.name}@${other}`
          : other;
      const right = await findVersion(store, kind, otherRef, options.store, io);
      if (!right) return 2;
      after = { label: label(right), files: await store.readVersionFiles(right) };
    } else {
      if (left.version === 1) {
        io.err(`${label(left)} is the first version: name another, or compare with a folder with --dir.\n`);
        return 2;
      }
      const previous = await store.getVersion(kind, left.name, String(left.version - 1));
      if (!previous) {
        io.err(`No ${kind} ${left.name}@${left.version - 1} in ${options.store}.\n`);
        return 2;
      }
      before = previous;
      after = { label: label(left), files: await store.readVersionFiles(left) };
    }
    const changes = diffFiles(await store.readVersionFiles(before), after.files);
    if (options.json) {
      io.out(`${JSON.stringify({ from: label(before), to: after.label, changes }, null, 2)}\n`);
      return changes.length === 0 ? 0 : 1;
    }
    if (changes.length === 0) {
      io.out(`No difference between ${label(before)} and ${after.label}.\n`);
      return 0;
    }
    const mark = { added: 'A', removed: 'D', changed: 'M' } as const;
    for (const change of changes) {
      io.out(`${mark[change.status]} ${change.path}\n`);
      for (const line of change.lines ?? []) io.out(`    ${line}\n`);
    }
    io.out(
      `${changes.length} file${changes.length === 1 ? '' : 's'} differ${changes.length === 1 ? 's' : ''} between ${label(before)} and ${after.label}.\n`,
    );
    return 1;
  });
}

async function restoreCommand(
  kind: RegistryKind,
  ref: string,
  options: StoreOption & { out?: string; force?: boolean },
  io: Io,
): Promise<number> {
  return withStore(options.store, io, async (store) => {
    const version = await findVersion(store, kind, ref, options.store, io);
    if (!version) return 2;
    const target = options.out !== undefined ? resolve(io.cwd, options.out) : version.source;
    if (target === undefined) {
      io.err(`${label(version)} was pushed without its source path: give --out.\n`);
      return 2;
    }
    const files = await store.readVersionFiles(version);
    const single = version.single === true;
    const report = await restoreFiles(files, target, { single, ...(options.force ? { force: true } : {}) });
    if (options.json) {
      io.out(
        `${JSON.stringify({ version: label(version), target: show(io, target), ...report }, null, 2)}\n`,
      );
      return report.conflicts.length === 0 ? 0 : 1;
    }
    if (report.conflicts.length > 0) {
      for (const path of report.conflicts) io.err(`✗ ${path} differs from ${label(version)}\n`);
      io.err('Nothing was written. Restore over them with --force.\n');
      return 1;
    }
    io.out(
      `Restored ${kind} ${label(version)} into ${show(io, target)}: ${report.written} written, ${report.unchanged} unchanged.\n`,
    );
    if (report.extra.length > 0) {
      const count = report.extra.length;
      io.out(
        `${count} file${count === 1 ? '' : 's'} the version does not hold ${count === 1 ? 'is' : 'are'} left: ${report.extra.join(', ')}\n`,
      );
    }
    return 0;
  });
}

async function findVersion(
  store: SqliteStore,
  kind: RegistryKind,
  text: string,
  storeLabel: string,
  io: Io,
): Promise<RegistryVersion | undefined> {
  const { name, ref } = parseVersionRef(text);
  let version: RegistryVersion | undefined;
  try {
    version = await store.getVersion(kind, name, ref);
  } catch (cause) {
    io.err(`${describe(cause).replace(/^store: /, '')}\n`);
    return undefined;
  }
  if (version) return version;
  const held = await store.listVersions(kind, name);
  io.err(
    held.length === 0
      ? `No ${kind} ${name} in ${storeLabel}.\n`
      : `No ${kind} ${text} in ${storeLabel}. Its versions: ${held.map((each) => each.version).join(', ')}.\n`,
  );
  return undefined;
}

async function withStore(
  path: string,
  io: Io,
  work: (store: SqliteStore) => Promise<number>,
): Promise<number> {
  let store: SqliteStore;
  try {
    store = openStore(resolve(io.cwd, path));
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${describe(cause)}\n`);
    return 2;
  }
  try {
    return await work(store);
  } catch (cause) {
    io.err(`${describe(cause)}\n`);
    return 2;
  } finally {
    await store.close();
  }
}

function label(version: RegistryVersion): string {
  return `${version.name}@${version.version}`;
}

function show(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}
