import type { App } from '../app';
import type { TaskContext } from './queue';
import { extractDocument, planMerge, applyPlan, type DocExtraction } from '../services/brain/ingest';
import { generateDiscovery, integrateAnswer } from '../services/brain/discovery';

export const INGEST_STEPS = [
  { key: 'read', label: 'Read documents' },
  { key: 'extract', label: 'Extract roles, evidence and skills' },
  { key: 'merge', label: 'Consolidate into your Career Brain' },
  { key: 'questions', label: 'Prepare follow-up questions' },
];

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function registerBrainTasks(app: App) {
  app.tasks.register('brain.ingest', async (ctx: TaskContext<{ documentIds: string[] }>) => {
    const { userId, progress, signal, taskId } = ctx;
    const ids = ctx.input.documentIds ?? [];
    if (!ids.length) throw new Error('No documents selected.');

    progress.start('read', `${ids.length} document${ids.length === 1 ? '' : 's'}`);
    // Text extraction happens inside extractDocument; we mark "read" done as each completes.
    progress.done('read');

    progress.start('extract');
    const failures: string[] = [];
    let done = 0;
    const results = await mapLimit(ids, 3, async (id) => {
      try {
        const r = await extractDocument(app, userId, id, { taskId, signal });
        done++;
        progress.start('extract', `${done} of ${ids.length} analyzed`);
        return r;
      } catch (err) {
        if (signal.aborted) throw err;
        failures.push(`${id}: ${(err as Error).message}`);
        return null;
      }
    });
    const docs = results.filter((r): r is DocExtraction => !!r);
    if (!docs.length) throw new Error(`No document could be analyzed. ${failures.map((f) => f.split(': ').slice(1).join(': ')).join(' ')}`);
    const quoteStats = docs.reduce((a, d) => ({ checked: a.checked + d.verification.checked, verified: a.verified + d.verification.verified }), { checked: 0, verified: 0 });
    progress.done('extract', `${quoteStats.verified} of ${quoteStats.checked} quotes verified against the originals${failures.length ? `; ${failures.length} failed` : ''}`);

    progress.start('merge');
    const plan = await planMerge(app, userId, docs, { taskId, signal });
    const applied = applyPlan(app, userId, docs, plan);
    progress.done(
      'merge',
      `${applied.evidence.created} new evidence items, ${applied.evidence.merged} merged; ${applied.conflicts} difference${applied.conflicts === 1 ? '' : 's'} to confirm`,
    );

    progress.start('questions');
    try {
      const d = await generateDiscovery(app, userId, { taskId, signal });
      progress.done('questions', `${d.created} question${d.created === 1 ? '' : 's'} ready`);
    } catch (err) {
      if (signal.aborted) throw err;
      progress.fail('questions', 'Could not prepare questions; you can retry from the Questions tab.');
    }
    return { applied, failures, quoteStats };
  });

  app.tasks.register('brain.discovery', async (ctx: TaskContext) => {
    ctx.progress.start('questions');
    const r = await generateDiscovery(app, ctx.userId, { taskId: ctx.taskId, signal: ctx.signal });
    ctx.progress.done('questions', `${r.created} questions ready`);
    return r;
  });

  app.tasks.register('brain.answer', async (ctx: TaskContext<{ questionId: string }>) => {
    ctx.progress.start('integrate');
    const r = await integrateAnswer(app, ctx.userId, ctx.input.questionId, { taskId: ctx.taskId, signal: ctx.signal });
    ctx.progress.done('integrate', `${r.evidenceCreated} evidence item${r.evidenceCreated === 1 ? '' : 's'} added`);
    return r;
  });
}
