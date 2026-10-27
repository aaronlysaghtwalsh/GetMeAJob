import type { App } from '../../app';
import * as appRepo from '../../repos/applications';
import type { Progress } from '../../tasks/queue';
import { PIPELINE_STEPS, PIPELINE_STEP_LABEL, TIER_LABEL, type PipelineStep, STAGES } from '../../../shared/constants';
import type { AnswerContent } from '../../../shared/schemas/documents';
import { loadContext, latest, requireIntel, type StepOptions } from './context';
import { analyzeJob, researchCompany } from './job-research';
import { analyzeFit, buildStrategy } from './fit-strategy';
import { generateAnswer, generateCoverLetter, generateResume, runReview } from './documents';

export const BUILD_STEPS = PIPELINE_STEPS.map((key) => ({
  key,
  label: {
    job: 'Understand the job',
    research: 'Research the company',
    fit: 'Analyze your fit',
    strategy: 'Decide the application strategy',
    resume: 'Write the tailored resume',
    cover_letter: 'Write the cover letter',
    questions: 'Answer application questions',
    review: 'Review readiness',
  }[key],
}));

function advanceStage(app: App, userId: string, applicationId: string, to: 'researching' | 'preparing') {
  const a = appRepo.getApplication(app.db, userId, applicationId);
  if (!a) return;
  if (STAGES.indexOf(a.stage) < STAGES.indexOf(to)) {
    appRepo.updateApplication(app.db, userId, applicationId, { stage: to });
    appRepo.addEvent(app.db, userId, applicationId, { type: 'stage', title: `Moved to ${to === 'preparing' ? 'Preparing' : 'Researching'}` });
  }
}

/** Run one pipeline step and store its versioned output. Returns a short human summary. */
export async function runStep(app: App, userId: string, applicationId: string, step: PipelineStep, opts: StepOptions): Promise<string> {
  const ctx = loadContext(app, userId, applicationId);
  const { db } = app;
  if (step === 'job') {
    const intel = await analyzeJob(ctx, opts);
    appRepo.addEvent(db, userId, applicationId, { type: 'analysis', title: 'Job analyzed', detail: { requirements: intel.requirements.length } });
    return `${intel.requirements.length} requirements, ${intel.keywords.length} keywords`;
  }
  const intel = requireIntel(ctx);
  const l = latest(ctx);
  if (step === 'research') {
    advanceStage(app, userId, applicationId, 'researching');
    const content = await researchCompany(ctx, intel, opts);
    appRepo.createArtifact(db, userId, { applicationId, kind: 'research', content, meta: { depth: content.depth }, changeSummary: opts.guidance ?? '' });
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: `Company research (${content.depth})`, detail: { findings: content.findings.length, sources: content.sources.length } });
    return `${content.findings.length} findings from ${content.sources.length} sources`;
  }
  if (step === 'fit') {
    const content = await analyzeFit(ctx, intel, l.research?.content ?? null, opts);
    appRepo.createArtifact(db, userId, { applicationId, kind: 'fit', content, changeSummary: opts.guidance ?? '' });
    appRepo.updateApplication(db, userId, applicationId, { tier: content.finalTier });
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: `Fit analysis: ${TIER_LABEL[content.finalTier]} (${content.scores.overall}/100)` });
    return `${TIER_LABEL[content.finalTier]}, ${content.scores.overall}/100`;
  }
  if (step === 'strategy') {
    if (!l.fit) throw new Error('Run the fit analysis first.');
    const content = await buildStrategy(ctx, intel, l.research?.content ?? null, l.fit.content, opts);
    appRepo.createArtifact(db, userId, { applicationId, kind: 'strategy', content, changeSummary: opts.guidance ?? '' });
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: 'Application strategy decided' });
    return content.positioning.primary;
  }
  if (step === 'resume') {
    if (!l.strategy) throw new Error('Create the application strategy first.');
    advanceStage(app, userId, applicationId, 'preparing');
    const content = await generateResume(ctx, intel, l.strategy.content, opts);
    appRepo.createArtifact(db, userId, {
      applicationId,
      kind: 'resume',
      content,
      meta: { strategyId: l.strategy.id, ats: content.ats.score },
      changeSummary: opts.guidance ? `Regenerated: ${opts.guidance}` : l.resume ? 'Regenerated' : 'First draft',
    });
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: `Resume drafted (ATS ${content.ats.score}/100)` });
    return `ATS ${content.ats.score}/100, ${content.integrity.issues.filter((i) => i.severity === 'blocker').length} integrity blockers`;
  }
  if (step === 'cover_letter') {
    if (!l.strategy) throw new Error('Create the application strategy first.');
    const content = await generateCoverLetter(ctx, intel, l.strategy.content, l.research?.content ?? null, opts);
    appRepo.createArtifact(db, userId, {
      applicationId,
      kind: 'cover_letter',
      content,
      meta: { strategyId: l.strategy.id },
      changeSummary: opts.guidance ? `Regenerated: ${opts.guidance}` : l.coverLetter ? 'Regenerated' : 'First draft',
    });
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: `Cover letter drafted (${content.wordCount} words)` });
    return `${content.wordCount} words`;
  }
  if (step === 'questions') {
    const questions = appRepo.listAppQuestions(db, userId, applicationId);
    if (!questions.length) return 'No application questions';
    const done: { question: string; answer: string }[] = [];
    for (const q of questions) {
      const content = await generateAnswer(ctx, intel, l.strategy?.content ?? null, l.research?.content ?? null, q, done, opts);
      appRepo.createArtifact<AnswerContent>(db, userId, { applicationId, kind: 'answer', refId: q.id, content, changeSummary: 'Drafted' });
      done.push({ question: q.question, answer: content.draft.answer });
    }
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: `${questions.length} application answer${questions.length === 1 ? '' : 's'} drafted` });
    return `${questions.length} answered`;
  }
  if (step === 'review') {
    if (!l.resume) throw new Error('Generate the resume first.');
    const content = await runReview(ctx, intel, opts);
    appRepo.createArtifact(db, userId, { applicationId, kind: 'review', content });
    appRepo.addEvent(db, userId, applicationId, { type: 'artifact', title: `Readiness review: ${content.overall}/100` });
    return `${content.overall}/100, ${content.verdict.replace('_', ' ')}`;
  }
  throw new Error(`Unknown step ${step}`);
}

