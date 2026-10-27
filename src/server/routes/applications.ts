import { z } from 'zod/v4';
import type { Router } from '../http/router';
import { badRequest, conflict, HttpError, json, noContent, notFound, readJson, requireUser } from '../http/core';
import * as appRepo from '../repos/applications';
import { JobInputSchema } from '../../shared/schemas/job';
import { ResumeDraftSchema, type AnswerContent, type CoverLetterContent, type ResumeContent, type ReviewContent, type ResumeDraft } from '../../shared/schemas/documents';
import { CONTACT_ROLES, FEEDBACK_TAGS, PIPELINE_STEPS, STAGES, STAGE_LABEL, STAGES_AFTER_APPLY, type PipelineStep } from '../../shared/constants';
import { fetchJobFromUrl, type FetchedJob } from '../services/jobs/fetch';
import { parseQuestions, isSensitiveQuestion, detectLimit } from '../services/questions/parse';
import { BUILD_STEPS } from '../services/pipeline/run';
import { loadContext, requireIntel } from '../services/pipeline/context';
import { reviseAnswer, reviseCoverLetter, reviseResume } from '../services/pipeline/documents';
import { letterToDocx, letterToPdf, resumeToDocx, resumeToPdf } from '../services/documents/render';
import { contactLine } from '../services/documents/resume-model';
import { ensureAiReady } from './brain';
import { audit } from '../security/audit';
import { newId, nowIso } from '../lib/ids';
import type { App } from '../app';
import type { ResearchContent } from '../../shared/schemas/research';
import type { FitContent } from '../../shared/schemas/fit';

function own(app: App, userId: string, id: string): appRepo.ApplicationDTO {
  const a = appRepo.getApplication(app.db, userId, id);
  if (!a) throw notFound('Application not found.');
  return a;
}

function versionMeta(v: appRepo.ArtifactDTO) {
  return { id: v.id, version: v.version, status: v.status, createdAt: v.createdAt, approvedAt: v.approvedAt, changeSummary: v.changeSummary, createdBy: v.createdBy };
}

function busy(app: App, userId: string, applicationId: string) {
  if (app.tasks.active(userId, { applicationId }).length) throw conflict('This application is already being worked on. Wait for the current step to finish.');
}

function safeFileName(s: string) {
  return s.replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
}

