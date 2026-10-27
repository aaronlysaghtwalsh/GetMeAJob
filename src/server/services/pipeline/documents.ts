import { INTEGRITY_CHARTER, UNTRUSTED_NOTE, WRITING_RULES, asData, voiceInstruction } from '../../ai/prompts';
import * as appRepo from '../../repos/applications';
import { buildBrainContext, preferencesText, type BrainContext, type RefMap } from '../brain/context';
import { IntegrityChecker, report } from '../integrity/validator';
import { lintWriting } from '../integrity/writing-lint';
import { analyzeAts } from '../documents/ats';
import { buildResumeDoc, resumeToText } from '../documents/resume-model';
import { resumeToDocx, resumeToPdf } from '../documents/render';
import {
  AnswerDraftSchema,
  CoverLetterDraftSchema,
  ResumeDraftSchema,
  ReviewSchema,
  type AnswerContent,
  type AnswerDraft,
  type CoverLetterContent,
  type CoverLetterDraft,
  type IntegrityIssue,
  type ResumeContent,
  type ResumeDraft,
  type ReviewContent,
  type ReviewRecommendation,
  type ConsistencyIssue,
} from '../../../shared/schemas/documents';
import type { Strategy } from '../../../shared/schemas/strategy';
import type { JobIntelligence } from '../../../shared/schemas/job';
import type { ResearchContent } from '../../../shared/schemas/research';
import type { FitContent } from '../../../shared/schemas/fit';
import { SENSITIVE_TOPICS, FEEDBACK_TAG_LABEL, type FeedbackTag } from '../../../shared/constants';
import { charCount, extractNumbers, wordCount } from '../../../shared/text';
import { jobText, latest, researchText, type PipelineContext, type StepOptions } from './context';

/* Helpers --------------------------------------------------------------------------------------------------- */

export function strategyText(s: Strategy, refs: RefMap): string {
  const r = (ids: string[]) => ids.map((id) => refs.ref(id) ?? id).join(', ');
  const lines = [
    '## Application strategy (follow it)',
    `Primary positioning: ${s.positioning.primary}`,
    `Secondary angle: ${s.positioning.secondary}`,
    `Narrative: ${s.positioning.narrative}`,
    `Lead with: ${s.leadWith.map((l) => `${l.point} [${r(l.evidenceIds)}]`).join('; ')}`,
    `De-emphasize: ${s.deEmphasize.map((d) => d.point).join('; ') || '(nothing)'}`,
    `Strongest evidence: ${s.strongestEvidence.map((e) => `${refs.ref(e.evidenceId) ?? e.evidenceId} for ${e.useIn.join('/')}`).join('; ')}`,
    `Objections to address: ${s.objections.map((o) => `${o.objection} -> ${o.response} [${r(o.evidenceIds)}]`).join('; ') || '(none)'}`,
    `Company priorities: ${s.companyPriorities.map((c) => `${c.priority} [${c.findingIds.join(', ')}]: ${c.howToAddress}`).join('; ') || '(none)'}`,
    `Role priorities: ${s.rolePriorities.map((c) => `${c.priority} [${c.requirementIds.join(', ')}]: ${c.howToAddress}`).join('; ')}`,
    `Differentiators: ${s.differentiators.map((d) => `${d.point} [${r(d.evidenceIds)}]`).join('; ')}`,
    `Cover letter: angle "${s.coverLetter.angle}"; hook "${s.coverLetter.hook}"; why company: ${s.coverLetter.whyCompany}; why role: ${s.coverLetter.whyRole}; why me: ${s.coverLetter.whyMe}; why now: ${s.coverLetter.whyNow}`,
    `Resume plan: summary ${s.resumePlan.includeSummary ? `yes (${s.resumePlan.summaryFocus})` : 'no'}; section order ${s.resumePlan.sectionOrder.join(' > ')}; experience order ${r(s.resumePlan.experienceOrder)}`,
    `Keywords to cover truthfully: ${s.resumePlan.keywordsToCover.map((k) => `${k.term} [${r(k.evidenceIds)}]`).join('; ')}`,
    `Keywords NOT supported (never add): ${s.resumePlan.keywordsNotSupported.join(', ') || '(none)'}`,
    `Base resume: ${s.baseResume.decision}${s.baseResume.sourceIds.length ? ` from ${r(s.baseResume.sourceIds)}` : ''}. ${s.baseResume.rationale}`,
  ];
  return lines.join('\n');
}

function feedbackNote(ctx: PipelineContext, kind: 'resume' | 'cover_letter' | 'answer', refId = ''): string {
  const prev = appRepo.latestArtifact(ctx.app.db, ctx.userId, ctx.application.id, kind, refId);
  if (!prev) return '';
  const fb = ctx.app.db.all<{ rating: string; tags: string; comment: string }>('SELECT rating, tags, comment FROM feedback WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 3', [prev.id]);
  if (!fb.length) return '';
  const parts = fb.map((f) => {
    const tags = (JSON.parse(f.tags || '[]') as FeedbackTag[]).map((t) => FEEDBACK_TAG_LABEL[t] ?? t);
    return `${f.rating === 'up' ? 'Liked' : 'Needs improvement'}${tags.length ? `: ${tags.join(', ')}` : ''}${f.comment ? ` — "${f.comment}"` : ''}`;
  });
  return `\n\nThe applicant's feedback on the previous version (address it): ${parts.join(' | ')}`;
}

