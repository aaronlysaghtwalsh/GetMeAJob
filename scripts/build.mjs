// Production build: minified client bundle with hashed assets, compiled CSS, bundled server.
import path from 'node:path';
import fs from 'node:fs/promises';
import { dist, writeClientBundle, buildServer } from './lib.mjs';

const t0 = Date.now();
await fs.mkdir(dist, { recursive: true });
await writeClientBundle({ minify: true });
await buildServer({ outdir: path.join(dist, 'server') });
console.log(`Built GetMeAJob in ${Date.now() - t0} ms -> ${path.relative(process.cwd(), dist)}`);
