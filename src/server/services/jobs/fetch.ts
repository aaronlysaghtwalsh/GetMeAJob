import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from '../../http/core';

/**
 * Job URL import. Uses official public job-board APIs where they exist (Greenhouse, Lever, Ashby,
 * SmartRecruiters), schema.org JobPosting data embedded for search engines, and a plain-text fallback.
 * Sites whose terms prohibit automated access are never fetched: the user pastes the text instead.
 */
export interface ImportedQuestion {
  question: string;
  required: boolean;
  limitType: 'words' | 'chars' | 'none';
  limitValue: number | null;
}

export interface FetchedJob {
  title: string;
  company: string;
  location: string;
  text: string;
  url: string;
  ats: string;
  salaryText: string;
  companyWebsite: string;
  questions: ImportedQuestion[];
}

const NO_AUTOMATION: { pattern: RegExp; name: string }[] = [
  { pattern: /(^|\.)linkedin\.com$/i, name: 'LinkedIn' },
  { pattern: /(^|\.)indeed\.[a-z.]+$/i, name: 'Indeed' },
  { pattern: /(^|\.)glassdoor\.[a-z.]+$/i, name: 'Glassdoor' },
  { pattern: /(^|\.)ziprecruiter\.com$/i, name: 'ZipRecruiter' },
  { pattern: /(^|\.)monster\.com$/i, name: 'Monster' },
  { pattern: /(^|\.)handshake\.com$|joinhandshake\.com$/i, name: 'Handshake' },
];

const USER_AGENT = 'GetMeAJob/0.1 (personal job-application assistant; single user-initiated request)';

/* SSRF protection ------------------------------------------------------------------------------------ */

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'bad_url', 'That does not look like a valid link.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'bad_url', 'Only http and https links are supported.');
  if (url.port && !['80', '443'].includes(url.port)) throw new HttpError(400, 'bad_url', 'Links with custom ports are not supported.');
  if (url.username || url.password) throw new HttpError(400, 'bad_url', 'Links with credentials are not supported.');
  const host = url.hostname;
  if (net.isIP(host) && isPrivateIp(host)) throw new HttpError(400, 'bad_url', 'Private network addresses are not allowed.');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new HttpError(400, 'bad_url', 'Private network addresses are not allowed.');
  const addrs = await dns.lookup(host, { all: true }).catch(() => {
    throw new HttpError(400, 'bad_url', `Could not resolve ${host}.`);
  });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'bad_url', 'That link points to a private network address.');
  return url;
}

async function safeFetch(raw: string, accept = 'text/html,application/json'): Promise<{ url: URL; body: string; contentType: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const resp = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept },
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
      url = await assertPublicUrl(new URL(resp.headers.get('location')!, url).toString());
      continue;
    }
    if (!resp.ok) throw new HttpError(422, 'fetch_failed', `The page returned an error (${resp.status}). Paste the job description instead.`);
    const reader = resp.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new HttpError(422, 'fetch_failed', 'That page is too large to import. Paste the job description instead.');
        }
        chunks.push(value);
      }
    }
    return { url, body: Buffer.concat(chunks).toString('utf8'), contentType: resp.headers.get('content-type') ?? '' };
  }
  throw new HttpError(422, 'fetch_failed', 'Too many redirects. Paste the job description instead.');
}

async function fetchJson(url: string): Promise<any> {
  const { body } = await safeFetch(url, 'application/json');
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(422, 'fetch_failed', 'The job board returned an unexpected response. Paste the job description instead.');
  }
}

/* HTML → text --------------------------------------------------------------------------------------- */

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', bull: '•', hellip: '…', middot: '·', trade: '™', reg: '®', copy: '©' };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|noscript|svg|head|nav|footer|form)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|h[1-6]|li|ul|ol|section|article|tr|header)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<h[1-6][^>]*>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, arr) => l || (arr[i - 1] && arr[i - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Connectors --------------------------------------------------------------------------------------------- */

function limitFrom(text: string): { limitType: 'words' | 'chars' | 'none'; limitValue: number | null } {
  const w = text.match(/(\d{2,4})\s*(?:-|\s)?words?/i);
  if (w) return { limitType: 'words', limitValue: Number(w[1]) };
  const c = text.match(/(\d{2,5})\s*(?:-|\s)?char(?:acter)?s?/i);
  if (c) return { limitType: 'chars', limitValue: Number(c[1]) };
  return { limitType: 'none', limitValue: null };
}