/** Map E/X/D/P refs in a list to ids; unknown refs are reported. */
function mapRefs(refs: RefMap, ids: string[], unknown: string[]): string[] {
  return refs.ids(ids, unknown);
}

function issuesText(issues: IntegrityIssue[]): string {
  return issues.map((i) => `- ${i.location}: ${i.message}${i.text ? ` (text: "${i.text.slice(0, 160)}")` : ''}`).join('\n');
}

/** Present the base resume(s) as written, so "use existing"/"combine" can stay close to the original wording. */
function baseResumeText(ctx: PipelineContext, strategy: Strategy, bc: BrainContext): string {
  if (strategy.baseResume.decision === 'rebuild' || !strategy.baseResume.sourceIds.length) return '';
  const out: string[] = [];
  for (const sid of strategy.baseResume.sourceIds) {
    const rs = ctx.brain.resumeSources.find((r) => r.id === sid);
    if (!rs) continue;
    const ref = bc.refs.ref(rs.id) ?? '?';
    out.push(`### Base resume [${ref}] "${rs.label}" as written`);
    for (const sec of rs.structure.sections) {
      out.push(`${sec.title}:`);
      for (const en of sec.entries) {
        const subjectRef = en.subjectId ? bc.refs.ref(en.subjectId) : '';
        out.push(`  ${subjectRef ? `[${subjectRef}]` : ''}`);
        for (const eid of en.evidenceIds) {
          const ev = ctx.brain.evidence.find((e) => e.id === eid);
          const quote = ev?.sources.find((s) => s.type === 'document' && s.documentId === rs.documentId);
          const eref = bc.refs.ref(eid);
          if (ev && eref) out.push(`    - [${eref}] ${quote && quote.type === 'document' ? quote.quote : ev.statement}`);
        }
      }
    }
  }
  return out.join('\n');
}

/* Resume ------------------------------------------------------------------------------------------------------- */

const RESUME_SYSTEM = `${INTEGRITY_CHARTER}

${WRITING_RULES}

Task: write the applicant's resume for this specific job, following the application strategy.

A great resume here passes ATS parsing and keyword screens AND earns a recruiter's attention in a 10-second scan:
- Lead with what the strategy says to lead with. The most relevant roles get the most and best bullets (3-5); less relevant roles get 1-3; clearly irrelevant items can be left out. Education is always included.
- Bullets: action + method + impact. Start with a strong verb (past tense for past roles, present for current). Use the evidence's numbers whenever they exist. One idea per bullet, roughly 12-28 words. No first person, no buzzwords.
- Use the job's keywords where the evidence truthfully supports them, in natural phrasing. Never add a keyword the Career Brain does not support.
- Summary (only if the strategy includes one): 2-3 lines positioning the applicant for this role with concrete facts. No "motivated", "passionate", "dynamic" or similar.
- Skills: 2-4 labelled groups using exact names from the Career Brain skills list only; most job-relevant first.
- Education: institution, degree and dates are added automatically; add detail lines only for relevant coursework, final-year project/thesis or honors that exist in the Career Brain.
- Leadership & activities: include when it strengthens the story (captaincy, long-term commitments), citing the evidence.
- Target one page for early-career applicants.
- Titles, employers and dates are rendered from the records automatically. Never restate or change them in bullets.
- Every bullet, summary and detail line must cite its support: evidence refs (E#) and/or record refs (X#, D#, P#). A line may only contain facts present in what it cites.
- Base decision: "use_existing" means stay close to the base resume's structure and wording and only improve what the strategy calls for; "combine" means choose the strongest bullets from the base resumes; "rebuild" means write from the Career Brain evidence.
- changeLog: the significant choices you made and why.
${UNTRUSTED_NOTE}`;

function mapResumeDraft(draft: ResumeDraft, refs: RefMap, unknown: string[]): ResumeDraft {
  const b = (x: { text: string; evidenceIds: string[] }) => ({ text: x.text.trim(), evidenceIds: mapRefs(refs, x.evidenceIds, unknown) });
  return {
    ...draft,
    summary: b(draft.summary),
    experience: draft.experience.map((e) => ({ experienceId: refs.id(e.experienceId) ?? '', bullets: e.bullets.map(b) })).filter((e) => e.experienceId.startsWith('exp_')),
    projects: draft.projects.map((p) => ({ projectId: refs.id(p.projectId) ?? '', bullets: p.bullets.map(b) })).filter((p) => p.projectId.startsWith('prj_')),
    education: draft.education.map((d) => ({ educationId: refs.id(d.educationId) ?? '', details: d.details.map(b) })).filter((d) => d.educationId.startsWith('edu_')),
    leadership: {
      entries: draft.leadership.entries.map((e) => ({ experienceId: refs.id(e.experienceId) ?? '', bullets: e.bullets.map(b) })).filter((e) => e.experienceId.startsWith('exp_')),
      lines: draft.leadership.lines.map(b),
    },
  };
}

