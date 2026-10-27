import { useMemo, useState } from 'react';
import { LuKanban, LuLayoutList, LuPlus, LuSearch, LuBriefcase } from 'react-icons/lu';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { useAction } from '../../lib/actions';
import { Link, navigate } from '../../lib/router';
import { formatDate, relativeTime } from '../../lib/format';
import type { ApplicationListItem } from '../../lib/types';
import { STAGES, STAGE_LABEL, TIERS, type Stage } from '../../../shared/constants';
import { Button, EmptyState, Input, PageHeader, Skeleton, Spinner } from '../../components/ui/primitives';
import { SegmentedControl } from '../../components/ui/overlays';
import { TierBadge } from '../../components/domain/provenance';
import { cn } from '../../components/ui/cn';

const COLUMNS: { key: string; label: string; stages: Stage[] }[] = [
  { key: 'preparing', label: 'Preparing', stages: ['discovered', 'considering', 'researching', 'preparing'] },
  { key: 'applied', label: 'Applied', stages: ['applied'] },
  { key: 'interviewing', label: 'Interviewing', stages: ['recruiter_screen', 'hiring_manager', 'assessment', 'interview', 'final'] },
  { key: 'offer', label: 'Offer', stages: ['offer', 'accepted'] },
  { key: 'closed', label: 'Closed', stages: ['rejected', 'withdrawn'] },
];

type SortKey = 'updated' | 'company' | 'fit' | 'readiness' | 'applied' | 'priority';

function Card({ a }: { a: ApplicationListItem }) {
  const { run } = useAction();
  return (
    <div className="rounded-control border border-rule bg-surface px-3.5 py-3 shadow-[0_1px_0_rgba(24,33,47,0.03)] hover:border-rule-strong">
      <Link to={`/applications/${a.id}`} className="block">
        <div className="text-[12.5px] text-graphite">{a.job.companyName || 'Company'}</div>
        <div className="mt-0.5 text-sm leading-snug font-medium text-ink">{a.job.title || 'Untitled role'}</div>
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {a.fit && <TierBadge tier={a.fit.tier} size="sm" />}
        {a.fit && <span className="text-[12px] text-graphite tabular">fit {a.fit.overall}</span>}
        {a.running && <Spinner className="size-3 text-cobalt" />}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <select
          aria-label="Stage"
          value={a.stage}
          onChange={(e) => void run('stage', () => api.patch(`/api/applications/${a.id}`, { stage: e.target.value }), { refresh: ['/api/applications', '/api/dashboard', `/api/applications/${a.id}`] })}
          className="min-w-0 flex-1 truncate rounded border-0 bg-transparent py-0 pr-1 pl-0 text-[12px] text-graphite focus:ring-0"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-[11.5px] whitespace-nowrap text-mist">{a.nextActionDate ? `Next ${formatDate(a.nextActionDate)}` : relativeTime(a.updatedAt)}</span>
      </div>
    </div>
  );
}

