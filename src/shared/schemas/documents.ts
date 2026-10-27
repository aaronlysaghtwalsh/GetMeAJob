import { z } from 'zod/v4';
import { RESUME_SECTIONS, type ResumeSectionKey } from './strategy';

const evidenceIds = z.array(z.string()).describe('Evidence refs (E1, E2...) that support every fact in the text. Required for every factual claim.');

export const BulletSchema = z.object({
  text: z.string().describe('Action + method + impact, using only facts in the cited evidence. Under ~30 words.'),
  evidenceIds,
});
export type Bullet = z.infer<typeof BulletSchema>;

export const ResumeDraftSchema = z.object({
  summary: z.object({
    text: z.string().describe('2-3 line profile tailored to the role, or empty if the strategy says no summary.'),
    evidenceIds,
  }),
  sectionOrder: z.array(z.enum(RESUME_SECTIONS)),
  experience: z.array(
    z.object({
      experienceId: z.string().describe('Experience ref (X1...). Title, employer and dates are taken from the record automatically.'),
      bullets: z.array(BulletSchema),
    }),
  ),
  projects: z.array(z.object({ projectId: z.string().describe('Project ref (P1...)'), bullets: z.array(BulletSchema) })),
  education: z.array(
    z.object({
      educationId: z.string().describe('Education ref (D1...). Institution, degree and dates come from the record.'),
      details: z.array(BulletSchema).describe('Optional lines such as relevant coursework or thesis, each evidence-backed.'),
    }),
  ),
  skills: z.array(
    z.object({
      label: z.string().describe('Group label, e.g. "Data & analytics".'),
      items: z.array(z.string()).describe('Skill names exactly as they appear in the Career Brain skills list.'),
    }),
  ),
  leadership: z.object({
    entries: z.array(z.object({ experienceId: z.string(), bullets: z.array(BulletSchema) })).describe('Leadership/extracurricular experiences (X refs).'),
    lines: z.array(BulletSchema).describe('One-line items not tied to an experience record.'),
  }),
  changeLog: z.array(z.object({ change: z.string(), reason: z.string() })).describe('Major choices made versus the base resume, with the reason for each.'),
});
export type ResumeDraft = z.infer<typeof ResumeDraftSchema>;

export const CoverLetterDraftSchema = z.object({
  greeting: z.string().describe('e.g. "Dear Hiring Team," or a named person if known.'),
  paragraphs: z.array(
    z.object({
      text: z.string(),
      purpose: z.enum(['hook', 'why_company', 'evidence', 'why_role', 'why_now', 'close']),
      evidenceIds,
      findingIds: z.array(z.string()).describe('Research finding refs (F1...) for any statement about the company.'),
    }),
  ),
  closing: z.string().describe('Sign-off line, e.g. "Best regards,".'),
  notes: z.string().describe('Short note to the applicant on the choices made.'),
});
export type CoverLetterDraft = z.infer<typeof CoverLetterDraftSchema>;

export const AnswerDraftSchema = z.object({
  analysis: z.object({
    testing: z.string().describe('What the employer is really assessing with this question.'),
    signals: z.array(z.string()).describe('What a strong answer demonstrates.'),
    pitfalls: z.array(z.string()),
  }),
  answer: z.string().describe('The answer, in the applicant voice, within the limit.'),
  evidenceIds,
  findingIds: z.array(z.string()),
  strategy: z.string().describe('One or two sentences on why this answer is built this way.'),
  needsApplicantInput: z.string().describe('If the answer depends on facts only the applicant can confirm (salary, authorization, availability), say exactly what. Else empty.'),
});
export type AnswerDraft = z.infer<typeof AnswerDraftSchema>;

const scored = z.object({ score: z.number().int().describe('0-100'), reasoning: z.string() });

export const ReviewSchema = z.object({
  scores: z.object({
    resume: scored,
    coverLetter: scored,
    questions: scored,
    companyAlignment: scored,
    evidence: scored,
    recruiterAppeal: scored,
  }),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      severity: z.enum(['critical', 'important', 'nice_to_have']),
      target: z.enum(['resume', 'cover_letter', 'answer', 'general']),
      targetRef: z.string().describe('Question ref (Q1...) when target is answer, else empty.'),
      find: z.string().describe('Exact existing text to replace, copied verbatim, or empty if not a text edit.'),
      replace: z.string().describe('Replacement text using only supported facts, or empty.'),
    }),
  ),
  verdict: z.enum(['ready', 'almost_ready', 'not_ready']),
  verdictReason: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