function checkResume(draft: ResumeDraft, checker: IntegrityChecker): { issues: IntegrityIssue[]; checked: number } {
  const issues: IntegrityIssue[] = [];
  let checked = 0;
  const claim = (text: string, ids: string[], location: string, requireEvidence = true) => {
    checked++;
    checker.checkClaim(text, { evidenceIds: ids, location, requireEvidence }, issues);
    if (requireEvidence && ids.length === 0) issues.push({ severity: 'blocker', code: 'no_evidence', location, text, message: 'No supporting evidence cited.' });
  };
  if (draft.summary.text) claim(draft.summary.text, draft.summary.evidenceIds, 'Summary', false);
  draft.experience.forEach((e, i) => e.bullets.forEach((bl, j) => claim(bl.text, bl.evidenceIds, `Experience ${i + 1}, bullet ${j + 1}`)));
  draft.projects.forEach((p, i) => p.bullets.forEach((bl, j) => claim(bl.text, bl.evidenceIds, `Project ${i + 1}, bullet ${j + 1}`)));
  draft.education.forEach((d, i) => d.details.forEach((bl, j) => claim(bl.text, bl.evidenceIds, `Education ${i + 1}, line ${j + 1}`, false)));
  draft.leadership.entries.forEach((e, i) => e.bullets.forEach((bl, j) => claim(bl.text, bl.evidenceIds, `Leadership ${i + 1}, bullet ${j + 1}`)));
  draft.leadership.lines.forEach((l, j) => claim(l.text, l.evidenceIds, `Leadership line ${j + 1}`));
  return { issues, checked };
}

/** Skills must exist in the Career Brain; unknown ones are removed automatically (with a visible note). */
function filterSkills(draft: ResumeDraft, checker: IntegrityChecker): { draft: ResumeDraft; warnings: IntegrityIssue[] } {
  const warnings: IntegrityIssue[] = [];
  const skills = draft.skills.map((g) => {
    const kept: string[] = [];
    for (const item of g.items) {
      if (checker.isKnownSkill(item)) kept.push(item);
      else warnings.push({ severity: 'warning', code: 'unknown_skill', location: `Skills: ${g.label}`, text: item, message: `Removed "${item}": it is not in your Career Brain skills.` });
    }
    return { ...g, items: kept };
  });
  return { draft: { ...draft, skills }, warnings };
}

/** Remove lines that still fail integrity after a repair attempt (never ship an unsupported claim). */
function dropFailing(draft: ResumeDraft, issues: IntegrityIssue[]): { draft: ResumeDraft; removed: IntegrityIssue[] } {
  const bad = new Set(issues.filter((i) => i.severity === 'blocker' && i.text).map((i) => i.text!));
  const removed: IntegrityIssue[] = [];
  const keep = (b: { text: string }) => {
    if (bad.has(b.text)) {
      removed.push({ severity: 'warning', code: 'consistency', location: 'Removed line', text: b.text, message: 'Removed because it could not be supported by your evidence.' });
      return false;
    }
    return true;
  };
  return {
    draft: {
      ...draft,
      summary: bad.has(draft.summary.text) ? { text: '', evidenceIds: [] } : draft.summary,
      experience: draft.experience.map((e) => ({ ...e, bullets: e.bullets.filter(keep) })),
      projects: draft.projects.map((p) => ({ ...p, bullets: p.bullets.filter(keep) })),
      education: draft.education.map((d) => ({ ...d, details: d.details.filter(keep) })),
      leadership: { entries: draft.leadership.entries.map((e) => ({ ...e, bullets: e.bullets.filter(keep) })), lines: draft.leadership.lines.filter(keep) },
    },
    removed,
  };
}

export async function renderAndAnalyzeResume(ctx: PipelineContext, draft: ResumeDraft, intel: JobIntelligence) {
  const doc = buildResumeDoc(draft, ctx.brain);
  const title = `${doc.header.name} - Resume - ${intel.company}`;
  const [pdf, docx] = await Promise.all([resumeToPdf(doc, { title }), resumeToDocx(doc, { title })]);
  const ats = await analyzeAts({ doc, pdf, docx, intel, brain: ctx.brain });
  return { doc, pdf, docx, ats, plainText: resumeToText(doc) };
}

