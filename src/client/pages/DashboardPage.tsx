import type { ReactNode } from 'react';
import { LuArrowRight, LuCalendarClock, LuCircleAlert, LuSend, LuSparkles, LuTarget, LuBrain, LuRotateCcw } from 'react-icons/lu';
import { useQuery } from '../lib/query';
import { useAuth } from '../lib/auth';
import { Link, navigate } from '../lib/router';
import { relativeTime } from '../lib/format';
import type { Readiness } from '../lib/types';
import { STAGE_LABEL, type Stage } from '../../shared/constants';
import { Button, Skeleton } from '../components/ui/primitives';
import { TierBadge } from '../components/domain/provenance';
import { ReadinessCard } from './brain/BrainPage';
import { cn } from '../components/ui/cn';

interface DashboardData {
  metrics: {
    appliedThisWeek: number;
    appliedThisMonth: number;
    totalApplied: number;
    interviews: number;
    interviewRate: number | null;
    interviewRateNeeds: number;
    finals: number;
    offers: number;
  };
  pipeline: { pipeline: number; active: number; interviewing: number; closed: number };
  byStage: Record<string, number>;
  attention: { kind: string; title: string; detail: string; href: string }[];
  recent: { id: string; title: string; company: string; stage: Stage; tier: string | null; updatedAt: string }[];
  readiness: Readiness;
  usage: { costUsd: number; calls: number };
}

const ATTENTION_ICON: Record<string, ReactNode> = {
  follow_up: <LuRotateCcw />,
  due: <LuCalendarClock />,
  ready: <LuSend />,
  high_match: <LuTarget />,
  failed: <LuCircleAlert />,
  brain: <LuBrain />,
  review: <LuSparkles />,
};

