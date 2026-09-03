import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@control-plane': path.resolve(__dirname, '../control-plane/src') } },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
