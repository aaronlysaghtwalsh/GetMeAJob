import type { ReactNode } from 'react';
import { PROVENANCE_HELP, PROVENANCE_LABEL, type Provenance, TIER_LABEL, type Tier } from '../../../shared/constants';
import { HoverCard } from '../ui/overlays';
import { cn } from '../ui/cn';

export const PROVENANCE_STYLE: Record<Provenance, { dot: string; badge: string; text: string }> = {
  verified: { dot: 'bg-jade', badge: 'bg-jade-tint text-jade-strong', text: 'text-jade-strong' },
  applicant_provided: { dot: 'bg-cobalt', badge: 'bg-cobalt-tint text-cobalt', text: 'text-cobalt' },
  inferred: { dot: 'bg-ochre', badge: 'bg-ochre-tint text-ochre', text: 'text-ochre' },
  unsupported: { dot: 'bg-brick', badge: 'bg-brick-tint text-brick', text: 'text-brick' },
};

export function ProvenanceBadge({ value, className }: { value: Provenance; className?: string }) {
  const s = PROVENANCE_STYLE[value];
  return (
    <HoverCard
      interactive={false}
      trigger={
        <span className={cn('inline-flex cursor-default items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap', s.badge, className)}>
          <span className={cn('size-1.5 rounded-full', s.dot)} />
          {PROVENANCE_LABEL[value]}
        </span>
      }
    >
      {PROVENANCE_HELP[value]}
    </HoverCard>
  );
}

export function ProvenanceDot({ value, className }: { value: Provenance; className?: string }) {
  return (
    <HoverCard interactive={false} trigger={<span aria-label={PROVENANCE_LABEL[value]} className={cn('inline-block size-2 shrink-0 rounded-full', PROVENANCE_STYLE[value].dot, className)} />}>
      <span className="font-medium text-ink">{PROVENANCE_LABEL[value]}.</span> {PROVENANCE_HELP[value]}
    </HoverCard>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  apply_now: 'bg-jade text-white',
  high_priority: 'bg-jade-tint text-jade-strong',
  good_match: 'bg-cobalt-tint text-cobalt',
  stretch: 'bg-ochre-tint text-ochre',
  low_priority: 'bg-ink/[0.07] text-graphite',
  do_not_apply: 'bg-brick-tint text-brick',
};

export function TierBadge({ tier, size = 'md' }: { tier: Tier | string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  if (!tier) return null;
  const t = tier as Tier;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        TIER_STYLE[t] ?? TIER_STYLE.low_priority,
        size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-[12.5px]',
      )}
    >
      {TIER_LABEL[t] ?? tier}
    </span>
  );
}

export function scoreTone(v: number): 'jade' | 'cobalt' | 'ochre' | 'brick' {
  if (v >= 80) return 'jade';
  if (v >= 65) return 'cobalt';
  if (v >= 45) return 'ochre';
  return 'brick';
}

const BAR: Record<string, string> = { jade: 'bg-jade', cobalt: 'bg-cobalt', ochre: 'bg-ochre', brick: 'bg-brick' };
const TEXT: Record<string, string> = { jade: 'text-jade-strong', cobalt: 'text-cobalt', ochre: 'text-ochre', brick: 'text-brick' };

export function ScoreBar({ value, label, hint, muted }: { value: number; label: ReactNode; hint?: ReactNode; muted?: boolean }) {
  const tone = muted ? 'cobalt' : scoreTone(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-soft">{label}</span>
        <span className={cn('tabular text-[13px] font-semibold', muted ? 'text-mist' : TEXT[tone])}>{muted ? 'n/a' : value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
        <div className={cn('h-full rounded-full transition-[width] duration-500', muted ? 'bg-mist/40' : BAR[tone])} style={{ width: `${muted ? 100 : Math.max(2, Math.min(100, value))}%` }} />
      </div>
      {hint && <p className="mt-1.5 text-[12.5px] leading-snug text-graphite">{hint}</p>}
    </div>
  );
}

/** Big number treatment for a headline score. */
export function ScoreFigure({ value, label, suffix = '/100' }: { value: number | null; label: string; suffix?: string }) {
  const tone = value === null ? 'cobalt' : scoreTone(value);
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className={cn('font-display text-[40px] leading-none font-semibold', value === null ? 'text-mist' : TEXT[tone])}>{value ?? '–'}</span>
        {value !== null && <span className="text-sm text-mist">{suffix}</span>}
      </div>
      <div className="mt-1.5 text-[13px] text-graphite">{label}</div>
    </div>
  );
}
