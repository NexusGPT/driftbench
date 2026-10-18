import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['comparisons/deepeval/hard/hard.test.ts'], environment: 'node' },
});
