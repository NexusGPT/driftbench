import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['comparisons/langwatch/pairwise/*.test.ts'] } });
