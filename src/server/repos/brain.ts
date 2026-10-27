import type { Database } from '../db/database';
import { parseJson } from '../db/database';
import { newId, nowIso } from '../lib/ids';
import type {
  CareerBrainDTO,
  DocumentDTO,
  EducationDTO,
  EvidenceDTO,
  EvidenceSource,
  ExperienceDTO,
  MetricDTO,
  ProfileDTO,
  ProjectDTO,
  QuestionDTO,
  ResumeSourceDTO,
  ResumeStructure,
  SkillDTO,
  SubjectType,
} from '../../shared/schemas/brain';
import type { DocumentKind, EvidenceKind, ExperienceKind, Provenance, SkillCategory, Theme } from '../../shared/constants';
import { USABLE_PROVENANCE } from '../../shared/constants';
import { normalizeName } from '../../shared/text';

type R = Record<string, any>;

/** Provenance from sources: any verified document quote → verified; any applicant source → applicant_provided; else inferred. */
export function provenanceFromSources(sources: EvidenceSource[], fallback: Provenance = 'inferred'): Provenance {
  if (sources.some((s) => s.type === 'document' && s.verified)) return 'verified';
  if (sources.some((s) => s.type === 'answer' || s.type === 'manual' || s.type === 'confirmation')) return 'applicant_provided';
  return fallback;
}

/* Mappers ------------------------------------------------------------------------------------------------- */

const toExperience = (r: R): ExperienceDTO => ({
  id: r.id,
  kind: r.kind as ExperienceKind,
  organization: r.organization,
  title: r.title,
  location: r.location,
  startDate: r.start_date,
  endDate: r.end_date,
  isCurrent: !!r.is_current,
  employmentType: r.employment_type,
  summary: r.summary,
  provenance: r.provenance,
  sources: parseJson(r.sources, []),
  sortOrder: Number(r.sort_order),
  hidden: !!r.hidden,
});

const toEducation = (r: R): EducationDTO => ({
  id: r.id,
  institution: r.institution,
  degree: r.degree,
  field: r.field,
  minor: r.minor,
  location: r.location,
  startDate: r.start_date,
  endDate: r.end_date,
  grade: r.grade,
  coursework: parseJson(r.coursework, []),
  honors: parseJson(r.honors, []),
  provenance: r.provenance,
  sources: parseJson(r.sources, []),
  sortOrder: Number(r.sort_order),
  hidden: !!r.hidden,
});

const toProject = (r: R): ProjectDTO => ({
  id: r.id,
  name: r.name,
  context: r.context,
  role: r.role,
  startDate: r.start_date,
  endDate: r.end_date,
  url: r.url,
  summary: r.summary,
  technologies: parseJson(r.technologies, []),
  provenance: r.provenance,
  sources: parseJson(r.sources, []),
  sortOrder: Number(r.sort_order),
  hidden: !!r.hidden,
});

