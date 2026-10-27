/** Shared vocabulary used by server, client and AI prompts. */

export const PROVENANCE = ['verified', 'applicant_provided', 'inferred', 'unsupported'] as const;
export type Provenance = (typeof PROVENANCE)[number];
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified: 'Verified',
  applicant_provided: 'Provided by you',
  inferred: 'Inferred',
  unsupported: 'Unsupported',
};
export const PROVENANCE_HELP: Record<Provenance, string> = {
  verified: 'Quoted from one of your documents and checked against the original text.',
  applicant_provided: 'You stated or confirmed this. It can be used in applications.',
  inferred: 'A reasonable inference. Confirm it before it can appear in an application.',
  unsupported: 'Not supported by your documents or answers. It will never be used.',
};
/** Provenance levels that may appear in final application materials. */
export const USABLE_PROVENANCE: readonly Provenance[] = ['verified', 'applicant_provided'];

export const EVIDENCE_KINDS = ['achievement', 'responsibility', 'award', 'certification', 'presentation', 'leadership', 'project', 'other'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const THEMES = [
  'analytical',
  'technical',
  'customer_facing',
  'stakeholder',
  'sales',
  'leadership',
  'communication',
  'teamwork',
  'problem_solving',
  'initiative',
  'operations',
  'research',
  'creative',
] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABEL: Record<Theme, string> = {
  analytical: 'Analytical',
  technical: 'Technical',
  customer_facing: 'Customer-facing',
  stakeholder: 'Stakeholders',
  sales: 'Sales',
  leadership: 'Leadership',
  communication: 'Communication',
  teamwork: 'Teamwork',
  problem_solving: 'Problem solving',
  initiative: 'Initiative',
  operations: 'Operations',
  research: 'Research',
  creative: 'Creative',
};

export const SKILL_CATEGORIES = [
  'technical',
  'analytical',
  'tool',
  'business',
  'communication',
  'leadership',
  'sales',
  'customer',
  'industry',
  'language',
  'certification',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export const SKILL_CATEGORY_LABEL: Record<SkillCategory, string> = {
  technical: 'Technical',
  analytical: 'Analytical',
  tool: 'Software & tools',
  business: 'Business',
  communication: 'Communication',
  leadership: 'Leadership',
  sales: 'Sales',
  customer: 'Customer-facing',
  industry: 'Industry knowledge',
  language: 'Languages',
  certification: 'Certifications',
};

export const EXPERIENCE_KINDS = ['employment', 'internship', 'part_time', 'contract', 'volunteer', 'leadership', 'extracurricular', 'other'] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];
export const EXPERIENCE_KIND_LABEL: Record<ExperienceKind, string> = {
  employment: 'Employment',
  internship: 'Internship',
  part_time: 'Part-time',
  contract: 'Contract',
  volunteer: 'Volunteer',
  leadership: 'Leadership role',
  extracurricular: 'Extracurricular',
  other: 'Other',
};

export const DOCUMENT_KINDS = [
  'resume',
  'cover_letter',
  'transcript',
  'certificate',
  'linkedin',
  'portfolio',
  'project',
  'application_answers',
  'interview_notes',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  resume: 'Resume / CV',
  cover_letter: 'Cover letter',
  transcript: 'Transcript',
  certificate: 'Certificate',
  linkedin: 'LinkedIn export',
  portfolio: 'Portfolio',
  project: 'Project description',
  application_answers: 'Previous application answers',
  interview_notes: 'Interview notes',
  other: 'Other',
};

export const STAGES = [
  'discovered',
  'considering',
  'researching',
  'preparing',
  'applied',
  'recruiter_screen',
  'hiring_manager',
  'assessment',
  'interview',
  'final',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  discovered: 'Discovered',
  considering: 'Considering',
  researching: 'Researching',
  preparing: 'Preparing',
  applied: 'Applied',
  recruiter_screen: 'Recruiter screen',
  hiring_manager: 'Hiring manager',
  assessment: 'Technical / assessment',
  interview: 'Interview',
  final: 'Final round',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
/** Pipeline grouping used by the tracker board and dashboard funnel. */
export const STAGE_GROUP: Record<Stage, 'pipeline' | 'active' | 'interviewing' | 'closed'> = {
  discovered: 'pipeline',
  considering: 'pipeline',
  researching: 'pipeline',
  preparing: 'pipeline',
  applied: 'active',
  recruiter_screen: 'interviewing',
  hiring_manager: 'interviewing',
  assessment: 'interviewing',
  interview: 'interviewing',
  final: 'interviewing',
  offer: 'closed',
  accepted: 'closed',
  rejected: 'closed',
  withdrawn: 'closed',
};
export const STAGES_AFTER_APPLY: readonly Stage[] = [
  'applied',
  'recruiter_screen',
  'hiring_manager',
  'assessment',
  'interview',
  'final',
  'offer',
  'accepted',
  'rejected',
];
export const INTERVIEW_STAGES: readonly Stage[] = ['recruiter_screen', 'hiring_manager', 'assessment', 'interview', 'final', 'offer', 'accepted'];

export const TIERS = ['apply_now', 'high_priority', 'good_match', 'stretch', 'low_priority', 'do_not_apply'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = {
  apply_now: 'Apply now',
  high_priority: 'High priority',
  good_match: 'Good match',
  stretch: 'Stretch',
  low_priority: 'Low priority',
  do_not_apply: 'Do not apply',
};

export const RESEARCH_DEPTHS = ['standard', 'deep', 'maximum'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];
export const RESEARCH_DEPTH_LABEL: Record<ResearchDepth, string> = {
  standard: 'Standard',
  deep: 'Deep',
  maximum: 'Maximum',
};
export const RESEARCH_DEPTH_HELP: Record<ResearchDepth, string> = {
  standard: 'Role and company basics. Fast and cheap.',
  deep: 'Adds recent developments, strategy and industry context.',
  maximum: 'Adds team, leadership, competitors, related postings and employee signals.',
};

export const VOICES = ['direct', 'conversational', 'professional', 'analytical', 'energetic', 'technical', 'customer_focused', 'sales_oriented'] as const;
export type Voice = (typeof VOICES)[number];
export const VOICE_LABEL: Record<Voice, string> = {
  direct: 'Direct',
  conversational: 'Conversational',
  professional: 'Professional',
  analytical: 'Analytical',
  energetic: 'Energetic',
  technical: 'Technical',
  customer_focused: 'Customer-focused',
  sales_oriented: 'Sales-oriented',
};

export const ARTIFACT_KINDS = ['research', 'fit', 'strategy', 'resume', 'cover_letter', 'answer', 'review'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The per-application workflow, in order. */
export const PIPELINE_STEPS = ['job', 'research', 'fit', 'strategy', 'resume', 'cover_letter', 'questions', 'review'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export const PIPELINE_STEP_LABEL: Record<PipelineStep, string> = {
  job: 'Job',
  research: 'Research',
  fit: 'Fit',
  strategy: 'Strategy',
  resume: 'Resume',
  cover_letter: 'Cover letter',
  questions: 'Questions',
  review: 'Review',
};

export const FEEDBACK_TAGS = [
  'too_generic',
  'too_formal',
  'too_verbose',
  'not_accurate',
  'doesnt_sound_like_me',
  'wrong_emphasis',
  'missing_achievement',
  'wrong_company_understanding',
  'too_keyword_heavy',
] as const;
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export const FEEDBACK_TAG_LABEL: Record<FeedbackTag, string> = {
  too_generic: 'Too generic',
  too_formal: 'Too formal',
  too_verbose: 'Too verbose',
  not_accurate: 'Not accurate',
  doesnt_sound_like_me: "Doesn't sound like me",
  wrong_emphasis: 'Wrong emphasis',
  missing_achievement: 'Missing achievement',
  wrong_company_understanding: 'Wrong company understanding',
  too_keyword_heavy: 'Too keyword-heavy',
};

export const CONTACT_ROLES = ['recruiter', 'hiring_manager', 'referral', 'employee', 'alumni', 'other'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  recruiter: 'Recruiter',
  hiring_manager: 'Hiring manager',
  referral: 'Referral',
  employee: 'Employee',
  alumni: 'Alumni',
  other: 'Other',
};

export const WORK_MODELS = ['onsite', 'hybrid', 'remote', 'unknown'] as const;
export type WorkModel = (typeof WORK_MODELS)[number];
export const WORK_MODEL_LABEL: Record<WorkModel, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: 'Not stated',
};

/** Application questions touching these topics always require explicit human review. */
export const SENSITIVE_TOPICS = [
  'work authorization',
  'sponsorship',
  'visa',
  'salary',
  'compensation',
  'criminal',
  'conviction',
  'disability',
  'veteran',
  'gender',
  'race',
  'ethnicity',
  'sexual orientation',
  'pronoun',
  'date of birth',
  'age',
  'legal',
  'background check',
  'non-compete',
  'relocat',
];

/** Kinds of work the applicant enjoys or wants more of (preferences form). */
export const WORK_TYPES = [
  'technical',
  'analytical',
  'customer_facing',
  'sales',
  'product',
  'data',
  'security',
  'consulting',
  'operations',
  'account_management',
] as const;
export const WORK_TYPE_LABEL: Record<(typeof WORK_TYPES)[number], string> = {
  technical: 'Technical',
  analytical: 'Analytical',
  customer_facing: 'Customer-facing',
  sales: 'Sales',
  product: 'Product',
  data: 'Data',
  security: 'Security',
  consulting: 'Consulting',
  operations: 'Operations',
  account_management: 'Account management',
};

/** Dimensions scored in fit analysis. */
export const FIT_DIMENSIONS = [
  'experience',
  'skills',
  'education',
  'industry',
  'location',
  'compensation',
  'work_authorization',
  'career_preference',
] as const;
export type FitDimension = (typeof FIT_DIMENSIONS)[number];
export const FIT_DIMENSION_LABEL: Record<FitDimension, string> = {
  experience: 'Experience',
  skills: 'Skills',
  education: 'Education',
  industry: 'Industry',
  location: 'Location',
  compensation: 'Compensation',
  work_authorization: 'Work authorization',
  career_preference: 'Career preference',
};
