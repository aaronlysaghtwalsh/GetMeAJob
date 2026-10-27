import type { WritingLint } from '../../../shared/schemas/documents';

/**
 * Deterministic editorial checks for natural, specific writing. This is about quality, not about
 * evading detectors: it flags clichés, filler and the structural habits that make writing feel generic.
 */
const PATTERNS: { re: RegExp; kind: WritingLint['flags'][number]['kind']; suggestion: string }[] = [
  { re: /\bpassionate( about)?\b/gi, kind: 'cliche', suggestion: 'Show the interest through a specific reason or action instead.' },
  { re: /\b(i am|i'm) (so |very |really )?(excited|thrilled|eager) to (apply|submit)/gi, kind: 'cliche', suggestion: 'Open with something specific about the role or company.' },
  { re: /\bi am writing to (express|apply)/gi, kind: 'cliche', suggestion: 'Skip the preamble; start with your strongest point.' },
  { re: /\b(i believe|i feel) (that )?i (would be|am) (a )?(great|perfect|ideal|strong) (fit|candidate)/gi, kind: 'cliche', suggestion: 'Let the evidence make the case.' },
  { re: /\bproven track record\b/gi, kind: 'cliche', suggestion: 'Name the actual result.' },
  { re: /\bresults[- ]driven\b/gi, kind: 'cliche', suggestion: 'Name the results.' },
  { re: /\b(team player|go-getter|self-starter|hard[- ]working)\b/gi, kind: 'cliche', suggestion: 'Describe what you did with the team instead.' },
  { re: /\bfast[- ]paced (environment|world)\b/gi, kind: 'cliche', suggestion: 'Describe the actual pace or volume.' },
  { re: /\bthink outside the box\b/gi, kind: 'cliche', suggestion: 'Describe the unusual approach you took.' },
  { re: /\bhit the ground running\b/gi, kind: 'cliche', suggestion: 'Say what you would do first.' },
  { re: /\bwear many hats\b/gi, kind: 'cliche', suggestion: 'List the actual responsibilities.' },
  { re: /\bsynerg(y|ies|ize)\b/gi, kind: 'cliche', suggestion: 'Use a plain word.' },
  { re: /\bleverag(e|ed|ing)\b/gi, kind: 'filler', suggestion: 'Use "used" or a more precise verb.' },
  { re: /\butiliz(e|ed|ing)\b/gi, kind: 'filler', suggestion: 'Use "used".' },
  { re: /\b(delve|delving)\b/gi, kind: 'ai_tell', suggestion: 'Use "look into" or cut.' },
  { re: /\btapestry\b/gi, kind: 'ai_tell', suggestion: 'Cut it.' },
  { re: /\btestament to\b/gi, kind: 'ai_tell', suggestion: 'Say what it shows directly.' },
  { re: /\bin today's (rapidly )?(evolving|changing|fast-paced)/gi, kind: 'ai_tell', suggestion: 'Cut the scene-setting.' },
  { re: /\bnavigat(e|ing) the complexities\b/gi, kind: 'ai_tell', suggestion: 'Name the actual complexity.' },
  { re: /\b(unlock|elevate|empower|revolutioniz)(e|ed|es|ing)?\b/gi, kind: 'hype', suggestion: 'Use a concrete verb.' },
  { re: /\b(seamless(ly)?|robust|cutting-edge|world-class|game-chang(er|ing)|best-in-class)\b/gi, kind: 'hype', suggestion: 'Replace with a specific detail.' },
  { re: /\b(dynamic|innovative|visionary)\b/gi, kind: 'hype', suggestion: 'Show it rather than claim it.' },
  { re: /\bnot only\b[^.]{0,80}\bbut also\b/gi, kind: 'structure', suggestion: 'Simplify into two plain statements.' },
  { re: /\bI'?m confident that\b/gi, kind: 'filler', suggestion: 'State the point directly.' },
  { re: /\b(furthermore|moreover|additionally)\b/gi, kind: 'filler', suggestion: 'Usually cuttable; let sentences follow naturally.' },
  { re: /!/g, kind: 'hype', suggestion: 'Drop exclamation marks in applications.' },
];

export function lintWriting(text: string): WritingLint {
  const flags = new Map<string, WritingLint['flags'][number]>();
  for (const p of PATTERNS) {
    const matches = text.match(p.re);
    if (!matches?.length) continue;
    const phrase = matches[0].toLowerCase();
    const prev = flags.get(phrase);
    flags.set(phrase, { phrase: matches[0], kind: p.kind, suggestion: p.suggestion, count: (prev?.count ?? 0) + matches.length });
  }
  const dashes = (text.match(/—/g) ?? []).length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (dashes > Math.max(2, words / 120)) flags.set('em dashes', { phrase: '—', kind: 'structure', suggestion: 'Several em dashes; prefer full stops and commas.', count: dashes });
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const stdev = lengths.length ? Math.sqrt(lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length) : 0;
  const iStarts = sentences.filter((s) => /^I\b/.test(s)).length;
  if (sentences.length >= 5 && iStarts / sentences.length > 0.45) {
    flags.set('I-starts', { phrase: 'Sentences starting with "I"', kind: 'structure', suggestion: 'Vary sentence openings; lead some with the work or the result.', count: iStarts });
  }
  if (sentences.length >= 6 && stdev < 3.5) {
    flags.set('rhythm', { phrase: 'Uniform sentence length', kind: 'structure', suggestion: 'Mix short and long sentences for a natural rhythm.', count: 1 });
  }
  if (avg > 28) flags.set('long', { phrase: 'Long sentences', kind: 'structure', suggestion: 'Break up sentences over ~25 words.', count: lengths.filter((l) => l > 30).length });
  const list = [...flags.values()];
  const penalty = list.reduce((a, f) => a + (f.kind === 'structure' ? 6 : f.kind === 'filler' ? 4 : 8) * Math.min(f.count, 3), 0);
  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    flags: list,
    stats: { words, sentences: sentences.length, avgSentenceLength: Math.round(avg * 10) / 10, sentenceLengthStdev: Math.round(stdev * 10) / 10, iStarts },
  };
}
