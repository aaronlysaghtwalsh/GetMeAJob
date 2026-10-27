import { z } from 'zod/v4';
import type { Router } from '../http/router';
import { badRequest, json, noContent, notFound, parseWith, readJson, requireUser, tooMany, HttpError } from '../http/core';
import * as brainRepo from '../repos/brain';
import { getPreferences, savePreferences } from '../repos/preferences';
import { computeReadiness } from '../services/brain/readiness';
import { storeDocument } from '../services/documents/service';
import { INGEST_STEPS } from '../tasks/brain-tasks';
import { audit } from '../security/audit';
import { nowIso } from '../lib/ids';
import { parseJson } from '../db/database';
import { DOCUMENT_KINDS, EVIDENCE_KINDS, THEMES } from '../../shared/constants';
import {
  EducationInput,
  EvidenceInput,
  ExperienceInput,
  PreferencesSchema,
  ProfileInput,
  ProjectInput,
  SkillInput,
  type EvidenceSource,
} from '../../shared/schemas/brain';
import { normalizeDate } from '../../shared/text';
import type { App } from '../app';

function ensureAiReady(app: App, userId: string) {
  const status = app.ai.status(userId);
  if (!status.configured) throw new HttpError(409, 'ai_not_configured', status.message ?? 'Connect an AI provider in Settings first.');
  if (!app.limits.aiStart.hit(userId)) throw tooMany('You have started a lot of AI work this hour. Wait a bit and try again.');
}

