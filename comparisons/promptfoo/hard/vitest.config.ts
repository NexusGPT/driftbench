import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['comparisons/promptfoo/hard/hard.test.ts'] },
});
