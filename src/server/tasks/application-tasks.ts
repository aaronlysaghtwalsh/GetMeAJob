import type { App } from '../app';
import type { TaskContext } from './queue';
import { runAnswer, runBuild, runStep, type BuildInput } from '../services/pipeline/run';
import { PIPELINE_STEP_LABEL, type PipelineStep } from '../../shared/constants';

export function registerApplicationTasks(app: App) {
  app.tasks.register('application.build', async (ctx: TaskContext<BuildInput & { guidance?: string }>) => {
    if (!ctx.applicationId) throw new Error('Missing application');
    return runBuild(app, ctx.userId, ctx.applicationId, ctx.input, ctx.progress, { taskId: ctx.taskId, signal: ctx.signal, guidance: ctx.input.guidance });
  });

  app.tasks.register('application.step', async (ctx: TaskContext<{ step: PipelineStep; guidance?: string }>) => {
    if (!ctx.applicationId) throw new Error('Missing application');
    ctx.progress.start(ctx.input.step);
    ctx.progress.message(`${PIPELINE_STEP_LABEL[ctx.input.step]}…`);
    const summary = await runStep(app, ctx.userId, ctx.applicationId, ctx.input.step, { taskId: ctx.taskId, signal: ctx.signal, guidance: ctx.input.guidance });
    ctx.progress.done(ctx.input.step, summary);
    return { summary };
  });

  app.tasks.register('application.answer', async (ctx: TaskContext<{ questionId: string; guidance?: string }>) => {
    if (!ctx.applicationId) throw new Error('Missing application');
    ctx.progress.start('answer');
    const summary = await runAnswer(app, ctx.userId, ctx.applicationId, ctx.input.questionId, { taskId: ctx.taskId, signal: ctx.signal, guidance: ctx.input.guidance });
    ctx.progress.done('answer', summary);
    return { summary };
  });
}
