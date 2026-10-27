const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2024-06" -> "Jun 2024", "2024" -> "2024", "" -> "" */
export function formatYm(value: string | null | undefined): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{2})/);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`.trim();
  return value;
}

export function formatRange(start: string, end: string, isCurrent: boolean): string {
  const s = formatYm(start);
  const e = isCurrent ? 'Present' : formatYm(end);
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
}

/**
 * Date-only strings ("2026-10-14") are calendar dates, not instants: parse them as local midnight so they
 * never shift a day when shown in a timezone behind UTC.
 */
export function parseWhen(value: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Today (or d) as YYYY-MM-DD in the viewer's timezone, for <input type="date">. */
export function localDateInput(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Now (or d) as YYYY-MM-DDTHH:mm in the viewer's timezone, for <input type="datetime-local">. */
export function localDateTimeInput(d = new Date()): string {
  return `${localDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseWhen(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseWhen(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - parseWhen(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: [number, string][] = [
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
    [604_800_000, 'week'],
  ];
  if (abs < 60_000) return 'just now';
  let label = '';
  if (abs < 3_600_000) label = plural(Math.round(abs / units[0][0]), 'minute');
  else if (abs < 86_400_000) label = plural(Math.round(abs / units[1][0]), 'hour');
  else if (abs < 604_800_000 * 2) label = plural(Math.round(abs / units[2][0]), 'day');
  else if (abs < 86_400_000 * 60) label = plural(Math.round(abs / units[3][0]), 'week');
  else return formatDate(iso);
  return future ? `in ${label}` : `${label} ago`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function money(n: number | null | undefined, currency = 'USD', period: 'year' | 'hour' = 'year'): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return '';
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: period === 'hour' ? 2 : 0 });
  return `${fmt.format(n)}${period === 'hour' ? '/hr' : ''}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "not_offered" -> "Not offered"; "bachelor's degree in a field" -> "Bachelor's degree in a field". */
export function sentence(value: string | null | undefined): string {
  const t = String(value ?? '').replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
