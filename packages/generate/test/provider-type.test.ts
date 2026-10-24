import { describe, expect, it } from 'vitest';
import { providerTypeOf } from '../src/model/http';

describe('the error type a provider body names', () => {
  it('reads error.type, then detail.error_type, and gives none for a body that names none', () => {
    expect(providerTypeOf({ error: { type: 'max_tokens_exceeded', message: 'too long' } })).toBe(
      'max_tokens_exceeded',
    );
    expect(providerTypeOf({ detail: { error_type: 'max_tokens_exceeded', message: 'too long' } })).toBe(
      'max_tokens_exceeded',
    );
    expect(providerTypeOf({ detail: 'too long' })).toBeUndefined();
    expect(providerTypeOf('not an object')).toBeUndefined();
  });
});
