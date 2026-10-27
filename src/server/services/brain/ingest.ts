import type { App } from '../../app';
import { parseJson } from '../../db/database';
import { nowIso } from '../../lib/ids';
import { INTEGRITY_CHARTER, UNTRUSTED_NOTE, asData } from '../../ai/prompts';
import { ExtractionSchema, MergePlanSchema, type EvidenceSource, type Extraction, type MergePlan, type SubjectType } from '../../../shared/schemas/brain';
import type { SkillCategory } from '../../../shared/constants';
import { isPresent, normalizeDate, orgSimilarity, unsupportedNumbers, verifyQuote } from '../../../shared/text';
import * as brainRepo from '../../repos/brain';
import { ensureDocumentText } from '../documents/service';
import { audit } from '../../security/audit';

/* ------------------------------------------------------------------------------------------------
 * 1. Per-document extraction (with server-side quote verification)
 * ---------------------------------------------------------------------------------------------- */

const EXTRACTION_SYSTEM = `${INTEGRITY_CHARTER}

Task: extract structured career information from ONE document belonging to the applicant.

How to extract:
- Experiences: every job, internship, part-time role, volunteer or leadership position. If one organization lists several positions, create one experience per position.
- Evidence: one item per distinct accomplishment, responsibility, award, presentation or leadership fact. Usually one per bullet point; split a bullet that contains two unrelated facts. Include facts from summaries/profile sections only if they are concrete (not self-descriptions like "hard-working").
- "statement" restates the fact cleanly in the third person without the subject ("Built Tableau dashboards used by regional managers"). Do not add adjectives, outcomes, numbers, tools or context that are not in the quote.
- "quote" is copied character-for-character from the document. It is checked automatically; a paraphrased quote marks the item as unverified.
- Metrics: capture every number that measures scale or impact, exactly as written.
- Skills: list named tools, technologies, languages, methods and clearly stated skills. Do not infer skills that are not written.
- Dates: YYYY-MM when a month is given, YYYY when only a year is given, empty when not stated. isCurrent is true only for Present/Current.
- Leave fields empty rather than guessing. Note ambiguities in "notes".
${UNTRUSTED_NOTE}`;

export interface DocExtraction {
  documentId: string;
  label: string;
  filename: string;
  text: string;
  extraction: Extraction;
  verification: { checked: number; verified: number };
}

function stripBullet(s: string): string {
  return s.replace(/^[\s•●▪◦‣⁃·*-]+/, '').trim();
}