export async function generateResume(ctx: PipelineContext, intel: JobIntelligence, strategy: Strategy, opts: StepOptions): Promise<ResumeContent> {
  const { app, userId, brain, job } = ctx;
  const bc = buildBrainContext(brain, 'usable');
  const checker = new IntegrityChecker({ brain, companyName: intel.company });
  const base = baseResumeText(ctx, strategy, bc);
  const prompt = `${jobText(job, intel, { includeRaw: false })}\n\n${strategyText(strategy, bc.refs)}${base ? `\n\n${base}` : ''}${feedbackNote(ctx, 'resume')}${opts.guidance ? `\n\nApplicant's direction for this version: ${opts.guidance}` : ''}\n\nWrite the resume.`;
  const call = (p: string) =>
    app.ai.structured({
      userId,
      taskId: opts.taskId,
      task: 'resume',
      purpose: `Resume: ${intel.title} at ${intel.company}`,
      context: bc.text,
      system: RESUME_SYSTEM,
      prompt: p,
      schema: ResumeDraftSchema,
      schemaName: 'resume_draft',
      signal: opts.signal,
    });

  const unknown: string[] = [];
  let filtered = filterSkills(mapResumeDraft(await call(prompt), bc.refs, unknown), checker);
  let draft = filtered.draft;
  let result = checkResume(draft, checker);
  const repairs: IntegrityIssue[] = [];
  if (result.issues.some((i) => i.severity === 'blocker')) {
    const blockers = result.issues.filter((i) => i.severity === 'blocker');
    const repaired = await call(`${prompt}\n\nYour previous draft failed the integrity check. Rewrite it so every line is supported by what it cites. Remove or reword these lines:\n${issuesText(blockers)}`);
    filtered = filterSkills(mapResumeDraft(repaired, bc.refs, unknown), checker);
    draft = filtered.draft;
    result = checkResume(draft, checker);
    repairs.push(
      ...blockers.map((b) => ({ ...b, severity: 'warning' as const, message: `Fixed automatically: ${b.message}` })),
    );
  }
  let issues = [...filtered.warnings, ...result.issues];
  if (result.issues.some((i) => i.severity === 'blocker')) {
    const dropped = dropFailing(draft, result.issues);
    draft = dropped.draft;
    issues = [...filtered.warnings, ...checkResume(draft, checker).issues, ...dropped.removed];
  }
  issues.push(...repairs.filter((r) => !issues.some((i) => i.text === r.text && i.severity === 'blocker')));
  if (unknown.length) issues.push({ severity: 'warning', code: 'unknown_ref', location: 'References', message: `Ignored ${unknown.length} reference(s) that do not exist: ${[...new Set(unknown)].slice(0, 6).join(', ')}` });
  const rendered = await renderAndAnalyzeResume(ctx, draft, intel);
  return {
    draft,
    doc: rendered.doc,
    integrity: report(issues, result.checked),
    ats: rendered.ats,
    baseDecision: { decision: strategy.baseResume.decision, sourceIds: strategy.baseResume.sourceIds, rationale: strategy.baseResume.rationale },
    plainText: rendered.plainText,
  };
}

/** Re-check and re-render a resume edited by the applicant (creates a new version upstream). */
export async function reviseResume(ctx: PipelineContext, draft: ResumeDraft, intel: JobIntelligence, previous: ResumeContent): Promise<ResumeContent> {
  const checker = new IntegrityChecker({ brain: ctx.brain, companyName: intel.company });
  const filtered = filterSkills(draft, checker);
  const result = checkResume(filtered.draft, checker);
  const rendered = await renderAndAnalyzeResume(ctx, filtered.draft, intel);
  return {
    ...previous,
    draft: filtered.draft,
    doc: rendered.doc,
    integrity: report([...filtered.warnings, ...result.issues], result.checked),
    ats: rendered.ats,
    plainText: rendered.plainText,
  };
}

/* Cover letter ------------------------------------------------------------------------------------------------------ */

const COVER_SYSTEM = `${INTEGRITY_CHARTER}

${WRITING_RULES}

Task: write a cover letter a strong, thoughtful candidate would write themselves for this application.
- 250-380 words, 3-5 short paragraphs. No address block or date (added automatically).
- Hook: open with something specific. Either a concrete fact about the company or team (from research, cite F#) connected to the applicant, or the applicant's most relevant accomplishment. Never open with "I am writing to" or "I am excited to apply".
- Middle: the strongest evidence for this role, framed around what the company or team needs. Tell one short concrete story rather than repeating the resume.
- If the strategy names an important objection, address it briefly and honestly.
- Why this company, role and now: grounded in research findings, not flattery. If research is thin, keep company statements modest.
- Company statements must cite findings (F#). Only findings of type "fact" may be stated as fact; interpretations are phrased as the applicant's own read.
- Applicant statements must cite evidence (E#) or records (X#, D#, P#).
- Close briefly and confidently. No begging, no "at your earliest convenience".
- Greeting: the hiring manager's name if provided, otherwise "Dear Hiring Team,".
${UNTRUSTED_NOTE}`;

function mapLetter(d: CoverLetterDraft, refs: RefMap, findingIds: Set<string>, unknown: string[]): CoverLetterDraft {
  return {
    ...d,
    paragraphs: d.paragraphs.map((p) => ({
      ...p,
      text: p.text.trim(),
      evidenceIds: mapRefs(refs, p.evidenceIds, unknown),
      findingIds: p.findingIds.map((f) => f.toUpperCase()).filter((f) => findingIds.has(f)),
    })),
  };
}

function checkLetter(d: CoverLetterDraft, checker: IntegrityChecker, research: ResearchContent | null): { issues: IntegrityIssue[]; checked: number } {
  const issues: IntegrityIssue[] = [];
  d.paragraphs.forEach((p, i) => {
    checker.checkClaim(p.text, { evidenceIds: p.evidenceIds, findingIds: p.findingIds, location: `Paragraph ${i + 1}`, allowCompanyNumbers: true }, issues);
    if (p.purpose === 'why_company' && !p.findingIds.length && research?.findings.length) {
      issues.push({ severity: 'warning', code: 'unsupported_company_claim', location: `Paragraph ${i + 1}`, text: p.text, message: 'Talks about the company without citing research.' });
    }
    const facts = p.findingIds.map((f) => research?.findings.find((x) => x.id === f)).filter(Boolean);
    if (facts.some((f) => f!.type === 'hypothesis')) {
      issues.push({ severity: 'warning', code: 'unsupported_company_claim', location: `Paragraph ${i + 1}`, text: p.text, message: 'Relies on an unverified hypothesis about the company. Make sure it is phrased as your own read, not as fact.' });
    }
  });
  return { issues, checked: d.paragraphs.length };
}

