import { INTEGRITY_CHARTER, UNTRUSTED_NOTE, asData } from '../../ai/prompts';
import { RESEARCH_SEARCHES } from '../../ai/registry';
import * as appRepo from '../../repos/applications';
import { JobIntelligenceSchema, type JobIntelligence } from '../../../shared/schemas/job';
import { ResearchSchema, type ResearchContent, type ResearchSource } from '../../../shared/schemas/research';
import { fetchPageText } from '../jobs/fetch';
import { jobText, type PipelineContext, type StepOptions } from './context';

/* Job intelligence ------------------------------------------------------------------------------------------ */

const JOB_SYSTEM = `You are an expert recruiter and hiring analyst. Convert a job posting into a structured Job Intelligence Profile that will drive fit analysis and application writing.

Rules:
- Extract faithfully. Do not invent requirements, salary, benefits or facts that are not in the posting.
- Requirements: one entry per distinct requirement, numbered R1, R2... "Nice to have", "bonus", "preferred", "a plus" are preferred; "must", "required", "minimum", "you have" are required. If unclear, treat core qualifications as required.
- Keywords: the terms an applicant-tracking system and a recruiter would scan for: skills, tools, certifications, domain terms and job-title variants. Weight high when a term appears in requirements, the title or repeatedly.
- Salary: copy the text exactly; min/max as numbers in the stated period (do not convert hourly to annual).
- Sponsorship: classify the posting's stance and quote the exact sentence if there is one.
- hiddenPriorities: careful interpretations of what the team most needs, each with the wording it is based on and an honest confidence. These are interpretations, not facts.
- redFlags: only genuine concerns (commission-only, vague duties, unrealistic seniority for the title, missing pay where pay disclosure is legally expected). Empty if none.
${UNTRUSTED_NOTE}`;

export async function analyzeJob(ctx: PipelineContext, opts: StepOptions): Promise<JobIntelligence> {
  const { app, userId, job } = ctx;
  const intel = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'job',
    purpose: `Analyze job: ${job.title || job.companyName || 'posting'}`,
    system: JOB_SYSTEM,
    prompt: `${job.title ? `Title (from source): ${job.title}\n` : ''}${job.companyName ? `Company (from source): ${job.companyName}\n` : ''}${job.location ? `Location (from source): ${job.location}\n` : ''}${job.salaryText ? `Pay (from source): ${job.salaryText}\n` : ''}${job.sourceUrl ? `URL: ${job.sourceUrl}\n` : ''}\n${asData('job_posting', job.rawText.slice(0, 60_000))}`,
    schema: JobIntelligenceSchema,
    schemaName: 'job_intelligence',
    signal: opts.signal,
  });
  // Keep requirement ids clean and sequential (later steps reference them).
  intel.requirements = intel.requirements.map((r, i) => ({ ...r, id: `R${i + 1}` }));
  appRepo.saveJobIntelligence(app.db, userId, job.id, intel, appRepo.getCompanyWebsite(app.db, userId, job.companyId));
  ctx.job = appRepo.getJob(app.db, userId, job.id)!;
  return intel;
}

/* Company research --------------------------------------------------------------------------------------------- */

const SECTIONS: Record<'standard' | 'deep' | 'maximum', string[]> = {
  standard: [
    'Company overview: what they sell, to whom, and how they make money',
    'The role in context: what this team or function does at the company',
    'Recent developments (last 12-18 months)',
    'Culture and values as the company states them',
  ],
  deep: [
    'Company overview: what they sell, to whom, and how they make money',
    'Products and customers in more detail (segments, notable customers if public)',
    'Strategy and current priorities (from leadership statements, earnings, press releases)',
    'Recent developments: launches, acquisitions, funding, partnerships, layoffs (last 12-18 months)',
    'Industry and competitive position',
    'The role in context: what this team or function does, and what related open roles reveal about it',
    'Culture and values as the company states them',
  ],
  maximum: [
    'Company overview: what they sell, to whom, and how they make money',
    'Products and customers in detail (segments, notable public customers, pricing model)',
    'Strategy and current priorities (leadership statements, earnings calls, investor materials)',
    'Recent developments: launches, acquisitions, funding, partnerships, restructuring (last 18 months)',
    'Competitors and how the company differentiates',
    'Leadership of the relevant function or team (names and public statements only from credible sources)',
    'Related job postings and what they reveal about team growth and priorities',
    'Employee sentiment: recurring themes from public reviews or reporting, with appropriate caution',
    'Culture and values as the company states them, and evidence of how they show up',
  ],
};

const STRUCTURE_SYSTEM = `${INTEGRITY_CHARTER}

Task: convert a company research briefing into structured findings.
- Each finding is one specific, useful claim. Prefer concrete facts (products, customers, numbers, dates, named initiatives) over generic praise.
- Cite the source ids that support each finding using the [S#] markers that appear after the briefing's sentences. S0 is the job posting itself.
- type "fact" only when a cited source states it. Conclusions you draw are "interpretation" (still cite the facts behind them). Plausible but unverified ideas are "hypothesis".
- Never add information that is not in the briefing or the posting.
- talkingPoints must be specific enough that only this company could be meant.
${UNTRUSTED_NOTE}`;

function sourceKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

export async function researchCompany(ctx: PipelineContext, intel: JobIntelligence, opts: StepOptions): Promise<ResearchContent> {
  const { app, userId, job, application } = ctx;
  const depth = application.researchDepth;
  const company = intel.company || job.companyName || 'the company';
  const website = appRepo.getCompanyWebsite(app.db, userId, job.companyId) || intel.companyWebsite;
  const sources: ResearchSource[] = [{ id: 'S0', url: job.sourceUrl, title: `Job posting: ${intel.title}`, snippet: intel.summary, kind: 'job_posting' }];
  const byKey = new Map<string, ResearchSource>();
  const addSource = (url: string, title: string, snippet: string, kind: ResearchSource['kind']): string => {
    const key = sourceKey(url);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.snippet && snippet) existing.snippet = snippet.slice(0, 300);
      return existing.id;
    }
    const s: ResearchSource = { id: `S${sources.length}`, url, title: title || url, snippet: snippet.slice(0, 300), kind };
    sources.push(s);
    byKey.set(key, s);
    return s.id;
  };

  const research = await app.ai.research({
    userId,
    taskId: opts.taskId,
    purpose: `Research ${company} (${depth})`,
    system: `You are a meticulous company researcher preparing a briefing for a job applicant. Use web search to find current, credible information. Prefer primary sources (the company's website and newsroom, filings, executive interviews) and reputable publications. Note dates and prefer recent information. If you cannot find something, say so plainly; never guess. Keep what sources state separate from your own interpretation, and label interpretation as such. Write a concise briefing in markdown with these sections:\n${SECTIONS[depth].map((s) => `- ${s}`).join('\n')}`,
    prompt: `Company: ${company}${website ? ` (${website})` : ''}\nRole being applied for: ${intel.title}${intel.team ? `, ${intel.team}` : ''}, ${intel.location || job.location}\nWhat the role does: ${intel.summary}\n\nResearch the company for this application.`,
    maxSearches: RESEARCH_SEARCHES[depth],
    signal: opts.signal,
  });

  let brief = '';
  if (research.webSearchUsed) {
    for (const r of research.searchResults) addSource(r.url, r.title, '', 'web');
    brief = research.segments
      .map((seg) => {
        const ids = [...new Set(seg.citations.map((c) => addSource(c.url, c.title, c.citedText, 'web')))];
        return seg.text + (ids.length ? ` ${ids.map((i) => `[${i}]`).join('')}` : '');
      })
      .join('');
  } else {
    let siteText = '';
    if (website && app.config.allowOutboundFetch) {
      siteText = await fetchPageText(website).catch(() => '');
    }
    if (siteText) {
      const id = addSource(website, `${company} website`, siteText.slice(0, 200), 'company_site');
      brief = `Company website text [${id}]:\n${siteText.slice(0, 12_000)}`;
    } else brief = '(No web research was available. Use only the job posting, cited as S0.)';
  }

  const sourceList = sources.map((s) => `[${s.id}] ${s.title}${s.url ? ` <${s.url}>` : ''}`).join('\n');
  const structured = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'research_structure',
    purpose: `Structure research: ${company}`,
    system: STRUCTURE_SYSTEM,
    prompt: `Sources:\n${sourceList}\n\n${asData('research', brief)}\n\n${jobText(job, intel)}`,
    schema: ResearchSchema,
    schemaName: 'company_research',
    signal: opts.signal,
  });

  // Integrity: facts must cite real sources; otherwise they are downgraded.
  const valid = new Set(sources.map((s) => s.id));
  const downgraded: string[] = [];
  let dropped = 0;
  structured.findings = structured.findings.map((f, idx) => {
    const ids = f.sourceIds.map((s) => s.trim().replace(/^\[|\]$/g, '').toUpperCase()).filter((s) => {
      const ok = valid.has(s);
      if (!ok) dropped++;
      return ok;
    });
    let type = f.type;
    if (type === 'fact' && ids.length === 0) {
      type = 'hypothesis';
      downgraded.push(f.claim);
    }
    return { ...f, id: f.id || `F${idx + 1}`, sourceIds: ids, type };
  });
  const findingIds = new Set(structured.findings.map((f) => f.id));
  const keepIds = (ids: string[]) => ids.filter((i) => findingIds.has(i));
  structured.values = structured.values.map((v) => ({ ...v, findingIds: keepIds(v.findingIds) }));
  structured.teamSignals = structured.teamSignals.map((v) => ({ ...v, findingIds: keepIds(v.findingIds) }));
  structured.talkingPoints = structured.talkingPoints.map((v) => ({ ...v, findingIds: keepIds(v.findingIds) }));

  const used = new Set(structured.findings.flatMap((f) => f.sourceIds));
  used.add('S0');
  return {
    ...structured,
    depth,
    sources: sources.filter((s) => used.has(s.id) || s.kind !== 'web' || sources.length < 25),
    brief: research.text || brief,
    webSearchUsed: research.webSearchUsed,
    searches: research.queries,
    integrity: { downgraded, droppedSourceRefs: dropped },
  };
}