export async function extractDocument(app: App, userId: string, documentId: string, opts: { taskId?: string; signal?: AbortSignal }): Promise<DocExtraction> {
  const text = await ensureDocumentText(app, userId, documentId, opts);
  const row = brainRepo.getDocumentRow(app.db, userId, documentId)!;
  app.db.run(`UPDATE documents SET status = 'analyzing', updated_at = ? WHERE id = ?`, [nowIso(), documentId]);
  try {
    const extraction = await app.ai.structured({
      userId,
      taskId: opts.taskId,
      task: 'extract',
      purpose: `Extract: ${row.filename}`,
      system: EXTRACTION_SYSTEM,
      prompt: `Document label: ${row.label}\nFile name: ${row.filename}\nType selected by the applicant: ${row.kind}\n\n${asData('document', text.slice(0, 120_000))}`,
      schema: ExtractionSchema,
      schemaName: 'career_extraction',
      signal: opts.signal,
    });
    let checked = 0;
    let verified = 0;
    const check = (q: string) => {
      checked++;
      const ok = verifyQuote(q, text).verified;
      if (ok) verified++;
      return ok;
    };
    // Annotate verification results in place (stored for transparency) and repair embellished statements.
    for (const x of extraction.experiences) (x as any).verified = check(x.quote);
    for (const d of extraction.education) (d as any).verified = check(d.quote);
    for (const p of extraction.projects) (p as any).verified = check(p.quote);
    for (const s of extraction.skills) (s as any).verified = s.quote ? verifyQuote(s.quote, text).verified : false;
    for (const e of extraction.evidence) {
      const ok = check(e.quote);
      (e as any).verified = ok;
      if (ok && unsupportedNumbers(e.statement, [e.quote]).length) {
        // The model added a number that is not in the source; fall back to the quote itself.
        e.statement = stripBullet(e.quote);
      }
      e.metrics = e.metrics.filter((m) => unsupportedNumbers(m.value, [e.quote]).length === 0);
    }
    app.db.run(`UPDATE documents SET extraction = ?, status = 'analyzed', updated_at = ? WHERE id = ?`, [JSON.stringify(extraction), nowIso(), documentId]);
    return { documentId, label: row.label, filename: row.filename, text, extraction, verification: { checked, verified } };
  } catch (err) {
    app.db.run(`UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, [String((err as Error).message).slice(0, 500), nowIso(), documentId]);
    throw err;
  }
}

/* ------------------------------------------------------------------------------------------------
 * 2. Consolidation: several representations of the same applicant → one Career Brain
 * ---------------------------------------------------------------------------------------------- */

const MERGE_SYSTEM = `${INTEGRITY_CHARTER}

Task: several documents describe the SAME applicant (for example different versions of their resume). Decide which extracted items refer to the same real-world thing so the Career Brain stores each role, degree, project and accomplishment once, with every document that supports it.

Rules:
- Cluster experiences by real-world role: same organization (allowing name variants such as "Fizzwell" vs "Fizzwell Beverages") and overlapping or compatible dates. Different positions at the same organization are different experiences.
- Cluster evidence items that state the same accomplishment, even if worded differently. Do not cluster items that merely share a theme.
- If a new item matches something already in the Career Brain, set existingId to that id.
- preferredRef: the ref with the most accurate and complete details.
- mergedStatement: only when two versions each add a real detail; combine them using ONLY facts present in their statements/quotes. Otherwise leave empty.
- Report genuine conflicts (different dates, titles, numbers for the same thing) as conflicts with a clear question for the applicant. Formatting differences are not conflicts.
- Every new ref should appear in exactly one cluster (a single-ref cluster is fine).
${UNTRUSTED_NOTE}`;

interface NewRef {
  ref: string;
  docIndex: number;
  type: 'X' | 'D' | 'P' | 'E';
  data: any;
}

function collectRefs(docs: DocExtraction[]): NewRef[] {
  const out: NewRef[] = [];
  docs.forEach((d, i) => {
    const di = `D${i + 1}`;
    for (const x of d.extraction.experiences) out.push({ ref: `${di}.${x.ref}`, docIndex: i, type: 'X', data: x });
    for (const e of d.extraction.education) out.push({ ref: `${di}.${e.ref}`, docIndex: i, type: 'D', data: e });
    for (const p of d.extraction.projects) out.push({ ref: `${di}.${p.ref}`, docIndex: i, type: 'P', data: p });
    d.extraction.evidence.forEach((e, k) => out.push({ ref: `${di}.E${k + 1}`, docIndex: i, type: 'E', data: e }));
  });
  return out;
}

function describeNew(docs: DocExtraction[]): string {
  const lines: string[] = [];
  docs.forEach((d, i) => {
    const di = `D${i + 1}`;
    lines.push(`### ${di}: "${d.label}" (${d.filename})`);
    for (const x of d.extraction.experiences)
      lines.push(`[${di}.${x.ref}] experience: ${x.title} | ${x.organization} | ${x.location || '-'} | ${x.startDate || '?'} to ${x.isCurrent ? 'present' : x.endDate || '?'}`);
    for (const e of d.extraction.education) lines.push(`[${di}.${e.ref}] education: ${[e.degree, e.field].filter(Boolean).join(', ')} | ${e.institution} | ${e.startDate || '?'} to ${e.endDate || '?'}`);
    for (const p of d.extraction.projects) lines.push(`[${di}.${p.ref}] project: ${p.name}${p.context ? ` (${p.context})` : ''}`);
    d.extraction.evidence.forEach((e, k) => lines.push(`[${di}.E${k + 1}] evidence${e.subjectRef ? ` (about ${di}.${e.subjectRef})` : ''}: ${e.statement}`));
    lines.push('');
  });
  return lines.join('\n');
}

