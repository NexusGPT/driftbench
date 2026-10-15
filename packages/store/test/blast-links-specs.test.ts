import { rm } from 'node:fs/promises';
import { canonicalJson, contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryStore, type SqliteStore } from '../src/index';
import { campaign, run, tempDir } from './fixtures';

/**
 * Blast radius of "links out of the spec hash" (PR 423) on the store: a spec keyed by its hash, put
 * with links, read back, exported and imported; and a store written before the change, read after it.
 * Fictional data only.
 */

const raw = {
  id: 'acme-new-customer-coverage',
  blocks: [{ id: 'ask', when: { user: 'Can I return my phone?' }, expect: { must: ['30 days'] } }],
  metadata: { generated: { cell: { flow: 'returns' } } },
};
const links = [
  {
    block: 'ask',
    to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'refunds' },
    status: 'declared',
    created_by: 'author',
  },
];

function loaded(value: unknown): LoadedSpec {
  const result = validateSpec(value, 'specs/returns.yaml');
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}

/** Writes a specs row as a store of an earlier release did: its own hash, no re-validation. */
function writeLegacyRow(store: SqliteStore, spec: unknown, hash: string): void {
  const sql = (store as unknown as { sql: { upsertSpec: { run: (...args: unknown[]) => void } } }).sql;
  sql.upsertSpec.run(raw.id, hash, 'specs/returns.yaml', canonicalJson(spec), '2026-10-01T00:00:00.000Z');
}

let store: SqliteStore;
let dir: string;

beforeEach(async () => {
  store = openMemoryStore();
  dir = await tempDir();
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the store keys a linked spec by the hash of the spec without its links', () => {
  it('puts a linked spec under the unlinked hash and reads it back with its links', async () => {
    const plain = loaded(raw);
    const linked = loaded({ ...raw, metadata: { ...raw.metadata, links } });
    expect(linked.hash).toBe(plain.hash);
    await store.putSpec(linked);
    const read = await store.getSpec(raw.id, plain.hash);
    expect(read?.hash).toBe(plain.hash);
    expect(read?.spec.metadata?.links).toEqual(links);
  });

  it('refuses a linked spec whose stated hash is the hash of the spec with its links', async () => {
    const linked = loaded({ ...raw, metadata: { ...raw.metadata, links } });
    await expect(store.putSpec({ ...linked, hash: contentHash(linked.spec) })).rejects.toThrow(
      /content hashes to/,
    );
  });

  it('exports and imports a campaign whose pinned spec gained links after it was pinned', async () => {
    const plain = loaded(raw);
    const linked = loaded({ ...raw, metadata: { ...raw.metadata, links } });
    await store.putCampaign(campaign('acme-links', { specs: [{ id: raw.id, hash: plain.hash }] }));
    await store.putRun('acme-links', run({ specHash: plain.hash }));
    await store.putSpec(linked);
    const folder = await store.exportCampaign('acme-links', dir);
    const other = openMemoryStore();
    try {
      const bundle = await other.importCampaign(folder);
      expect(bundle.specs.map((spec) => spec.hash)).toEqual([plain.hash]);
      expect((await other.getSpec(raw.id, plain.hash))?.spec.metadata?.links).toEqual(links);
    } finally {
      await other.close();
    }
  });

  it('reads a spec an earlier release stored, with no links, at the hash it stored it under', async () => {
    const plain = loaded(raw);
    writeLegacyRow(store, plain.spec, contentHash(plain.spec));
    expect((await store.getSpec(raw.id, contentHash(plain.spec)))?.hash).toBe(contentHash(plain.spec));
  });

  // BUG: a spec whose free metadata already held `provenance` was stored under contentHash(spec); the
  // spec hash now leaves `provenance` out, so getSpec of that row throws a corrupt-store error. Reported to lead.
  it.fails('reads a spec an earlier release stored with a metadata.provenance note', async () => {
    const before = loaded({ ...raw, metadata: { ...raw.metadata, provenance: { source: 'hand-written' } } });
    const legacyHash = contentHash(before.spec);
    writeLegacyRow(store, before.spec, legacyHash);
    const read = await store.getSpec(raw.id, legacyHash);
    expect(read?.spec.metadata?.provenance).toEqual({ source: 'hand-written' });
  });

  // BUG: `metadata` was free before; a spec with a `links` key of another shape (a list of URLs) was valid
  // and stored, and is now refused as an invalid spec when the store reads it. Reported to lead.
  it.fails('reads a spec an earlier release stored with free-form metadata.links', async () => {
    // The spec as the earlier release loaded it: normalized, its free metadata kept as written.
    const base = loaded(raw).spec;
    const free = { ...base, metadata: { ...base.metadata, links: ['https://example.com/acme/returns'] } };
    writeLegacyRow(store, free, contentHash(free));
    const read = await store.getSpec(raw.id, contentHash(free));
    expect(read?.spec.metadata?.links).toEqual(['https://example.com/acme/returns']);
  });
});
