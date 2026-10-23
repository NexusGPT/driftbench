import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify } from 'yaml';
import { compileGlob, matchGlob } from '../estate-model/glob';
import { folderHolding, locateFile, locateInside } from '../estate-model/locate';
import type { TypeSet } from '../estate-model/part-type';
import { runtimeProfile, runtimeProfileNames } from '../runtime-profile';
import { parseSetupText, resolveSetupSources, type ResolvedSetupSource, type SetupDocument } from './schema';

/** A registry reader's metadata, with no prose or secrets retained in the doctor's report. */
export type SetupRead = {
  runtime: string;
  files: Array<{ path: string; kind: string; text: string }>;
  notes?: Array<{ file: string; message: string }>;
  ignored?: { paths: string[] };
};
/** Dependency inversion: core owns policy, the CLI dispatches through the estate readerFor registry. */
export type SetupReader = (id: string, root: string, source: ResolvedSetupSource) => Promise<SetupRead | undefined>;
export type DoctorDetection = {
  field: string; value: string; confidence: number;
  evidence: Array<{ source: string; file: string; reader: string; reason: string }>;
};
export type DoctorResult = {
  draft: SetupDocument;
  detections: DoctorDetection[];
  sources: Array<{ id: string; reader: string; files: Array<{ path: string; kind: string }> }>;
  coverage: { status: 'pass' | 'fail' | 'not-run'; read: number; covered: number; unknown: string[]; skipped: Array<{ what: string; reason: string }> };
  drift: { status: 'pass' | 'fail' | 'not-run'; changes: Array<{ source: string; path: string; kind: 'added' | 'removed' | 'changed' }> };
  nextSteps: Array<{ action: string; usd: number | null; allowed: boolean; reason: string }>;
  advice: string[];
};
type DiskFile = { path: string; absolute: string; sha256: string };
type Link = { path: string; target: string };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const inside = (root: string, file: string) => { const path = relative(root, file); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep)); };
const slash = (path: string) => path.split(sep).join('/');

/** Match an explicit root-relative glob, including descendants of a matching directory. */
function matches(pattern: string, path: string): boolean {
  const parsed = compileGlob(pattern.replace(/\/$/, ''));
  if (!parsed.ok) return false;
  const segments = path.split('/');
  return segments.some((_, index) => matchGlob(parsed.glob, segments.slice(0, index + 1).join('/')) !== undefined);
}

/** Profile ignore rules may be basename globs. Setup scope and privacy globs are always root-relative. */
function ignored(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matches(pattern, path) || (!pattern.includes('/') && path.split('/').some((name) => matches(pattern, name))));
}

function defaults(runtime: string | null): SetupDocument {
  return {
    version: 1, sources: [{ id: 'project', path: '.', kind: 'project', reader: runtime ?? 'unknown' }],
    runtime, roles: {}, scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] }, budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: [] },
  };
}

/** Walk only explicitly mapped roots. Never follow links outside one, and never use process HOME. */
async function inventory(source: ResolvedSetupSource, setup: SetupDocument, setupFile: string, skipped: DoctorResult['coverage']['skipped']): Promise<{ files: DiskFile[]; links: Link[] }> {
  const files: DiskFile[] = [];
  const links: Link[] = [];
  const profile = runtimeProfile(setup.runtime ?? source.reader);
  const canonical = await realpath(source.root).catch(() => undefined);
  if (!canonical) { skipped.push({ what: source.id, reason: 'source unavailable' }); return { files, links }; }
  const walk = async (folder: string, prefix: string, ancestors: Set<string>): Promise<void> => {
    const real = await realpath(folder);
    if (ancestors.has(real)) { skipped.push({ what: `${source.id}:${prefix}`, reason: 'symlink cycle' }); return; }
    const next = new Set([...ancestors, real]);
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(folder, entry.name);
      const what = `${source.id}:${path}`;
      if (resolve(source.root, path) === setupFile || path === 'driftbench.setup.yaml') continue;
      let reason: string | undefined;
      if (setup.privacy.exclude.some((pattern) => matches(pattern, path))) reason = 'privacy';
      else if (setup.scope.exclude.some((pattern) => matches(pattern, path))) reason = 'scope';
      else if (ignored(path, profile?.ignore ?? ['.git', 'node_modules'])) reason = 'ignored';
      if (reason) { skipped.push({ what, reason }); continue; }
      let info: { isDirectory(): boolean; isFile(): boolean } = entry;
      if (entry.isSymbolicLink()) {
        const target = await realpath(absolute).catch(() => undefined);
        if (!target || !inside(canonical, target)) { skipped.push({ what, reason: 'unmapped symlink' }); continue; }
        links.push({ path, target: slash(relative(canonical, target)) });
        const targetInfo = await stat(absolute);
        // Both Dirent and Stats expose the file/directory tests used below.
        info = targetInfo;
      }
      if (info.isDirectory()) await walk(absolute, path, next);
      else if (info.isFile()) {
        if (!setup.scope.include.some((pattern) => matches(pattern, path))) { skipped.push({ what, reason: 'scope' }); continue; }
        const size = (await stat(absolute)).size;
        if (size > 1024 * 1024) { skipped.push({ what, reason: 'larger than 1 MB' }); continue; }
        const bytes = await readFile(absolute);
        files.push({ path, absolute, sha256: hash(bytes) });
      }
    }
  };
  await walk(source.root, '', new Set());
  return { files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), links };
}