function assembleLetter(d: CoverLetterDraft, name: string): string {
  return [d.greeting, ...d.paragraphs.map((p) => p.text), `${d.closing}\n${name}`].join('\n\n');
}

export async function generateCoverLetter(ctx: PipelineContext, intel: JobIntelligence, strategy: Strategy, research: ResearchContent | null, opts: StepOptions): Promise<CoverLetterContent> {
  const { app, userId, brain, prefs, job } = ctx;
  const bc = buildBrainContext(brain, 'usable');
  const findingIds = new Set((research?.findings ?? []).map((f) => f.id));
  const checker = new IntegrityChecker({ brain, research, companyName: intel.company, companyTexts: [job.rawText, research?.overview ?? ''] });
  const manager = appRepo.listContacts(app.db, userId, ctx.application.id).find((c) => c.role === 'hiring_manager');
  const system = `${COVER_SYSTEM}\n\n${voiceInstruction(prefs.writingVoice, prefs.writingSample)}`;
  const prompt = `${jobText(job, intel, { includeRaw: false })}\n\n${researchText(research)}\n\n${strategyText(strategy, bc.refs)}${manager ? `\n\nHiring manager: ${manager.name}${manager.title ? `, ${manager.title}` : ''}` : ''}${feedbackNote(ctx, 'cover_letter')}${opts.guidance ? `\n\nApplicant's direction for this version: ${opts.guidance}` : ''}\n\nWrite the cover letter.`;
  const call = (p: string) =>
    app.ai.structured({
      userId,
      taskId: opts.taskId,
      task: 'cover_letter',
      purpose: `Cover letter: ${intel.company}`,
      context: `${bc.text}\n\n${preferencesText(prefs)}`,
      system,
      prompt: p,
      schema: CoverLetterDraftSchema,
      schemaName: 'cover_letter',
      signal: opts.signal,
    });
  const unknown: string[] = [];
  let draft = mapLetter(await call(prompt), bc.refs, findingIds, unknown);
  let check = checkLetter(draft, checker, research);
  let lint = lintWriting(draft.paragraphs.map((p) => p.text).join('\n\n'));
  const needsEdit = check.issues.some((i) => i.severity === 'blocker') || lint.score < 80;
  if (needsEdit) {
    // Editorial pass: fix integrity problems and generic phrasing while keeping the strongest content.
    const edited = mapLetter(
      await call(
        `${prompt}\n\nHere is your draft:\n${asData('draft', assembleLetter(draft, ''))}\n\nRevise it.${check.issues.length ? `\nFix these integrity issues:\n${issuesText(check.issues)}` : ''}${lint.flags.length ? `\nRemove these generic patterns: ${lint.flags.map((f) => `"${f.phrase}" (${f.suggestion})`).join('; ')}` : ''}\nKeep what is specific and strong.`,
      ),
      bc.refs,
      findingIds,
      unknown,
    );
    const editedCheck = checkLetter(edited, checker, research);
    const editedLint = lintWriting(edited.paragraphs.map((p) => p.text).join('\n\n'));
    const blockers = (c: typeof check) => c.issues.filter((i) => i.severity === 'blocker').length;
    if (blockers(editedCheck) < blockers(check) || (blockers(editedCheck) === blockers(check) && editedLint.score >= lint.score)) {
      draft = edited;
      check = editedCheck;
      lint = editedLint;
    }
  }
  const text = assembleLetter(draft, brain.profile.fullName);
  return { draft, text, wordCount: wordCount(draft.paragraphs.map((p) => p.text).join(' ')), integrity: report(check.issues, check.checked), writing: lint };
}

export function reviseCoverLetter(ctx: PipelineContext, draft: CoverLetterDraft, intel: JobIntelligence, research: ResearchContent | null): CoverLetterContent {
  const checker = new IntegrityChecker({ brain: ctx.brain, research, companyName: intel.company, companyTexts: [ctx.job.rawText, research?.overview ?? ''] });
  const check = checkLetter(draft, checker, research);
  const lint = lintWriting(draft.paragraphs.map((p) => p.text).join('\n\n'));
  return { draft, text: assembleLetter(draft, ctx.brain.profile.fullName), wordCount: wordCount(draft.paragraphs.map((p) => p.text).join(' ')), integrity: report(check.issues, check.checked), writing: lint };
}

/* Application questions --------------------------------------------------------------------------------------------- */

