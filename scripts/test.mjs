// Test runner: unit + integration tests via node:test (TypeScript through tsx).
// `npm test` runs unit and integration suites; `npm run test:e2e` runs the browser suite.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { root, writeClientBundle } from './lib.mjs';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const mode = process.argv[2] ?? 'default';

function collect(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => path.join(dir, f));
}

const files = mode === 'e2e' ? collect('tests/e2e') : [...collect('tests/unit'), ...collect('tests/integration')];
// The browser suite drives the real built client.
if (mode === 'e2e') await writeClientBundle({ minify: true });
const filter = process.argv[3];
const selected = filter ? files.filter((f) => f.includes(filter)) : files;
if (!selected.length) {
  console.log('No test files found.');
  process.exit(0);
}
const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', tsxCli, '--test', '--test-concurrency=1', ...selected], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
});
process.exit(result.status ?? 1);
