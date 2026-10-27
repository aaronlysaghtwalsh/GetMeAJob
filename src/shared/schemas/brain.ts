import { z } from 'zod/v4';
import {
  WORK_TYPES,
  DOCUMENT_KINDS,
  EVIDENCE_KINDS,
  EXPERIENCE_KINDS,
  PROVENANCE,
  SKILL_CATEGORIES,
  THEMES,
  VOICES,
  type DocumentKind,
  type EvidenceKind,
  type ExperienceKind,
  type Provenance,
  type SkillCategory,
  type Theme,
} from '../constants';
export { WORK_TYPES, WORK_TYPE_LABEL } from '../constants';

/* ------------------------------------------------------------------------------------------------
 * Stored entity shapes (API DTOs)
 * ---------------------------------------------------------------------------------------------- */

export type EvidenceSource =
  | { type: 'document'; documentId: string; quote: string; verified: boolean }
  | { type: 'answer'; questionId: string; excerpt: string }
  | { type: 'manual'; note?: string }
  | { type: 'confirmation'; at: string };

export interface MetricDTO {
  value: string;
  unit: string;
  context: string;
}

export interface ProfileDTO {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  links: { label: string; url: string }[];
  updatedAt: string;
}

export interface ExperienceDTO {
  id: string;
  kind: ExperienceKind;
  organization: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  employmentType: string;
  summary: string;
  provenance: Provenance;
  sources: EvidenceSource[];
  sortOrder: number;
  hidden: boolean;
}

export interface EducationDTO {
  id: string;
  institution: string;
  degree: string;
  field: string;
  minor: string;
  location: string;
  startDate: string;
  endDate: string;
  grade: string;
  coursework: string[];
  honors: string[];
  provenance: Provenance;
  sources: EvidenceSource[];
  sortOrder: number;
  hidden: boolean;
}

export interface ProjectDTO {
  id: string;
  name: string;
  context: string;
  role: string;
  startDate: string;
  endDate: string;
  url: string;
  summary: string;
  technologies: string[];
  provenance: Provenance;
  sources: EvidenceSource[];
  sortOrder: number;
  hidden: boolean;
}

export type SubjectType = 'experience' | 'education' | 'project' | 'general';