export function brainRoutes(r: Router) {
  /* Overview ---------------------------------------------------------------------------------------- */

  r.get('/api/brain', (ctx) => {
    const user = requireUser(ctx);
    return json({
      brain: brainRepo.getBrain(ctx.app.db, user.id),
      readiness: computeReadiness(ctx.app, user.id),
      tasks: ctx.app.tasks.active(user.id, { typePrefix: 'brain.' }),
      openQuestions: brainRepo.listQuestions(ctx.app.db, user.id, ['open']).length,
    });
  });

  r.get('/api/brain/readiness', (ctx) => json(computeReadiness(ctx.app, requireUser(ctx).id)));

  r.put('/api/brain/profile', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, ProfileInput);
    brainRepo.upsertProfile(ctx.app.db, user.id, body, [{ type: 'manual' }]);
    return json(brainRepo.getProfile(ctx.app.db, user.id));
  });

  /* Records: experiences / education / projects ------------------------------------------------------- */

  const userSource = (): EvidenceSource[] => [{ type: 'manual', note: 'Entered by applicant' }];

  r.post('/api/brain/experiences', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, ExperienceInput);
    const id = brainRepo.insertExperience(ctx.app.db, user.id, {
      ...b,
      startDate: normalizeDate(b.startDate),
      endDate: b.isCurrent ? '' : normalizeDate(b.endDate),
      provenance: 'applicant_provided',
      sources: userSource(),
    });
    audit(ctx.app.db, { userId: user.id, action: 'brain.item_changed', targetType: 'experience', targetId: id, meta: { op: 'create' } });
    return json({ id }, { status: 201 });
  });

  r.patch('/api/brain/experiences/:id', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, ExperienceInput.partial().extend({ hidden: z.boolean().optional() }));
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM experiences WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!row) throw notFound();
    const factual = ['organization', 'title', 'startDate', 'endDate', 'isCurrent', 'location', 'kind', 'employmentType', 'summary'].some((k) => k in b);
    const sources = factual ? [...parseJson<EvidenceSource[]>(row.sources, []), ...userSource()] : parseJson<EvidenceSource[]>(row.sources, []);
    ctx.app.db.run(
      `UPDATE experiences SET kind = ?, organization = ?, title = ?, location = ?, start_date = ?, end_date = ?, is_current = ?, employment_type = ?, summary = ?, hidden = ?, provenance = ?, sources = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [
        b.kind ?? row.kind,
        b.organization ?? row.organization,
        b.title ?? row.title,
        b.location ?? row.location,
        b.startDate !== undefined ? normalizeDate(b.startDate) : row.start_date,
        b.isCurrent ? '' : b.endDate !== undefined ? normalizeDate(b.endDate) : row.end_date,
        b.isCurrent ?? !!row.is_current,
        b.employmentType ?? row.employment_type,
        b.summary ?? row.summary,
        b.hidden ?? !!row.hidden,
        factual ? 'applicant_provided' : row.provenance,
        JSON.stringify(sources),
        nowIso(),
        row.id,
        user.id,
      ],
    );
    audit(ctx.app.db, { userId: user.id, action: 'brain.item_changed', targetType: 'experience', targetId: row.id, meta: { op: 'update' } });
    return json({ ok: true });
  });

  r.post('/api/brain/education', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, EducationInput);
    const id = brainRepo.insertEducation(ctx.app.db, user.id, {
      ...b,
      startDate: normalizeDate(b.startDate),
      endDate: normalizeDate(b.endDate),
      provenance: 'applicant_provided',
      sources: userSource(),
    });
    return json({ id }, { status: 201 });
  });

  r.patch('/api/brain/education/:id', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, EducationInput.partial().extend({ hidden: z.boolean().optional() }));
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM education WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!row) throw notFound();
    const factual = Object.keys(b).some((k) => k !== 'hidden');
    ctx.app.db.run(
      `UPDATE education SET institution = ?, degree = ?, field = ?, minor = ?, location = ?, start_date = ?, end_date = ?, grade = ?, coursework = ?, honors = ?, hidden = ?, provenance = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [
        b.institution ?? row.institution,
        b.degree ?? row.degree,
        b.field ?? row.field,
        b.minor ?? row.minor,
        b.location ?? row.location,
        b.startDate !== undefined ? normalizeDate(b.startDate) : row.start_date,
        b.endDate !== undefined ? normalizeDate(b.endDate) : row.end_date,
        b.grade ?? row.grade,
        JSON.stringify(b.coursework ?? parseJson(row.coursework, [])),
        JSON.stringify(b.honors ?? parseJson(row.honors, [])),
        b.hidden ?? !!row.hidden,
        factual ? 'applicant_provided' : row.provenance,
        nowIso(),
        row.id,
        user.id,
      ],
    );
    return json({ ok: true });
  });

  r.post('/api/brain/projects', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, ProjectInput);
    const id = brainRepo.insertProject(ctx.app.db, user.id, {
      ...b,
      startDate: normalizeDate(b.startDate),
      endDate: normalizeDate(b.endDate),
      provenance: 'applicant_provided',
      sources: userSource(),
    });
    return json({ id }, { status: 201 });
  });

  r.patch('/api/brain/projects/:id', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, ProjectInput.partial().extend({ hidden: z.boolean().optional() }));
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM projects WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!row) throw notFound();
    const factual = Object.keys(b).some((k) => k !== 'hidden');
    ctx.app.db.run(
      `UPDATE projects SET name = ?, context = ?, role = ?, start_date = ?, end_date = ?, url = ?, summary = ?, technologies = ?, hidden = ?, provenance = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [
        b.name ?? row.name,
        b.context ?? row.context,
        b.role ?? row.role,
        b.startDate !== undefined ? normalizeDate(b.startDate) : row.start_date,
        b.endDate !== undefined ? normalizeDate(b.endDate) : row.end_date,
        b.url ?? row.url,
        b.summary ?? row.summary,
        JSON.stringify(b.technologies ?? parseJson(row.technologies, [])),
        b.hidden ?? !!row.hidden,
        factual ? 'applicant_provided' : row.provenance,
        nowIso(),
        row.id,
        user.id,
      ],
    );
    return json({ ok: true });
  });

  for (const [segment, table] of [
    ['experiences', 'experiences'],
    ['education', 'education'],
    ['projects', 'projects'],
  ] as const) {
    r.delete(`/api/brain/${segment}/:id`, (ctx) => {
      const user = requireUser(ctx);
      const res = ctx.app.db.tx(() => {
        ctx.app.db.run(`UPDATE evidence SET subject_type = 'general', subject_id = NULL, updated_at = ? WHERE user_id = ? AND subject_id = ?`, [nowIso(), user.id, ctx.params.id]);
        return ctx.app.db.run(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [ctx.params.id, user.id]);
      });
      if (!res.changes) throw notFound();
      audit(ctx.app.db, { userId: user.id, action: 'brain.item_changed', targetType: segment, targetId: ctx.params.id, meta: { op: 'delete' } });
      return noContent();
    });
  }

  /* Evidence --------------------------------------------------------------------------------------------- */

  r.post('/api/brain/evidence', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, EvidenceInput);
    const subjectType = b.subjectId ? brainRepo.subjectTypeOf(ctx.app.db, user.id, b.subjectId) : 'general';
    if (b.subjectId && !subjectType) throw badRequest('That role, degree or project does not exist.');
    const id = brainRepo.insertEvidence(ctx.app.db, user.id, {
      statement: b.statement,
      kind: b.kind,
      subjectType: subjectType ?? 'general',
      subjectId: b.subjectId,
      metrics: [],
      skills: b.skills,
      themes: b.themes,
      provenance: 'applicant_provided',
      sources: [{ type: 'manual', note: 'Entered by applicant' }],
      userConfirmed: true,
    });
    for (const s of b.skills) brainRepo.upsertSkill(ctx.app.db, user.id, { name: s, category: 'technical', provenance: 'applicant_provided', evidenceIds: [id] });
    audit(ctx.app.db, { userId: user.id, action: 'brain.item_changed', targetType: 'evidence', targetId: id, meta: { op: 'create' } });
    return json({ id }, { status: 201 });
  });

  r.patch('/api/brain/evidence/:id', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(
      ctx,
      z.object({
        statement: z.string().trim().min(3).max(600).optional(),
        kind: z.enum(EVIDENCE_KINDS).optional(),
        themes: z.array(z.enum(THEMES)).optional(),
        skills: z.array(z.string().max(80)).max(20).optional(),
        subjectId: z.string().nullable().optional(),
        hidden: z.boolean().optional(),
      }),
    );
    const ev = brainRepo.getEvidence(ctx.app.db, user.id, ctx.params.id);
    if (!ev) throw notFound();
    const patch: Parameters<typeof brainRepo.updateEvidence>[3] = {};
    if (b.statement !== undefined && b.statement !== ev.statement) {
      patch.statement = b.statement;
      patch.provenance = 'applicant_provided';
      patch.userConfirmed = true;
      patch.sources = [...ev.sources, { type: 'manual', note: 'Edited by applicant' }];
      patch.metrics = [];
    }
    if (b.kind) patch.kind = b.kind;
    if (b.themes) patch.themes = b.themes;
    if (b.skills) patch.skills = b.skills;
    if (b.hidden !== undefined) patch.hidden = b.hidden;
    if (b.subjectId !== undefined) {
      const t = b.subjectId ? brainRepo.subjectTypeOf(ctx.app.db, user.id, b.subjectId) : 'general';
      if (!t) throw badRequest('That role, degree or project does not exist.');
      patch.subjectId = b.subjectId;
      patch.subjectType = t;
    }
    brainRepo.updateEvidence(ctx.app.db, user.id, ev.id, patch);
    audit(ctx.app.db, { userId: user.id, action: 'brain.item_changed', targetType: 'evidence', targetId: ev.id, meta: { op: 'update', fields: Object.keys(b) } });
    return json(brainRepo.getEvidence(ctx.app.db, user.id, ev.id));
  });

  r.post('/api/brain/evidence/:id/confirm', (ctx) => {
    const user = requireUser(ctx);
    const ev = brainRepo.getEvidence(ctx.app.db, user.id, ctx.params.id);
    if (!ev) throw notFound();
    brainRepo.updateEvidence(ctx.app.db, user.id, ev.id, {
      userConfirmed: true,
      hidden: false,
      provenance: ev.provenance === 'verified' ? 'verified' : 'applicant_provided',
      sources: [...ev.sources, { type: 'confirmation', at: nowIso() }],
    });
    return json(brainRepo.getEvidence(ctx.app.db, user.id, ev.id));
  });

  r.post('/api/brain/evidence/:id/reject', (ctx) => {
    const user = requireUser(ctx);
    const ev = brainRepo.getEvidence(ctx.app.db, user.id, ctx.params.id);
    if (!ev) throw notFound();
    brainRepo.updateEvidence(ctx.app.db, user.id, ev.id, { provenance: 'unsupported', hidden: true, userConfirmed: false });
    audit(ctx.app.db, { userId: user.id, action: 'brain.item_changed', targetType: 'evidence', targetId: ev.id, meta: { op: 'reject' } });
    return json(brainRepo.getEvidence(ctx.app.db, user.id, ev.id));
  });

  r.delete('/api/brain/evidence/:id', (ctx) => {
    const user = requireUser(ctx);
    const res = ctx.app.db.run('DELETE FROM evidence WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!res.changes) throw notFound();
    for (const s of ctx.app.db.all<{ id: string; evidence_ids: string }>('SELECT id, evidence_ids FROM skills WHERE user_id = ?', [user.id])) {
      const ids = parseJson<string[]>(s.evidence_ids, []);
      if (ids.includes(ctx.params.id)) ctx.app.db.run('UPDATE skills SET evidence_ids = ? WHERE id = ?', [JSON.stringify(ids.filter((x) => x !== ctx.params.id)), s.id]);
    }
    return noContent();
  });

  /* Skills ------------------------------------------------------------------------------------------------ */

  r.post('/api/brain/skills', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, SkillInput);
    const id = brainRepo.upsertSkill(ctx.app.db, user.id, { name: b.name, category: b.category, provenance: 'applicant_provided', sources: [{ type: 'manual' }] });
    return json({ id }, { status: 201 });
  });

  r.patch('/api/brain/skills/:id', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, SkillInput.partial().extend({ hidden: z.boolean().optional(), confirm: z.boolean().optional() }));
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM skills WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!row) throw notFound();
    ctx.app.db.run('UPDATE skills SET category = ?, hidden = ?, provenance = ?, updated_at = ? WHERE id = ?', [
      b.category ?? row.category,
      b.hidden ?? !!row.hidden,
      b.confirm && row.provenance !== 'verified' ? 'applicant_provided' : row.provenance,
      nowIso(),
      row.id,
    ]);
    return json({ ok: true });
  });

  r.delete('/api/brain/skills/:id', (ctx) => {
    const user = requireUser(ctx);
    const res = ctx.app.db.run('DELETE FROM skills WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!res.changes) throw notFound();
    return noContent();
  });

  /* Documents ---------------------------------------------------------------------------------------------- */

  r.get('/api/documents', (ctx) => {
    const user = requireUser(ctx);
    return json({ documents: brainRepo.listDocuments(ctx.app.db, user.id), tasks: ctx.app.tasks.active(user.id, { typePrefix: 'brain.' }) });
  });

  r.post('/api/documents', async (ctx) => {
    const user = requireUser(ctx);
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw badRequest('Upload must be multipart form data.');
    }
    const kind = parseWith(z.enum(DOCUMENT_KINDS), form.get('kind') ?? 'resume');
    const autoProcess = form.get('process') !== 'false';
    const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
    if (!files.length) throw badRequest('Choose at least one file.');
    if (files.length > 10) throw badRequest('Upload at most 10 files at a time.');
    const ids: string[] = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        ids.push(await storeDocument(ctx.app, { userId: user.id, filename: f.name, data: Buffer.from(await f.arrayBuffer()), kind, ip: ctx.ip }));
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    let task = null;
    if (ids.length && autoProcess) {
      const status = ctx.app.ai.status(user.id);
      if (status.configured) {
        task = ctx.app.tasks.enqueue({ userId: user.id, type: 'brain.ingest', input: { documentIds: ids }, steps: INGEST_STEPS });
      }
    }
    return json({ documentIds: ids, errors, task }, { status: ids.length ? 201 : 400 });
  });

  r.post('/api/brain/rebuild', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, z.object({ documentIds: z.array(z.string()).max(20).optional() }));
    ensureAiReady(ctx.app, user.id);
    const ids =
      b.documentIds ??
      ctx.app.db.all<{ id: string }>(`SELECT id FROM documents WHERE user_id = ? AND included_in_brain = 0 AND status != 'failed'`, [user.id]).map((x) => x.id);
    const owned = ids.filter((id) => brainRepo.getDocumentRow(ctx.app.db, user.id, id));
    if (!owned.length) throw badRequest('There are no new documents to process.');
    if (ctx.app.tasks.active(user.id, { typePrefix: 'brain.ingest' }).length) throw badRequest('Your Career Brain is already being updated.');
    for (const id of owned) ctx.app.db.run(`UPDATE documents SET status = CASE WHEN text_content IS NULL THEN 'uploaded' ELSE 'extracted' END, error = NULL WHERE id = ?`, [id]);
    const task = ctx.app.tasks.enqueue({ userId: user.id, type: 'brain.ingest', input: { documentIds: owned }, steps: INGEST_STEPS });
    return json({ task }, { status: 202 });
  });

  r.patch('/api/documents/:id', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, z.object({ label: z.string().trim().min(1).max(120).optional(), kind: z.enum(DOCUMENT_KINDS).optional() }));
    const row = brainRepo.getDocumentRow(ctx.app.db, user.id, ctx.params.id);
    if (!row) throw notFound();
    ctx.app.db.run('UPDATE documents SET label = ?, kind = ?, updated_at = ? WHERE id = ?', [b.label ?? row.label, b.kind ?? row.kind, nowIso(), row.id]);
    if (b.label) ctx.app.db.run('UPDATE resume_sources SET label = ? WHERE document_id = ?', [b.label, row.id]);
    return json({ ok: true });
  });

  r.get('/api/documents/:id/text', (ctx) => {
    const user = requireUser(ctx);
    const row = brainRepo.getDocumentRow(ctx.app.db, user.id, ctx.params.id);
    if (!row) throw notFound();
    return json({ document: brainRepo.toDocument(row), text: row.text_content ?? '', extraction: parseJson(row.extraction, null) });
  });

  r.get('/api/documents/:id/file', async (ctx) => {
    const user = requireUser(ctx);
    const row = brainRepo.getDocumentRow(ctx.app.db, user.id, ctx.params.id);
    if (!row) throw notFound();
    const data = await ctx.app.storage.get(user.id, row.storage_key);
    audit(ctx.app.db, { userId: user.id, action: 'document.downloaded', targetType: 'document', targetId: row.id, ip: ctx.ip });
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': row.mime,
        'content-disposition': `attachment; filename="${encodeURIComponent(row.filename)}"`,
      },
    });
  });

  r.delete('/api/documents/:id', (ctx) => {
    const user = requireUser(ctx);
    const purge = ctx.url.searchParams.get('purge') === '1';
    const row = brainRepo.getDocumentRow(ctx.app.db, user.id, ctx.params.id);
    if (!row) throw notFound();
    const stats = { removed: 0, downgraded: 0 };
    ctx.app.db.tx(() => {
      for (const ev of brainRepo.listEvidence(ctx.app.db, user.id)) {
        const remaining = ev.sources.filter((s) => !(s.type === 'document' && s.documentId === row.id));
        if (remaining.length === ev.sources.length) continue;
        if (!remaining.length && purge) {
          ctx.app.db.run('DELETE FROM evidence WHERE id = ?', [ev.id]);
          stats.removed++;
        } else {
          const prov = ev.provenance === 'unsupported' ? 'unsupported' : ev.userConfirmed ? 'applicant_provided' : brainRepo.provenanceFromSources(remaining, 'inferred');
          if (prov !== ev.provenance) stats.downgraded++;
          brainRepo.updateEvidence(ctx.app.db, user.id, ev.id, { sources: remaining, provenance: prov });
        }
      }
      for (const table of ['experiences', 'education', 'projects']) {
        for (const rec of ctx.app.db.all<{ id: string; sources: string; provenance: string }>(`SELECT id, sources, provenance FROM ${table} WHERE user_id = ?`, [user.id])) {
          const sources = parseJson<EvidenceSource[]>(rec.sources, []);
          const remaining = sources.filter((s) => !(s.type === 'document' && s.documentId === row.id));
          if (remaining.length === sources.length) continue;
          if (!remaining.length && purge) {
            ctx.app.db.run(`UPDATE evidence SET subject_type = 'general', subject_id = NULL WHERE subject_id = ?`, [rec.id]);
            ctx.app.db.run(`DELETE FROM ${table} WHERE id = ?`, [rec.id]);
          } else {
            const prov = rec.provenance === 'applicant_provided' ? rec.provenance : brainRepo.provenanceFromSources(remaining, 'inferred');
            ctx.app.db.run(`UPDATE ${table} SET sources = ?, provenance = ? WHERE id = ?`, [JSON.stringify(remaining), prov, rec.id]);
          }
        }
      }
      ctx.app.db.run('DELETE FROM documents WHERE id = ? AND user_id = ?', [row.id, user.id]);
    });
    void ctx.app.storage.delete(user.id, row.storage_key);
    audit(ctx.app.db, { userId: user.id, action: 'document.deleted', targetType: 'document', targetId: row.id, meta: { purge, ...stats }, ip: ctx.ip });
    return json(stats);
  });

  /* Discovery questions --------------------------------------------------------------------------------------- */

  r.get('/api/brain/questions', (ctx) => {
    const user = requireUser(ctx);
    return json({
      open: brainRepo.listQuestions(ctx.app.db, user.id, ['open']),
      answered: brainRepo.listQuestions(ctx.app.db, user.id, ['answered']).slice(0, 50),
      tasks: ctx.app.tasks.active(user.id, { typePrefix: 'brain.' }),
    });
  });

  r.post('/api/brain/questions/:id/answer', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx, z.object({ answer: z.string().trim().min(1).max(4000) }));
    const row = ctx.app.db.one<Record<string, any>>('SELECT * FROM discovery_questions WHERE id = ? AND user_id = ?', [ctx.params.id, user.id]);
    if (!row) throw notFound();
    ensureAiReady(ctx.app, user.id);
    ctx.app.db.run(`UPDATE discovery_questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ?`, [b.answer, nowIso(), row.id]);
    const task = ctx.app.tasks.enqueue({ userId: user.id, type: 'brain.answer', input: { questionId: row.id }, steps: [{ key: 'integrate', label: 'Update your Career Brain' }] });
    return json({ task }, { status: 202 });
  });

  r.post('/api/brain/questions/:id/skip', (ctx) => {
    const user = requireUser(ctx);
    const res = ctx.app.db.run(`UPDATE discovery_questions SET status = 'skipped' WHERE id = ? AND user_id = ? AND status = 'open'`, [ctx.params.id, user.id]);
    if (!res.changes) throw notFound();
    return json({ ok: true });
  });

  r.post('/api/brain/questions/refresh', (ctx) => {
    const user = requireUser(ctx);
    ensureAiReady(ctx.app, user.id);
    if (ctx.app.tasks.active(user.id, { typePrefix: 'brain.' }).length) throw badRequest('Your Career Brain is being updated. Try again in a moment.');
    const task = ctx.app.tasks.enqueue({ userId: user.id, type: 'brain.discovery', steps: [{ key: 'questions', label: 'Prepare follow-up questions' }] });
    return json({ task }, { status: 202 });
  });

  /* Preferences ------------------------------------------------------------------------------------------------- */

  r.get('/api/preferences', (ctx) => json(getPreferences(ctx.app.db, requireUser(ctx).id)));

  r.put('/api/preferences', async (ctx) => {
    const user = requireUser(ctx);
    const prefs = await readJson(ctx, PreferencesSchema);
    savePreferences(ctx.app.db, user.id, prefs);
    return json(prefs);
  });
}

export { ensureAiReady };