function describeExisting(app: App, userId: string): { text: string; empty: boolean } {
  const brain = brainRepo.getBrain(app.db, userId);
  const lines: string[] = [];
  for (const x of brain.experiences) lines.push(`[${x.id}] experience: ${x.title} | ${x.organization} | ${x.startDate || '?'} to ${x.isCurrent ? 'present' : x.endDate || '?'}`);
  for (const d of brain.education) lines.push(`[${d.id}] education: ${[d.degree, d.field].filter(Boolean).join(', ')} | ${d.institution}`);
  for (const p of brain.projects) lines.push(`[${p.id}] project: ${p.name}`);
  for (const e of brain.evidence) if (!e.hidden) lines.push(`[${e.id}] evidence${e.subjectId ? ` (about ${e.subjectId})` : ''}: ${e.statement}`);
  return { text: lines.join('\n'), empty: lines.length === 0 };
}

/** Deterministic fallback/validation: make sure every new ref lands in exactly one cluster. */
function normalizePlan(plan: MergePlan, refs: NewRef[], existingIds: Set<string>): MergePlan {
  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const seen = new Set<string>();
  const fix = <C extends { refs: string[]; existingId: string; preferredRef: string }>(clusters: C[], type: NewRef['type'], idPrefix: string): C[] => {
    const out: C[] = [];
    for (const c of clusters) {
      const valid = c.refs.filter((r) => byRef.get(r)?.type === type && !seen.has(r));
      valid.forEach((r) => seen.add(r));
      const existingId = existingIds.has(c.existingId) && c.existingId.startsWith(idPrefix) ? c.existingId : '';
      if (!valid.length) continue;
      out.push({ ...c, refs: valid, existingId, preferredRef: valid.includes(c.preferredRef) ? c.preferredRef : valid[0] });
    }
    for (const r of refs) {
      if (r.type === type && !seen.has(r.ref)) {
        seen.add(r.ref);
        out.push({ refs: [r.ref], existingId: '', preferredRef: r.ref, mergedStatement: '' } as unknown as C);
      }
    }
    return out;
  };
  return {
    experienceClusters: fix(plan.experienceClusters, 'X', 'exp_'),
    educationClusters: fix(plan.educationClusters, 'D', 'edu_'),
    projectClusters: fix(plan.projectClusters, 'P', 'prj_'),
    evidenceClusters: fix(plan.evidenceClusters, 'E', 'evd_'),
    conflicts: plan.conflicts,
  };
}

/** Without AI (single document into an empty brain) — or as a safety net — cluster obvious duplicates deterministically. */
function heuristicPlan(refs: NewRef[]): MergePlan {
  const experienceClusters: MergePlan['experienceClusters'] = [];
  for (const r of refs.filter((x) => x.type === 'X')) {
    const match = experienceClusters.find((c) => {
      const first = refs.find((x) => x.ref === c.refs[0])!.data;
      return orgSimilarity(first.organization, r.data.organization) >= 1 && first.title.toLowerCase() === r.data.title.toLowerCase();
    });
    if (match) match.refs.push(r.ref);
    else experienceClusters.push({ refs: [r.ref], existingId: '', preferredRef: r.ref });
  }
  return { experienceClusters, educationClusters: [], projectClusters: [], evidenceClusters: [], conflicts: [] };
}

export async function planMerge(app: App, userId: string, docs: DocExtraction[], opts: { taskId?: string; signal?: AbortSignal }): Promise<MergePlan> {
  const refs = collectRefs(docs);
  const existing = describeExisting(app, userId);
  const existingIds = new Set<string>([
    ...app.db.all<{ id: string }>('SELECT id FROM experiences WHERE user_id = ?', [userId]).map((r) => r.id),
    ...app.db.all<{ id: string }>('SELECT id FROM education WHERE user_id = ?', [userId]).map((r) => r.id),
    ...app.db.all<{ id: string }>('SELECT id FROM projects WHERE user_id = ?', [userId]).map((r) => r.id),
    ...app.db.all<{ id: string }>('SELECT id FROM evidence WHERE user_id = ?', [userId]).map((r) => r.id),
  ]);
  if (existing.empty && docs.length === 1) return normalizePlan(heuristicPlan(refs), refs, existingIds);
  const plan = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'consolidate',
    purpose: `Consolidate ${docs.length} document(s) into the Career Brain`,
    system: MERGE_SYSTEM,
    prompt: `## Already in the Career Brain\n${existing.empty ? '(empty)' : existing.text}\n\n## Newly extracted items\n${describeNew(docs)}`,
    schema: MergePlanSchema,
    schemaName: 'merge_plan',
    signal: opts.signal,
  });
  return normalizePlan(plan, refs, existingIds);
}