export function ApplicationsPage() {
  const { data, loading } = useQuery<{ applications: ApplicationListItem[] }>('/api/applications', { refreshMs: 8000 });
  const [view, setView] = useState<'board' | 'table'>(() => {
    try {
      return localStorage.getItem('gmaj.appsView') === 'table' ? 'table' : 'board';
    } catch {
      return 'board';
    }
  });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const apps = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.applications ?? []).filter((a) => !a.archived && (!q || `${a.job.title} ${a.job.companyName}`.toLowerCase().includes(q)));
    const by: Record<SortKey, (a: ApplicationListItem) => number | string> = {
      updated: (a) => -Date.parse(a.updatedAt),
      company: (a) => a.job.companyName.toLowerCase(),
      fit: (a) => -(a.fit?.overall ?? -1),
      readiness: (a) => -(a.readiness?.overall ?? -1),
      applied: (a) => -(a.dateApplied ? Date.parse(a.dateApplied) : 0),
      priority: (a) => (a.fit ? TIERS.indexOf(a.fit.tier as (typeof TIERS)[number]) : 99),
    };
    return [...list].sort((x, y) => (by[sort](x) < by[sort](y) ? -1 : by[sort](x) > by[sort](y) ? 1 : 0));
  }, [data, query, sort]);

  const setViewPersist = (v: 'board' | 'table') => {
    setView(v);
    try {
      localStorage.setItem('gmaj.appsView', v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Every role you are pursuing, from first look to offer."
        actions={
          <Button variant="primary" icon={<LuPlus className="size-4" />} onClick={() => navigate('/applications/new')}>
            New application
          </Button>
        }
      />
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !data?.applications.length ? (
        <div className="rounded-panel border border-dashed border-rule-strong bg-surface">
          <EmptyState icon={<LuBriefcase />} title="No applications yet" action={<Button variant="primary" onClick={() => navigate('/applications/new')}>Start your first application</Button>}>
            Paste a job description or a link. GetMeAJob researches the company, tells you honestly whether it is worth applying, and builds the application with you.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-xs">
              <LuSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist" />
              <Input className="pl-9" placeholder="Search company or role" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              {view === 'table' && (
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 rounded-control border border-rule-strong bg-surface px-2 text-[13px]" aria-label="Sort by">
                  <option value="updated">Recently updated</option>
                  <option value="priority">Priority</option>
                  <option value="fit">Fit</option>
                  <option value="readiness">Readiness</option>
                  <option value="applied">Date applied</option>
                  <option value="company">Company</option>
                </select>
              )}
              <SegmentedControl
                value={view}
                onChange={setViewPersist}
                options={[
                  { value: 'board', label: <><LuKanban /> Board</> },
                  { value: 'table', label: <><LuLayoutList /> Table</> },
                ]}
              />
            </div>
          </div>
          {view === 'board' ? (
            <div className="grid gap-3 pb-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              {COLUMNS.map((col) => {
                const items = apps.filter((a) => col.stages.includes(a.stage));
                return (
                  <section key={col.key} className="min-w-0">
                    <div className="mb-2 flex items-baseline justify-between px-0.5">
                      <h2 className="text-[13px] font-medium text-ink">{col.label}</h2>
                      <span className="text-[12px] text-mist tabular">{items.length}</span>
                    </div>
                    <div className={cn('flex min-h-24 flex-col gap-2 rounded-panel p-1.5', items.length ? 'bg-ink/[0.025]' : 'border border-dashed border-rule')}>
                      {items.map((a) => (
                        <Card key={a.id} a={a} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-panel border border-rule bg-surface">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-rule bg-paper/60 text-[12.5px] text-graphite">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Role</th>
                    <th className="px-3 py-2.5 font-medium">Stage</th>
                    <th className="px-3 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">Fit</th>
                    <th className="px-3 py-2.5 font-medium">Ready</th>
                    <th className="px-3 py-2.5 font-medium">Applied</th>
                    <th className="px-3 py-2.5 font-medium">Next</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {apps.map((a) => (
                    <tr key={a.id} className="cursor-pointer hover:bg-paper/60" onClick={() => navigate(`/applications/${a.id}`)}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-ink">{a.job.title || 'Untitled role'}</div>
                        <div className="text-[12.5px] text-graphite">{a.job.companyName}</div>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-ink-soft">{STAGE_LABEL[a.stage]}</td>
                      <td className="px-3 py-3">{a.fit ? <TierBadge tier={a.fit.tier} size="sm" /> : <span className="text-mist">–</span>}</td>
                      <td className="px-3 py-3 text-[13px] tabular">{a.fit?.overall ?? '–'}</td>
                      <td className="px-3 py-3 text-[13px] tabular">{a.readiness?.overall ?? '–'}</td>
                      <td className="px-3 py-3 text-[13px] text-graphite">{a.dateApplied ? formatDate(a.dateApplied) : '–'}</td>
                      <td className="px-3 py-3 text-[13px] text-graphite">{a.nextActionDate ? `${a.nextAction || 'Next step'} by ${formatDate(a.nextActionDate)}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