const ANSWER_SYSTEM = `${INTEGRITY_CHARTER}

${WRITING_RULES}

Task: answer one application question for this job.
1. Work out what the employer is really testing (motivation and research for "why us", self-awareness for weaknesses, evidence of impact for achievements, judgement for scenarios).
2. Choose the strongest relevant evidence and, where it helps, company research (F#).
3. Answer in the applicant's voice (first person), specific and concise, and within the limit. With no stated limit: about 100-180 words for open questions, one or two sentences for factual ones.
4. Stay consistent with the resume, cover letter and other answers provided.
5. Sensitive questions (work authorization, sponsorship, salary, relocation, start date, legal declarations): answer ONLY from the applicant's stated preferences. If the needed fact is not stated, write a neutral draft and set needsApplicantInput to exactly what must be confirmed. Never guess these facts.
6. Voluntary self-identification (gender, race, ethnicity, veteran or disability status, sexual orientation): leave answer empty and set needsApplicantInput to "Voluntary self-identification. Answer this yourself."
7. Cite evidence refs for applicant facts and finding refs for company facts.
${UNTRUSTED_NOTE}`;

export function isSensitive(question: string): boolean {
  const q = question.toLowerCase();
  return SENSITIVE_TOPICS.some((t) => q.includes(t));
}

export function checkLimit(text: string, limitType: string, limitValue: number | null): { over: boolean; count: number } {
  const count = limitType === 'chars' ? charCount(text) : wordCount(text);
  return { over: !!limitValue && limitType !== 'none' && count > limitValue, count };
}

function checkAnswer(d: AnswerDraft, checker: IntegrityChecker, q: appRepo.QuestionRowDTO, location: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (d.answer.trim()) checker.checkClaim(d.answer, { evidenceIds: d.evidenceIds, findingIds: d.findingIds, location, allowCompanyNumbers: true }, issues);
  const lim = checkLimit(d.answer, q.limitType, q.limitValue);
  if (lim.over) issues.push({ severity: 'blocker', code: 'over_limit', location, message: `${lim.count} ${q.limitType === 'chars' ? 'characters' : 'words'}; the limit is ${q.limitValue}.` });
  if (q.sensitive) issues.push({ severity: 'warning', code: 'sensitive_review', location, message: 'Sensitive question: confirm this answer yourself before submitting.' });
  return issues;
}

