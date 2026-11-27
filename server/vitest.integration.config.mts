import { defineConfig } from 'vitest/config';

// Runs against a real PocketBase started by tools/pocketbase-ci.sh (CI job "PocketBase integration").
export default defineConfig({
  test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 15_000, fileParallelism: false },
});
