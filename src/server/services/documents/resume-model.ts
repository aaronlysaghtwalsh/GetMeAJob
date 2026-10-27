import type { CareerBrainDTO, ProfileDTO } from '../../../shared/schemas/brain';
import type { ResumeDoc, ResumeDraft, ResumeItem } from '../../../shared/schemas/documents';
import { RESUME_SECTIONS, type ResumeSectionKey } from '../../../shared/schemas/strategy';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtYm(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return v;
}

export function fmtRange(start: string, end: string, current: boolean): string {
  const s = start ? fmtYm(start) : '';
  const e = current ? 'Present' : end ? fmtYm(end) : '';
  if (s && e) return s === e ? s : `${s} – ${e}`;
  return s || e;
}

export const SECTION_TITLE: Record<ResumeSectionKey, string> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
  leadership: 'Leadership & Activities',
};

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

export function contactLine(profile: ProfileDTO): string[] {
  return [profile.location, profile.phone, profile.email, ...profile.links.map((l) => shortUrl(l.url))].filter((x) => x && x.trim());
}

/**
 * Deterministically assemble the rendered resume. Names, titles, employers, institutions and dates
 * come from Career Brain records, never from model text, so they cannot be altered by generation.
 */
export function buildResumeDoc(draft: ResumeDraft, brain: CareerBrainDTO): ResumeDoc {
  const exp = new Map(brain.experiences.filter((x) => !x.hidden).map((x) => [x.id, x]));
  const edu = new Map(brain.education.filter((x) => !x.hidden).map((x) => [x.id, x]));
  const prj = new Map(brain.projects.filter((x) => !x.hidden).map((x) => [x.id, x]));
  const order: ResumeSectionKey[] = [];
  for (const k of [...draft.sectionOrder, ...RESUME_SECTIONS]) if (!order.includes(k)) order.push(k);

  const sections: ResumeDoc['sections'] = [];
  for (const key of order) {
    const items: ResumeItem[] = [];
    if (key === 'summary' && draft.summary.text.trim()) items.push({ type: 'text', text: draft.summary.text.trim(), evidenceIds: draft.summary.evidenceIds });
    if (key === 'experience') {
      for (const e of draft.experience) {
        const x = exp.get(e.experienceId);
        if (!x) continue;
        items.push({
          type: 'entry',
          subjectType: 'experience',
          subjectId: x.id,
          heading: x.organization,
          subheading: x.title,
          location: x.location,
          dates: fmtRange(x.startDate, x.endDate, x.isCurrent),
          bullets: e.bullets.filter((b) => b.text.trim()),
        });
      }
    }
    if (key === 'projects') {
      for (const p of draft.projects) {
        const r = prj.get(p.projectId);
        if (!r) continue;
        items.push({
          type: 'entry',
          subjectType: 'project',
          subjectId: r.id,
          heading: r.name,
          subheading: [r.role, r.context].filter(Boolean).join(', '),
          location: '',
          dates: fmtRange(r.startDate, r.endDate, false),
          bullets: p.bullets.filter((b) => b.text.trim()),
        });
      }
    }
    if (key === 'education') {
      const listed = new Set<string>();
      for (const d of draft.education) {
        const r = edu.get(d.educationId);
        if (!r || listed.has(r.id)) continue;
        listed.add(r.id);
        items.push({
          type: 'entry',
          subjectType: 'education',
          subjectId: r.id,
          heading: r.institution,
          subheading: [[r.degree, r.field].filter(Boolean).join(', '), r.minor ? `Minor in ${r.minor}` : '', r.grade].filter(Boolean).join('; '),
          location: r.location,
          dates: fmtRange(r.startDate, r.endDate, false),
          bullets: d.details.filter((b) => b.text.trim()),
        });
      }
      // Education is never silently dropped: add any degree the model omitted, without details.
      for (const r of edu.values()) {
        if (listed.has(r.id)) continue;
        items.push({
          type: 'entry',
          subjectType: 'education',
          subjectId: r.id,
          heading: r.institution,
          subheading: [[r.degree, r.field].filter(Boolean).join(', '), r.grade].filter(Boolean).join('; '),
          location: r.location,
          dates: fmtRange(r.startDate, r.endDate, false),
          bullets: [],
        });
      }
    }
    if (key === 'skills') {
      const groups = draft.skills.map((g) => ({ label: g.label.trim(), items: g.items.map((i) => i.trim()).filter(Boolean) })).filter((g) => g.items.length);
      if (groups.length) items.push({ type: 'skills', groups });
    }
    if (key === 'leadership') {
      for (const e of draft.leadership.entries) {
        const x = exp.get(e.experienceId);
        if (!x) continue;
        items.push({
          type: 'entry',
          subjectType: 'experience',
          subjectId: x.id,
          heading: x.organization,
          subheading: x.title,
          location: x.location,
          dates: fmtRange(x.startDate, x.endDate, x.isCurrent),
          bullets: e.bullets.filter((b) => b.text.trim()),
        });
      }
      for (const l of draft.leadership.lines) if (l.text.trim()) items.push({ type: 'text', text: l.text.trim(), evidenceIds: l.evidenceIds });
    }
    if (items.length) sections.push({ key, title: SECTION_TITLE[key], items });
  }
  return { header: { name: brain.profile.fullName || 'Your Name', contact: contactLine(brain.profile) }, sections };
}

/** Plain-text rendering (used for previews, keyword checks and the .txt export). */
export function resumeToText(doc: ResumeDoc): string {
  const out: string[] = [doc.header.name, doc.header.contact.join(' | '), ''];
  for (const s of doc.sections) {
    out.push(s.title.toUpperCase());
    for (const it of s.items) {
      if (it.type === 'text') out.push(it.text);
      else if (it.type === 'skills') for (const g of it.groups) out.push(`${g.label}: ${g.items.join(', ')}`);
      else {
        out.push([it.heading, it.location].filter(Boolean).join(' — '));
        out.push([it.subheading, it.dates].filter(Boolean).join(' | '));
        for (const b of it.bullets) out.push(`• ${b.text}`);
      }
    }
    out.push('');
  }
  return out.join('\n').trim();
}
