/**
 * Deterministic text utilities behind the factual-integrity engine.
 * Shared by server (verification) and client (live counts, highlighting).
 */

const CHAR_MAP: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '–': '-',
  '—': '-',
  '‒': '-',
  '‐': '-',
  '‑': '-',
  '−': '-',
  '•': ' ',
  '●': ' ',
  '▪': ' ',
  '◦': ' ',
  '‣': ' ',
  '⁃': ' ',
  '·': ' ',
  '…': '...',
  ' ': ' ',
  '​': '',
  '­': '',
  '﻿': '',
};

export function normalizeForMatch(text: string): string {
  let s = text.normalize('NFKC');
  s = s.replace(/[‘’‚‛′“”„″–—‒‐‑−•●▪◦‣⁃·… ​­﻿]/g, (c) => CHAR_MAP[c] ?? c);
  s = s.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2'); // de-hyphenate line breaks
  s = s.toLowerCase();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s+([,.;:!?)])/g, '$1').replace(/([(])\s+/g, '$1');
  return s.trim();
}

function alnumOnly(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '');
}

function tokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}%+]+/u).filter(Boolean);
}

export interface QuoteCheck {
  verified: boolean;
  method: 'exact' | 'loose' | 'fuzzy' | 'none';
}

/** Cache of normalized documents (keyed by original text) for repeated checks. */
const normCache = new Map<string, { norm: string; alnum: string; toks: string[] }>();
function prepared(doc: string) {
  let hit = normCache.get(doc);
  if (!hit) {
    const norm = normalizeForMatch(doc);
    hit = { norm, alnum: alnumOnly(norm), toks: tokens(norm) };
    if (normCache.size > 50) normCache.clear();
    normCache.set(doc, hit);
  }
  return hit;
}

/**
 * Verify that `quote` appears in `documentText`. Tolerates typography, whitespace, bullets,
 * punctuation and hyphenation differences, and small extraction gaps (≥90% of words in order).
 */
export function verifyQuote(quote: string, documentText: string): QuoteCheck {
  const q = normalizeForMatch(quote);
  if (!q || q.length < 3) return { verified: false, method: 'none' };
  const doc = prepared(documentText);
  if (doc.norm.includes(q)) return { verified: true, method: 'exact' };
  const qa = alnumOnly(q);
  if (qa.length >= 6 && doc.alnum.includes(qa)) return { verified: true, method: 'loose' };
  const qt = tokens(q);
  if (qt.length < 4) return { verified: false, method: 'none' };
  const dt = doc.toks;
  const need = Math.ceil(qt.length * 0.9);
  for (let start = 0; start < dt.length; start++) {
    if (dt[start] !== qt[0] && dt[start] !== qt[1]) continue;
    let qi = dt[start] === qt[0] ? 0 : 1;
    let matched = 0;
    let di = start;
    let gap = 0;
    while (qi < qt.length && di < dt.length && gap <= 3) {
      if (dt[di] === qt[qi]) {
        matched++;
        qi++;
        di++;
        gap = 0;
      } else if (qi + 1 < qt.length && dt[di] === qt[qi + 1]) {
        qi++; // model dropped/added a word
      } else {
        di++;
        gap++;
      }
    }
    if (matched >= need) return { verified: true, method: 'fuzzy' };
  }
  return { verified: false, method: 'none' };
}

/* ------------------------------------------------------------------------------------------------
 * Numbers
 * ---------------------------------------------------------------------------------------------- */

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  dozen: 12,
  dozens: 12,
  hundreds: 100,
  thousands: 1000,
  million: 1_000_000,
  millions: 1_000_000,
};

export interface FoundNumber {
  raw: string;
  value: number;
  percent: boolean;
}

/**
 * Find quantities in text. "300,000" → 300000, "300k" → 300000, "$1.2M" → 1200000, "20%" → 20 (percent),
 * "fifty" → 50. Numbers glued to letters (S3, Web3, H1B, Q4) are ignored as identifiers.
 */
export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  const re = /(?<![\p{L}\d.])(\$|€|£)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|bn|b|million|billion|thousand|%|percent)?(?![\p{L}\d])/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [raw, , num, suffixRaw] = m;
    const suffix = (suffixRaw ?? '').toLowerCase();
    let value = Number(num.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    let percent = false;
    if (suffix === 'k' || suffix === 'thousand') value *= 1000;
    else if (suffix === 'm' || suffix === 'million') value *= 1_000_000;
    else if (suffix === 'b' || suffix === 'bn' || suffix === 'billion') value *= 1_000_000_000;
    else if (suffix === '%' || suffix === 'percent') percent = true;
    out.push({ raw: raw.trim(), value, percent });
  }
  const wordRe = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|dozens?|millions?)\b/gi;
  while ((m = wordRe.exec(text))) {
    out.push({ raw: m[0], value: NUMBER_WORDS[m[0].toLowerCase()], percent: false });
  }
  return out;
}

/** Numbers in `claim` that are not present in any of the `support` texts. Years are matched like any number. */
export function unsupportedNumbers(claim: string, support: string[]): FoundNumber[] {
  const allowed = new Set<string>();
  for (const s of support) {
    for (const n of extractNumbers(s)) {
      allowed.add(`${n.value}|${n.percent}`);
      allowed.add(`${n.value}|any`);
    }
  }
  return extractNumbers(claim).filter((n) => !allowed.has(`${n.value}|${n.percent}`) && !(n.percent === false && allowed.has(`${n.value}|any`)));
}

/* ------------------------------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------------------------------- */

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** Normalize loose dates to YYYY-MM / YYYY / '' ("June 2023", "06/2023", "2023-6", "Summer 2022" → "2022"). */
export function normalizeDate(input: string | null | undefined): string {
  if (!input) return '';
  const s = input.trim().toLowerCase();
  if (!s || /^(present|current|now|ongoing|today)$/.test(s)) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([a-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, m[1] === 'sept' ? 4 : 3)]) return `${m[2]}-${MONTHS[m[1].slice(0, m[1] === 'sept' ? 4 : 3)]}`;
  m = s.match(/(\d{4})/);
  if (m) return m[1];
  return '';
}

export function isPresent(input: string | null | undefined): boolean {
  return !!input && /^(present|current|now|ongoing|today)$/i.test(input.trim());
}

/* ------------------------------------------------------------------------------------------------
 * Counting
 * ---------------------------------------------------------------------------------------------- */

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function charCount(text: string): number {
  return [...text].length;
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .trim();
}

/** Organization similarity for entity resolution: token overlap ignoring legal suffixes. */
export function orgSimilarity(a: string, b: string): number {
  const stop = new Set(['inc', 'ltd', 'llc', 'plc', 'limited', 'group', 'the', 'co', 'company', 'corp', 'corporation', 'gmbh', 'and', '&']);
  const ta = new Set(normalizeName(a).split(' ').filter((t) => t && !stop.has(t)));
  const tb = new Set(normalizeName(b).split(' ').filter((t) => t && !stop.has(t)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}