export function applicationRoutes(r: Router) {
  /* List & create ---------------------------------------------------------------------------------------------- */

  r.get('/api/applications', (ctx) => {
    const user = requireUser(ctx);
    const apps = ctx.app.db.all<Record<string, any>>(
      `SELECT a.*, j.title AS job_title, j.company_name, j.location, j.work_model, j.salary_text, j.source_url
       FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? ORDER BY a.updated_at DESC`,
      [user.id],
    );
    const active = ctx.app.tasks.active(user.id);
    return json({
      applications: apps.map((row) => {
        const a = appRepo.toApplication(row);
        const fit = appRepo.latestArtifact<FitContent>(ctx.app.db, user.id, a.id, 'fit');
        const review = appRepo.latestArtifact<ReviewContent>(ctx.app.db, user.id, a.id, 'review');
        return {
          ...a,
          job: { title: row.job_title, companyName: row.company_name, location: row.location, workModel: row.work_model, salaryText: row.salary_text, sourceUrl: row.source_url },
          fit: fit ? { overall: fit.content.scores.overall, tier: fit.content.finalTier, headline: fit.content.verdict.headline, effortMinutes: fit.content.effortMinutes } : null,
          readiness: review ? { overall: review.content.overall, verdict: review.content.verdict } : null,
          running: active.some((t) => t.applicationId === a.id),
        };
      }),
    });
  });

  r.post('/api/applications', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, JobInputSchema.extend({ buildMode: z.enum(['full', 'fit_first', 'none']).default('full') }), 200_000);
    if (body.buildMode !== 'none') ensureAiReady(ctx.app, user.id);
    let fetched: FetchedJob | null = null;
    if (body.mode === 'url') {
      if (!body.url.trim()) throw badRequest('Paste a job link.', { fieldErrors: { url: ['Paste a job link.'] } });
      fetched = await fetchJobFromUrl(body.url.trim(), ctx.app.config.allowOutboundFetch);
    } else if (body.text.trim().length < 150) {
      throw badRequest('Paste the full job description (at least a few paragraphs).', { fieldErrors: { text: ['Paste the full job description.'] } });
    }
    const pasted = parseQuestions(body.questions);
    const { appId, jobId } = ctx.app.db.tx(() => {
      const jobId = appRepo.insertJob(ctx.app.db, user.id, {
        title: fetched?.title ?? '',
        companyName: body.companyName.trim() || fetched?.company || '',
        location: fetched?.location ?? '',
        source: body.mode === 'url' ? fetched!.ats : 'paste',
        sourceUrl: body.mode === 'url' ? fetched!.url : body.url.trim(),
        ats: fetched?.ats ?? 'unknown',
        rawText: fetched?.text ?? body.text.trim(),
        salaryText: fetched?.salaryText ?? '',
        importedQuestions: fetched?.questions ?? [],
        companyWebsite: body.companyWebsite.trim() || fetched?.companyWebsite || '',
      });
      const appId = appRepo.insertApplication(ctx.app.db, user.id, jobId, body.researchDepth);
      for (const q of [...(fetched?.questions ?? []).map((q) => ({ ...q, sensitive: isSensitiveQuestion(q.question) })), ...pasted]) {
        appRepo.insertAppQuestion(ctx.app.db, user.id, appId, q);
      }
      appRepo.addEvent(ctx.app.db, user.id, appId, { type: 'created', title: 'Application created', detail: { source: body.mode, url: fetched?.url ?? body.url } });
      return { appId, jobId };
    });
    audit(ctx.app.db, { userId: user.id, action: 'application.created', targetType: 'application', targetId: appId, meta: { jobId, mode: body.mode } });
    const task =
      body.buildMode === 'none'
        ? null
        : ctx.app.tasks.enqueue({
            userId: user.id,
            applicationId: appId,
            type: 'application.build',
            input: { until: body.buildMode === 'fit_first' ? 'strategy' : undefined },
            steps: BUILD_STEPS,
          });
    return json({ applicationId: appId, task, imported: { questions: (fetched?.questions.length ?? 0) + pasted.length, source: fetched?.ats ?? 'paste' } }, { status: 201 });
  });

  /* Workspace ---------------------------------------------------------------------------------------------------- */

  r.get('/api/applications/:id', (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const db = ctx.app.db;
    const job = appRepo.getJob(db, user.id, a.jobId)!;
    const kinds = ['research', 'fit', 'strategy', 'resume', 'cover_letter', 'review'] as const;
    const artifacts: Record<string, unknown> = {};
    const versions: Record<string, unknown> = {};
    for (const k of kinds) {
      artifacts[k] = appRepo.latestArtifact(db, user.id, a.id, k);
      versions[k] = appRepo.listVersions(db, user.id, a.id, k).map(versionMeta);
    }
    const questions = appRepo.listAppQuestions(db, user.id, a.id).map((q) => ({
      ...q,
      answer: appRepo.latestArtifact<AnswerContent>(db, user.id, a.id, 'answer', q.id),
      versions: appRepo.listVersions(db, user.id, a.id, 'answer', q.id).map(versionMeta),
    }));
    const recentTasks = ctx.app.tasks.recent(user.id, { applicationId: a.id, limit: 5 });
    return json({
      application: a,
      job,
      artifacts,
      versions,
      questions,
      contacts: appRepo.listContacts(db, user.id, a.id),
      notes: appRepo.listNotes(db, user.id, a.id),
      events: appRepo.listEvents(db, user.id, a.id),
      tasks: ctx.app.tasks.active(user.id, { applicationId: a.id }),
      lastTask: recentTasks[0] ?? null,
      ai: ctx.app.ai.status(user.id),
    });
  });

  r.patch('/api/applications/:id', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(
      ctx,
      z.object({
        stage: z.enum(STAGES).optional(),
        nextAction: z.string().max(300).optional(),
        nextActionDate: z.string().max(40).nullable().optional(),
        outcome: z.string().max(500).nullable().optional(),
        researchDepth: z.enum(['standard', 'deep', 'maximum']).optional(),
        archived: z.boolean().optional(),
        dateApplied: z.string().max(40).nullable().optional(),
      }),
    );
    appRepo.updateApplication(ctx.app.db, user.id, a.id, b);
    if (b.stage && b.stage !== a.stage) {
      appRepo.addEvent(ctx.app.db, user.id, a.id, { type: 'stage', title: `Moved to ${STAGE_LABEL[b.stage]}`, detail: { from: a.stage, to: b.stage } });
      audit(ctx.app.db, { userId: user.id, action: 'application.stage_changed', targetType: 'application', targetId: a.id, meta: { from: a.stage, to: b.stage } });
      if (STAGES_AFTER_APPLY.includes(b.stage) && !a.dateApplied && b.dateApplied === undefined) {
        appRepo.updateApplication(ctx.app.db, user.id, a.id, { dateApplied: nowIso().slice(0, 10) });
      }
    }
    return json(appRepo.getApplication(ctx.app.db, user.id, a.id));
  });

  r.delete('/api/applications/:id', (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    for (const t of ctx.app.tasks.active(user.id, { applicationId: a.id })) ctx.app.tasks.cancel(user.id, t.id);
    ctx.app.db.run('DELETE FROM jobs WHERE id = ? AND user_id = ?', [a.jobId, user.id]);
    audit(ctx.app.db, { userId: user.id, action: 'application.deleted', targetType: 'application', targetId: a.id });
    return noContent();
  });

  /* Running the pipeline ------------------------------------------------------------------------------------------- */

  r.post('/api/applications/:id/build', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(
      ctx,
      z.object({
        from: z.enum(PIPELINE_STEPS).optional(),
        until: z.enum(PIPELINE_STEPS).optional(),
        continueAnyway: z.boolean().default(false),
        force: z.boolean().default(false),
      }),
    );
    ensureAiReady(ctx.app, user.id);
    busy(ctx.app, user.id, a.id);
    const task = ctx.app.tasks.enqueue({ userId: user.id, applicationId: a.id, type: 'application.build', input: b, steps: BUILD_STEPS });
    return json({ task }, { status: 202 });
  });

  r.post('/api/applications/:id/steps/:step', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const step = z.enum(PIPELINE_STEPS).parse(ctx.params.step) as PipelineStep;
    const b = await readJson(ctx, z.object({ guidance: z.string().max(1000).optional() }));
    ensureAiReady(ctx.app, user.id);
    busy(ctx.app, user.id, a.id);
    const label = BUILD_STEPS.find((s) => s.key === step)!.label;
    const task = ctx.app.tasks.enqueue({ userId: user.id, applicationId: a.id, type: 'application.step', input: { step, guidance: b.guidance }, steps: [{ key: step, label }] });
    return json({ task }, { status: 202 });
  });

  /* Questions ---------------------------------------------------------------------------------------------------------- */

  r.post('/api/applications/:id/questions', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(ctx, z.object({ text: z.string().min(1).max(20000) }));
    const parsed = parseQuestions(b.text);
    if (!parsed.length) throw badRequest('No questions found. Put each question on its own line.');
    const ids = parsed.map((q) => appRepo.insertAppQuestion(ctx.app.db, user.id, a.id, q));
    return json({ ids }, { status: 201 });
  });

  r.patch('/api/applications/:id/questions/:qid', async (ctx) => {
    const user = requireUser(ctx);
    own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(
      ctx,
      z.object({
        question: z.string().trim().min(3).max(2000).optional(),
        limitType: z.enum(['words', 'chars', 'none']).optional(),
        limitValue: z.number().int().min(1).max(20000).nullable().optional(),
        sensitive: z.boolean().optional(),
        required: z.boolean().optional(),
      }),
    );
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM application_questions WHERE id = ? AND user_id = ? AND application_id = ?', [ctx.params.qid, user.id, ctx.params.id]);
    if (!row) throw notFound();
    const question = b.question ?? row.question;
    const limit = b.question && b.limitType === undefined ? detectLimit(question) : null;
    ctx.app.db.run('UPDATE application_questions SET question = ?, limit_type = ?, limit_value = ?, sensitive = ?, required = ? WHERE id = ?', [
      question,
      b.limitType ?? (limit && limit.limitType !== 'none' ? limit.limitType : row.limit_type),
      b.limitValue !== undefined ? b.limitValue : limit && limit.limitType !== 'none' ? limit.limitValue : row.limit_value,
      b.sensitive ?? (b.question ? isSensitiveQuestion(question) : !!row.sensitive),
      b.required ?? !!row.required,
      row.id,
    ]);
    return json({ ok: true });
  });

  r.delete('/api/applications/:id/questions/:qid', (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    // Answers that went out with a submitted application are part of its record and are kept.
    const snap = a.submittedSnapshot as { answerIds?: string[] } | null;
    if (snap) {
      const ids = snap.answerIds ?? [];
      const used = ids.length
        ? ctx.app.db.one(`SELECT 1 FROM artifacts WHERE user_id = ? AND ref_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [user.id, ctx.params.qid, ...ids])
        : null;
      if (used) throw conflict('This answer was part of the application you submitted, so it is kept with the record.');
    }
    const res = ctx.app.db.tx(() => {
      ctx.app.db.run(`DELETE FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = 'answer' AND ref_id = ?`, [user.id, ctx.params.id, ctx.params.qid]);
      return ctx.app.db.run('DELETE FROM application_questions WHERE id = ? AND user_id = ? AND application_id = ?', [ctx.params.qid, user.id, ctx.params.id]);
    });
    if (!res.changes) throw notFound();
    return noContent();
  });

  r.post('/api/applications/:id/questions/:qid/answer', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(ctx, z.object({ guidance: z.string().max(1000).optional() }));
    if (!ctx.app.db.one('SELECT 1 FROM application_questions WHERE id = ? AND application_id = ?', [ctx.params.qid, a.id])) throw notFound();
    ensureAiReady(ctx.app, user.id);
    busy(ctx.app, user.id, a.id);
    const task = ctx.app.tasks.enqueue({
      userId: user.id,
      applicationId: a.id,
      type: 'application.answer',
      input: { questionId: ctx.params.qid, guidance: b.guidance },
      steps: [{ key: 'answer', label: 'Draft the answer' }],
    });
    return json({ task }, { status: 202 });
  });

  /* Artifacts: versions, approval, edits, feedback, downloads ------------------------------------------------------- */

  r.get('/api/artifacts/:id', (ctx) => {
    const user = requireUser(ctx);
    const art = appRepo.getArtifact(ctx.app.db, user.id, ctx.params.id);
    if (!art) throw notFound();
    return json(art);
  });

  r.get('/api/applications/:id/versions/:kind', (ctx) => {
    const user = requireUser(ctx);
    own(ctx.app, user.id, ctx.params.id);
    const kind = z.enum(['research', 'fit', 'strategy', 'resume', 'cover_letter', 'answer', 'review']).parse(ctx.params.kind);
    return json({ versions: appRepo.listVersions(ctx.app.db, user.id, ctx.params.id, kind, ctx.url.searchParams.get('ref') ?? '') });
  });

  r.post('/api/artifacts/:id/approve', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, z.object({ confirmSensitive: z.boolean().optional() }));
    const art = appRepo.getArtifact<any>(ctx.app.db, user.id, ctx.params.id);
    if (!art) throw notFound();
    const blockers = (art.content?.integrity?.issues ?? []).filter((i: { severity: string }) => i.severity === 'blocker');
    if (blockers.length) throw conflict(`Fix ${blockers.length} integrity issue${blockers.length === 1 ? '' : 's'} before approving.`, { blockers });
    let title = `Approved ${art.kind.replace('_', ' ')} v${art.version}`;
    if (art.kind === 'answer') {
      // Sensitive answers (work authorization, salary, legal, demographic…) need an explicit, separate confirmation.
      const q = ctx.app.db.one<{ sensitive: number; question: string }>('SELECT sensitive, question FROM application_questions WHERE id = ? AND user_id = ?', [art.refId, user.id]);
      if (q?.sensitive && body.confirmSensitive !== true) {
        throw new HttpError(409, 'sensitive_confirmation_required', 'This is a sensitive question. Confirm you checked the answer yourself before approving it.');
      }
      if (q) title = `Approved answer v${art.version}: ${shortQuestion(q.question, 60)}`;
    }
    appRepo.approveArtifact(ctx.app.db, user.id, art.id);
    appRepo.addEvent(ctx.app.db, user.id, art.applicationId, { type: 'approval', title });
    audit(ctx.app.db, { userId: user.id, action: 'artifact.approved', targetType: 'artifact', targetId: art.id, meta: { kind: art.kind, version: art.version } });
    return json(appRepo.getArtifact(ctx.app.db, user.id, art.id));
  });

  r.post('/api/artifacts/:id/revise', async (ctx) => {
    const user = requireUser(ctx);
    const art = appRepo.getArtifact<any>(ctx.app.db, user.id, ctx.params.id);
    if (!art) throw notFound();
    const body = await readJson(
      ctx,
      z.object({
        resume: ResumeDraftSchema.optional(),
        coverLetter: z.object({ greeting: z.string().max(200), paragraphs: z.array(z.string().max(4000)).min(1).max(10), closing: z.string().max(200) }).optional(),
        answer: z.string().max(20000).optional(),
        summary: z.string().max(300).default('Edited by you'),
      }),
      400_000,
    );
    const pctx = loadContext(ctx.app, user.id, art.applicationId);
    const intel = requireIntel(pctx);
    const research = appRepo.latestArtifact<ResearchContent>(ctx.app.db, user.id, art.applicationId, 'research')?.content ?? null;
    let content: unknown;
    if (art.kind === 'resume' && body.resume) {
      content = await reviseResume(pctx, body.resume as ResumeDraft, intel, art.content as ResumeContent);
    } else if (art.kind === 'cover_letter' && body.coverLetter) {
      const prev = art.content as CoverLetterContent;
      const paragraphs = body.coverLetter.paragraphs.map((text, i) => {
        const before = prev.draft.paragraphs[i];
        return before ? { ...before, text } : { text, purpose: 'evidence' as const, evidenceIds: [], findingIds: [] };
      });
      content = reviseCoverLetter(pctx, { ...prev.draft, greeting: body.coverLetter.greeting, closing: body.coverLetter.closing, paragraphs }, intel, research);
    } else if (art.kind === 'answer' && body.answer !== undefined) {
      const q = appRepo.listAppQuestions(ctx.app.db, user.id, art.applicationId).find((x) => x.id === art.refId);
      if (!q) throw notFound('Question not found.');
      content = reviseAnswer(pctx, art.content as AnswerContent, body.answer, q, intel, research);
    } else throw badRequest('Nothing to change.');
    const created = appRepo.createArtifact(ctx.app.db, user.id, {
      applicationId: art.applicationId,
      kind: art.kind,
      refId: art.refId,
      content,
      meta: { ...art.meta, editedFrom: art.id },
      changeSummary: body.summary,
      createdBy: 'user',
    });
    return json(created, { status: 201 });
  });

  r.post('/api/artifacts/:id/feedback', async (ctx) => {
    const user = requireUser(ctx);
    const art = appRepo.getArtifact(ctx.app.db, user.id, ctx.params.id);
    if (!art) throw notFound();
    const b = await readJson(ctx, z.object({ rating: z.enum(['up', 'down']), tags: z.array(z.enum(FEEDBACK_TAGS)).max(9).default([]), comment: z.string().max(1000).default('') }));
    ctx.app.db.run('INSERT INTO feedback (id, user_id, artifact_id, rating, tags, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      newId('fbk'),
      user.id,
      art.id,
      b.rating,
      JSON.stringify(b.tags),
      b.comment,
      nowIso(),
    ]);
    return json({ ok: true }, { status: 201 });
  });

  r.get('/api/artifacts/:id/download', async (ctx) => {
    const user = requireUser(ctx);
    const art = appRepo.getArtifact<any>(ctx.app.db, user.id, ctx.params.id);
    if (!art) throw notFound();
    const format = z.enum(['pdf', 'docx', 'txt']).parse(ctx.url.searchParams.get('format') ?? 'pdf');
    const job = appRepo.getJob(ctx.app.db, user.id, appRepo.getApplication(ctx.app.db, user.id, art.applicationId)!.jobId)!;
    const company = job.intelligence?.company || job.companyName || 'Company';
    let bytes: Uint8Array;
    let name: string;
    let type: string;
    if (art.kind === 'resume') {
      const content = art.content as ResumeContent;
      const title = `${content.doc.header.name} - Resume - ${company}`;
      name = safeFileName(title);
      if (format === 'pdf') bytes = (await resumeToPdf(content.doc, { title })).bytes;
      else if (format === 'docx') bytes = await resumeToDocx(content.doc, { title });
      else bytes = new TextEncoder().encode(content.plainText);
    } else if (art.kind === 'cover_letter') {
      const content = art.content as CoverLetterContent;
      const pctx = loadContext(ctx.app, user.id, art.applicationId);
      const profile = pctx.brain.profile;
      const input = {
        name: profile.fullName,
        contact: contactLine(profile),
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        greeting: content.draft.greeting,
        paragraphs: content.draft.paragraphs.map((p) => p.text),
        closing: content.draft.closing,
        title: `${profile.fullName} - Cover Letter - ${company}`,
      };
      name = safeFileName(input.title);
      if (format === 'pdf') bytes = await letterToPdf(input);
      else if (format === 'docx') bytes = await letterToDocx(input);
      else bytes = new TextEncoder().encode(content.text);
    } else if (art.kind === 'answer') {
      const content = art.content as AnswerContent;
      name = safeFileName(`Answer - ${content.question.slice(0, 50)}`);
      bytes = new TextEncoder().encode(`${content.question}\n\n${content.draft.answer}\n`);
      if (format !== 'txt') throw badRequest('Answers download as text.');
    } else throw badRequest('This item cannot be downloaded.');
    const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain; charset=utf-8' }[format];
    type = mime;
    audit(ctx.app.db, { userId: user.id, action: 'artifact.exported', targetType: 'artifact', targetId: art.id, meta: { format } });
    return new Response(bytes as unknown as ConstructorParameters<typeof Response>[0], {
      headers: { 'content-type': type, 'content-disposition': `attachment; filename="${encodeURIComponent(`${name}.${format}`)}"; filename*=UTF-8''${encodeURIComponent(`${name}.${format}`)}` },
    });
  });

  r.post('/api/artifacts/:id/recommendations/:recId', async (ctx) => {
    const user = requireUser(ctx);
    const review = appRepo.getArtifact<ReviewContent>(ctx.app.db, user.id, ctx.params.id);
    if (!review || review.kind !== 'review') throw notFound();
    const b = await readJson(ctx, z.object({ decision: z.enum(['accepted', 'rejected']) }));
    const rec = review.content.recommendations.find((x) => x.id === ctx.params.recId);
    if (!rec) throw notFound('Recommendation not found.');
    let newArtifactId: string | null = null;
    if (b.decision === 'accepted' && rec.applicable) {
      const target = appRepo.getArtifact<any>(ctx.app.db, user.id, rec.targetId);
      if (!target) throw notFound('The document this applies to no longer exists.');
      const latestTarget = appRepo.latestArtifact(ctx.app.db, user.id, target.applicationId, target.kind, target.refId);
      if (latestTarget && latestTarget.id !== target.id) throw conflict('This document changed since the review. Re-run the review to get fresh recommendations.');
      const pctx = loadContext(ctx.app, user.id, target.applicationId);
      const intel = requireIntel(pctx);
      const research = appRepo.latestArtifact<ResearchContent>(ctx.app.db, user.id, target.applicationId, 'research')?.content ?? null;
      const replaceIn = (t: string) => (t.includes(rec.find) ? t.replace(rec.find, rec.replace) : t);
      let content: any;
      if (target.kind === 'resume') {
        const d = (target.content as ResumeContent).draft;
        const next: ResumeDraft = {
          ...d,
          summary: { ...d.summary, text: replaceIn(d.summary.text) },
          experience: d.experience.map((e) => ({ ...e, bullets: e.bullets.map((x) => ({ ...x, text: replaceIn(x.text) })) })),
          projects: d.projects.map((e) => ({ ...e, bullets: e.bullets.map((x) => ({ ...x, text: replaceIn(x.text) })) })),
          education: d.education.map((e) => ({ ...e, details: e.details.map((x) => ({ ...x, text: replaceIn(x.text) })) })),
          leadership: { entries: d.leadership.entries.map((e) => ({ ...e, bullets: e.bullets.map((x) => ({ ...x, text: replaceIn(x.text) })) })), lines: d.leadership.lines.map((x) => ({ ...x, text: replaceIn(x.text) })) },
        };
        content = await reviseResume(pctx, next, intel, target.content as ResumeContent);
      } else if (target.kind === 'cover_letter') {
        const prev = target.content as CoverLetterContent;
        content = reviseCoverLetter(pctx, { ...prev.draft, paragraphs: prev.draft.paragraphs.map((p) => ({ ...p, text: replaceIn(p.text) })) }, intel, research);
      } else if (target.kind === 'answer') {
        const q = appRepo.listAppQuestions(ctx.app.db, user.id, target.applicationId).find((x) => x.id === target.refId)!;
        const prev = target.content as AnswerContent;
        content = reviseAnswer(pctx, prev, replaceIn(prev.draft.answer), q, intel, research);
      }
      const before = (target.content.integrity?.issues ?? []).filter((i: { severity: string }) => i.severity === 'blocker').length;
      const after = (content.integrity?.issues ?? []).filter((i: { severity: string }) => i.severity === 'blocker').length;
      if (after > before) throw new HttpError(422, 'integrity', 'That edit would add a claim your evidence does not support, so it was not applied.');
      newArtifactId = appRepo.createArtifact(ctx.app.db, user.id, {
        applicationId: target.applicationId,
        kind: target.kind,
        refId: target.refId,
        content,
        meta: { ...target.meta, fromRecommendation: rec.id },
        changeSummary: `Applied review suggestion: ${rec.title}`,
        createdBy: 'user',
      }).id;
    }
    review.content.decisions[rec.id] = b.decision;
    appRepo.updateArtifactContent(ctx.app.db, user.id, review.id, review.content);
    return json({ ok: true, newArtifactId });
  });

  /* Submission (human approval gate) --------------------------------------------------------------------------------- */

  r.get('/api/applications/:id/submission-check', (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    return json(submissionCheck(ctx.app, user.id, a));
  });

  r.post('/api/applications/:id/submit', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(
      ctx,
      z.object({
        confirm: z.literal(true),
        dateApplied: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        submittedAt: z.string().max(40).optional(),
        withoutCoverLetter: z.boolean().default(false),
      }),
    );
    const check = submissionCheck(ctx.app, user.id, a, b.withoutCoverLetter);
    if (!check.ok) throw conflict('Approve your materials before marking this application as submitted.', check);
    const dateApplied = b.dateApplied || nowIso().slice(0, 10);
    const followUp = new Date(Date.parse(`${dateApplied}T12:00:00.000Z`) + 7 * 86400_000).toISOString().slice(0, 10);
    appRepo.updateApplication(ctx.app.db, user.id, a.id, {
      stage: STAGES.indexOf(a.stage) < STAGES.indexOf('applied') ? 'applied' : a.stage,
      dateApplied,
      finalResumeId: check.resumeId,
      finalCoverLetterId: b.withoutCoverLetter ? null : check.coverLetterId,
      submittedSnapshot: JSON.stringify({ resumeId: check.resumeId, coverLetterId: b.withoutCoverLetter ? null : check.coverLetterId, answerIds: check.answerIds, at: nowIso() }),
      nextAction: a.nextAction || 'Follow up if you have not heard back',
      nextActionDate: a.nextActionDate || followUp,
    });
    const submittedAt = b.submittedAt && !Number.isNaN(Date.parse(b.submittedAt)) ? new Date(b.submittedAt).toISOString() : `${dateApplied}T12:00:00.000Z`;
    appRepo.addEvent(ctx.app.db, user.id, a.id, { type: 'applied', title: 'Application submitted', occurredAt: submittedAt });
    audit(ctx.app.db, { userId: user.id, action: 'application.stage_changed', targetType: 'application', targetId: a.id, meta: { to: 'applied' } });
    return json(appRepo.getApplication(ctx.app.db, user.id, a.id));
  });

  /* Contacts, notes, timeline ------------------------------------------------------------------------------------------- */

  const ContactInput = z.object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(CONTACT_ROLES).default('other'),
    title: z.string().max(160).default(''),
    email: z.string().max(200).default(''),
    linkedinUrl: z.string().max(300).default(''),
    notes: z.string().max(2000).default(''),
    lastContactedAt: z.string().max(40).nullable().default(null),
  });

  r.post('/api/applications/:id/contacts', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(ctx, ContactInput);
    const id = newId('cnt');
    ctx.app.db.run(
      `INSERT INTO contacts (id, user_id, application_id, name, role, title, email, linkedin_url, notes, last_contacted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user.id, a.id, b.name, b.role, b.title, b.email, b.linkedinUrl, b.notes, b.lastContactedAt, nowIso(), nowIso()],
    );
    return json({ id }, { status: 201 });
  });

  r.patch('/api/applications/:id/contacts/:cid', async (ctx) => {
    const user = requireUser(ctx);
    own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(ctx, ContactInput.partial());
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM contacts WHERE id = ? AND user_id = ?', [ctx.params.cid, user.id]);
    if (!row) throw notFound();
    ctx.app.db.run('UPDATE contacts SET name = ?, role = ?, title = ?, email = ?, linkedin_url = ?, notes = ?, last_contacted_at = ?, updated_at = ? WHERE id = ?', [
      b.name ?? row.name,
      b.role ?? row.role,
      b.title ?? row.title,
      b.email ?? row.email,
      b.linkedinUrl ?? row.linkedin_url,
      b.notes ?? row.notes,
      b.lastContactedAt !== undefined ? b.lastContactedAt : row.last_contacted_at,
      nowIso(),
      row.id,
    ]);
    return json({ ok: true });
  });

  r.delete('/api/applications/:id/contacts/:cid', (ctx) => {
    const user = requireUser(ctx);
    own(ctx.app, user.id, ctx.params.id);
    if (!ctx.app.db.run('DELETE FROM contacts WHERE id = ? AND user_id = ?', [ctx.params.cid, user.id]).changes) throw notFound();
    return noContent();
  });

  r.post('/api/applications/:id/notes', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(ctx, z.object({ body: z.string().trim().min(1).max(10000) }));
    const id = newId('nte');
    ctx.app.db.run('INSERT INTO notes (id, user_id, application_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, user.id, a.id, b.body, nowIso(), nowIso()]);
    return json({ id }, { status: 201 });
  });

  r.delete('/api/applications/:id/notes/:nid', (ctx) => {
    const user = requireUser(ctx);
    own(ctx.app, user.id, ctx.params.id);
    if (!ctx.app.db.run('DELETE FROM notes WHERE id = ? AND user_id = ?', [ctx.params.nid, user.id]).changes) throw notFound();
    return noContent();
  });

  r.post('/api/applications/:id/events', async (ctx) => {
    const user = requireUser(ctx);
    const a = own(ctx.app, user.id, ctx.params.id);
    const b = await readJson(
      ctx,
      z.object({ type: z.enum(['interview', 'follow_up', 'message', 'note', 'other']), title: z.string().trim().min(1).max(200), occurredAt: z.string().max(40).optional() }),
    );
    const id = appRepo.addEvent(ctx.app.db, user.id, a.id, { type: b.type, title: b.title, occurredAt: b.occurredAt ? new Date(b.occurredAt).toISOString() : undefined });
    if (b.type === 'follow_up' && a.nextActionDate && Date.parse(a.nextActionDate) <= Date.now() + 86400_000) {
      appRepo.updateApplication(ctx.app.db, user.id, a.id, { nextActionDate: null, nextAction: '' });
    }
    return json({ id }, { status: 201 });
  });
}