const STANDARD_FIELDS = /^(first name|last name|full name|name|email|phone|resume|resume\/cv|cv|cover letter|linkedin profile|website|location|address|city|preferred name)\b/i;

async function greenhouse(board: string, id: string, original: string): Promise<FetchedJob> {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}?questions=true`);
  const content = htmlToText(decodeEntities(String(data.content ?? '')));
  const questions: ImportedQuestion[] = (data.questions ?? [])
    .filter((q: any) => q?.label && !STANDARD_FIELDS.test(String(q.label).trim()))
    .filter((q: any) => (q.fields ?? []).some((f: any) => ['textarea', 'input_text'].includes(f.type)))
    .map((q: any) => ({ question: String(q.label).trim(), required: !!q.required, ...limitFrom(String(q.description ?? q.label)) }));
  return {
    title: String(data.title ?? ''),
    company: String(data.company_name ?? board),
    location: String(data.location?.name ?? ''),
    text: content,
    url: String(data.absolute_url ?? original),
    ats: 'greenhouse',
    salaryText: '',
    companyWebsite: '',
    questions,
  };
}

async function lever(company: string, id: string, original: string): Promise<FetchedJob> {
  const d = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(id)}`);
  const lists = (d.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(String(l.content ?? '')).replace(/^/gm, '')}`).join('\n\n');
  const text = [d.descriptionPlain ?? htmlToText(String(d.description ?? '')), lists, d.additionalPlain ?? ''].filter(Boolean).join('\n\n');
  const salary = d.salaryRange ? `${d.salaryRange.currency ?? ''} ${d.salaryRange.min ?? ''}–${d.salaryRange.max ?? ''} ${d.salaryRange.interval ?? ''}`.trim() : '';
  return {
    title: String(d.text ?? ''),
    company,
    location: String(d.categories?.location ?? ''),
    text,
    url: String(d.hostedUrl ?? original),
    ats: 'lever',
    salaryText: salary,
    companyWebsite: '',
    questions: [],
  };
}

async function ashby(org: string, id: string, original: string): Promise<FetchedJob> {
  const d = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`);
  const job = (d.jobs ?? []).find((j: any) => j.id === id || String(j.jobUrl ?? '').includes(id));
  if (!job) throw new HttpError(422, 'fetch_failed', 'That posting is no longer listed. Paste the job description instead.');
  return {
    title: String(job.title ?? ''),
    company: org,
    location: String(job.location ?? ''),
    text: job.descriptionPlain ?? htmlToText(String(job.descriptionHtml ?? '')),
    url: String(job.jobUrl ?? original),
    ats: 'ashby',
    salaryText: String(job.compensation?.compensationTierSummary ?? ''),
    companyWebsite: '',
    questions: [],
  };
}

