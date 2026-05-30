#!/usr/bin/env node
// Delegates to bundle-size-check.mjs — do not add logic here.
// [REUSE: scripts/bundle-size-check.mjs:1-161]
// Usage: node scripts/bundle-delta.mjs [--update]

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'bundle-size-check.mjs');
const args = process.argv.slice(2).join(' ');

try {
  execSync(`node "${target}" ${args}`, { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status ?? 1);
}
