import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
  },
});
