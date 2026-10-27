import { z } from 'zod/v4';

export const FINDING_CATEGORIES = [
  'products',
  'customers',
  'business_model',
  'strategy',
  'news',
  'culture',
  'values',
  'leadership',
  'funding',
  'competitors',
  'hiring',
  'team',
  'employee_sentiment',
  'industry',
  'other',
] as const;

/** Structured company research. Every fact must cite at least one source id (S1, S2...). */
export const ResearchSchema = z.object({
  overview: z.string().describe('3-4 plain sentences: what the company does, for whom, and how it makes money. Facts only.'),
  findings: z.array(
    z.object({
      id: z.string().describe('F1, F2, ...'),
      category: z.enum(FINDING_CATEGORIES),
      claim: z.string(),
      type: z
        .enum(['fact', 'interpretation', 'hypothesis'])
        .describe('fact = directly stated by a source; interpretation = reasonable conclusion from facts; hypothesis = plausible but uncertain.'),
      sourceIds: z.array(z.string()).describe('Source ids supporting the claim. Required for facts.'),
      date: z.string().describe('Date the fact refers to (YYYY-MM or YYYY), else empty.'),
    }),
  ),
  values: z
    .array(z.object({ value: z.string(), findingIds: z.array(z.string()) }))
    .describe('What the company appears to value, each tied to findings.'),
  teamSignals: z
    .array(z.object({ signal: z.string(), findingIds: z.array(z.string()) }))
    .describe('What the specific team/function appears to value or be working on.'),
  talkingPoints: z
    .array(z.object({ point: z.string(), findingIds: z.array(z.string()) }))
    .describe('Specific, non-generic hooks an applicant could reference credibly.'),
  openQuestions: z.array(z.string()).describe('What could not be verified and would be worth finding out.'),
});
export type Research = z.infer<typeof ResearchSchema>;

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  kind: 'web' | 'job_posting' | 'company_site' | 'user';
}

/** Stored research artifact content. */
export interface ResearchContent extends Research {
  depth: 'standard' | 'deep' | 'maximum';
  sources: ResearchSource[];
  brief: string;
  webSearchUsed: boolean;
  searches: string[];
  integrity: { downgraded: string[]; droppedSourceRefs: number };
}
