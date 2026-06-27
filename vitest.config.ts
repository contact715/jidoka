import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['lcov', 'text'],
      exclude: ['node_modules/**', '.claude/**', 'e2e/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