/** Run a single answer (used when a question is added or regenerated). */
export async function runAnswer(app: App, userId: string, applicationId: string, questionId: string, opts: StepOptions): Promise<string> {
  const ctx = loadContext(app, userId, applicationId);
  const intel = requireIntel(ctx);
  const l = latest(ctx);
  const questions = appRepo.listAppQuestions(app.db, userId, applicationId);
  const q = questions.find((x) => x.id === questionId);
  if (!q) throw new Error('Question not found');
  const others = questions
    .filter((x) => x.id !== questionId)
    .map((x) => ({ x, a: appRepo.latestArtifact<AnswerContent>(app.db, userId, applicationId, 'answer', x.id) }))
    .filter((y) => y.a)
    .map((y) => ({ question: y.x.question, answer: y.a!.content.draft.answer }));
  const prev = appRepo.latestArtifact(app.db, userId, applicationId, 'answer', q.id);
  const content = await generateAnswer(ctx, intel, l.strategy?.content ?? null, l.research?.content ?? null, q, others, opts);
  appRepo.createArtifact<AnswerContent>(app.db, userId, {
    applicationId,
    kind: 'answer',
    refId: q.id,
    content,
    changeSummary: opts.guidance ? `Regenerated: ${opts.guidance}` : prev ? 'Regenerated' : 'Drafted',
  });
  return `${content.wordCount} words`;
}

export interface BuildInput {
  from?: PipelineStep;
  until?: PipelineStep;
  continueAnyway?: boolean;
  force?: boolean;
}

/** The end-to-end workflow. Skips steps whose output already exists unless forced; stops at "do not apply". */
export async function runBuild(app: App, userId: string, applicationId: string, input: BuildInput, progress: Progress, opts: StepOptions): Promise<{ stoppedAt?: string; completed: string[] }> {
  const completed: string[] = [];
  const startIdx = input.from ? PIPELINE_STEPS.indexOf(input.from) : 0;
  const endIdx = input.until ? PIPELINE_STEPS.indexOf(input.until) : PIPELINE_STEPS.length - 1;
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const step = PIPELINE_STEPS[i];
    if (i < startIdx || i > endIdx) {
      progress.skip(step);
      continue;
    }
    const ctx = loadContext(app, userId, applicationId);
    const l = latest(ctx);
    const exists =
      (step === 'job' && !!ctx.job.intelligence) ||
      (step === 'research' && !!l.research) ||
      (step === 'fit' && !!l.fit) ||
      (step === 'strategy' && !!l.strategy) ||
      (step === 'resume' && !!l.resume) ||
      (step === 'cover_letter' && !!l.coverLetter);
    // Downstream steps always re-run when an upstream step ran in this build.
    if (exists && !input.force && completed.length === 0) {
      progress.skip(step, 'Already done');
      continue;
    }
    progress.start(step);
    progress.message(`${PIPELINE_STEP_LABEL[step]}…`);
    const summary = await runStep(app, userId, applicationId, step, opts);
    completed.push(step);
    progress.done(step, summary);
    if (step === 'fit' && !input.continueAnyway) {
      const fit = appRepo.latestArtifact<{ finalTier: string }>(app.db, userId, applicationId, 'fit');
      if (fit?.content.finalTier === 'do_not_apply') {
        progress.skipRemaining('Fit analysis recommends not applying. Review the reasons; you can still continue.');
        return { stoppedAt: 'fit', completed };
      }
    }
  }
  progress.message('Done');
  return { completed };
}
