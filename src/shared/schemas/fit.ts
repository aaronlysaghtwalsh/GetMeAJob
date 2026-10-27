import { z } from 'zod/v4';
import { TIERS, FIT_DIMENSIONS } from '../constants';
export { FIT_DIMENSIONS, FIT_DIMENSION_LABEL, type FitDimension } from '../constants';

const concern = z.object({
  concern: z.string(),
  severity: z.enum(['minor', 'moderate', 'major', 'dealbreaker']),
  response: z.string().describe('How the applicant can credibly address it, using real evidence. Say so plainly if it cannot be addressed.'),
  evidenceIds: z.array(z.string()),
});

export const FitSchema = z.object({
  verdict: z.object({
    tier: z.enum(TIERS),
    headline: z.string().describe('One honest sentence a good recruiter friend would say.'),
    rationale: z.string().describe('3-5 sentences explaining the tier.'),
  }),
  dimensions: z.array(
    z.object({
      key: z.enum(FIT_DIMENSIONS),
      score: z.number().int().describe('0-100. Use 50 with basis "unknown" when there is no information.'),
      basis: z.enum(['evidence', 'preference', 'unknown']),
      assessment: z.string().describe('One or two sentences. Name the evidence.'),
      evidenceIds: z.array(z.string()),
    }),
  ),
  requirementMatches: z.array(
    z.object({
      requirementId: z.string().describe('R1, R2... from the job.'),
      status: z.enum(['strong', 'partial', 'transferable', 'gap', 'unknown']),
      evidenceIds: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
  strengths: z.array(z.object({ point: z.string(), evidenceIds: z.array(z.string()) })),
  gaps: z.array(
    z.object({
      point: z.string(),
      severity: z.enum(['minor', 'moderate', 'major', 'dealbreaker']),
      mitigation: z.string(),
    }),
  ),
  recruiterView: z.object({
    firstImpression: z.string().describe('What a recruiter notices in a 10-second scan.'),
    wouldAdvance: z.enum(['yes', 'maybe', 'no']),
    reasoning: z.string(),
    concerns: z.array(concern),
  }),
  hiringManagerView: z.object({
    canDoTheWork: z.enum(['yes', 'likely', 'uncertain', 'unlikely']),
    reasoning: z.string(),
    concerns: z.array(concern),
  }),
  atsView: z.object({
    risk: z.enum(['low', 'medium', 'high']),
    notes: z.string(),
  }),
  competitiveness: z.object({
    level: z.enum(['strong', 'competitive', 'long_shot']),
    reasoning: z.string().describe('Relative to the likely applicant pool. Never claim certainty about outcomes.'),
  }),
  effort: z.object({
    researchMinutes: z.number().int(),
    resumeMinutes: z.number().int(),
    coverLetterMinutes: z.number().int(),
    questionsMinutes: z.number().int(),
    notes: z.string(),
  }),
  alternativeRoles: z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .describe('Role types where this applicant may be a stronger match, if any. Empty if not relevant.'),
});
export type Fit = z.infer<typeof FitSchema>;

export interface FitGuardrail {
  rule: string;
  severity: 'warning' | 'blocker';
  message: string;
}

export interface FitContent extends Fit {
  scores: {
    overall: number;
    requirementCoverage: number;
    requiredCoverage: number;
    dimensions: Record<string, number>;
  };
  guardrails: FitGuardrail[];
  /** Tier after deterministic guardrails (may be lower than the model's tier). */
  finalTier: Fit['verdict']['tier'];
  effortMinutes: number;
}
