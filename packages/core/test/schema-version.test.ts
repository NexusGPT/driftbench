import { describe, expect, it } from 'vitest';
import { contentHash, parseSpecText, SPEC_SCHEMA_VERSION, validateSpec } from '../src/index';

const base = { id: 'versioned', blocks: [{ user: 'Hi' }] };

describe('schema_version', () => {
  it('is 1 today, and a spec that declares it loads', () => {
    expect(SPEC_SCHEMA_VERSION).toBe(1);
    const result = validateSpec({ ...base, schema_version: 1 });
    expect(result.ok).toBe(true);
  });

  it('refuses a spec written for a newer format with one clear error, before its unknown keys', () => {
    const result = validateSpec({ ...base, schema_version: 2, future_key: { x: 1 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      {
        level: 'error',
        code: 'SPEC_SCHEMA_VERSION',
        path: 'schema_version',
        message:
          'the spec is written for spec format version 2; this driftbench reads version 1 and older: upgrade driftbench',
      },
    ]);
  });

  it('refuses a malformed version as a schema error', () => {
    for (const bad of [0, 1.5, '1']) {
      const result = validateSpec({ ...base, schema_version: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.path).toBe('schema_version');
    }
  });

  it('leaves a spec without it as it was: same hash, no new key in the parsed spec', () => {
    const result = parseSpecText('id: versioned\nblocks:\n  - user: Hi\n', 'yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('schema_version' in result.spec).toBe(false);
    expect(result.hash).toBe(contentHash(result.spec));
    const declared = validateSpec({ ...base, schema_version: 1 });
    // A declared version is part of the spec, so it enters the hash only when written.
    expect(declared.ok && declared.hash !== result.hash).toBe(true);
  });
});
