import { INTEGRITY_CHARTER, UNTRUSTED_NOTE } from '../../ai/prompts';
import { buildBrainContext, preferencesText, type RefMap } from '../brain/context';
import { FitSchema, FIT_DIMENSIONS, type Fit, type FitContent, type FitGuardrail } from '../../../shared/schemas/fit';
import { StrategySchema, type Strategy } from '../../../shared/schemas/strategy';
import type { JobIntelligence } from '../../../shared/schemas/job';
import type { ResearchContent } from '../../../shared/schemas/research';
import type { Preferences } from '../../../shared/schemas/brain';
import { TIERS, TIER_LABEL, type Tier } from '../../../shared/constants';
import { jobText, researchText, type PipelineContext, type StepOptions } from './context';

/* Fit analysis ---------------------------------------------------------------------------------------------- */

const FIT_SYSTEM = `${INTEGRITY_CHARTER}

Task: evaluate how well this applicant fits THIS job, as an experienced recruiter, the hiring manager and an ATS would. Be honest and calibrated; the applicant wants real assessments, including "do not apply".

Method:
- Judge only from the Career Brain (E/X/D/P refs) and stated preferences. Evidence labelled "inferred" is unconfirmed: you may mention it as potential, but do not count it as proven.
- requirementMatches: one entry for every requirement R#. strong = direct evidence; partial = some evidence; transferable = adjacent evidence a recruiter could accept with good framing; gap = clearly missing; unknown = not enough information either way.
- dimensions: score all eight (experience, skills, education, industry, location, compensation, work_authorization, career_preference) from 0-100. 85+ needs direct evidence. Use basis "unknown" with a neutral 50 when there is no information (e.g. salary not posted). Location/compensation/work authorization/career preference are judged against stated preferences.
- tier: apply_now = exceptional match worth prioritizing; high_priority = strong; good_match = worth applying; stretch = possible with significant gaps; low_priority = weak fit; do_not_apply = clearly incompatible (dealbreaker gaps, a work-authorization conflict, or a role type the applicant said to avoid).
- Concerns: what would make a recruiter or hiring manager hesitate, how serious it is, and how the applicant can address it with real evidence. Say plainly when something cannot be addressed.
- effort: realistic minutes to finish a high-quality application (tailoring, cover letter, the posting's questions).
- alternativeRoles: only if the evidence points to adjacent role types where the applicant would be clearly stronger.
- Never claim certainty about outcomes.
${UNTRUSTED_NOTE}`;

const STATUS_VALUE: Record<string, number> = { strong: 1, partial: 0.6, transferable: 0.45, unknown: 0.25, gap: 0 };
const DIM_WEIGHT: Record<string, number> = {
  experience: 0.22,
  skills: 0.2,
  education: 0.08,
  industry: 0.08,
  location: 0.12,
  compensation: 0.08,
  work_authorization: 0.12,
  career_preference: 0.1,
};

function mapIds(refs: RefMap, ids: string[], unknown: string[]): string[] {
  return refs.ids(ids, unknown);
}

