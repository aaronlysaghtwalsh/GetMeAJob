import type { Database } from '../db/database';
import { parseJson } from '../db/database';
import { newId, nowIso } from '../lib/ids';
import type { ArtifactKind, ContactRole, Stage, Tier } from '../../shared/constants';
import type { JobIntelligence } from '../../shared/schemas/job';
import type { ImportedQuestion } from '../services/jobs/fetch';
import { normalizeName } from '../../shared/text';

type R = Record<string, any>;

export interface JobDTO {
  id: string;
  title: string;
  companyName: string;
  companyId: string | null;
  location: string;
  workModel: string;
  salaryText: string;
  source: string;
  sourceUrl: string;
  ats: string;
  rawText: string;
  intelligence: JobIntelligence | null;
  createdAt: string;
}

export interface ApplicationDTO {
  id: string;
  jobId: string;
  stage: Stage;
  tier: Tier | null;
  researchDepth: 'standard' | 'deep' | 'maximum';
  dateApplied: string | null;
  outcome: string | null;
  nextAction: string;
  nextActionDate: string | null;
  finalResumeId: string | null;
  finalCoverLetterId: string | null;
  submittedSnapshot: unknown;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactDTO<T = unknown> {
  id: string;
  applicationId: string;
  kind: ArtifactKind;
  refId: string;
  version: number;
  status: 'draft' | 'approved' | 'superseded' | 'failed';
  content: T;
  meta: Record<string, unknown>;
  parentId: string | null;
  changeSummary: string;
  createdBy: 'ai' | 'user';
  createdAt: string;
  approvedAt: string | null;
}

export interface QuestionRowDTO {
  id: string;
  question: string;
  limitType: 'words' | 'chars' | 'none';
  limitValue: number | null;
  required: boolean;
  sensitive: boolean;
  sortOrder: number;
}

export interface EventDTO {
  id: string;
  type: string;
  title: string;
  detail: Record<string, unknown>;
  occurredAt: string;
}

export interface ContactDTO {
  id: string;
  applicationId: string | null;
  name: string;
  role: ContactRole;
  title: string;
  email: string;
  linkedinUrl: string;
  notes: string;
  lastContactedAt: string | null;
}

export interface NoteDTO {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const toJob = (r: R): JobDTO => ({
  id: r.id,
  title: r.title,
  companyName: r.company_name,
  companyId: r.company_id,
  location: r.location,
  workModel: r.work_model,
  salaryText: r.salary_text,
  source: r.source,
  sourceUrl: r.source_url,
  ats: r.ats,
  rawText: r.raw_text,
  intelligence: parseJson<JobIntelligence | null>(r.intelligence, null),
  createdAt: r.created_at,
});

export const toApplication = (r: R): ApplicationDTO => ({
  id: r.id,
  jobId: r.job_id,
  stage: r.stage,
  tier: r.tier,
  researchDepth: r.research_depth,
  dateApplied: r.date_applied,
  outcome: r.outcome,
  nextAction: r.next_action,
  nextActionDate: r.next_action_date,
  finalResumeId: r.final_resume_id,
  finalCoverLetterId: r.final_cover_letter_id,
  submittedSnapshot: parseJson(r.submitted_snapshot, null),
  archived: !!r.archived,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function toArtifact<T>(r: R): ArtifactDTO<T> {
  return {
    id: r.id,
    applicationId: r.application_id,
    kind: r.kind,
    refId: r.ref_id,
    version: Number(r.version),
    status: r.status,
    content: parseJson<T>(r.content, {} as T),
    meta: parseJson(r.meta, {}),
    parentId: r.parent_id,
    changeSummary: r.change_summary,
    createdBy: r.created_by,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
  };
}

/* Companies & jobs ------------------------------------------------------------------------------------ */

export function upsertCompany(db: Database, userId: string, name: string, website = ''): string | null {
  const norm = normalizeName(name);
  if (!norm) return null;
  const existing = db.one<{ id: string; website: string }>('SELECT id, website FROM companies WHERE user_id = ? AND name_normalized = ?', [userId, norm]);
  if (existing) {
    if (website && !existing.website) db.run('UPDATE companies SET website = ?, updated_at = ? WHERE id = ?', [website, nowIso(), existing.id]);
    return existing.id;
  }
  const id = newId('cmp');
  db.run('INSERT INTO companies (id, user_id, name, name_normalized, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, userId, name.trim(), norm, website, nowIso(), nowIso()]);
  return id;
}

export function getCompanyWebsite(db: Database, userId: string, companyId: string | null): string {
  if (!companyId) return '';
  return db.one<{ website: string }>('SELECT website FROM companies WHERE id = ? AND user_id = ?', [companyId, userId])?.website ?? '';
}

export function insertJob(
  db: Database,
  userId: string,
  j: { title: string; companyName: string; location: string; source: string; sourceUrl: string; ats: string; rawText: string; salaryText: string; importedQuestions: ImportedQuestion[]; companyWebsite: string },
): string {
  const id = newId('job');
  const companyId = j.companyName ? upsertCompany(db, userId, j.companyName, j.companyWebsite) : null;
  db.run(
    `INSERT INTO jobs (id, user_id, company_id, title, company_name, location, salary_text, source, source_url, ats, raw_text, imported_questions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, companyId, j.title, j.companyName, j.location, j.salaryText, j.source, j.sourceUrl, j.ats, j.rawText, JSON.stringify(j.importedQuestions), nowIso(), nowIso()],
  );
  return id;
}

export function getJob(db: Database, userId: string, id: string): JobDTO | null {
  const r = db.one<R>('SELECT * FROM jobs WHERE id = ? AND user_id = ?', [id, userId]);
  return r ? toJob(r) : null;
}

export function saveJobIntelligence(db: Database, userId: string, jobId: string, intel: JobIntelligence, companyWebsite: string): void {
  const job = getJob(db, userId, jobId);
  if (!job) return;
  const companyName = job.companyName || intel.company;
  const companyId = companyName ? upsertCompany(db, userId, companyName, companyWebsite || intel.companyWebsite) : job.companyId;
  db.run(
    `UPDATE jobs SET intelligence = ?, title = ?, company_name = ?, company_id = ?, location = ?, work_model = ?, salary_text = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [
      JSON.stringify(intel),
      job.title || intel.title,
      companyName,
      companyId,
      job.location || intel.location,
      intel.workModel,
      job.salaryText || intel.salary.text,
      nowIso(),
      jobId,
      userId,
    ],
  );
}

/* Applications ------------------------------------------------------------------------------------------ */

export function insertApplication(db: Database, userId: string, jobId: string, researchDepth: string): string {
  const id = newId('app');
  db.run(`INSERT INTO applications (id, user_id, job_id, stage, research_depth, created_at, updated_at) VALUES (?, ?, ?, 'researching', ?, ?, ?)`, [
    id,
    userId,
    jobId,
    researchDepth,
    nowIso(),
    nowIso(),
  ]);
  return id;
}

export function getApplication(db: Database, userId: string, id: string): ApplicationDTO | null {
  const r = db.one<R>('SELECT * FROM applications WHERE id = ? AND user_id = ?', [id, userId]);
  return r ? toApplication(r) : null;
}

export function updateApplication(db: Database, userId: string, id: string, patch: Partial<Record<string, unknown>>): void {
  const cols: Record<string, string> = {
    stage: 'stage',
    tier: 'tier',
    researchDepth: 'research_depth',
    dateApplied: 'date_applied',
    outcome: 'outcome',
    nextAction: 'next_action',
    nextActionDate: 'next_action_date',
    finalResumeId: 'final_resume_id',
    finalCoverLetterId: 'final_cover_letter_id',
    submittedSnapshot: 'submitted_snapshot',
    archived: 'archived',
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in cols) || v === undefined) continue;
    sets.push(`${cols[k]} = ?`);
    vals.push(v);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(nowIso(), id, userId);
  db.run(`UPDATE applications SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, vals as any);
}

/* Artifacts (versioned, never overwritten) ----------------------------------------------------------------- */

export function latestArtifact<T>(db: Database, userId: string, applicationId: string, kind: ArtifactKind, refId = ''): ArtifactDTO<T> | null {
  const r = db.one<R>(
    `SELECT * FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = ? AND ref_id = ? AND status != 'failed' ORDER BY version DESC LIMIT 1`,
    [userId, applicationId, kind, refId],
  );
  return r ? toArtifact<T>(r) : null;
}

export function getArtifact<T>(db: Database, userId: string, id: string): ArtifactDTO<T> | null {
  const r = db.one<R>('SELECT * FROM artifacts WHERE id = ? AND user_id = ?', [id, userId]);
  return r ? toArtifact<T>(r) : null;
}

export function listVersions(db: Database, userId: string, applicationId: string, kind: ArtifactKind, refId = ''): ArtifactDTO[] {
  return db
    .all<R>(`SELECT * FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = ? AND ref_id = ? ORDER BY version DESC`, [userId, applicationId, kind, refId])
    .map((r) => toArtifact(r));
}

export function createArtifact<T>(
  db: Database,
  userId: string,
  a: { applicationId: string; kind: ArtifactKind; refId?: string; content: T; meta?: Record<string, unknown>; changeSummary?: string; createdBy?: 'ai' | 'user' },
): ArtifactDTO<T> {
  return db.tx(() => {
    const refId = a.refId ?? '';
    const prev = db.one<{ id: string; version: number }>(
      `SELECT id, version FROM artifacts WHERE user_id = ? AND application_id = ? AND kind = ? AND ref_id = ? ORDER BY version DESC LIMIT 1`,
      [userId, a.applicationId, a.kind, refId],
    );
    const id = newId('art');
    db.run(
      `INSERT INTO artifacts (id, user_id, application_id, kind, ref_id, version, status, content, meta, parent_id, change_summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [id, userId, a.applicationId, a.kind, refId, (prev?.version ?? 0) + 1, JSON.stringify(a.content), JSON.stringify(a.meta ?? {}), prev?.id ?? null, a.changeSummary ?? '', a.createdBy ?? 'ai', nowIso()],
    );
    db.run('UPDATE applications SET updated_at = ? WHERE id = ?', [nowIso(), a.applicationId]);
    return getArtifact<T>(db, userId, id)!;
  });
}

export function approveArtifact(db: Database, userId: string, id: string): void {
  db.tx(() => {
    const a = getArtifact(db, userId, id);
    if (!a) return;
    db.run(`UPDATE artifacts SET status = 'superseded' WHERE user_id = ? AND application_id = ? AND kind = ? AND ref_id = ? AND status = 'approved'`, [
      userId,
      a.applicationId,
      a.kind,
      a.refId,
    ]);
    db.run(`UPDATE artifacts SET status = 'approved', approved_at = ? WHERE id = ?`, [nowIso(), id]);
  });
}

export function updateArtifactMeta(db: Database, userId: string, id: string, meta: Record<string, unknown>): void {
  db.run('UPDATE artifacts SET meta = ? WHERE id = ? AND user_id = ?', [JSON.stringify(meta), id, userId]);
}

/** Review decisions are metadata about a review, so they are updated in place. */
export function updateArtifactContent(db: Database, userId: string, id: string, content: unknown): void {
  db.run('UPDATE artifacts SET content = ? WHERE id = ? AND user_id = ?', [JSON.stringify(content), id, userId]);
}

/* Application questions ------------------------------------------------------------------------------------- */

export function listAppQuestions(db: Database, userId: string, applicationId: string): QuestionRowDTO[] {
  return db
    .all<R>('SELECT * FROM application_questions WHERE user_id = ? AND application_id = ? ORDER BY sort_order, created_at', [userId, applicationId])
    .map((r) => ({
      id: r.id,
      question: r.question,
      limitType: r.limit_type,
      limitValue: r.limit_value === null ? null : Number(r.limit_value),
      required: !!r.required,
      sensitive: !!r.sensitive,
      sortOrder: Number(r.sort_order),
    }));
}

export function insertAppQuestion(
  db: Database,
  userId: string,
  applicationId: string,
  q: { question: string; limitType: string; limitValue: number | null; required: boolean; sensitive: boolean },
): string {
  const id = newId('apq');
  const max = db.one<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM application_questions WHERE application_id = ?', [applicationId])?.m ?? 0;
  db.run(
    `INSERT INTO application_questions (id, user_id, application_id, question, limit_type, limit_value, required, sensitive, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, applicationId, q.question, q.limitType, q.limitValue, q.required, q.sensitive, Number(max) + 1, nowIso()],
  );
  return id;
}

/* Timeline, contacts, notes ------------------------------------------------------------------------------------ */

export function addEvent(db: Database, userId: string, applicationId: string, e: { type: string; title: string; detail?: Record<string, unknown>; occurredAt?: string }): string {
  const id = newId('evt');
  db.run(`INSERT INTO application_events (id, user_id, application_id, type, title, detail, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    userId,
    applicationId,
    e.type,
    e.title,
    JSON.stringify(e.detail ?? {}),
    e.occurredAt ?? nowIso(),
    nowIso(),
  ]);
  return id;
}

export function listEvents(db: Database, userId: string, applicationId: string): EventDTO[] {
  return db
    .all<R>('SELECT * FROM application_events WHERE user_id = ? AND application_id = ? ORDER BY occurred_at DESC, created_at DESC', [userId, applicationId])
    .map((r) => ({ id: r.id, type: r.type, title: r.title, detail: parseJson(r.detail, {}), occurredAt: r.occurred_at }));
}

export function listContacts(db: Database, userId: string, applicationId: string): ContactDTO[] {
  return db.all<R>('SELECT * FROM contacts WHERE user_id = ? AND application_id = ? ORDER BY created_at', [userId, applicationId]).map((r) => ({
    id: r.id,
    applicationId: r.application_id,
    name: r.name,
    role: r.role,
    title: r.title,
    email: r.email,
    linkedinUrl: r.linkedin_url,
    notes: r.notes,
    lastContactedAt: r.last_contacted_at,
  }));
}

export function listNotes(db: Database, userId: string, applicationId: string): NoteDTO[] {
  return db
    .all<R>('SELECT * FROM notes WHERE user_id = ? AND application_id = ? ORDER BY created_at DESC', [userId, applicationId])
    .map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at }));
}
