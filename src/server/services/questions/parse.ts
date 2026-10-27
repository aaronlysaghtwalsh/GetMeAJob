import { SENSITIVE_TOPICS } from '../../../shared/constants';

export interface ParsedQuestion {
  question: string;
  limitType: 'words' | 'chars' | 'none';
  limitValue: number | null;
  required: boolean;
  sensitive: boolean;
}

export function detectLimit(text: string): { limitType: 'words' | 'chars' | 'none'; limitValue: number | null } {
  const w = text.match(/(\d{2,4})\s*(?:-|\s)?words?\b/i) ?? text.match(/words?\s*(?:limit|max(?:imum)?)\s*[:=]?\s*(\d{2,4})/i);
  if (w) return { limitType: 'words', limitValue: Number(w[1]) };
  const c = text.match(/(\d{2,5})\s*(?:-|\s)?char(?:acter)?s?\b/i) ?? text.match(/char(?:acter)?s?\s*(?:limit|max(?:imum)?)\s*[:=]?\s*(\d{2,5})/i);
  if (c) return { limitType: 'chars', limitValue: Number(c[1]) };
  return { limitType: 'none', limitValue: null };
}

export function isSensitiveQuestion(q: string): boolean {
  const lower = q.toLowerCase();
  return SENSITIVE_TOPICS.some((t) => lower.includes(t));
}

/**
 * Split pasted application questions. Accepts numbered lists, bullets, "Q1:" prefixes or one
 * question per paragraph; limit hints like "(max 250 words)" are parsed from each question.
 */
export function parseQuestions(text: string): ParsedQuestion[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  let blocks: string[];
  const marker = /^\s*(?:\d{1,2}[.)]|q\d{1,2}[:.)]|[-•*])\s+/im;
  if (marker.test(normalized)) {
    blocks = normalized
      .split(/\n(?=\s*(?:\d{1,2}[.)]|q\d{1,2}[:.)]|[-•*])\s+)/i)
      .map((b) => b.replace(marker, '').trim());
  } else if (/\n\s*\n/.test(normalized)) {
    blocks = normalized.split(/\n\s*\n/).map((b) => b.trim());
  } else {
    blocks = normalized.split('\n').map((b) => b.trim());
  }
  return blocks
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b) => b.length >= 8)
    .slice(0, 25)
    .map((question) => ({
      question,
      ...detectLimit(question),
      required: !/\boptional\b/i.test(question),
      sensitive: isSensitiveQuestion(question),
    }));
}
