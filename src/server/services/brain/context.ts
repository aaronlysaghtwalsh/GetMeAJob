import type { CareerBrainDTO, EvidenceDTO, Preferences } from '../../../shared/schemas/brain';
import { PROVENANCE_LABEL, USABLE_PROVENANCE, SKILL_CATEGORY_LABEL } from '../../../shared/constants';

/**
 * Short, stable references used inside prompts (E1, X1, D1, P1, A...) mapped to database ids.
 * Short refs are cheaper and far less error-prone for models to copy than random ids.
 */
export class RefMap {
  private toIdMap = new Map<string, string>();
  private toRefMap = new Map<string, string>();
  private counters: Record<string, number> = {};

  add(prefix: string, id: string): string {
    const existing = this.toRefMap.get(id);
    if (existing) return existing;
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
    const ref = prefix === 'A' ? String.fromCharCode(64 + this.counters[prefix]) : `${prefix}${this.counters[prefix]}`;
    this.toIdMap.set(ref.toUpperCase(), id);
    this.toRefMap.set(id, ref);
    return ref;
  }

  id(ref: string): string | undefined {
    const clean = ref.trim().replace(/^\[|\]$/g, '').toUpperCase();
    return this.toIdMap.get(clean) ?? (this.toRefMap.has(ref) ? ref : undefined);
  }

  ref(id: string): string | undefined {
    return this.toRefMap.get(id);
  }

  /** Map refs to ids, collecting unknown refs. */
  ids(refs: string[], unknown?: string[]): string[] {
    const out: string[] = [];
    for (const r of refs) {
      const id = this.id(r);
      if (id) {
        if (!out.includes(id)) out.push(id);
      } else unknown?.push(r);
    }
    return out;
  }

  entries(): [string, string][] {
    return [...this.toIdMap.entries()];
  }
}

function dateRange(start: string, end: string, current: boolean): string {
  const s = start || '?';
  const e = current ? 'present' : end || '?';
  return start || end || current ? `${s} to ${e}` : 'dates not stated';
}

function evidenceLine(e: EvidenceDTO, ref: string, showProvenance: boolean): string {
  const bits = [`[${ref}]`];
  if (showProvenance) bits.push(`(${PROVENANCE_LABEL[e.provenance].toLowerCase()})`);
  bits.push(e.statement);
  const extra: string[] = [];
  if (e.metrics.length) extra.push(`metrics: ${e.metrics.map((m) => `${m.value}${m.unit ? ` ${m.unit}` : ''}${m.context ? ` (${m.context})` : ''}`).join('; ')}`);
  if (e.skills.length) extra.push(`skills: ${e.skills.join(', ')}`);
  if (e.themes.length) extra.push(`themes: ${e.themes.join(', ')}`);
  return `  ${bits.join(' ')}${extra.length ? ` | ${extra.join(' | ')}` : ''}`;
}

export interface BrainContext {
  text: string;
  refs: RefMap;
  usableEvidence: EvidenceDTO[];
}

/**
 * Serialize the Career Brain for prompts.
 * mode "usable": only verified / applicant-provided evidence (for generation).
 * mode "all": also inferred items, clearly labelled (for analysis and discovery).
 */
