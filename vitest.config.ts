import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packages = [
  'core',
  'checks',
  'judges',
  'users',
  'adapters',
  'sandbox',
  'stats',
  'store',
  'report',
  'battery',
  'artifacts',
  'space',
  'generate',
];

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      packages.map((name) => [
        `@driftbench/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      'tools/**/*.test.mjs',
      'tools/**/*.test.ts',
    ],
    environment: 'node',
  },
});
