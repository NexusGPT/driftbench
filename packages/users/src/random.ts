import { createHash } from 'node:crypto';

/**
 * A seeded choice: the same parts give the same index on every machine and every run. The index is the
 * first 48 bits of the SHA-256 of the parts joined, modulo the size.
 */
export function seededIndex(parts: readonly (string | number)[], size: number): number {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError(`seededIndex needs a size of at least 1, not ${size}`);
  const digest = createHash('sha256').update(parts.map(String).join('\u0000')).digest();
  return digest.readUIntBE(0, 6) % size;
}