/** Deterministic guardrails that can override the model's optimism. */
export function computeGuardrails(intel: JobIntelligence, prefs: Preferences): FitGuardrail[] {
  const out: FitGuardrail[] = [];
  const wa = prefs.workAuthorization;
  if (intel.sponsorship.stance === 'not_offered' && wa.requiresSponsorshipNow === 'yes') {
    out.push({ rule: 'sponsorship', severity: 'blocker', message: 'The posting says it does not sponsor visas, and you said you need sponsorship now.' });
  } else if (intel.sponsorship.stance === 'not_offered' && wa.requiresSponsorshipFuture === 'yes') {
    out.push({ rule: 'sponsorship_future', severity: 'warning', message: 'The posting does not offer sponsorship and you expect to need it in the future. Check before investing time.' });
  } else if (intel.sponsorship.stance !== 'offered' && wa.requiresSponsorshipNow === 'yes') {
    out.push({ rule: 'sponsorship_unclear', severity: 'warning', message: 'You need sponsorship and the posting does not say whether it is offered. Confirm with the recruiter early.' });
  }
  if (wa.authorizedToWork === 'no' && intel.sponsorship.stance !== 'offered') {
    out.push({ rule: 'authorization', severity: 'warning', message: `You said you are not authorized to work in ${wa.country}; this role does not mention sponsorship.` });
  }
  const title = intel.title.toLowerCase();
  const avoided = prefs.avoidRoles.find((r) => r.trim() && title.includes(r.trim().toLowerCase()));
  if (avoided) out.push({ rule: 'avoid_role', severity: 'warning', message: `The title matches a role type you want to avoid ("${avoided}").` });
  const min = prefs.compensation.minimum;
  if (min && intel.salary.max > 0 && intel.salary.period === prefs.compensation.period && intel.salary.max < min) {
    out.push({ rule: 'compensation', severity: 'warning', message: `The top of the posted range (${intel.salary.max.toLocaleString()}) is below your minimum (${min.toLocaleString()}).` });
  }
  if ((intel.seniority === 'senior' || intel.seniority === 'lead') && prefs.seniority.length && prefs.seniority.every((s) => ['internship', 'entry', 'associate'].includes(s))) {
    out.push({ rule: 'seniority', severity: 'warning', message: `This is a ${intel.seniority}-level role; you are targeting earlier-career roles.` });
  }
  if (intel.workModel === 'onsite' && prefs.workModels.length && !prefs.workModels.includes('onsite')) {
    out.push({ rule: 'work_model', severity: 'warning', message: 'This role is on-site and you did not select on-site work.' });
  }
  if (intel.workModel !== 'remote' && intel.location && prefs.locations.length && prefs.openToRelocation === 'no') {
    const loc = intel.location.toLowerCase();
    const ok = prefs.locations.some((l) => {
      const city = l.split(',')[0].trim().toLowerCase();
      return city && loc.includes(city);
    });
    if (!ok) out.push({ rule: 'location', severity: 'warning', message: `The role is in ${intel.location}, outside your locations, and you are not open to relocation.` });
  }
  return out;
}

export async function analyzeFit(ctx: PipelineContext, intel: JobIntelligence, research: ResearchContent | null, opts: StepOptions): Promise<FitContent> {
  const { app, userId, brain, prefs, job } = ctx;
  const bc = buildBrainContext(brain, 'all');
  const raw = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'fit',
    purpose: `Fit analysis: ${intel.title} at ${intel.company}`,
    context: `${bc.text}\n\n${preferencesText(prefs)}`,
    system: FIT_SYSTEM,
    prompt: `${jobText(job, intel, { includeRaw: false })}\n\n${researchText(research)}\n\nEvaluate the fit.${opts.guidance ? `\n\nApplicant's note: ${opts.guidance}` : ''}`,
    schema: FitSchema,
    schemaName: 'fit_analysis',
    signal: opts.signal,
  });
  return finalizeFit(raw, bc.refs, intel, prefs);
}

