import './lib/quiet-warnings';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config';
import { createApp } from './app';
import { createHttpServer } from './http/server';
import { buildRouter } from './routes';
import { registerTaskHandlers } from './tasks/handlers';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`GetMeAJob needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the current LTS from https://nodejs.org.`);
  process.exit(1);
}

const config = loadConfig({ forcedProvider: process.env.FORCE_AI_PROVIDER || undefined });
const app = createApp(config);
registerTaskHandlers(app);

if (config.forcedProvider === 'scripted' && process.env.GMAJ_FIXTURES) {
  // Test-only: load deterministic AI fixtures for end-to-end runs.
  const mod = await import(pathToFileURL(path.resolve(process.env.GMAJ_FIXTURES)).href);
  mod.registerFixtures(app.ai.scriptedProvider);
  app.log('Scripted AI provider active (test mode).');
}

// Keep serving if a stray promise rejects; the error is logged instead of taking the app down.
process.on('unhandledRejection', (err) => app.log('Unhandled rejection', err));

app.tasks.start();
const server = createHttpServer(app, buildRouter());
server.listen(config.port, config.host, () => {
  app.log(`GetMeAJob is running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  const status = config.forcedProvider ? null : app.config.env_keys.anthropic || app.config.env_keys.openai ? 'AI key found in environment.' : 'No AI key in .env — add one in Settings after signing in.';
  if (status) app.log(status);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  app.log('Shutting down…');
  server.close();
  await app.tasks.stop();
  app.db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
