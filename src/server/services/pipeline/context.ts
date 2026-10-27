import type { App } from '../../app';
import * as appRepo from '../../repos/applications';
import * as brainRepo from '../../repos/brain';
import { getPreferences } from '../../repos/preferences';
import type { CareerBrainDTO, Preferences } from '../../../shared/schemas/brain';
import type { JobIntelligence } from '../../../shared/schemas/job';
import type { ResearchContent } from '../../../shared/schemas/research';
import type { FitContent } from '../../../shared/schemas/fit';
import type { Strategy } from '../../../shared/schemas/strategy';
import type { CoverLetterContent, ResumeContent } from '../../../shared/schemas/documents';

export interface StepOptions {
  taskId?: string;
  signal?: AbortSignal;
  /** Free-text guidance from the applicant for a regeneration ("make it shorter"). */
  guidance?: string;
}

export interface PipelineContext {
  app: App;
  userId: string;
  application: appRepo.ApplicationDTO;
  job: appRepo.JobDTO;
  brain: CareerBrainDTO;
  prefs: Preferences;
}

export function loadContext(app: App, userId: string, applicationId: string): PipelineContext {
  const application = appRepo.getApplication(app.db, userId, applicationId);
  if (!application) throw new Error('Application not found');
  const job = appRepo.getJob(app.db, userId, application.jobId);
  if (!job) throw new Error('Job not found');
  return { app, userId, application, job, brain: brainRepo.getBrain(app.db, userId), prefs: getPreferences(app.db, userId) };
}

export function requireIntel(ctx: PipelineContext): JobIntelligence {
  if (!ctx.job.intelligence) throw new Error('Analyze the job first.');
  return ctx.job.intelligence;
}

export function latest(ctx: PipelineContext) {
  const { db } = ctx.app;
  return {
    research: appRepo.latestArtifact<ResearchContent>(db, ctx.userId, ctx.application.id, 'research'),
    fit: appRepo.latestArtifact<FitContent>(db, ctx.userId, ctx.application.id, 'fit'),
    strategy: appRepo.latestArtifact<Strategy>(db, ctx.userId, ctx.application.id, 'strategy'),
    resume: appRepo.latestArtifact<ResumeContent>(db, ctx.userId, ctx.application.id, 'resume'),
    coverLetter: appRepo.latestArtifact<CoverLetterContent>(db, ctx.userId, ctx.application.id, 'cover_letter'),
  };
}

/** Compact job text for prompts: the structured profile plus the original posting. */
export function jobText(job: appRepo.JobDTO, intel: JobIntelligence | null, opts: { includeRaw?: boolean } = {}): string {
  const lines: string[] = [];
  const i = intel;
  lines.push(`## Job: ${i?.title || job.title} at ${i?.company || job.companyName}`);
  if (i) {
    lines.push(`Location: ${i.location || job.location || 'not stated'} | Work model: ${i.workModel} | Seniority: ${i.seniority} | Type: ${i.employmentType || 'not stated'}`);
    if (i.team) lines.push(`Team: ${i.team}`);
    if (i.salary.text) lines.push(`Compensation: ${i.salary.text}`);
    lines.push(`Summary: ${i.summary}`);
    lines.push('Responsibilities:');
    for (const r of i.responsibilities) lines.push(`- (${r.importance}) ${r.text}`);
    lines.push('Requirements:');
    for (const r of i.requirements) lines.push(`- [${r.id}] (${r.type}, ${r.category}) ${r.text}`);
    if (i.education) lines.push(`Education: ${i.education}`);
    if (i.experienceYears) lines.push(`Experience: ${i.experienceYears}`);
    lines.push(`Customer-facing: ${i.customerFacing.level} (${i.customerFacing.basis})`);
    lines.push(`Sponsorship: ${i.sponsorship.stance}${i.sponsorship.quote ? ` ("${i.sponsorship.quote}")` : ''}`);
    if (i.travel) lines.push(`Travel: ${i.travel}`);
    lines.push(`Keywords: ${i.keywords.map((k) => `${k.term} (${k.weight})`).join(', ')}`);
    if (i.screeningCriteria.length) lines.push(`Likely screening criteria: ${i.screeningCriteria.map((s) => s.criterion).join('; ')}`);
    if (i.hiddenPriorities.length) lines.push(`Interpreted priorities (not facts): ${i.hiddenPriorities.map((h) => `${h.insight} [${h.confidence}]`).join('; ')}`);
  }
  if (opts.includeRaw !== false) lines.push('', '<job_posting>', job.rawText.slice(0, 30_000), '</job_posting>');
  return lines.join('\n');
}

export function researchText(r: ResearchContent | null | undefined): string {
  if (!r) return '## Company research\n(not available)';
  const lines = ['## Company research', `Overview: ${r.overview}`];
  for (const f of r.findings) lines.push(`[${f.id}] (${f.type}, ${f.category}${f.date ? `, ${f.date}` : ''}) ${f.claim}`);
  if (r.values.length) lines.push(`Apparent company values: ${r.values.map((v) => `${v.value} [${v.findingIds.join(',')}]`).join('; ')}`);
  if (r.teamSignals.length) lines.push(`Team signals: ${r.teamSignals.map((t) => `${t.signal} [${t.findingIds.join(',')}]`).join('; ')}`);
  if (r.talkingPoints.length) lines.push(`Talking points: ${r.talkingPoints.map((t) => `${t.point} [${t.findingIds.join(',')}]`).join('; ')}`);
  if (!r.webSearchUsed) lines.push('Note: research was limited to the job posting (no web search).');
  return lines.join('\n');
}
