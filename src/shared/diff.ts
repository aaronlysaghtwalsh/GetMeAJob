export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };

/**
 * Words (keeping internal punctuation such as 250,000+ or don't), runs of whitespace, and single punctuation
 * marks as separate tokens, so "managers" -> "managers," shows only the added comma.
 */
const TOKEN = /\s+|[\p{L}\p{N}]+(?:['’.,\-/][\p{L}\p{N}]+)*[%+]?|[^\s]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Word-level diff (LCS). Fine for documents up to a few thousand words. */
export function diffWords(a: string, b: string): DiffPart[] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;
  if (n * m > 4_000_000) return [{ type: 'removed', text: a }, { type: 'added', text: b }];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      push('same', ta[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('removed', ta[i++]);
    else push('added', tb[j++]);
  }
  while (i < n) push('removed', ta[i++]);
  while (j < m) push('added', tb[j++]);
  return out;
}