export function buildBrainContext(brain: CareerBrainDTO, mode: 'usable' | 'all' = 'usable'): BrainContext {
  const refs = new RefMap();
  const allowed = (e: EvidenceDTO) => !e.hidden && e.provenance !== 'unsupported' && (mode === 'all' || USABLE_PROVENANCE.includes(e.provenance));
  const evidence = brain.evidence.filter(allowed);
  const bySubject = new Map<string, EvidenceDTO[]>();
  for (const e of evidence) {
    const key = e.subjectId ?? 'general';
    bySubject.set(key, [...(bySubject.get(key) ?? []), e]);
  }
  const lines: string[] = [];
  const p = brain.profile;
  lines.push('## Applicant');
  lines.push(`Name: ${p.fullName || '(not set)'}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);

  const exps = brain.experiences.filter((x) => !x.hidden && x.provenance !== 'unsupported');
  if (exps.length) {
    lines.push('', '## Experience (most recent first)');
    for (const x of exps) {
      const ref = refs.add('X', x.id);
      lines.push(
        `[${ref}] ${x.title} at ${x.organization} (${x.kind.replace('_', ' ')}${x.employmentType ? `, ${x.employmentType}` : ''}) | ${x.location || 'location not stated'} | ${dateRange(x.startDate, x.endDate, x.isCurrent)}`,
      );
      if (x.summary) lines.push(`  context: ${x.summary}`);
      for (const e of bySubject.get(x.id) ?? []) lines.push(evidenceLine(e, refs.add('E', e.id), mode === 'all'));
    }
  }
  const edus = brain.education.filter((d) => !d.hidden && d.provenance !== 'unsupported');
  if (edus.length) {
    lines.push('', '## Education');
    for (const d of edus) {
      const ref = refs.add('D', d.id);
      const degree = [d.degree, d.field].filter(Boolean).join(', ');
      lines.push(`[${ref}] ${degree || 'Studies'} at ${d.institution} | ${dateRange(d.startDate, d.endDate, false)}${d.grade ? ` | grade: ${d.grade}` : ''}${d.minor ? ` | minor: ${d.minor}` : ''}`);
      if (d.coursework.length) lines.push(`  coursework: ${d.coursework.join(', ')}`);
      if (d.honors.length) lines.push(`  honors: ${d.honors.join('; ')}`);
      for (const e of bySubject.get(d.id) ?? []) lines.push(evidenceLine(e, refs.add('E', e.id), mode === 'all'));
    }
  }
  const projs = brain.projects.filter((x) => !x.hidden && x.provenance !== 'unsupported');
  if (projs.length) {
    lines.push('', '## Projects');
    for (const pr of projs) {
      const ref = refs.add('P', pr.id);
      lines.push(`[${ref}] ${pr.name}${pr.context ? ` (${pr.context})` : ''}${pr.role ? ` | role: ${pr.role}` : ''} | ${dateRange(pr.startDate, pr.endDate, false)}`);
      if (pr.summary) lines.push(`  summary: ${pr.summary}`);
      if (pr.technologies.length) lines.push(`  technologies: ${pr.technologies.join(', ')}`);
      for (const e of bySubject.get(pr.id) ?? []) lines.push(evidenceLine(e, refs.add('E', e.id), mode === 'all'));
    }
  }
  const knownSubjects = new Set([...exps.map((x) => x.id), ...edus.map((d) => d.id), ...projs.map((x) => x.id)]);
  const general = evidence.filter((e) => !e.subjectId || !knownSubjects.has(e.subjectId));
  if (general.length) {
    lines.push('', '## Other evidence (not tied to a specific role)');
    for (const e of general) lines.push(evidenceLine(e, refs.add('E', e.id), mode === 'all'));
  }

  const skills = brain.skills.filter((s) => !s.hidden && s.provenance !== 'unsupported' && (mode === 'all' || USABLE_PROVENANCE.includes(s.provenance)));
  if (skills.length) {
    lines.push('', '## Skills (exact names; only these may be listed as skills)');
    const byCat = new Map<string, string[]>();
    for (const s of skills) {
      const evRefs = s.evidenceIds.map((id) => refs.ref(id)).filter(Boolean);
      byCat.set(s.category, [...(byCat.get(s.category) ?? []), `${s.name}${evRefs.length ? ` [${evRefs.join(',')}]` : ''}`]);
    }
    for (const [cat, names] of byCat) lines.push(`${SKILL_CATEGORY_LABEL[cat as keyof typeof SKILL_CATEGORY_LABEL] ?? cat}: ${names.join('; ')}`);
  }

  if (brain.resumeSources.length) {
    lines.push('', '## Resumes on file (different representations of the same applicant)');
    for (const rs of brain.resumeSources) {
      const ref = refs.add('A', rs.id);
      const sections = rs.structure.sections
        .map((s) => {
          const items = s.entries.map((en) => (en.subjectId ? refs.ref(en.subjectId) : null)).filter(Boolean);
          return `${s.title}${items.length ? ` (${items.join(', ')})` : ''}`;
        })
        .join(' > ');
      lines.push(`[${ref}] "${rs.label}"${rs.focus ? ` | emphasis: ${rs.focus}` : ''}${sections ? ` | order: ${sections}` : ''}`);
    }
  }
  return { text: lines.join('\n'), refs, usableEvidence: evidence.filter((e) => USABLE_PROVENANCE.includes(e.provenance)) };
}

export function preferencesText(p: Preferences): string {
  const lines: string[] = ['## Preferences and constraints (stated by the applicant)'];
  const list = (label: string, v: string[]) => v.length && lines.push(`${label}: ${v.join(', ')}`);
  list('Target roles', p.targetRoles);
  list('Roles to avoid', p.avoidRoles);
  list('Preferred kinds of work', p.workTypes.map((w) => w.replace('_', ' ')));
  list('Seniority', p.seniority);
  list('Industries of interest', p.industries);
  list('Industries to avoid', p.avoidIndustries);
  list('Locations', p.locations);
  list('Work models', p.workModels);
  if (p.maxCommuteMinutes) lines.push(`Max commute: ${p.maxCommuteMinutes} minutes`);
  lines.push(`Open to relocation: ${p.openToRelocation}`);
  const c = p.compensation;
  if (c.minimum || c.target || c.maximum) {
    const per = c.period === 'hour' ? '/hour' : '/year';
    lines.push(
      `Compensation (${c.currency}): ${[c.minimum && `minimum ${c.minimum}${per}`, c.target && `target ${c.target}${per}`, c.maximum && `upper ${c.maximum}${per}`].filter(Boolean).join(', ')}${c.notes ? ` | ${c.notes}` : ''}`,
    );
  } else lines.push('Compensation: not stated');
  list('Company size', p.companySizes);
  list('Company type', p.companyTypes);
  const w = p.workAuthorization;
  lines.push(
    `Work authorization (${w.country}): authorized to work = ${w.authorizedToWork ?? 'not stated'}; needs sponsorship now = ${w.requiresSponsorshipNow ?? 'not stated'}; needs sponsorship in future = ${w.requiresSponsorshipFuture ?? 'not stated'}${w.visaType ? `; visa: ${w.visaType}` : ''}${w.visaExpiry ? `; visa expires: ${w.visaExpiry}` : ''}${w.notes ? `; notes: ${w.notes}` : ''}`,
  );
  const a = p.availability;
  if (a.availableFrom || a.latestStart || a.noticePeriod)
    lines.push(`Availability: ${[a.availableFrom && `from ${a.availableFrom}`, a.latestStart && `latest start ${a.latestStart}`, a.noticePeriod && `notice ${a.noticePeriod}`].filter(Boolean).join(', ')}`);
  if (p.travel) lines.push(`Travel: ${p.travel}`);
  if (p.careerGoals) lines.push(`Career goals: ${p.careerGoals}`);
  if (p.dealbreakers) lines.push(`Dealbreakers: ${p.dealbreakers}`);
  return lines.join('\n');
}
