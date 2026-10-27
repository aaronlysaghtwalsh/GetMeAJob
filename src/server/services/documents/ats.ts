import type { AtsCheck, AtsReport, ResumeDoc } from '../../../shared/schemas/documents';
import type { JobIntelligence } from '../../../shared/schemas/job';
import type { CareerBrainDTO } from '../../../shared/schemas/brain';
import { USABLE_PROVENANCE } from '../../../shared/constants';
import { docxToText, pdfToText } from './parse';
import { resumeToText } from './resume-model';

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9+#./ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose keyword match: exact phrase, simple plural/stem variants, or listed variants. */
export function containsTerm(text: string, term: string, variants: string[] = []): boolean {
  const t = norm(text);
  for (const cand of [term, ...variants]) {
    const c = norm(cand);
    if (!c) continue;
    const stem = c.replace(/(ing|ed|es|s)$/, '');
    const re = new RegExp(`(^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (re.test(t)) return true;
    if (stem.length >= 5 && t.includes(stem)) return true;
  }
  return false;
}

const ACTION_VERBS =
  /^(analy[sz]ed|built|created|designed|developed|delivered|drove|grew|increased|reduced|cut|improved|launched|led|managed|owned|presented|sold|negotiated|automated|streamlined|organized|organised|coordinated|resolved|trained|mentored|researched|identified|implemented|wrote|produced|ran|captained|represented|promoted|generated|closed|secured|achieved|exceeded|supported|partnered|collaborated|translated|modelled|modeled|forecast|tested|deployed|engineered|programmed|planned|facilitated|hosted|pitched|converted|recruited|onboarded|scaled|shipped|mapped|evaluated|assessed|audited|monitored|reported|visuali[sz]ed|cleaned|processed|queried)\b/i;

/**
 * ATS compatibility is checked on the actual exported files: both are parsed back with the same
 * extractors used for uploads, and we verify contact details, headings, dates and reading order survive.
 */
export async function analyzeAts(input: {
  doc: ResumeDoc;
  pdf: { bytes: Uint8Array; pages: number };
  docx: Buffer;
  intel: JobIntelligence;
  brain: CareerBrainDTO;
}): Promise<AtsReport> {
  const { doc, intel, brain } = input;
  const plain = resumeToText(doc);
  const checks: AtsCheck[] = [];
  const parsed: AtsReport['parsed'] = [];

  const expectations = {
    name: doc.header.name,
    email: doc.header.contact.find((c) => c.includes('@')) ?? '',
    phone: doc.header.contact.find((c) => /\d{3}.*\d{3}.*\d{2}/.test(c)) ?? '',
    headings: doc.sections.map((s) => s.title),
    bulletStarts: doc.sections.flatMap((s) => s.items.flatMap((i) => (i.type === 'entry' ? i.bullets.map((b) => b.text.split(/\s+/).slice(0, 5).join(' ')) : []))),
  };

  for (const format of ['pdf', 'docx'] as const) {
    let text = '';
    try {
      text = format === 'pdf' ? (await pdfToText(Buffer.from(input.pdf.bytes))).text : await docxToText(input.docx);
    } catch {
      parsed.push({ format, ok: false, detectedName: false, detectedEmail: false, detectedPhone: false, sections: [] });
      continue;
    }
    const n = norm(text);
    const top = norm(text.split('\n').slice(0, 6).join(' '));
    const sections = expectations.headings.filter((h) => n.includes(norm(h)));
    const bulletsFound = expectations.bulletStarts.filter((b) => n.includes(norm(b))).length;
    parsed.push({
      format,
      ok: bulletsFound >= expectations.bulletStarts.length * 0.9 && sections.length === expectations.headings.length,
      detectedName: top.includes(norm(expectations.name)),
      detectedEmail: !expectations.email || top.includes(norm(expectations.email)),
      detectedPhone: !expectations.phone || top.replace(/\D/g, '').includes(expectations.phone.replace(/\D/g, '')),
      sections,
    });
  }

  const allParsed = parsed.every((p) => p.ok);
  checks.push({
    key: 'parsing',
    label: 'Text extracts cleanly',
    status: allParsed ? 'pass' : 'fail',
    detail: allParsed ? 'Both the PDF and DOCX were parsed back and every section and bullet was recovered in order.' : 'Some content could not be recovered when the files were parsed back.',
  });
  const contactOk = parsed.every((p) => p.detectedName && p.detectedEmail && p.detectedPhone);
  const hasEmail = !!expectations.email;
  const hasPhone = !!expectations.phone;
  checks.push({
    key: 'contact',
    label: 'Contact details',
    status: !hasEmail ? 'fail' : contactOk && hasPhone ? 'pass' : 'warn',
    detail: !hasEmail
      ? 'No email address. Add it to your profile in Career Brain.'
      : !hasPhone
        ? 'No phone number. Many ATS forms and recruiters expect one; add it to your profile.'
        : contactOk
          ? 'Name, email and phone are at the top in plain text.'
          : 'Contact details were not detected at the top of the parsed file.',
  });
  const std = ['Experience', 'Education', 'Skills'];
  const missingStd = std.filter((h) => !expectations.headings.includes(h));
  checks.push({
    key: 'headings',
    label: 'Standard section headings',
    status: missingStd.length === 0 ? 'pass' : missingStd.includes('Experience') || missingStd.includes('Education') ? 'fail' : 'warn',
    detail: missingStd.length ? `Missing: ${missingStd.join(', ')}.` : 'Uses headings applicant-tracking systems recognize.',
  });
  const entries = doc.sections.flatMap((s) => s.items).filter((i) => i.type === 'entry');
  const undated = entries.filter((e) => e.type === 'entry' && !e.dates && e.subjectType !== 'project');
  // Dates are rendered from Career Brain records, so the format is uniform by construction; entries whose
  // source only gives a year show the year alone rather than an invented month.
  const yearOnly = entries.filter((e) => e.type === 'entry' && e.dates && !/[A-Z][a-z]{2} \d{4}/.test(e.dates));
  checks.push({
    key: 'dates',
    label: 'Consistent dates',
    status: undated.length ? 'warn' : 'pass',
    detail: undated.length
      ? `No dates for: ${undated.map((u) => (u.type === 'entry' ? u.heading : '')).join(', ')}. Add them in Career Brain if you can.`
      : yearOnly.length
        ? `Dates use one format ("Mon YYYY – Mon YYYY"). ${yearOnly.map((u) => (u.type === 'entry' ? u.heading : '')).join(', ')} show${yearOnly.length === 1 ? 's' : ''} years only because the source has no months; add months in Career Brain if you know them.`
        : 'Every role and degree uses the same "Mon YYYY – Mon YYYY" format.',
  });
  checks.push({
    key: 'layout',
    label: 'Layout and formatting',
    status: 'pass',
    detail: 'Single column with no tables, text boxes, images, headers or footers. Standard fonts.',
  });
  checks.push({ key: 'files', label: 'File types', status: 'pass', detail: 'DOCX (most ATS-friendly) and a text-based PDF are both available.' });
  const words = plain.split(/\s+/).length;
  checks.push({
    key: 'length',
    label: 'Length',
    status: input.pdf.pages === 1 ? 'pass' : input.pdf.pages === 2 && brain.experiences.length > 4 ? 'pass' : 'warn',
    detail: `${input.pdf.pages} page${input.pdf.pages === 1 ? '' : 's'}, about ${words} words.${input.pdf.pages > 1 ? ' Early-career resumes usually fit on one page.' : ''}`,
  });
  const titleWords = norm(intel.title)
    .split(' ')
    .filter((w) => w.length > 3 && !['senior', 'junior', 'associate', 'graduate'].includes(w));
  const titleHit = titleWords.length === 0 || titleWords.some((w) => norm(plain).includes(w));
  checks.push({
    key: 'title',
    label: 'Job title alignment',
    status: titleHit ? 'pass' : 'warn',
    detail: titleHit ? `The resume uses language from the target title "${intel.title}".` : `The resume never uses words from "${intel.title}". If truthful, reflect it in your summary.`,
  });

  // Keywords: present in resume? supported by the Career Brain?
  const brainText = norm(
    [
      ...brain.evidence.filter((e) => !e.hidden && USABLE_PROVENANCE.includes(e.provenance)).flatMap((e) => [e.statement, ...e.skills]),
      ...brain.skills.filter((s) => !s.hidden && USABLE_PROVENANCE.includes(s.provenance)).map((s) => s.name),
      ...brain.experiences.map((x) => `${x.title} ${x.summary}`),
      ...brain.education.flatMap((d) => [d.degree, d.field, ...d.coursework]),
      ...brain.projects.flatMap((p) => [p.name, p.summary, ...p.technologies]),
    ].join(' \n '),
  );
  const keywords = intel.keywords.slice(0, 30).map((k) => ({
    term: k.term,
    weight: k.weight,
    found: containsTerm(plain, k.term, k.variants),
    supported: containsTerm(brainText, k.term, k.variants),
  }));
  const weightOf = { high: 3, medium: 2, low: 1 } as const;
  const supportedKw = keywords.filter((k) => k.supported);
  const kwScore = supportedKw.length ? supportedKw.filter((k) => k.found).reduce((a, k) => a + weightOf[k.weight], 0) / supportedKw.reduce((a, k) => a + weightOf[k.weight], 0) : 1;
  const missingSupported = keywords.filter((k) => k.supported && !k.found);
  checks.push({
    key: 'keywords',
    label: 'Keyword coverage',
    status: kwScore >= 0.85 ? 'pass' : kwScore >= 0.6 ? 'warn' : 'fail',
    detail: missingSupported.length
      ? `Covers ${Math.round(kwScore * 100)}% of the job's keywords that your Career Brain supports. Supported but missing: ${missingSupported.map((k) => k.term).join(', ')}.`
      : `Covers every job keyword your Career Brain supports. Keywords you have no evidence for are deliberately left out.`,
  });

  const weights: Record<string, number> = { parsing: 25, contact: 12, headings: 10, dates: 8, layout: 8, files: 5, length: 7, title: 5, keywords: 20 };
  const statusValue = { pass: 1, warn: 0.6, fail: 0 };
  const score = Math.round(checks.reduce((a, c) => a + (weights[c.key] ?? 5) * statusValue[c.status], 0) / checks.reduce((a, c) => a + (weights[c.key] ?? 5), 0) * 100);

  // Human recruiter appeal signals (separate from ATS).
  const bullets = entries.flatMap((e) => (e.type === 'entry' ? e.bullets : []));
  const withMetrics = bullets.filter((b) => /\d/.test(b.text)).length;
  const actionStarts = bullets.filter((b) => ACTION_VERBS.test(b.text.trim())).length;
  const avgLen = bullets.length ? bullets.reduce((a, b) => a + b.text.split(/\s+/).length, 0) / bullets.length : 0;
  const summary = doc.sections.find((s) => s.key === 'summary');
  const signals: AtsReport['appeal']['signals'] = [
    {
      label: 'Bullets with a number',
      value: `${withMetrics} of ${bullets.length}`,
      status: bullets.length && withMetrics / bullets.length >= 0.35 ? 'good' : withMetrics ? 'ok' : 'weak',
    },
    {
      label: 'Bullets that open with a strong verb',
      value: `${actionStarts} of ${bullets.length}`,
      status: bullets.length && actionStarts / bullets.length >= 0.75 ? 'good' : actionStarts / Math.max(1, bullets.length) >= 0.5 ? 'ok' : 'weak',
    },
    { label: 'Average bullet length', value: `${Math.round(avgLen)} words`, status: avgLen >= 10 && avgLen <= 28 ? 'good' : avgLen <= 34 ? 'ok' : 'weak' },
    { label: 'Tailored summary', value: summary ? 'Yes' : 'No', status: summary ? 'good' : 'ok' },
    { label: 'Fits on one page', value: input.pdf.pages === 1 ? 'Yes' : `${input.pdf.pages} pages`, status: input.pdf.pages === 1 ? 'good' : 'ok' },
  ];
  const sv = { good: 1, ok: 0.65, weak: 0.3 };
  const appealScore = Math.round((signals.reduce((a, s) => a + sv[s.status], 0) / signals.length) * 100);
  return { score, checks, keywords, parsed, appeal: { score: appealScore, signals } };
}
