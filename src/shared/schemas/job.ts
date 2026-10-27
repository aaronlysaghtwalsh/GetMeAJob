import { z } from 'zod/v4';

/** Structured Job Intelligence Profile extracted from a posting. */
export const JobIntelligenceSchema = z.object({
  title: z.string(),
  company: z.string(),
  team: z.string().describe('Team / department if stated, else empty.'),
  location: z.string(),
  workModel: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
  employmentType: z.string().describe('Full-time, internship, contract... or empty.'),
  seniority: z.enum(['internship', 'entry', 'associate', 'mid', 'senior', 'lead', 'unknown']),
  salary: z.object({
    text: z.string().describe('Salary/compensation exactly as written, or empty.'),
    min: z.number().describe('Minimum in the stated period (per year or per hour), 0 if not stated.'),
    max: z.number().describe('Maximum in the stated period, 0 if not stated.'),
    currency: z.string(),
    period: z.enum(['year', 'hour', 'unknown']),
  }),
  summary: z.string().describe('Two plain sentences: what this person will actually do and for whom.'),
  responsibilities: z.array(z.object({ text: z.string(), importance: z.enum(['core', 'secondary']) })),
  requirements: z.array(
    z.object({
      id: z.string().describe('R1, R2, ... in order.'),
      text: z.string().describe('The requirement, close to the original wording.'),
      type: z.enum(['required', 'preferred']),
      category: z.enum(['experience', 'skill', 'education', 'certification', 'language', 'work_authorization', 'location', 'other']),
      keywords: z.array(z.string()).describe('Exact terms an ATS would match for this requirement.'),
    }),
  ),
  skills: z.object({
    technical: z.array(z.string()),
    tools: z.array(z.string()),
    soft: z.array(z.string()),
    domain: z.array(z.string()),
  }),
  education: z.string().describe('Education requirement as stated, or empty.'),
  experienceYears: z.string().describe('Years of experience as stated, e.g. "0-2 years", or empty.'),
  customerFacing: z.object({
    level: z.enum(['none', 'some', 'heavy']),
    basis: z.string().describe('What in the posting indicates this.'),
  }),
  travel: z.string(),
  sponsorship: z.object({
    stance: z.enum(['offered', 'not_offered', 'not_mentioned', 'unclear']),
    quote: z.string().describe('Exact posting text about sponsorship / work authorization, or empty.'),
  }),
  startDate: z.string(),
  deadline: z.string(),
  keywords: z.array(
    z.object({
      term: z.string(),
      weight: z.enum(['high', 'medium', 'low']).describe('How central the term is (repetition, placement in requirements).'),
      variants: z.array(z.string()).describe('Common equivalent phrasings an ATS might also accept.'),
    }),
  ),
  screeningCriteria: z.array(z.object({ criterion: z.string(), why: z.string() })).describe('Likely knockout filters a recruiter or ATS applies first.'),
  coreCompetencies: z.array(z.string()),
  hiddenPriorities: z
    .array(
      z.object({
        insight: z.string(),
        basis: z.string().describe('What wording in the posting supports this reading.'),
        confidence: z.enum(['low', 'medium', 'high']),
      }),
    )
    .describe('Interpretations of what the team really needs. These are interpretations, not facts.'),
  redFlags: z.array(z.string()).describe('Concerns about the posting itself (vague comp, commission-only, unrealistic requirements). Empty if none.'),
  companyWebsite: z.string().describe('Company website if the posting states it, else empty.'),
});
export type JobIntelligence = z.infer<typeof JobIntelligenceSchema>;

export const JobInputSchema = z.object({
  mode: z.enum(['paste', 'url']),
  text: z.string().max(60000).default(''),
  url: z.string().max(2000).default(''),
  companyName: z.string().max(200).default(''),
  companyWebsite: z.string().max(300).default(''),
  questions: z.string().max(20000).default(''),
  researchDepth: z.enum(['standard', 'deep', 'maximum']).default('deep'),
});
export type JobInput = z.infer<typeof JobInputSchema>;