/* ------------------------------------------------------------------------------------------------
 * Stored artifact content (server-produced)
 * ---------------------------------------------------------------------------------------------- */

export interface IntegrityIssue {
  severity: 'blocker' | 'warning';
  code:
    | 'unknown_ref'
    | 'unusable_evidence'
    | 'unsupported_number'
    | 'unknown_skill'
    | 'no_evidence'
    | 'unsupported_company_claim'
    | 'over_limit'
    | 'sensitive_review'
    | 'cliche'
    | 'consistency';
  message: string;
  location: string;
  text?: string;
}

export interface IntegrityReport {
  ok: boolean;
  checkedClaims: number;
  issues: IntegrityIssue[];
}

export type ResumeItem =
  | {
      type: 'entry';
      subjectType: 'experience' | 'education' | 'project';
      subjectId: string;
      heading: string;
      subheading: string;
      location: string;
      dates: string;
      bullets: Bullet[];
    }
  | { type: 'text'; text: string; evidenceIds: string[] }
  | { type: 'skills'; groups: { label: string; items: string[] }[] };

export interface ResumeDoc {
  header: { name: string; contact: string[] };
  sections: { key: ResumeSectionKey; title: string; items: ResumeItem[] }[];
}

export interface AtsCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface AtsReport {
  score: number;
  checks: AtsCheck[];
  keywords: { term: string; weight: 'high' | 'medium' | 'low'; found: boolean; supported: boolean }[];
  parsed: { format: 'pdf' | 'docx'; ok: boolean; detectedName: boolean; detectedEmail: boolean; detectedPhone: boolean; sections: string[] }[];
  appeal: { score: number; signals: { label: string; value: string; status: 'good' | 'ok' | 'weak' }[] };
}

export interface ResumeContent {
  draft: ResumeDraft;
  doc: ResumeDoc;
  integrity: IntegrityReport;
  ats: AtsReport;
  baseDecision: { decision: string; sourceIds: string[]; rationale: string };
  plainText: string;
}

export interface WritingLint {
  score: number;
  flags: { phrase: string; kind: 'cliche' | 'ai_tell' | 'filler' | 'hype' | 'structure'; suggestion: string; count: number }[];
  stats: { words: number; sentences: number; avgSentenceLength: number; sentenceLengthStdev: number; iStarts: number };
}

export interface CoverLetterContent {
  draft: CoverLetterDraft;
  text: string;
  wordCount: number;
  integrity: IntegrityReport;
  writing: WritingLint;
}

export interface AnswerContent {
  draft: AnswerDraft;
  question: string;
  limitType: 'words' | 'chars' | 'none';
  limitValue: number | null;
  wordCount: number;
  charCount: number;
  integrity: IntegrityReport;
  writing: WritingLint;
  sensitive: boolean;
}

export interface ConsistencyIssue {
  severity: 'blocker' | 'warning';
  message: string;
  where: string[];
}

export interface ReviewRecommendation {
  id: string;
  title: string;
  detail: string;
  severity: 'critical' | 'important' | 'nice_to_have';
  target: 'resume' | 'cover_letter' | 'answer' | 'general';
  targetId: string;
  find: string;
  replace: string;
  applicable: boolean;
}

export interface ReviewContent {
  scores: Record<'resume' | 'coverLetter' | 'questions' | 'companyAlignment' | 'evidence' | 'recruiterAppeal' | 'ats' | 'consistency', { score: number; reasoning: string }>;
  overall: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: ReviewRecommendation[];
  consistency: ConsistencyIssue[];
  verdict: 'ready' | 'almost_ready' | 'not_ready';
  verdictReason: string;
  reviewed: { resumeId: string | null; coverLetterId: string | null; answerIds: string[] };
  decisions: Record<string, 'accepted' | 'rejected'>;
}