export function finalizeFit(raw: Fit, refs: RefMap, intel: JobIntelligence, prefs: Preferences): FitContent {
  const unknown: string[] = [];
  const fit: Fit = {
    ...raw,
    dimensions: FIT_DIMENSIONS.map((key) => {
      const d = raw.dimensions.find((x) => x.key === key);
      return d
        ? { ...d, score: Math.max(0, Math.min(100, Math.round(d.score))), evidenceIds: mapIds(refs, d.evidenceIds, unknown) }
        : { key, score: 50, basis: 'unknown' as const, assessment: 'Not assessed.', evidenceIds: [] };
    }),
    requirementMatches: intel.requirements.map((req) => {
      const m = raw.requirementMatches.find((x) => x.requirementId.toUpperCase() === req.id);
      return m ? { ...m, requirementId: req.id, evidenceIds: mapIds(refs, m.evidenceIds, unknown) } : { requirementId: req.id, status: 'unknown' as const, evidenceIds: [], explanation: 'Not assessed.' };
    }),
    strengths: raw.strengths.map((s) => ({ ...s, evidenceIds: mapIds(refs, s.evidenceIds, unknown) })),
    recruiterView: { ...raw.recruiterView, concerns: raw.recruiterView.concerns.map((c) => ({ ...c, evidenceIds: mapIds(refs, c.evidenceIds, unknown) })) },
    hiringManagerView: { ...raw.hiringManagerView, concerns: raw.hiringManagerView.concerns.map((c) => ({ ...c, evidenceIds: mapIds(refs, c.evidenceIds, unknown) })) },
  };

  let wSum = 0;
  let vSum = 0;
  let rwSum = 0;
  let rvSum = 0;
  for (const m of fit.requirementMatches) {
    const req = intel.requirements.find((r) => r.id === m.requirementId);
    const w = req?.type === 'required' ? 2 : 1;
    wSum += w;
    vSum += w * STATUS_VALUE[m.status];
    if (req?.type === 'required') {
      rwSum += 1;
      rvSum += STATUS_VALUE[m.status];
    }
  }
  const requirementCoverage = wSum ? Math.round((vSum / wSum) * 100) : 50;
  const requiredCoverage = rwSum ? Math.round((rvSum / rwSum) * 100) : requirementCoverage;
  const dims: Record<string, number> = {};
  let dimAvg = 0;
  for (const d of fit.dimensions) {
    dims[d.key] = d.score;
    dimAvg += d.score * (DIM_WEIGHT[d.key] ?? 0.1);
  }
  const overall = Math.round(0.5 * requirementCoverage + 0.5 * dimAvg);

  const guardrails = computeGuardrails(intel, prefs);
  let finalTier: Tier = fit.verdict.tier;
  if (guardrails.some((g) => g.severity === 'blocker')) finalTier = 'do_not_apply';
  if (fit.gaps.some((g) => g.severity === 'dealbreaker') && TIERS.indexOf(finalTier) < TIERS.indexOf('stretch')) finalTier = 'stretch';
  if (finalTier !== fit.verdict.tier) {
    guardrails.push({ rule: 'tier_adjusted', severity: 'warning', message: `Priority lowered from "${TIER_LABEL[fit.verdict.tier]}" to "${TIER_LABEL[finalTier]}" because of the issues above.` });
  }
  const effortMinutes = Math.max(10, fit.effort.researchMinutes + fit.effort.resumeMinutes + fit.effort.coverLetterMinutes + fit.effort.questionsMinutes);
  return { ...fit, scores: { overall, requirementCoverage, requiredCoverage, dimensions: dims }, guardrails, finalTier, effortMinutes };
}

/* Application strategy ------------------------------------------------------------------------------------------ */

const STRATEGY_SYSTEM = `${INTEGRITY_CHARTER}

Task: you are the applicant's career strategist. Before any document is written, decide the optimal TRUTHFUL positioning for this specific application. Everything downstream (resume, cover letter, answers) is generated from your strategy, so be concrete.

Decide:
- positioning: the single most compelling, credible story for this role. Specific to the applicant and this employer; no clichés.
- leadWith / deEmphasize: what the reader should see first, and what would distract or invite doubt.
- strongestEvidence: the evidence items that do the most work, and where to use each.
- baseResume: compare the resumes on file (A, B...). use_existing when one already tells the right story and needs light tailoring; combine when two hold complementary strengths; rebuild when none fits well and the resume should be rebuilt from the evidence. Explain why.
- objections: likely recruiter/hiring-manager doubts and the evidence-based response to each.
- companyPriorities: what the company appears to value (cite research findings F#) and how the applicant can credibly speak to it. rolePriorities: same for requirements (R#).
- coverLetter: the angle, a specific hook grounded in a real company fact or real applicant evidence, and the why company / why role / why me / why now.
- resumePlan: whether to include a summary, section order, experience order (X refs), job keywords the applicant can truthfully cover (with evidence), and keywords the Career Brain does NOT support (these must never be added).
- questionsForApplicant: specific facts the applicant could add that would materially strengthen this application.
${UNTRUSTED_NOTE}`;

