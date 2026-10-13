import { defineConfig } from 'vitest/config';
import './archive-env.ts';
import base from '../../../vitest.config.ts';
export default defineConfig({
  ...base,
  test: { include: ['comparisons/inspect/hard/*.test.ts'], environment: 'node' },
});