export const toEvidence = (r: R): EvidenceDTO => ({
  id: r.id,
  statement: r.statement,
  kind: r.kind as EvidenceKind,
  subjectType: r.subject_type as SubjectType,
  subjectId: r.subject_id ?? null,
  metrics: parseJson<MetricDTO[]>(r.metrics, []),
  skills: parseJson<string[]>(r.skills, []),
  themes: parseJson<Theme[]>(r.themes, []),
  provenance: r.provenance,
  sources: parseJson(r.sources, []),
  userConfirmed: !!r.user_confirmed,
  hidden: !!r.hidden,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toSkill = (r: R): SkillDTO => ({
  id: r.id,
  name: r.name,
  category: r.category as SkillCategory,
  provenance: r.provenance,
  evidenceIds: parseJson(r.evidence_ids, []),
  hidden: !!r.hidden,
});

export const toDocument = (r: R): DocumentDTO => ({
  id: r.id,
  kind: r.kind as DocumentKind,
  label: r.label,
  filename: r.filename,
  mime: r.mime,
  size: Number(r.size),
  status: r.status,
  textMethod: r.text_method,
  textLength: r.text_content ? String(r.text_content).length : 0,
  error: r.error,
  includedInBrain: !!r.included_in_brain,
  createdAt: r.created_at,
});

export const toQuestion = (r: R): QuestionDTO => ({
  id: r.id,
  question: r.question,
  rationale: r.rationale,
  category: r.category,
  priority: Number(r.priority),
  targetType: r.target_type,
  targetId: r.target_id,
  answerType: r.answer_type,
  choices: parseJson(r.choices, []),
  status: r.status,
  answer: r.answer,
  createdAt: r.created_at,
  answeredAt: r.answered_at,
});

/* Reads ------------------------------------------------------------------------------------------------------ */

export function getProfile(db: Database, userId: string): ProfileDTO {
  const r = db.one<R>('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  return {
    fullName: r?.full_name ?? '',
    email: r?.email ?? '',
    phone: r?.phone ?? '',
    location: r?.location ?? '',
    headline: r?.headline ?? '',
    links: parseJson(r?.links, []),
    updatedAt: r?.updated_at ?? '',
  };
}

export function listExperiences(db: Database, userId: string): ExperienceDTO[] {
  return db
    .all<R>(`SELECT * FROM experiences WHERE user_id = ? ORDER BY is_current DESC, COALESCE(NULLIF(end_date,''), '9999') DESC, start_date DESC, sort_order`, [userId])
    .map(toExperience);
}
export function listEducation(db: Database, userId: string): EducationDTO[] {
  return db.all<R>(`SELECT * FROM education WHERE user_id = ? ORDER BY COALESCE(NULLIF(end_date,''), '9999') DESC, sort_order`, [userId]).map(toEducation);
}
export function listProjects(db: Database, userId: string): ProjectDTO[] {
  return db.all<R>(`SELECT * FROM projects WHERE user_id = ? ORDER BY COALESCE(NULLIF(end_date,''), '9999') DESC, sort_order`, [userId]).map(toProject);
}
export function listEvidence(db: Database, userId: string): EvidenceDTO[] {
  return db.all<R>(`SELECT * FROM evidence WHERE user_id = ? ORDER BY created_at`, [userId]).map(toEvidence);
}
export function listSkills(db: Database, userId: string): SkillDTO[] {
  return db.all<R>(`SELECT * FROM skills WHERE user_id = ? ORDER BY category, name`, [userId]).map(toSkill);
}
export function listResumeSources(db: Database, userId: string): ResumeSourceDTO[] {
  return db.all<R>(`SELECT * FROM resume_sources WHERE user_id = ? ORDER BY created_at`, [userId]).map((r) => ({
    id: r.id,
    documentId: r.document_id,
    label: r.label,
    focus: r.focus,
    structure: parseJson<ResumeStructure>(r.structure, { sections: [] }),
  }));
}
export function listDocuments(db: Database, userId: string): DocumentDTO[] {
  return db.all<R>(`SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC`, [userId]).map(toDocument);
}
export function getDocumentRow(db: Database, userId: string, id: string): R | undefined {
  return db.one<R>('SELECT * FROM documents WHERE id = ? AND user_id = ?', [id, userId]);
}
export function listQuestions(db: Database, userId: string, statuses: string[] = ['open']): QuestionDTO[] {
  const placeholders = statuses.map(() => '?').join(',');
  return db
    .all<R>(`SELECT * FROM discovery_questions WHERE user_id = ? AND status IN (${placeholders}) ORDER BY priority DESC, created_at`, [userId, ...statuses])
    .map(toQuestion);
}

export function getBrain(db: Database, userId: string): CareerBrainDTO {
  const evidence = listEvidence(db, userId);
  const visible = evidence.filter((e) => !e.hidden);
  return {
    profile: getProfile(db, userId),
    experiences: listExperiences(db, userId),
    education: listEducation(db, userId),
    projects: listProjects(db, userId),
    evidence,
    skills: listSkills(db, userId),
    resumeSources: listResumeSources(db, userId),
    stats: {
      evidence: visible.length,
      verified: visible.filter((e) => e.provenance === 'verified').length,
      applicantProvided: visible.filter((e) => e.provenance === 'applicant_provided').length,
      inferred: visible.filter((e) => e.provenance === 'inferred').length,
      withMetrics: visible.filter((e) => e.metrics.length > 0 && USABLE_PROVENANCE.includes(e.provenance)).length,
    },
  };
}

/* Writes ------------------------------------------------------------------------------------------------------- */

export function upsertProfile(db: Database, userId: string, p: Omit<ProfileDTO, 'updatedAt'>, sources?: EvidenceSource[]): void {
  db.run(
    `INSERT INTO profiles (user_id, full_name, email, phone, location, headline, links, sources, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, location = excluded.location,
       headline = excluded.headline, links = excluded.links, sources = COALESCE(excluded.sources, profiles.sources), updated_at = excluded.updated_at`,
    [userId, p.fullName, p.email, p.phone, p.location, p.headline, JSON.stringify(p.links), JSON.stringify(sources ?? []), nowIso()],
  );
}

export function insertExperience(db: Database, userId: string, e: Omit<ExperienceDTO, 'id' | 'sortOrder' | 'hidden'> & { sortOrder?: number }): string {
  const id = newId('exp');
  const now = nowIso();
  db.run(
    `INSERT INTO experiences (id, user_id, kind, organization, title, location, start_date, end_date, is_current, employment_type, summary, provenance, sources, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, e.kind, e.organization, e.title, e.location, e.startDate, e.endDate, e.isCurrent, e.employmentType, e.summary, e.provenance, JSON.stringify(e.sources), e.sortOrder ?? 0, now, now],
  );
  return id;
}

export function insertEducation(db: Database, userId: string, e: Omit<EducationDTO, 'id' | 'sortOrder' | 'hidden'>): string {
  const id = newId('edu');
  const now = nowIso();
  db.run(
    `INSERT INTO education (id, user_id, institution, degree, field, minor, location, start_date, end_date, grade, coursework, honors, provenance, sources, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      e.institution,
      e.degree,
      e.field,
      e.minor,
      e.location,
      e.startDate,
      e.endDate,
      e.grade,
      JSON.stringify(e.coursework),
      JSON.stringify(e.honors),
      e.provenance,
      JSON.stringify(e.sources),
      now,
      now,
    ],
  );
  return id;
}

export function insertProject(db: Database, userId: string, p: Omit<ProjectDTO, 'id' | 'sortOrder' | 'hidden'>): string {
  const id = newId('prj');
  const now = nowIso();
  db.run(
    `INSERT INTO projects (id, user_id, name, context, role, start_date, end_date, url, summary, technologies, provenance, sources, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, p.name, p.context, p.role, p.startDate, p.endDate, p.url, p.summary, JSON.stringify(p.technologies), p.provenance, JSON.stringify(p.sources), now, now],
  );
  return id;
}

export function insertEvidence(
  db: Database,
  userId: string,
  e: Pick<EvidenceDTO, 'statement' | 'kind' | 'subjectType' | 'subjectId' | 'metrics' | 'skills' | 'themes' | 'provenance' | 'sources'> & { userConfirmed?: boolean },
): string {
  const id = newId('evd');
  const now = nowIso();
  db.run(
    `INSERT INTO evidence (id, user_id, statement, kind, subject_type, subject_id, metrics, skills, themes, provenance, sources, user_confirmed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      e.statement,
      e.kind,
      e.subjectType,
      e.subjectId,
      JSON.stringify(e.metrics),
      JSON.stringify(e.skills),
      JSON.stringify(e.themes),
      e.provenance,
      JSON.stringify(e.sources),
      e.userConfirmed ?? false,
      now,
      now,
    ],
  );
  return id;
}

export function getEvidence(db: Database, userId: string, id: string): EvidenceDTO | null {
  const r = db.one<R>('SELECT * FROM evidence WHERE id = ? AND user_id = ?', [id, userId]);
  return r ? toEvidence(r) : null;
}

export function updateEvidence(db: Database, userId: string, id: string, patch: Partial<Omit<EvidenceDTO, 'id' | 'createdAt' | 'updatedAt'>>): void {
  const current = getEvidence(db, userId, id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.run(
    `UPDATE evidence SET statement = ?, kind = ?, subject_type = ?, subject_id = ?, metrics = ?, skills = ?, themes = ?, provenance = ?, sources = ?, user_confirmed = ?, hidden = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      next.statement,
      next.kind,
      next.subjectType,
      next.subjectId,
      JSON.stringify(next.metrics),
      JSON.stringify(next.skills),
      JSON.stringify(next.themes),
      next.provenance,
      JSON.stringify(next.sources),
      next.userConfirmed,
      next.hidden,
      nowIso(),
      id,
      userId,
    ],
  );
}

/** Insert or merge a skill by normalized name; links evidence ids and upgrades provenance when better support arrives. */
export function upsertSkill(db: Database, userId: string, s: { name: string; category: SkillCategory; provenance: Provenance; evidenceIds?: string[]; sources?: EvidenceSource[] }): string {
  const norm = normalizeName(s.name);
  if (!norm) return '';
  const existing = db.one<R>('SELECT * FROM skills WHERE user_id = ? AND name_normalized = ?', [userId, norm]);
  const rank: Record<Provenance, number> = { verified: 3, applicant_provided: 2, inferred: 1, unsupported: 0 };
  if (existing) {
    const ev = new Set<string>([...parseJson<string[]>(existing.evidence_ids, []), ...(s.evidenceIds ?? [])]);
    const sources = [...parseJson<EvidenceSource[]>(existing.sources, []), ...(s.sources ?? [])].slice(0, 20);
    const prov = rank[s.provenance] > rank[existing.provenance as Provenance] && existing.provenance !== 'unsupported' ? s.provenance : existing.provenance;
    db.run('UPDATE skills SET evidence_ids = ?, sources = ?, provenance = ?, updated_at = ? WHERE id = ?', [JSON.stringify([...ev]), JSON.stringify(sources), prov, nowIso(), existing.id]);
    return existing.id;
  }
  const id = newId('skl');
  const now = nowIso();
  db.run(
    `INSERT INTO skills (id, user_id, name, name_normalized, category, provenance, evidence_ids, sources, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, s.name.trim(), norm, s.category, s.provenance, JSON.stringify(s.evidenceIds ?? []), JSON.stringify(s.sources ?? []), now, now],
  );
  return id;
}

export function insertQuestion(
  db: Database,
  userId: string,
  q: { question: string; rationale: string; category: string; priority: number; targetType: string; targetId: string | null; answerType: string; choices: string[] },
): string {
  const id = newId('qst');
  db.run(
    `INSERT INTO discovery_questions (id, user_id, question, rationale, category, priority, target_type, target_id, answer_type, choices, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [id, userId, q.question, q.rationale, q.category, Math.max(1, Math.min(100, Math.round(q.priority))), q.targetType, q.targetId, q.answerType, JSON.stringify(q.choices), nowIso()],
  );
  return id;
}

/** Look up which table an id belongs to (scoped to the user). */
export function subjectTypeOf(db: Database, userId: string, id: string | null): SubjectType | null {
  if (!id) return null;
  if (id.startsWith('exp_') && db.one('SELECT 1 FROM experiences WHERE id = ? AND user_id = ?', [id, userId])) return 'experience';
  if (id.startsWith('edu_') && db.one('SELECT 1 FROM education WHERE id = ? AND user_id = ?', [id, userId])) return 'education';
  if (id.startsWith('prj_') && db.one('SELECT 1 FROM projects WHERE id = ? AND user_id = ?', [id, userId])) return 'project';
  return null;
}
