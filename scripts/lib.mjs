// Shared build helpers used by scripts/build.mjs, scripts/dev.mjs and scripts/test.mjs.
// Kept dependency-light on purpose: esbuild for bundling, the Tailwind v4 compiler for CSS.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dist = path.join(root, 'dist');

async function walk(dir, exts, out = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Collect Tailwind class candidates from source files. Over-inclusive on purpose; Tailwind ignores invalid ones. */
export async function collectCandidates() {
  const files = [
    ...(await walk(path.join(root, 'src/client'), ['.ts', '.tsx'])),
    ...(await walk(path.join(root, 'src/shared'), ['.ts'])),
  ];
  const set = new Set();
  const add = (t) => {
    if (t && t.length < 160) set.add(t);
  };
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    // Split only on whitespace, quotes and backslashes so arbitrary values such as
    // grid-cols-[236px_minmax(0,1fr)] and [&>svg]:size-4 survive intact.
    for (const token of text.split(/[\s"'`\\]+/)) {
      add(token);
      // Also try the token with surrounding code punctuation removed (e.g. "{cn(" or "),").
      add(token.replace(/^[({[<,;=!?&|:]+/, '').replace(/[)}>,;:]+$/, ''));
      for (const part of token.split(/[{};=]+/)) add(part);
    }
  }
  return [...set];
}

export async function buildCss({ minify = false } = {}) {
  const { compile } = await import('tailwindcss');
  const twDir = path.dirname(require.resolve('tailwindcss/package.json'));
  const entry = path.join(root, 'src/client/styles/app.css');
  const input = await fs.readFile(entry, 'utf8');
  const compiler = await compile(input, {
    base: path.dirname(entry),
    loadStylesheet: async (id, base) => {
      let file;
      if (id === 'tailwindcss') file = path.join(twDir, 'index.css');
      else if (id.startsWith('tailwindcss/')) file = path.join(twDir, id.slice('tailwindcss/'.length));
      else file = path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: await fs.readFile(file, 'utf8') };
    },
  });
  let css = compiler.build(await collectCandidates());
  const esbuild = await import('esbuild');
  const result = await esbuild.transform(css, { loader: 'css', minify, target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'] });
  css = result.code;
  return css;
}

export async function buildClient({ minify = false, outdir }) {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/client/main.tsx')],
    bundle: true,
    format: 'esm',
    splitting: false,
    platform: 'browser',
    target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
    jsx: 'automatic',
    minify,
    sourcemap: minify ? false : 'linked',
    outdir,
    entryNames: 'app',
    write: true,
    metafile: true,
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
    logLevel: 'warning',
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  return result;
}

export async function buildServer({ outdir }) {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(root, 'src/server/main.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    outfile: path.join(outdir, 'main.mjs'),
    sourcemap: 'linked',
    logLevel: 'warning',
    tsconfig: path.join(root, 'tsconfig.json'),
  });
}

export function hashOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

export async function copyPublic(outdir) {
  await fs.cp(path.join(root, 'public'), outdir, { recursive: true });
}

export function htmlShell({ js, css }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>GetMeAJob</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preload" href="/fonts/inter-400.woff" as="font" type="font/woff" crossorigin />
<link rel="stylesheet" href="${css}" />
</head>
<body>
<div id="root"></div>
<script type="module" src="${js}"></script>
</body>
</html>
`;
}

export async function writeClientBundle({ minify }) {
  const outdir = path.join(dist, 'client');
  await fs.rm(outdir, { recursive: true, force: true });
  await fs.mkdir(path.join(outdir, 'assets'), { recursive: true });
  await copyPublic(outdir);
  await buildClient({ minify, outdir: path.join(outdir, 'assets') });
  const css = await buildCss({ minify });
  let jsName = 'app.js';
  let cssName = 'app.css';
  if (minify) {
    const js = await fs.readFile(path.join(outdir, 'assets/app.js'));
    jsName = `app-${hashOf(js)}.js`;
    await fs.rename(path.join(outdir, 'assets/app.js'), path.join(outdir, 'assets', jsName));
    cssName = `app-${hashOf(css)}.css`;
  }
  await fs.writeFile(path.join(outdir, 'assets', cssName), css);
  await fs.writeFile(path.join(outdir, 'index.html'), htmlShell({ js: `/assets/${jsName}`, css: `/assets/${cssName}` }));
  return { outdir };
}

export function exists(p) {
  return fsSync.existsSync(p);
}
