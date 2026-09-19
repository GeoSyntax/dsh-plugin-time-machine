import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    // Git worktrees and temporary directories can remain handle-locked briefly
    // on Windows. Serializing test files avoids nondeterministic EBUSY cleanup
    // failures while keeping normal parallelism on Unix CI.
    fileParallelism: process.platform !== 'win32',
  },
});
