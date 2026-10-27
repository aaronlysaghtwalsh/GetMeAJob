// Development: rebuild client + CSS on change, run the server with tsx watch.
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { root, writeClientBundle } from './lib.mjs';

const require = createRequire(import.meta.url);

let building = false;
let queued = false;
async function rebuild(reason) {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const t0 = Date.now();
  try {
    await writeClientBundle({ minify: false });
    console.log(`[client] rebuilt in ${Date.now() - t0} ms${reason ? ` (${reason})` : ''}`);
  } catch (err) {
    console.error('[client] build failed:', err.message);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      rebuild('queued change');
    }
  }
}

await rebuild('initial');

let timer;
for (const dir of ['src/client', 'src/shared', 'public']) {
  fs.watch(path.join(root, dir), { recursive: true }, (_event, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(file ?? dir), 120);
  });
}

const tsxCli = require.resolve('tsx/cli');
const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', tsxCli, 'watch', '--clear-screen=false', '--exclude', 'src/client/**', 'src/server/main.ts'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' } },
);
const stop = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