export async function buildStrategy(ctx: PipelineContext, intel: JobIntelligence, research: ResearchContent | null, fit: FitContent, opts: StepOptions): Promise<Strategy> {
  const { app, userId, brain, prefs, job } = ctx;
  const bc = buildBrainContext(brain, 'usable');
  const fitSummary = [
    `## Fit analysis (priority: ${TIER_LABEL[fit.finalTier]}, overall ${fit.scores.overall}/100)`,
    fit.verdict.headline,
    `Strengths: ${fit.strengths.map((s) => s.point).join('; ')}`,
    `Gaps: ${fit.gaps.map((g) => `${g.point} (${g.severity})`).join('; ')}`,
    `Recruiter concerns: ${fit.recruiterView.concerns.map((c) => c.concern).join('; ')}`,
    `Hiring manager concerns: ${fit.hiringManagerView.concerns.map((c) => c.concern).join('; ')}`,
    `Requirement status: ${fit.requirementMatches.map((m) => `${m.requirementId}=${m.status}`).join(', ')}`,
  ].join('\n');
  const raw = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'strategy',
    purpose: `Application strategy: ${intel.title} at ${intel.company}`,
    context: `${bc.text}\n\n${preferencesText(prefs)}`,
    system: STRATEGY_SYSTEM,
    prompt: `${jobText(job, intel, { includeRaw: false })}\n\n${researchText(research)}\n\n${fitSummary}\n\nDecide the application strategy.${opts.guidance ? `\n\nApplicant's direction for this strategy: ${opts.guidance}` : ''}`,
    schema: StrategySchema,
    schemaName: 'application_strategy',
    signal: opts.signal,
  });
  return finalizeStrategy(raw, bc.refs, research);
}

export function finalizeStrategy(raw: Strategy, refs: RefMap, research: ResearchContent | null): Strategy {
  const unknown: string[] = [];
  const findingIds = new Set((research?.findings ?? []).map((f) => f.id));
  const ev = (ids: string[]) => refs.ids(ids, unknown).filter((id) => id.startsWith('evd_') || id.startsWith('exp_') || id.startsWith('edu_') || id.startsWith('prj_'));
  return {
    ...raw,
    leadWith: raw.leadWith.map((l) => ({ ...l, evidenceIds: ev(l.evidenceIds) })),
    strongestEvidence: raw.strongestEvidence.map((s) => ({ ...s, evidenceId: refs.id(s.evidenceId) ?? '' })).filter((s) => s.evidenceId),
    baseResume: {
      ...raw.baseResume,
      sourceIds: refs.ids(raw.baseResume.sourceIds, unknown).filter((id) => id.startsWith('rsr_')),
      decision: raw.baseResume.decision !== 'rebuild' && refs.ids(raw.baseResume.sourceIds).filter((id) => id.startsWith('rsr_')).length === 0 ? 'rebuild' : raw.baseResume.decision,
    },
    objections: raw.objections.map((o) => ({ ...o, evidenceIds: ev(o.evidenceIds) })),
    companyPriorities: raw.companyPriorities.map((c) => ({ ...c, findingIds: c.findingIds.filter((f) => findingIds.has(f)) })),
    differentiators: raw.differentiators.map((d) => ({ ...d, evidenceIds: ev(d.evidenceIds) })),
    resumePlan: {
      ...raw.resumePlan,
      experienceOrder: refs.ids(raw.resumePlan.experienceOrder).filter((id) => id.startsWith('exp_')),
      keywordsToCover: raw.resumePlan.keywordsToCover.map((k) => ({ ...k, evidenceIds: ev(k.evidenceIds) })).filter((k) => k.evidenceIds.length > 0),
    },
  };
}