function Metric({ value, label, note }: { value: number | string; label: string; note?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="font-display text-[30px] leading-none font-semibold text-ink">{value}</div>
      <div className="mt-1.5 text-[13px] text-graphite">{label}</div>
      {note && <div className="mt-0.5 text-[11.5px] text-mist">{note}</div>}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading } = useQuery<DashboardData>('/api/dashboard', { refreshMs: 15000 });
  if (loading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const m = data.metrics;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = user?.displayName?.split(' ')[0];
  const funnel = [
    { label: 'Preparing', value: data.pipeline.pipeline },
    { label: 'Applied', value: data.pipeline.active },
    { label: 'Interviewing', value: data.pipeline.interviewing },
    { label: 'Offers', value: m.offers },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.value));
  const firstRun = data.recent.length === 0 && m.totalApplied === 0;
  const headline = data.attention.length
    ? `${data.attention.length} thing${data.attention.length === 1 ? ' needs' : 's need'} your attention.`
    : data.recent.length
      ? 'Nothing urgent. A good moment to start another application.'
      : data.readiness.ready
        ? 'Your Career Brain is ready. Start your first application.'
        : 'Let’s set up your Career Brain first.';

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="text-[13px] text-graphite">
          {greeting}
          {name ? `, ${name}` : ''}
        </div>
        <h1 className="mt-1 font-display text-[30px] leading-tight font-semibold tracking-[-0.01em] text-ink">{headline}</h1>
      </div>

      {!data.readiness.ready && <ReadinessCard readiness={data.readiness} collapsible={false} />}

      {data.attention.length > 0 && (
        <section>
          <ul className="divide-y divide-rule overflow-hidden rounded-panel border border-rule bg-surface">
            {data.attention.map((a, i) => (
              <li key={i}>
                <Link to={a.href} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-paper/60">
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
                      a.kind === 'failed' ? 'bg-brick-tint text-brick' : a.kind === 'ready' || a.kind === 'high_match' ? 'bg-jade-tint text-jade-strong' : 'bg-ochre-tint text-ochre',
                    )}
                  >
                    {ATTENTION_ICON[a.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{a.title}</span>
                    <span className="block truncate text-[13px] text-graphite">{a.detail}</span>
                  </span>
                  <LuArrowRight className="size-4 shrink-0 text-mist group-hover:text-ink" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {firstRun ? (
        <FirstRun readiness={data.readiness} />
      ) : (
      <section className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-panel border border-rule bg-surface">
          <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-3 sm:divide-y-0">
            <Metric value={m.appliedThisWeek} label="Applied this week" />
            <Metric value={m.appliedThisMonth} label="Applied in 30 days" />
            <Metric
              value={m.interviewRate === null ? '–' : `${m.interviewRate}%`}
              label="Interview rate"
              note={m.interviewRate === null ? `Shown after ${m.interviewRateNeeds} more application${m.interviewRateNeeds === 1 ? '' : 's'}` : `${m.interviews} of ${m.totalApplied}`}
            />
          </div>
          <div className="border-t border-rule px-5 py-5">
            <div className="mb-3 text-[13px] font-medium text-ink">Pipeline</div>
            <div className="flex flex-col gap-2.5">
              {funnel.map((f) => (
                <div key={f.label} className="grid grid-cols-[96px_1fr_32px] items-center gap-3 text-[13px]">
                  <span className="text-graphite">{f.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${(f.value / max) * 100}%` }} />
                  </div>
                  <span className="text-right text-ink tabular">{f.value}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12px] text-mist">
              {m.finals} final round{m.finals === 1 ? '' : 's'}, {m.offers} offer{m.offers === 1 ? '' : 's'}. Patterns in what works appear once there is enough data to be meaningful.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-ink">Recent</h2>
              <Link to="/applications" className="text-[13px] text-cobalt hover:underline">
                All applications
              </Link>
            </div>
            {data.recent.length ? (
              <ul className="flex flex-col gap-1">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <Link to={`/applications/${r.id}`} className="flex items-center justify-between gap-3 rounded-control px-2.5 py-2 hover:bg-ink/[0.04]">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{r.title || 'Untitled role'}</span>
                        <span className="block truncate text-[12.5px] text-graphite">
                          {r.company}, {STAGE_LABEL[r.stage]}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {r.tier && <TierBadge tier={r.tier} size="sm" />}
                        <span className="text-[11.5px] text-mist">{relativeTime(r.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-panel border border-dashed border-rule-strong px-5 py-6 text-center">
                <p className="text-sm text-graphite">No applications yet.</p>
                <Button className="mt-3" variant="primary" onClick={() => navigate('/applications/new')}>
                  New application
                </Button>
              </div>
            )}
          </section>
          <p className="text-[12px] text-mist">
            AI usage in the last 30 days: {data.usage.calls} calls{data.usage.costUsd ? `, about $${data.usage.costUsd.toFixed(2)}` : ''}.{' '}
            <Link to="/settings/usage" className="hover:underline">
              Details
            </Link>
          </p>
        </div>
      </section>
      )}
    </div>
  );
}

const FLOW = [
  { title: 'Career Brain', body: 'Your experience, merged from every resume and answer, with each fact linked to its source.' },
  { title: 'Job and company', body: 'What the role really asks for, plus cited research on the employer.' },
  { title: 'Fit and strategy', body: 'An honest call on whether to apply, the likely objections, and how to position you.' },
  { title: 'Documents', body: 'Resume, cover letter and answers built from that strategy and checked against your evidence.' },
  { title: 'Review and track', body: 'You approve every document. Nothing is ever submitted for you.' },
];

function FirstRun({ readiness }: { readiness: Readiness }) {
  const ready = readiness.ready;
  const optional = readiness.items.filter((i) => !i.required && i.status !== 'done');
  return (
    <section className="rounded-panel border border-rule bg-surface px-6 py-6">
      <h2 className="text-[15px] font-semibold text-ink">How each application is built</h2>
      <ol className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {FLOW.map((f, i) => (
          <li key={f.title} className="flex flex-col gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-full border border-rule-strong text-[12px] font-medium text-graphite tabular">{i + 1}</span>
            <span className="text-sm font-medium text-ink">{f.title}</span>
            <span className="text-[13px] leading-snug text-graphite">{f.body}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => navigate(ready ? '/applications/new' : '/brain')}>
          {ready ? 'Start your first application' : 'Set up your Career Brain'}
        </Button>
        {!ready && <span className="text-[13px] text-graphite">You can add a job at any time, but results are better once the checklist above is done.</span>}
      </div>
      {ready && optional.length > 0 && (
        <p className="mt-4 border-t border-rule pt-4 text-[13px] text-graphite">
          Optional, but it makes applications stronger:{' '}
          {optional.map((o, i) => (
            <span key={o.key}>
              {i > 0 && (i === optional.length - 1 ? ' and ' : ', ')}
              <Link to={o.href} className="text-cobalt hover:underline">
                {o.label.charAt(0).toLowerCase() + o.label.slice(1)}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}