/* ------------------------------------------------------------------------------------------------
 * 3. Apply the plan (deterministic, transactional, non-destructive)
 * ---------------------------------------------------------------------------------------------- */

function docSource(d: DocExtraction, item: { quote: string; verified?: boolean }): EvidenceSource {
  return { type: 'document', documentId: d.documentId, quote: item.quote.slice(0, 600), verified: !!item.verified };
}

function mergeSources(a: EvidenceSource[], b: EvidenceSource[]): EvidenceSource[] {
  const key = (s: EvidenceSource) => (s.type === 'document' ? `d:${s.documentId}:${s.quote}` : s.type === 'answer' ? `a:${s.questionId}` : `${s.type}`);
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((s) => !seen.has(key(s)))];
}

function guessCategory(name: string, known: Map<string, SkillCategory>): SkillCategory {
  const k = known.get(name.toLowerCase());
  if (k) return k;
  if (/^(english|irish|french|spanish|german|italian|mandarin|portuguese|arabic|hindi|japanese|korean)$/i.test(name)) return 'language';
  if (/(sales|negotiat|prospect|closing|upsell|cold call)/i.test(name)) return 'sales';
  if (/(stakeholder|presentation|public speaking|communication|writing)/i.test(name)) return 'communication';
  if (/(leadership|mentor|coaching|captain|team lead)/i.test(name)) return 'leadership';
  if (/(customer|client|account management|relationship)/i.test(name)) return 'customer';
  if (/(analysis|analytics|statistic|forecast|modelling|modeling|research)/i.test(name)) return 'analytical';
  return 'technical';
}

export interface ApplyResult {
  experiences: { created: number; merged: number };
  education: { created: number; merged: number };
  projects: { created: number; merged: number };
  evidence: { created: number; merged: number; verified: number };
  skills: number;
  conflicts: number;
}

