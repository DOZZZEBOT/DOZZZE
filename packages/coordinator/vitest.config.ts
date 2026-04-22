// Vitest config for the coordinator package.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    // `node:sqlite` is a Node runtime module; Vite's transform must not
    // attempt to resolve it as a package.
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
