import { defineConfig } from 'vitest/config';

// One root runner for all unit tests (HB-QUAL-02). Integration tests that need a running
// PocketBase live under server/tests/integration and run in their own CI job.
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/shell/src/**/*.test.ts',
      'server/tests/unit/**/*.test.{js,ts}',
      'tools/**/*.test.{mjs,ts}',
      'subapps/*/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