export interface EvidenceDTO {
  id: string;
  statement: string;
  kind: EvidenceKind;
  subjectType: SubjectType;
  subjectId: string | null;
  metrics: MetricDTO[];
  skills: string[];
  themes: Theme[];
  provenance: Provenance;
  sources: EvidenceSource[];
  userConfirmed: boolean;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDTO {
  id: string;
  name: string;
  category: SkillCategory;
  provenance: Provenance;
  evidenceIds: string[];
  hidden: boolean;
}

export interface DocumentDTO {
  id: string;
  kind: DocumentKind;
  label: string;
  filename: string;
  mime: string;
  size: number;
  status: 'uploaded' | 'extracting' | 'extracted' | 'analyzing' | 'analyzed' | 'failed';
  textMethod: string | null;
  textLength: number;
  error: string | null;
  includedInBrain: boolean;
  createdAt: string;
}

export interface ResumeSourceDTO {
  id: string;
  documentId: string;
  label: string;
  focus: string;
  structure: ResumeStructure;
}

export interface ResumeStructure {
  sections: {
    title: string;
    kind: 'summary' | 'experience' | 'education' | 'projects' | 'skills' | 'leadership' | 'other';
    entries: { subjectType: SubjectType; subjectId: string | null; evidenceIds: string[] }[];
  }[];
}

export interface QuestionDTO {
  id: string;
  question: string;
  rationale: string;
  category: string;
  priority: number;
  targetType: string;
  targetId: string | null;
  answerType: 'text' | 'yes_no' | 'number' | 'choice' | 'date';
  choices: string[];
  status: 'open' | 'answered' | 'skipped' | 'dismissed';
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface CareerBrainDTO {
  profile: ProfileDTO;
  experiences: ExperienceDTO[];
  education: EducationDTO[];
  projects: ProjectDTO[];
  evidence: EvidenceDTO[];
  skills: SkillDTO[];
  resumeSources: ResumeSourceDTO[];
  stats: { evidence: number; verified: number; applicantProvided: number; inferred: number; withMetrics: number };
}

/* ------------------------------------------------------------------------------------------------
 * AI output: per-document extraction
 * Every factual item carries a verbatim quote that the server verifies against the document text.
 * ---------------------------------------------------------------------------------------------- */

const quote = z
  .string()
  .describe('Exact text copied character-for-character from the document that supports this item. Keep it short (under 300 characters). Never paraphrase.');
const dateStr = z.string().describe('Date as YYYY-MM or YYYY. Empty string if not stated. Never guess.');

export const MetricSchema = z.object({
  value: z.string().describe('The number exactly as written in the source, e.g. "300,000" or "50+" or "20%".'),
  unit: z.string().describe('What is counted, e.g. "rows", "customers", "percent". Empty if none.'),
  context: z.string().describe('Short phrase explaining what the number measures.'),
});

export const ExtractionSchema = z.object({
  documentType: z.enum(DOCUMENT_KINDS).describe('What kind of document this is.'),
  person: z.object({
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    headline: z.string().describe('Professional headline or tagline if the document states one, else empty.'),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
  experiences: z.array(
    z.object({
      ref: z.string().describe('Local reference: X1, X2, ...'),
      kind: z.enum(EXPERIENCE_KINDS),
      organization: z.string(),
      title: z.string(),
      location: z.string(),
      startDate: dateStr,
      endDate: dateStr,
      isCurrent: z.boolean().describe('True only if the document says Present/Current/ongoing.'),
      employmentType: z.string().describe('Full-time, part-time, contract, seasonal... if stated, else empty.'),
      summary: z.string().describe('One neutral sentence describing the role/organization using only document facts, or empty.'),
      quote,
    }),
  ),
  education: z.array(
    z.object({
      ref: z.string().describe('Local reference: D1, D2, ...'),
      institution: z.string(),
      degree: z.string(),
      field: z.string(),
      minor: z.string(),
      location: z.string(),
      startDate: dateStr,
      endDate: dateStr,
      grade: z.string().describe('GPA / classification exactly as stated, else empty.'),
      coursework: z.array(z.string()),
      honors: z.array(z.string()),
      quote,
    }),
  ),
  projects: z.array(
    z.object({
      ref: z.string().describe('Local reference: P1, P2, ...'),
      name: z.string(),
      context: z.string().describe('Where the project happened, e.g. "Final-year project, Riverbend University". Empty if unknown.'),
      role: z.string(),
      startDate: dateStr,
      endDate: dateStr,
      url: z.string(),
      summary: z.string(),
      technologies: z.array(z.string()).describe('Only technologies the document names for this project.'),
      quote,
    }),
  ),
  evidence: z.array(
    z.object({
      statement: z
        .string()
        .describe('A clean factual statement of what the person did and the result, using ONLY information in the quote. No added adjectives, numbers or outcomes.'),
      quote,
      kind: z.enum(EVIDENCE_KINDS),
      themes: z.array(z.enum(THEMES)).describe('Themes this evidence demonstrates.'),
      subjectRef: z.string().describe('Ref of the experience/education/project this belongs to (X1, D1, P1) or empty for general items.'),
      metrics: z.array(MetricSchema).describe('Every number in the quote that measures scale or impact.'),
      skills: z.array(z.string()).describe('Skills or tools explicitly named or directly demonstrated in the quote.'),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string().describe('Canonical skill name, e.g. "Power BI", "Python", "Client relationship management".'),
      category: z.enum(SKILL_CATEGORIES),
      quote,
    }),
  ),
  resume: z
    .object({
      isResume: z.boolean(),
      focus: z.string().describe('If this is a resume: one sentence on what it emphasizes (e.g. "Data analytics focus, leads with internship"). Else empty.'),
      sections: z.array(
        z.object({
          title: z.string().describe('Section heading as written.'),
          kind: z.enum(['summary', 'experience', 'education', 'projects', 'skills', 'leadership', 'other']),
          subjectRefs: z.array(z.string()).describe('Refs (X/D/P) appearing in this section, in order.'),
        }),
      ),
    })
    .describe('How this resume is organized. Used to compare multiple resumes.'),
  notes: z.array(z.string()).describe('Ambiguities or gaps you noticed (missing dates, unclear titles, etc.).'),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/* ------------------------------------------------------------------------------------------------
 * AI output: consolidation of several extractions into the Career Brain
 * ---------------------------------------------------------------------------------------------- */

const cluster = z.object({
  refs: z.array(z.string()).describe('New item refs (e.g. "D1.X1", "D2.X3") that describe the same real-world item.'),
  existingId: z.string().describe('Id of the matching item already in the Career Brain, or empty string if this is new.'),
  preferredRef: z.string().describe('Which new ref has the most accurate/complete details. Empty if refs is empty.'),
});

export const MergePlanSchema = z.object({
  experienceClusters: z.array(cluster),
  educationClusters: z.array(cluster),
  projectClusters: z.array(cluster),
  evidenceClusters: z.array(
    cluster.extend({
      mergedStatement: z
        .string()
        .describe('Optional single statement combining details from all refs in the cluster. Use ONLY facts present in their quotes. Empty to keep the preferred statement.'),
    }),
  ),
  conflicts: z.array(
    z.object({
      topic: z.string().describe('Short label, e.g. "Campus Rec end date".'),
      detail: z.string().describe('What differs between the documents.'),
      question: z.string().describe('A direct question asking the applicant which version is correct.'),
      targetRef: z.string().describe('The new ref or existing id the conflict concerns.'),
      field: z.enum(['organization', 'title', 'startDate', 'endDate', 'location', 'degree', 'grade', 'metric', 'other']),
      options: z.array(z.string()).describe('The competing values exactly as each document states them, e.g. ["May 2025", "2024"]. The applicant can pick one or write the correct value.'),
    }),
  ),
});
export type MergePlan = z.infer<typeof MergePlanSchema>;

/* ------------------------------------------------------------------------------------------------
 * AI output: discovery interview planning
 * ---------------------------------------------------------------------------------------------- */

export const DISCOVERY_CATEGORIES = [
  'achievement',
  'metric',
  'responsibility',
  'customer',
  'stakeholder',
  'sales',
  'leadership',
  'technical',
  'project',
  'presentation',
  'challenge',
  'goals',
  'preferences',
  'work_authorization',
  'availability',
  'conflict',
] as const;

export const DiscoveryPlanSchema = z.object({
  summary: z.string().describe('Two sentences: what the Career Brain already shows well, and what is missing.'),
  readyForApplications: z.boolean().describe('True if background evidence is strong enough to build good applications now.'),
  questions: z.array(
    z.object({
      question: z.string().describe('One specific question. Reference the concrete role/project by name. Ask for one thing.'),
      rationale: z.string().describe('Why answering this would materially improve applications (one sentence, addressed to the applicant).'),
      category: z.enum(DISCOVERY_CATEGORIES),
      priority: z.number().int().describe('1-100, higher = more valuable to answer first.'),
      targetRef: z.string().describe('Ref of the experience/education/project this is about (X1, D1, P1), or empty.'),
      answerType: z.enum(['text', 'yes_no', 'number', 'choice', 'date']),
      choices: z.array(z.string()).describe('Options when answerType is choice, else empty.'),
    }),
  ),
});
export type DiscoveryPlan = z.infer<typeof DiscoveryPlanSchema>;

export const AnswerIntegrationSchema = z.object({
  newEvidence: z.array(
    z.object({
      statement: z.string().describe('Factual statement using ONLY what the applicant said. Keep their numbers exactly.'),
      kind: z.enum(EVIDENCE_KINDS),
      themes: z.array(z.enum(THEMES)),
      subjectRef: z.string().describe('Ref (X1/D1/P1) or empty.'),
      metrics: z.array(MetricSchema),
      skills: z.array(z.string()),
      excerpt: z.string().describe('The part of the applicant answer this statement comes from, copied exactly.'),
    }),
  ),
  fieldUpdates: z.array(
    z.object({
      targetRef: z.string(),
      field: z.enum(['organization', 'title', 'startDate', 'endDate', 'isCurrent', 'location', 'degree', 'grade']),
      value: z.string().describe('New value. Dates as YYYY-MM or YYYY. isCurrent as "true"/"false".'),
    }),
  ),
  newSkills: z.array(z.object({ name: z.string(), category: z.enum(SKILL_CATEGORIES) })),
  followUp: z.string().describe('One short follow-up question if the answer was vague and a detail would clearly help, else empty.'),
});
export type AnswerIntegration = z.infer<typeof AnswerIntegrationSchema>;

/* ------------------------------------------------------------------------------------------------
 * Preferences (form data, not AI)
 * ---------------------------------------------------------------------------------------------- */

const tri = z.enum(['yes', 'no', 'unsure']);

export const PreferencesSchema = z.object({
  targetRoles: z.array(z.string().max(120)).max(30).default([]),
  avoidRoles: z.array(z.string().max(120)).max(30).default([]),
  workTypes: z.array(z.enum(WORK_TYPES)).default([]),
  seniority: z.array(z.enum(['internship', 'entry', 'associate', 'mid', 'senior'])).default([]),
  industries: z.array(z.string().max(80)).max(30).default([]),
  avoidIndustries: z.array(z.string().max(80)).max(30).default([]),
  locations: z.array(z.string().max(120)).max(20).default([]),
  workModels: z.array(z.enum(['onsite', 'hybrid', 'remote'])).default([]),
  maxCommuteMinutes: z.number().int().min(0).max(300).nullable().default(null),
  openToRelocation: z.enum(['yes', 'no', 'maybe']).default('maybe'),
  compensation: z
    .object({
      currency: z.string().max(8).default('USD'),
      period: z.enum(['year', 'hour']).default('year'),
      minimum: z.number().min(0).nullable().default(null),
      target: z.number().min(0).nullable().default(null),
      maximum: z.number().min(0).nullable().default(null),
      notes: z.string().max(500).default(''),
    })
    .default({ currency: 'USD', period: 'year', minimum: null, target: null, maximum: null, notes: '' }),
  companySizes: z.array(z.enum(['startup', 'scaleup', 'midsize', 'enterprise'])).default([]),
  companyTypes: z.array(z.enum(['public', 'private', 'nonprofit', 'government', 'academic'])).default([]),
  workAuthorization: z
    .object({
      country: z.string().max(80).default('United States'),
      authorizedToWork: tri.nullable().default(null),
      requiresSponsorshipNow: tri.nullable().default(null),
      requiresSponsorshipFuture: tri.nullable().default(null),
      visaType: z.string().max(80).default(''),
      visaExpiry: z.string().max(40).default(''),
      notes: z.string().max(1000).default(''),
    })
    .default({
      country: 'United States',
      authorizedToWork: null,
      requiresSponsorshipNow: null,
      requiresSponsorshipFuture: null,
      visaType: '',
      visaExpiry: '',
      notes: '',
    }),
  availability: z
    .object({
      availableFrom: z.string().max(40).default(''),
      latestStart: z.string().max(40).default(''),
      noticePeriod: z.string().max(80).default(''),
    })
    .default({ availableFrom: '', latestStart: '', noticePeriod: '' }),
  travel: z.enum(['none', 'occasional', 'frequent', 'any']).nullable().default(null),
  careerGoals: z.string().max(2000).default(''),
  dealbreakers: z.string().max(1000).default(''),
  writingVoice: z.enum(VOICES).default('direct'),
  writingSample: z.string().max(6000).default(''),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/* ------------------------------------------------------------------------------------------------
 * Edit payloads (user-driven changes)
 * ---------------------------------------------------------------------------------------------- */

export const ExperienceInput = z.object({
  kind: z.enum(EXPERIENCE_KINDS),
  organization: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  location: z.string().max(200).default(''),
  startDate: z.string().max(20).default(''),
  endDate: z.string().max(20).default(''),
  isCurrent: z.boolean().default(false),
  employmentType: z.string().max(60).default(''),
  summary: z.string().max(1000).default(''),
});

export const EducationInput = z.object({
  institution: z.string().trim().min(1).max(200),
  degree: z.string().max(200).default(''),
  field: z.string().max(200).default(''),
  minor: z.string().max(200).default(''),
  location: z.string().max(200).default(''),
  startDate: z.string().max(20).default(''),
  endDate: z.string().max(20).default(''),
  grade: z.string().max(100).default(''),
  coursework: z.array(z.string().max(120)).max(40).default([]),
  honors: z.array(z.string().max(200)).max(20).default([]),
});

export const ProjectInput = z.object({
  name: z.string().trim().min(1).max(200),
  context: z.string().max(200).default(''),
  role: z.string().max(200).default(''),
  startDate: z.string().max(20).default(''),
  endDate: z.string().max(20).default(''),
  url: z.string().max(500).default(''),
  summary: z.string().max(1500).default(''),
  technologies: z.array(z.string().max(80)).max(40).default([]),
});

export const EvidenceInput = z.object({
  statement: z.string().trim().min(3).max(600),
  kind: z.enum(EVIDENCE_KINDS).default('achievement'),
  subjectType: z.enum(['experience', 'education', 'project', 'general']).default('general'),
  subjectId: z.string().nullable().default(null),
  themes: z.array(z.enum(THEMES)).default([]),
  skills: z.array(z.string().max(80)).max(20).default([]),
});

export const SkillInput = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(SKILL_CATEGORIES),
});

export const ProfileInput = z.object({
  fullName: z.string().max(120).default(''),
  email: z.string().max(200).default(''),
  phone: z.string().max(60).default(''),
  location: z.string().max(120).default(''),
  headline: z.string().max(200).default(''),
  links: z.array(z.object({ label: z.string().max(60), url: z.string().max(300) })).max(10).default([]),
});

export const ProvenanceSchema = z.enum(PROVENANCE);