async function smartRecruiters(company: string, id: string, original: string): Promise<FetchedJob> {
  const d = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`);
  const s = d.jobAd?.sections ?? {};
  const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
    .map((k) => (s[k]?.text ? `${s[k].title ?? ''}\n${htmlToText(String(s[k].text))}` : ''))
    .filter(Boolean)
    .join('\n\n');
  const loc = d.location ? [d.location.city, d.location.region, d.location.country].filter(Boolean).join(', ') : '';
  return { title: String(d.name ?? ''), company: String(d.company?.name ?? company), location: loc, text, url: original, ats: 'smartrecruiters', salaryText: '', companyWebsite: '', questions: [] };
}

function jsonLdJob(html: string): any | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
      const job = items.find((i: any) => {
        const t = i?.['@type'];
        return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
      });
      if (job) return job;
    } catch {
      /* ignore malformed blocks */
    }
  }
  return null;
}

async function generic(url: string): Promise<FetchedJob> {
  const { url: finalUrl, body } = await safeFetch(url);
  const ld = jsonLdJob(body);
  if (ld) {
    const loc = Array.isArray(ld.jobLocation) ? ld.jobLocation[0] : ld.jobLocation;
    const addr = loc?.address ?? {};
    const sal = ld.baseSalary?.value;
    const salaryText = sal ? `${ld.baseSalary.currency ?? ''} ${sal.minValue ?? sal.value ?? ''}${sal.maxValue ? `–${sal.maxValue}` : ''} ${sal.unitText ?? ''}`.trim() : '';
    return {
      title: String(ld.title ?? ''),
      company: String(ld.hiringOrganization?.name ?? ''),
      location: [addr.addressLocality, addr.addressRegion, addr.addressCountry?.name ?? addr.addressCountry].filter(Boolean).join(', ') || (ld.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''),
      text: htmlToText(String(ld.description ?? '')),
      url: finalUrl.toString(),
      ats: 'schema.org',
      salaryText,
      companyWebsite: String(ld.hiringOrganization?.sameAs ?? ''),
      questions: [],
    };
  }
  const main = body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? body;
  const text = htmlToText(main);
  if (text.length < 300) throw new HttpError(422, 'fetch_failed', 'This page loads its content with JavaScript, so it could not be read. Paste the job description instead.');
  const title = decodeEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  return { title, company: '', location: '', text: text.slice(0, 40_000), url: finalUrl.toString(), ats: 'web', salaryText: '', companyWebsite: '', questions: [] };
}

/** Identify the ATS behind a URL (exported for tests). */
export function identify(raw: string): { ats: string; parts: string[] } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (/greenhouse\.io$/.test(host)) {
    const gh = u.searchParams.get('gh_jid');
    const forBoard = u.searchParams.get('for');
    if (seg[0] === 'embed' && forBoard && u.searchParams.get('token')) return { ats: 'greenhouse', parts: [forBoard, u.searchParams.get('token')!] };
    const jobsIdx = seg.indexOf('jobs');
    if (jobsIdx > 0 && seg[jobsIdx + 1]) return { ats: 'greenhouse', parts: [seg[jobsIdx - 1], seg[jobsIdx + 1]] };
    if (gh && seg[0]) return { ats: 'greenhouse', parts: [seg[0], gh] };
  }
  if (host === 'jobs.lever.co' && seg.length >= 2) return { ats: 'lever', parts: [seg[0], seg[1]] };
  if (host === 'jobs.ashbyhq.com' && seg.length >= 2) return { ats: 'ashby', parts: [seg[0], seg[1]] };
  if (host === 'jobs.smartrecruiters.com' && seg.length >= 2) {
    const id = seg[1].match(/^(\d+)/)?.[1];
    if (id) return { ats: 'smartrecruiters', parts: [seg[0], id] };
  }
  return null;
}

/** Readable text of a public page (used for company websites when web search is unavailable). */
export async function fetchPageText(raw: string): Promise<string> {
  if (blockedSite(raw)) return '';
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const { body } = await safeFetch(url);
  const main = body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body;
  return htmlToText(main).slice(0, 20_000);
}

export function blockedSite(raw: string): string | null {
  try {
    const host = new URL(raw).hostname;
    return NO_AUTOMATION.find((b) => b.pattern.test(host))?.name ?? null;
  } catch {
    return null;
  }
}

export async function fetchJobFromUrl(raw: string, allowOutbound: boolean): Promise<FetchedJob> {
  const blocked = blockedSite(raw);
  if (blocked) {
    throw new HttpError(
      422,
      'site_not_supported',
      `${blocked} does not allow automated access, so GetMeAJob will not fetch it. Open the posting, copy the full description and paste it here instead.`,
    );
  }
  if (!allowOutbound) throw new HttpError(422, 'fetch_disabled', 'Fetching job links is disabled on this server. Paste the job description instead.');
  const id = identify(raw);
  let job: FetchedJob;
  if (id?.ats === 'greenhouse') job = await greenhouse(id.parts[0], id.parts[1], raw);
  else if (id?.ats === 'lever') job = await lever(id.parts[0], id.parts[1], raw);
  else if (id?.ats === 'ashby') job = await ashby(id.parts[0], id.parts[1], raw);
  else if (id?.ats === 'smartrecruiters') job = await smartRecruiters(id.parts[0], id.parts[1], raw);
  else job = await generic(raw);
  if (job.text.trim().length < 200) throw new HttpError(422, 'fetch_failed', 'Not enough of the job description could be read. Paste it instead.');
  return job;
}
