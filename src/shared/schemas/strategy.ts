import { z } from 'zod/v4';

export const RESUME_SECTIONS = ['summary', 'experience', 'projects', 'education', 'skills', 'leadership'] as const;
export type ResumeSectionKey = (typeof RESUME_SECTIONS)[number];

export const StrategySchema = z.object({
  positioning: z.object({
    primary: z.string().describe('One sentence: who the applicant is for THIS role. Specific, no clichés.'),
    secondary: z.string().describe('Supporting angle in one sentence.'),
    narrative: z.string().describe('2-3 sentence career story that makes this application make sense.'),
  }),
  leadWith: z.array(z.object({ point: z.string(), evidenceIds: z.array(z.string()), why: z.string() })),
  deEmphasize: z.array(z.object({ point: z.string(), why: z.string() })),
  strongestEvidence: z.array(
    z.object({
      evidenceId: z.string(),
      useIn: z.array(z.enum(['resume', 'cover_letter', 'answers', 'interview'])),
      why: z.string(),
    }),
  ),
  baseResume: z.object({
    decision: z.enum(['use_existing', 'combine', 'rebuild']),
    sourceIds: z.array(z.string()).describe('Resume source refs (A, B...) used as the base. Empty when rebuilding.'),
    rationale: z.string(),
  }),
  objections: z.array(
    z.object({
      objection: z.string().describe('What a recruiter or hiring manager may worry about.'),
      severity: z.enum(['minor', 'moderate', 'major']),
      response: z.string(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  companyPriorities: z.array(z.object({ priority: z.string(), findingIds: z.array(z.string()), howToAddress: z.string() })),
  rolePriorities: z.array(z.object({ priority: z.string(), requirementIds: z.array(z.string()), howToAddress: z.string() })),
  differentiators: z.array(z.object({ point: z.string(), evidenceIds: z.array(z.string()) })),
  coverLetter: z.object({
    angle: z.string(),
    hook: z.string().describe('Opening idea grounded in a real company fact or real applicant evidence.'),
    whyCompany: z.string(),
    whyRole: z.string(),
    whyMe: z.string(),
    whyNow: z.string(),
  }),
  resumePlan: z.object({
    summaryFocus: z.string(),
    includeSummary: z.boolean(),
    sectionOrder: z.array(z.enum(RESUME_SECTIONS)),
    experienceOrder: z.array(z.string()).describe('Experience refs (X1...) in the order they should appear.'),
    keywordsToCover: z.array(z.object({ term: z.string(), evidenceIds: z.array(z.string()) })).describe('Job keywords the applicant can truthfully support.'),
    keywordsNotSupported: z.array(z.string()).describe('Job keywords the Career Brain does NOT support. These must not be added.'),
  }),
  risks: z.array(z.string()),
  questionsForApplicant: z
    .array(z.object({ question: z.string(), why: z.string() }))
    .describe('Specific facts the applicant could add that would strengthen this application. Empty if none.'),
});
export type Strategy = z.infer<typeof StrategySchema>;
