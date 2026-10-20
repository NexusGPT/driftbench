import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/validators/src/ladders/pointer/blind/bank.test.ts'], maxWorkers: 2 },
});
