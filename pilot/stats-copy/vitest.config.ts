import { defineConfig } from 'vitest/config';

// The root config of the repository does not include this folder; this one does.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