/** Read a filtered snapshot, so even readers with legacy home fallbacks cannot cross declared boundaries. */
async function snapshotRead(source: ResolvedSetupSource, files: DiskFile[], setup: SetupDocument, read: SetupReader, skipped: DoctorResult['coverage']['skipped']): Promise<SetupRead | undefined> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-doctor-'));
  try {
    const profile = runtimeProfile(setup.runtime ?? source.reader);
    for (const file of files) {
      const destination = join(root, file.path);
      await mkdir(dirname(destination), { recursive: true });
      let bytes: Uint8Array | string = await readFile(file.absolute);
      if (profile?.configFiles.includes(file.path)) {
        try {
          const value: unknown = parseYaml(Buffer.from(bytes).toString('utf8'), { uniqueKeys: true });
          if (value && typeof value === 'object' && !Array.isArray(value) && 'userSkills' in value) {
            // Each home source is read independently. Never let a legacy config resolve a second home.
            const { userSkills: _userSkills, ...safe } = value;
            bytes = stringify(safe);
            skipped.push({ what: `${source.id}:${file.path}#userSkills`, reason: setup.sources.some((entry) => entry.kind === 'home') ? 'home read through mapped source' : 'home not mapped' });
          }
        } catch {
          // An invalid config is still the reader's responsibility, and cannot yield a parsed home path.
        }
      }
      await writeFile(destination, bytes);
    }
    return await read(source.reader, root, source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Whether declared locators cover a file. Contained types apply only inside their declared parent folders. */
function covered(types: TypeSet, path: string): boolean {
  return types.types.some((type) => {
    if (locateFile(type, path)) return true;
    return types.types.some((parent) => parent.contains.includes(type.name) && (() => {
      const place = folderHolding(parent, path);
      return place !== undefined && locateInside(type, place.inner) !== undefined;
    })());
  });
}

function driftOf(before: SetupDocument['drift'], files: NonNullable<SetupDocument['drift']>['files']): DoctorResult['drift'] {
  if (!before) return { status: 'not-run', changes: [] };
  const old = new Map(before.files.map((file) => [`${file.source}:${file.path}`, file]));
  const now = new Map(files.map((file) => [`${file.source}:${file.path}`, file]));
  const changes: DoctorResult['drift']['changes'] = [];
  for (const [key, file] of now) {
    const previous = old.get(key);
    if (!previous || previous.sha256 !== file.sha256) changes.push({ source: file.source, path: file.path, kind: previous ? 'changed' : 'added' });
  }
  for (const [key, file] of old) if (!now.has(key)) changes.push({ source: file.source, path: file.path, kind: 'removed' });
  return { status: changes.length ? 'fail' : 'pass', changes };
}

/** Inspect a setup without executing commands or calling a model. Runtime claims need registry-reader evidence. */
export async function diagnoseSetup(root: string, read: SetupReader, declared?: SetupDocument, setupFile = join(root, 'driftbench.setup.yaml')): Promise<DoctorResult> {
  root = resolve(root);
  setupFile = resolve(setupFile);
  let draft = declared ? structuredClone(declared) : defaults(null);
  const result: DoctorResult = {
    draft, detections: [], sources: [], coverage: { status: 'not-run', read: 0, covered: 0, unknown: [], skipped: [] },
    drift: { status: 'not-run', changes: [] }, nextSteps: [], advice: [],
  };
  const candidateNames = declared ? [declared.runtime] : runtimeProfileNames();
  if (!declared) {
    const candidates: Array<{ runtime: string; evidence: DoctorDetection['evidence'] }> = [];
    for (const name of candidateNames) {
      if (!name) continue;
      const candidate = defaults(name);
      const parsed = parseSetupText(JSON.stringify(candidate), runtimeProfile(name));
      if (!parsed.ok) continue;
      const source = resolveSetupSources(candidate, setupFile, parsed.types)[0];
      if (!source) continue;
      const disk = await inventory(source, candidate, setupFile, []);
      const raw = await snapshotRead(source, disk.files, candidate, read, []);
      const evidence = raw?.files.filter((file) => file.kind !== 'other').map((file) => ({ source: source.id, file: file.path, reader: name, reason: `reader classified ${file.kind}` })) ?? [];
      if (evidence.length) candidates.push({ runtime: name, evidence });
    }
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (candidate) {
        draft = defaults(candidate.runtime);
        result.draft = draft;
        result.detections.push({ field: 'runtime', value: candidate.runtime, confidence: 0.9, evidence: candidate.evidence });
      }
    } else result.advice.push(candidates.length ? 'Multiple runtimes detected: declare runtime and per-source readers.' : 'No runtime detected: declare a registered runtime and source reader.');
  }
  const profile = draft.runtime ? runtimeProfile(draft.runtime) : undefined;
  const parsed = parseSetupText(JSON.stringify(draft), profile);
  if (!parsed.ok) throw new Error(`Invalid setup: ${parsed.errors.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  if (draft.runtime && !profile) result.advice.push(`No runtime profile registered for ${draft.runtime}.`);
  const sources = resolveSetupSources(draft, setupFile, parsed.types);
  const manifest: NonNullable<SetupDocument['drift']>['files'] = [];
  const disks = new Map<string, DiskFile[]>();
  for (const source of sources) {
    const disk = await inventory(source, draft, setupFile, result.coverage.skipped);
    disks.set(source.id, disk.files);
    manifest.push(...disk.files.map((file) => {
      const link = disk.links.find((entry) => entry.path === file.path);
      return { source: source.id, path: file.path, sha256: link ? hash(Buffer.from(`link:${link.target}\0${file.sha256}`)) : file.sha256 };
    }));
    for (const link of disk.links) if (!disk.files.some((file) => file.path === link.path))
      manifest.push({ source: source.id, path: link.path, sha256: hash(Buffer.from(`link:${link.target}`)) });
    const raw = await snapshotRead(source, disk.files, draft, read, result.coverage.skipped);
    result.sources.push({ id: source.id, reader: source.reader, files: raw?.files.map(({ path, kind }) => ({ path, kind })) ?? [] });
    if (!raw) result.coverage.skipped.push({ what: source.id, reason: 'reader unavailable' });
    const readPaths = new Set(raw?.files.map((file) => file.path) ?? []);
    result.coverage.read += readPaths.size;
    for (const file of disk.files) {
      const what = `${source.id}:${file.path}`;
      const known = covered(parsed.types, file.path);
      if (known) result.coverage.covered++;
      else result.coverage.unknown.push(what);
      if (known && !readPaths.has(file.path)) result.coverage.skipped.push({ what, reason: 'type covered; reader did not read' });
    }
    for (const note of raw?.notes ?? []) result.coverage.skipped.push({ what: `${source.id}:${note.file}`, reason: 'reader limitation' });
    for (const path of raw?.ignored?.paths ?? []) result.coverage.skipped.push({ what: `${source.id}:${path}`, reason: 'reader ignored' });
    for (const link of disk.links) {
      const targetSource = sources.find((entry) => resolve(entry.root) === resolve(source.root, link.target));
      const deploymentProfile = runtimeProfile(draft.runtime ?? '');
      if (!targetSource || !deploymentProfile || !link.path.startsWith(`${deploymentProfile.layout.root}/`)) continue;
      const binding = { runtime: deploymentProfile.name, deployedRoot: source.id, deployedPath: link.path, method: 'link' as const };
      const target = draft.sources.find((entry) => entry.id === targetSource.id);
      if (target && !(target.bindings ?? []).some((entry) => JSON.stringify(entry) === JSON.stringify(binding))) target.bindings = [...(target.bindings ?? []), binding];
      result.detections.push({ field: `sources.${targetSource.id}.bindings`, value: link.path, confidence: 1, evidence: [{ source: source.id, file: link.path, reader: source.reader, reason: `symlink targets mapped source ${targetSource.id}` }] });
    }
  }
  result.coverage.unknown.sort();
  result.coverage.status = result.coverage.read === 0 ? 'not-run' : result.coverage.unknown.length || result.coverage.skipped.some((entry) => entry.reason !== 'ignored') ? 'fail' : 'pass';
  result.drift = driftOf(declared?.drift, manifest);
  for (const source of sources) {
    for (const target of source.bindings) {
      const deployed = resolve(target.root, target.deployedPath);
      const info = await lstat(deployed).catch(() => undefined);
      const real = await realpath(deployed).catch(() => undefined);
      const expected = await realpath(source.root).catch(() => undefined);
      let agrees = target.method === 'link' ? info?.isSymbolicLink() && real === expected : info?.isDirectory() && !info.isSymbolicLink();
      if (agrees && target.method === 'copy') {
        const skipped: DoctorResult['coverage']['skipped'] = [];
        const copy = await inventory({ ...source, root: deployed }, draft, setupFile, skipped);
        const fingerprints = (files: DiskFile[]) => files.map(({ path, sha256 }) => ({ path, sha256 }));
        agrees = skipped.every((entry) => entry.reason === 'ignored') && JSON.stringify(fingerprints(copy.files)) === JSON.stringify(fingerprints(disks.get(source.id) ?? []));
      }
      if (!agrees) {
        result.coverage.skipped.push({ what: `${source.id}:${target.deployedPath}`, reason: 'deployment disagrees with setup' });
        if (declared?.drift) {
          result.drift.status = 'fail';
          result.drift.changes.push({ source: source.id, path: target.deployedPath, kind: 'changed' });
        }
      }
    }
  }
  if (declared?.drift && result.coverage.skipped.some((entry) => entry.reason === 'source unavailable' || entry.reason === 'reader unavailable')) result.drift.status = 'fail';
  if (result.coverage.status === 'pass' && result.coverage.skipped.some((entry) => entry.reason === 'deployment disagrees with setup')) result.coverage.status = 'fail';
  result.draft = { ...draft, drift: { files: manifest } };
  const price = draft.budget.pricing;
  const usd = price ? draft.budget.modelCalls * (price.inputTokensPerCall * price.inputUsdPerMillion + price.outputTokensPerCall * price.outputUsdPerMillion) / 1_000_000 : null;
  result.nextSteps = [
    { action: 'Review unknown files and declare their types', usd: 0, allowed: true, reason: 'Local inspection; no execution or model call.' },
    { action: 'Run driftbench doctor --check', usd: 0, allowed: true, reason: 'Content fingerprint comparison; no execution or model call.' },
    { action: 'Model-assisted evaluation', usd, allowed: draft.privacy.model === 'allow' && draft.budget.modelCalls > 0 && usd !== null && usd <= draft.budget.usd, reason: price ? 'Estimate from declared rates, call count and token limits; no call made.' : 'Unknown price: declare budget.pricing before approving spend.' },
    { action: 'Execute declared commands', usd: 0, allowed: draft.execute.policy === 'allow' && draft.execute.commands.length > 0, reason: 'Doctor does not execute. Only explicitly allowed commands may run in a future execution step.' },
  ];
  if (!draft.sources.some((source) => source.kind === 'home')) result.advice.push('home not mapped');
  if (result.coverage.unknown.length) result.advice.push('Coverage is incomplete: declare types for unknown files or explicitly exclude them.');
  if (result.coverage.status === 'not-run') result.advice.push('Not run: no reader inputs.');
  if (!declared?.drift) result.advice.push('Review and save the draft to establish a drift baseline.');
  return result;
}