export function applyPlan(app: App, userId: string, docs: DocExtraction[], plan: MergePlan): ApplyResult {
  const db = app.db;
  const refs = new Map(collectRefs(docs).map((r) => [r.ref, r]));
  const refToId = new Map<string, string>();
  const result: ApplyResult = {
    experiences: { created: 0, merged: 0 },
    education: { created: 0, merged: 0 },
    projects: { created: 0, merged: 0 },
    evidence: { created: 0, merged: 0, verified: 0 },
    skills: 0,
    conflicts: 0,
  };

  db.tx(() => {
    /* Experiences */
    for (const c of plan.experienceClusters) {
      const items = c.refs.map((r) => refs.get(r)!);
      const pref = (refs.get(c.preferredRef) ?? items[0]).data;
      const pick = (f: string) => pref[f] || items.map((i) => i.data[f]).find(Boolean) || '';
      const sources = items.map((i) => docSource(docs[i.docIndex], i.data));
      const isCurrent = !!pref.isCurrent || isPresent(pref.endDate);
      if (c.existingId) {
        const row = db.one<Record<string, any>>('SELECT * FROM experiences WHERE id = ? AND user_id = ?', [c.existingId, userId])!;
        const merged = mergeSources(parseJson(row.sources, []), sources);
        const userOwned = row.provenance === 'applicant_provided';
        db.run(
          `UPDATE experiences SET sources = ?, provenance = ?, location = ?, start_date = ?, end_date = ?, employment_type = ?, summary = ?, updated_at = ? WHERE id = ?`,
          [
            JSON.stringify(merged),
            userOwned ? row.provenance : brainRepo.provenanceFromSources(merged, row.provenance),
            row.location || (userOwned ? row.location : pick('location')),
            row.start_date || (userOwned ? row.start_date : normalizeDate(pick('startDate'))),
            row.end_date || row.is_current || userOwned ? row.end_date : normalizeDate(pick('endDate')),
            row.employment_type || pick('employmentType'),
            row.summary || pick('summary'),
            nowIso(),
            c.existingId,
          ],
        );
        c.refs.forEach((r) => refToId.set(r, c.existingId));
        result.experiences.merged++;
      } else {
        const id = brainRepo.insertExperience(db, userId, {
          kind: pref.kind,
          organization: pick('organization'),
          title: pick('title'),
          location: pick('location'),
          startDate: normalizeDate(pick('startDate')),
          endDate: isCurrent ? '' : normalizeDate(pick('endDate')),
          isCurrent,
          employmentType: pick('employmentType'),
          summary: pick('summary'),
          provenance: brainRepo.provenanceFromSources(sources),
          sources,
        });
        c.refs.forEach((r) => refToId.set(r, id));
        if (c.refs.length > 1) result.experiences.merged++;
        result.experiences.created++;
      }
    }

    /* Education */
    for (const c of plan.educationClusters) {
      const items = c.refs.map((r) => refs.get(r)!);
      const pref = (refs.get(c.preferredRef) ?? items[0]).data;
      const pick = (f: string) => pref[f] || items.map((i) => i.data[f]).find(Boolean) || '';
      const sources = items.map((i) => docSource(docs[i.docIndex], i.data));
      const coursework = [...new Set(items.flatMap((i) => i.data.coursework as string[]))];
      const honors = [...new Set(items.flatMap((i) => i.data.honors as string[]))];
      if (c.existingId) {
        const row = db.one<Record<string, any>>('SELECT * FROM education WHERE id = ? AND user_id = ?', [c.existingId, userId])!;
        const merged = mergeSources(parseJson(row.sources, []), sources);
        db.run(`UPDATE education SET sources = ?, provenance = ?, coursework = ?, honors = ?, grade = ?, updated_at = ? WHERE id = ?`, [
          JSON.stringify(merged),
          row.provenance === 'applicant_provided' ? row.provenance : brainRepo.provenanceFromSources(merged, row.provenance),
          JSON.stringify([...new Set([...parseJson<string[]>(row.coursework, []), ...coursework])]),
          JSON.stringify([...new Set([...parseJson<string[]>(row.honors, []), ...honors])]),
          row.grade || pick('grade'),
          nowIso(),
          c.existingId,
        ]);
        c.refs.forEach((r) => refToId.set(r, c.existingId));
        result.education.merged++;
      } else {
        const id = brainRepo.insertEducation(db, userId, {
          institution: pick('institution'),
          degree: pick('degree'),
          field: pick('field'),
          minor: pick('minor'),
          location: pick('location'),
          startDate: normalizeDate(pick('startDate')),
          endDate: normalizeDate(pick('endDate')),
          grade: pick('grade'),
          coursework,
          honors,
          provenance: brainRepo.provenanceFromSources(sources),
          sources,
        });
        c.refs.forEach((r) => refToId.set(r, id));
        result.education.created++;
      }
    }

    /* Projects */
    for (const c of plan.projectClusters) {
      const items = c.refs.map((r) => refs.get(r)!);
      const pref = (refs.get(c.preferredRef) ?? items[0]).data;
      const pick = (f: string) => pref[f] || items.map((i) => i.data[f]).find(Boolean) || '';
      const sources = items.map((i) => docSource(docs[i.docIndex], i.data));
      const technologies = [...new Set(items.flatMap((i) => i.data.technologies as string[]))];
      if (c.existingId) {
        const row = db.one<Record<string, any>>('SELECT * FROM projects WHERE id = ? AND user_id = ?', [c.existingId, userId])!;
        const merged = mergeSources(parseJson(row.sources, []), sources);
        db.run(`UPDATE projects SET sources = ?, provenance = ?, technologies = ?, updated_at = ? WHERE id = ?`, [
          JSON.stringify(merged),
          row.provenance === 'applicant_provided' ? row.provenance : brainRepo.provenanceFromSources(merged, row.provenance),
          JSON.stringify([...new Set([...parseJson<string[]>(row.technologies, []), ...technologies])]),
          nowIso(),
          c.existingId,
        ]);
        c.refs.forEach((r) => refToId.set(r, c.existingId));
        result.projects.merged++;
      } else {
        const id = brainRepo.insertProject(db, userId, {
          name: pick('name'),
          context: pick('context'),
          role: pick('role'),
          startDate: normalizeDate(pick('startDate')),
          endDate: normalizeDate(pick('endDate')),
          url: pick('url'),
          summary: pick('summary'),
          technologies,
          provenance: brainRepo.provenanceFromSources(sources),
          sources,
        });
        c.refs.forEach((r) => refToId.set(r, id));
        result.projects.created++;
      }
    }

    /* Evidence */
    const knownCategories = new Map<string, SkillCategory>();
    docs.forEach((d) => d.extraction.skills.forEach((s) => knownCategories.set(s.name.toLowerCase(), s.category)));
    const evidenceIdByRef = new Map<string, string>();
    const subjectOf = (r: NewRef): { type: SubjectType; id: string | null } => {
      const local = r.data.subjectRef as string;
      if (!local) return { type: 'general', id: null };
      const id = refToId.get(`D${r.docIndex + 1}.${local}`) ?? null;
      if (!id) return { type: 'general', id: null };
      return { type: id.startsWith('exp_') ? 'experience' : id.startsWith('edu_') ? 'education' : 'project', id };
    };
    for (const c of plan.evidenceClusters) {
      const items = c.refs.map((r) => refs.get(r)!);
      const prefRef = refs.get(c.preferredRef) ?? items[0];
      const quotes = items.map((i) => i.data.quote as string);
      const merged = (c as { mergedStatement?: string }).mergedStatement?.trim();
      const statement = merged && unsupportedNumbers(merged, [...quotes, ...items.map((i) => i.data.statement)]).length === 0 ? merged : prefRef.data.statement;
      const sources = items.map((i) => docSource(docs[i.docIndex], i.data));
      const metrics = dedupeMetrics(items.flatMap((i) => i.data.metrics));
      const skills = [...new Set(items.flatMap((i) => i.data.skills as string[]))];
      const themes = [...new Set(items.flatMap((i) => i.data.themes as string[]))];
      const subject = subjectOf(prefRef);
      let id: string;
      if (c.existingId) {
        const existing = brainRepo.getEvidence(db, userId, c.existingId)!;
        const mergedSources = mergeSources(existing.sources, sources);
        brainRepo.updateEvidence(db, userId, c.existingId, {
          sources: mergedSources,
          metrics: dedupeMetrics([...existing.metrics, ...metrics]),
          skills: [...new Set([...existing.skills, ...skills])],
          themes: [...new Set([...existing.themes, ...themes])] as typeof existing.themes,
          provenance: existing.provenance === 'applicant_provided' || existing.provenance === 'unsupported' ? existing.provenance : brainRepo.provenanceFromSources(mergedSources, existing.provenance),
          statement: existing.provenance === 'inferred' && !existing.userConfirmed && sources.some((s) => s.type === 'document' && s.verified) ? statement : existing.statement,
        });
        id = c.existingId;
        result.evidence.merged++;
      } else {
        const provenance = brainRepo.provenanceFromSources(sources);
        id = brainRepo.insertEvidence(db, userId, {
          statement,
          kind: prefRef.data.kind,
          subjectType: subject.type,
          subjectId: subject.id,
          metrics,
          skills,
          themes: themes as any,
          provenance,
          sources,
        });
        result.evidence.created++;
        if (provenance === 'verified') result.evidence.verified++;
      }
      c.refs.forEach((r) => evidenceIdByRef.set(r, id));
    }

    /* Skills: from skills sections (quote-verified) and from evidence (linked) */
    const skillIds = new Set<string>();
    docs.forEach((d) => {
      for (const s of d.extraction.skills) {
        const sid = brainRepo.upsertSkill(db, userId, {
          name: s.name,
          category: s.category,
          provenance: (s as any).verified ? 'verified' : 'inferred',
          sources: [docSource(d, s)],
        });
        if (sid) skillIds.add(sid);
      }
    });
    for (const [ref, evidenceId] of evidenceIdByRef) {
      const item = refs.get(ref)!;
      const ev = brainRepo.getEvidence(db, userId, evidenceId);
      for (const name of item.data.skills as string[]) {
        const sid = brainRepo.upsertSkill(db, userId, {
          name,
          category: guessCategory(name, knownCategories),
          provenance: ev?.provenance === 'verified' ? 'verified' : 'inferred',
          evidenceIds: [evidenceId],
        });
        if (sid) skillIds.add(sid);
      }
    }
    result.skills = skillIds.size;

    /* Profile: fill gaps only, never overwrite what the applicant set */
    const profile = brainRepo.getProfile(db, userId);
    const primary = docs.find((d) => d.extraction.documentType === 'resume') ?? docs[0];
    if (primary) {
      const p = primary.extraction.person;
      const links = [...profile.links];
      for (const l of docs.flatMap((d) => d.extraction.person.links)) if (l.url && !links.some((x) => x.url === l.url)) links.push(l);
      brainRepo.upsertProfile(db, userId, {
        fullName: profile.fullName || p.fullName,
        email: profile.email || p.email,
        phone: profile.phone || p.phone,
        location: profile.location || p.location,
        headline: profile.headline || p.headline,
        links: links.slice(0, 10),
      });
    }

    /* Resume representations (for multi-resume strategy) */
    for (const d of docs) {
      if (!d.extraction.resume.isResume) continue;
      const di = docs.indexOf(d) + 1;
      const sections = d.extraction.resume.sections.map((s) => ({
        title: s.title,
        kind: s.kind,
        entries: s.subjectRefs
          .map((local) => refToId.get(`D${di}.${local}`))
          .filter((id): id is string => !!id)
          .map((id) => ({
            subjectType: (id.startsWith('exp_') ? 'experience' : id.startsWith('edu_') ? 'education' : 'project') as SubjectType,
            subjectId: id,
            evidenceIds: [...evidenceIdByRef.entries()]
              .filter(([ref]) => ref.startsWith(`D${di}.`) && (refs.get(ref)!.data.subjectRef ? refToId.get(`D${di}.${refs.get(ref)!.data.subjectRef}`) === id : false))
              .map(([, eid]) => eid),
          })),
      }));
      db.run('DELETE FROM resume_sources WHERE document_id = ? AND user_id = ?', [d.documentId, userId]);
      db.run(`INSERT INTO resume_sources (id, user_id, document_id, label, focus, structure, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        `rsr_${d.documentId.slice(4)}`,
        userId,
        d.documentId,
        d.label,
        d.extraction.resume.focus,
        JSON.stringify({ sections }),
        nowIso(),
      ]);
    }

    /* Conflicts become high-priority discovery questions */
    for (const conflict of plan.conflicts) {
      const target = refToId.get(conflict.targetRef) ?? (conflict.targetRef.match(/^(exp|edu|prj|evd)_/) ? conflict.targetRef : null);
      const targetType = target ? (target.startsWith('exp_') ? 'experience' : target.startsWith('edu_') ? 'education' : target.startsWith('prj_') ? 'project' : 'evidence') : 'general';
      const dupe = db.one('SELECT 1 FROM discovery_questions WHERE user_id = ? AND status = ? AND question = ?', [userId, 'open', conflict.question]);
      if (dupe) continue;
      brainRepo.insertQuestion(db, userId, {
        question: conflict.question,
        rationale: `${conflict.detail} Applications must use one consistent version.`,
        category: 'conflict',
        priority: 95,
        targetType,
        targetId: target,
        answerType: 'text',
        // The competing values become one-tap suggestions; free text stays available for "neither".
        choices: [...new Set(conflict.options.map((o) => o.trim()).filter(Boolean))].slice(0, 4),
      });
      result.conflicts++;
    }

    for (const d of docs) db.run('UPDATE documents SET included_in_brain = 1, updated_at = ? WHERE id = ?', [nowIso(), d.documentId]);
  });
  audit(app.db, { userId, action: 'brain.built', meta: { documents: docs.map((d) => d.documentId), ...result } });
  return result;
}

function dedupeMetrics(metrics: { value: string; unit: string; context: string }[]) {
  const seen = new Set<string>();
  return metrics.filter((m) => {
    const k = `${m.value}|${m.unit}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
