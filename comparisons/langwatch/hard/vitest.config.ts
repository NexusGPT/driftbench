import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config.ts';
export default defineConfig({
  ...base,
  test: {
    include: [
      'comparisons/langwatch/hard/verify.test.ts',
      'comparisons/langwatch/hard/compliance.test.ts',
      'comparisons/langwatch/hard/adapter-v2.test.ts',
    ],
    environment: 'node',
  },
});