/** "Why are you interested in Northwind? (150 words max)" -> "Why are you interested in Northwind?", cut at a word boundary. */
function shortQuestion(q: string, max = 70): string {
  const t = q.replace(/\s*\((?:[^()]*\b(?:words?|characters?|chars?)\b[^()]*)\)\s*$/i, '').replace(/^\s*\d+[.)]\s*/, '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '')}…`;
}

export function submissionCheck(app: App, userId: string, a: appRepo.ApplicationDTO, withoutCoverLetter = false) {
  const resume = appRepo.latestArtifact<ResumeContent>(app.db, userId, a.id, 'resume');
  const letter = appRepo.latestArtifact<CoverLetterContent>(app.db, userId, a.id, 'cover_letter');
  const questions = appRepo.listAppQuestions(app.db, userId, a.id);
  const problems: string[] = [];
  const approvedResume = app.db.one<{ id: string }>(`SELECT id FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = 'resume' AND status = 'approved' ORDER BY version DESC LIMIT 1`, [userId, a.id]);
  if (!resume) problems.push('Generate a resume.');
  else if (!approvedResume) problems.push('Approve a version of your resume.');
  const approvedLetter = app.db.one<{ id: string }>(`SELECT id FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = 'cover_letter' AND status = 'approved' ORDER BY version DESC LIMIT 1`, [userId, a.id]);
  if (letter && !approvedLetter && !withoutCoverLetter) problems.push('Approve your cover letter, or choose to submit without one.');
  const answerIds: string[] = [];
  questions.forEach((q, i) => {
    const approved = app.db.one<{ id: string }>(`SELECT id FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = 'answer' AND ref_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`, [
      userId,
      a.id,
      q.id,
    ]);
    if (approved) answerIds.push(approved.id);
    else if (q.sensitive) problems.push(`Check and approve answer ${i + 1} (sensitive): ${shortQuestion(q.question)}`);
    else if (q.required) problems.push(`Approve answer ${i + 1}: ${shortQuestion(q.question)}`);
  });
  return { ok: problems.length === 0, problems, resumeId: approvedResume?.id ?? null, coverLetterId: approvedLetter?.id ?? null, answerIds };
}

export { STAGE_LABEL };