export async function generateAnswer(
  ctx: PipelineContext,
  intel: JobIntelligence,
  strategy: Strategy | null,
  research: ResearchContent | null,
  q: appRepo.QuestionRowDTO,
  others: { question: string; answer: string }[],
  opts: StepOptions,
): Promise<AnswerContent> {
  const { app, userId, brain, prefs, job } = ctx;
  const bc = buildBrainContext(brain, 'usable');
  const findingIds = new Set((research?.findings ?? []).map((f) => f.id));
  const checker = new IntegrityChecker({ brain, research, companyName: intel.company, companyTexts: [job.rawText] });
  const l = latest(ctx);
  const consistency = [
    l.resume ? `Resume (current version):\n${l.resume.content.plainText.slice(0, 4000)}` : '',
    l.coverLetter ? `Cover letter (current version):\n${l.coverLetter.content.text.slice(0, 3000)}` : '',
    others.length ? `Other answers in this application:\n${others.map((o) => `Q: ${o.question}\nA: ${o.answer}`).join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const limitText = q.limitType === 'none' || !q.limitValue ? 'No stated limit.' : `Limit: ${q.limitValue} ${q.limitType === 'chars' ? 'characters' : 'words'} (stay safely under it).`;
  const prompt = `${jobText(job, intel, { includeRaw: false })}\n\n${researchText(research)}${strategy ? `\n\n${strategyText(strategy, bc.refs)}` : ''}\n\n${consistency}\n\n## Question\n${q.question}\n${limitText}${q.sensitive ? '\nThis question is sensitive: use only stated preferences.' : ''}${feedbackNote(ctx, 'answer', q.id)}${opts.guidance ? `\n\nApplicant's direction: ${opts.guidance}` : ''}`;
  const call = (p: string) =>
    app.ai.structured({
      userId,
      taskId: opts.taskId,
      task: 'answer',
      purpose: `Answer: ${q.question.slice(0, 60)}`,
      context: `${bc.text}\n\n${preferencesText(prefs)}`,
      system: `${ANSWER_SYSTEM}\n\n${voiceInstruction(prefs.writingVoice, prefs.writingSample)}`,
      prompt: p,
      schema: AnswerDraftSchema,
      schemaName: 'application_answer',
      signal: opts.signal,
    });
  const unknown: string[] = [];
  const map = (d: AnswerDraft): AnswerDraft => ({ ...d, answer: d.answer.trim(), evidenceIds: mapRefs(bc.refs, d.evidenceIds, unknown), findingIds: d.findingIds.map((f) => f.toUpperCase()).filter((f) => findingIds.has(f)) });
  let draft = map(await call(prompt));
  let issues = checkAnswer(draft, checker, q, 'Answer');
  const blockers = issues.filter((i) => i.severity === 'blocker');
  if (blockers.length) {
    const fixed = map(await call(`${prompt}\n\nYour previous answer:\n${asData('draft', draft.answer)}\nFix these problems and return the full corrected answer:\n${issuesText(blockers)}`));
    const fixedIssues = checkAnswer(fixed, checker, q, 'Answer');
    if (fixedIssues.filter((i) => i.severity === 'blocker').length <= blockers.length) {
      draft = fixed;
      issues = fixedIssues;
    }
  }
  return {
    draft,
    question: q.question,
    limitType: q.limitType,
    limitValue: q.limitValue,
    wordCount: wordCount(draft.answer),
    charCount: charCount(draft.answer),
    integrity: report(issues, 1),
    writing: lintWriting(draft.answer),
    sensitive: q.sensitive,
  };
}

export function reviseAnswer(ctx: PipelineContext, prev: AnswerContent, answer: string, q: appRepo.QuestionRowDTO, intel: JobIntelligence, research: ResearchContent | null): AnswerContent {
  const checker = new IntegrityChecker({ brain: ctx.brain, research, companyName: intel.company, companyTexts: [ctx.job.rawText] });
  const draft = { ...prev.draft, answer: answer.trim() };
  const issues = checkAnswer(draft, checker, q, 'Answer');
  return { ...prev, draft, wordCount: wordCount(draft.answer), charCount: charCount(draft.answer), integrity: report(issues, 1), writing: lintWriting(draft.answer) };
}

/* Review & consistency ---------------------------------------------------------------------------------------------- */

const REVIEW_SYSTEM = `${INTEGRITY_CHARTER}

Task: act as a demanding final reviewer (a recruiter, the hiring manager and an editor) before the applicant submits. Score each dimension 0-100 with honest reasoning:
- resume: relevance to this job, clarity, impact, evidence, ordering
- coverLetter: specificity, authenticity, company understanding, persuasiveness
- questions: how well answers address what each question tests, within limits (score 70 with a note if there are no questions)
- companyAlignment: how well the application connects to what the company and team value
- evidence: how well claims are backed by concrete evidence and numbers
- recruiterAppeal: would a recruiter advance this after a 10-second scan
Then list the biggest strengths, the biggest weaknesses and concrete recommendations. When a recommendation is a text edit, copy the existing text EXACTLY into "find" and put the improved text in "replace", using only supported facts (no new numbers, tools or claims). Use targetRef Q# for answers. verdict: ready, almost_ready or not_ready.
${UNTRUSTED_NOTE}`;

export function consistencyIssues(ctx: PipelineContext, letter: CoverLetterContent | null, answers: { question: string; content: AnswerContent }[]): ConsistencyIssue[] {
  const out: ConsistencyIssue[] = [];
  const prefs = ctx.prefs;
  const wa = prefs.workAuthorization;
  for (const a of answers) {
    const text = a.content.draft.answer.toLowerCase();
    if (!text) continue;
    if (/sponsor/.test(a.question.toLowerCase()) || /sponsor/.test(text)) {
      const saysNo = /\b(do not|don't|will not|won't|not) (currently )?(require|need)/.test(text);
      const saysYes = /\b(i )?(will|do|would) (require|need)\b/.test(text) && !saysNo;
      if (saysNo && wa.requiresSponsorshipNow === 'yes') out.push({ severity: 'blocker', message: 'An answer says you do not need sponsorship, but your preferences say you do.', where: [a.question] });
      if (saysYes && wa.requiresSponsorshipNow === 'no') out.push({ severity: 'blocker', message: 'An answer says you need sponsorship, but your preferences say you do not.', where: [a.question] });
    }
    if (/authori[sz]ed to work/.test(text) && wa.authorizedToWork === 'no' && !/not authori[sz]ed/.test(text)) {
      out.push({ severity: 'blocker', message: 'An answer says you are authorized to work, but your preferences say you are not.', where: [a.question] });
    }
    if (/salary|compensation|pay expectation/.test(a.question.toLowerCase())) {
      const nums = extractNumbers(a.content.draft.answer).map((n) => n.value).filter((v) => v > 1000);
      const min = prefs.compensation.minimum;
      if (min && nums.some((v) => v < min * 0.95)) out.push({ severity: 'warning', message: `A salary answer mentions an amount below your stated minimum (${min.toLocaleString()}).`, where: [a.question] });
      if (!min && !prefs.compensation.target) out.push({ severity: 'warning', message: 'You have not set a salary range, so the salary answer could not be checked.', where: [a.question] });
    }
  }
  if (letter) {
    const knownOrgs = [...ctx.brain.experiences.map((x) => x.organization), ...ctx.brain.education.map((d) => d.institution), ctx.job.companyName, ctx.job.intelligence?.company ?? ''].filter(Boolean);
    const text = letter.text;
    const caps = text.match(/\b(?:at|for|with|joined)\s+([A-Z][A-Za-z&]+(?:\s+[A-Z][A-Za-z&]+){0,3})/g) ?? [];
    for (const m of caps) {
      const name = m.replace(/^(at|for|with|joined)\s+/, '');
      if (!knownOrgs.some((o) => o.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(o.toLowerCase()))) {
        out.push({ severity: 'warning', message: `The cover letter mentions "${name}", which is not one of your organizations or the employer. Check it is correct.`, where: ['Cover letter'] });
      }
    }
  }
  return out;
}

export async function runReview(ctx: PipelineContext, intel: JobIntelligence, opts: StepOptions): Promise<ReviewContent> {
  const { app, userId, brain, prefs, job } = ctx;
  const l = latest(ctx);
  const questions = appRepo.listAppQuestions(app.db, userId, ctx.application.id);
  const answers = questions
    .map((q, i) => ({ q, ref: `Q${i + 1}`, art: appRepo.latestArtifact<AnswerContent>(app.db, userId, ctx.application.id, 'answer', q.id) }))
    .filter((x) => x.art);
  const bc = buildBrainContext(brain, 'usable');
  const materials = [
    l.resume ? `## Resume\n${l.resume.content.plainText}` : '## Resume\n(not generated)',
    l.coverLetter ? `## Cover letter\n${l.coverLetter.content.text}` : '## Cover letter\n(not generated)',
    answers.length ? `## Answers\n${answers.map((a) => `[${a.ref}] ${a.q.question}\n${a.art!.content.draft.answer}`).join('\n\n')}` : '## Answers\n(no application questions)',
  ].join('\n\n');
  const raw = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'review',
    purpose: `Readiness review: ${intel.company}`,
    context: `${bc.text}\n\n${preferencesText(prefs)}`,
    system: REVIEW_SYSTEM,
    prompt: `${jobText(job, intel, { includeRaw: false })}\n\n${researchText(l.research?.content)}${l.strategy ? `\n\n${strategyText(l.strategy.content, bc.refs)}` : ''}\n\n${asData('application_materials', materials)}\n\nReview the application.`,
    schema: ReviewSchema,
    schemaName: 'readiness_review',
    signal: opts.signal,
  });

  const qRef = new Map(answers.map((a) => [a.ref, a]));
  const recommendations: ReviewRecommendation[] = raw.recommendations.map((r, i) => {
    let targetId = '';
    let source = '';
    if (r.target === 'resume' && l.resume) {
      targetId = l.resume.id;
      source = l.resume.content.plainText;
    } else if (r.target === 'cover_letter' && l.coverLetter) {
      targetId = l.coverLetter.id;
      source = l.coverLetter.content.text;
    } else if (r.target === 'answer') {
      const a = qRef.get(r.targetRef.toUpperCase());
      if (a?.art) {
        targetId = a.art.id;
        source = a.art.content.draft.answer;
      }
    }
    const applicable = !!(r.find && r.replace && targetId && source.includes(r.find));
    return { id: `K${i + 1}`, title: r.title, detail: r.detail, severity: r.severity, target: r.target, targetId, find: r.find, replace: r.replace, applicable };
  });

  const consistency = consistencyIssues(
    ctx,
    l.coverLetter?.content ?? null,
    answers.map((a) => ({ question: a.q.question, content: a.art!.content })),
  );
  const integrityBlockers = [l.resume?.content.integrity, l.coverLetter?.content.integrity, ...answers.map((a) => a.art!.content.integrity)].reduce(
    (n, r) => n + (r?.issues.filter((i) => i.severity === 'blocker').length ?? 0),
    0,
  );
  const ats = l.resume?.content.ats.score ?? 0;
  const consistencyScore = Math.max(0, 100 - consistency.filter((c) => c.severity === 'blocker').length * 35 - consistency.filter((c) => c.severity === 'warning').length * 10 - integrityBlockers * 15);
  const scores: ReviewContent['scores'] = {
    resume: raw.scores.resume,
    coverLetter: raw.scores.coverLetter,
    questions: raw.scores.questions,
    companyAlignment: raw.scores.companyAlignment,
    evidence: raw.scores.evidence,
    recruiterAppeal: raw.scores.recruiterAppeal,
    ats: { score: ats, reasoning: l.resume ? 'Measured by parsing the exported PDF and DOCX and checking keywords against the job.' : 'No resume yet.' },
    consistency: {
      score: consistencyScore,
      reasoning: consistency.length || integrityBlockers ? `${consistency.length} consistency issue(s), ${integrityBlockers} unresolved integrity blocker(s).` : 'Dates, titles and facts match across the application.',
    },
  };
  const weights = { resume: 20, ats: 15, recruiterAppeal: 15, coverLetter: 15, questions: 10, companyAlignment: 10, evidence: 10, consistency: 5 } as const;
  const hasQuestions = answers.length > 0;
  let total = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (k === 'questions' && !hasQuestions) continue;
    if (k === 'coverLetter' && !l.coverLetter) continue;
    total += scores[k as keyof typeof scores].score * w;
    wsum += w;
  }
  let verdict = raw.verdict;
  if (integrityBlockers > 0 || consistency.some((c) => c.severity === 'blocker')) verdict = 'not_ready';
  return {
    scores,
    overall: Math.round(total / Math.max(1, wsum)),
    strengths: raw.strengths,
    weaknesses: raw.weaknesses,
    recommendations,
    consistency,
    verdict,
    verdictReason: integrityBlockers ? `${raw.verdictReason} There are ${integrityBlockers} unresolved integrity issue(s) to fix first.` : raw.verdictReason,
    reviewed: { resumeId: l.resume?.id ?? null, coverLetterId: l.coverLetter?.id ?? null, answerIds: answers.map((a) => a.art!.id) },
    decisions: {},
  };
}

export type { FitContent };
