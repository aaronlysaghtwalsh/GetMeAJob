import { useState } from 'react';
import { LuCircleCheck, LuCircle, LuChevronDown, LuUpload, LuKeyRound } from 'react-icons/lu';
import { useQuery } from '../../lib/query';
import { useTaskWatcher } from '../../lib/tasks';
import { api } from '../../lib/api';
import { Link, navigate, useLocation } from '../../lib/router';
import type { CareerBrainDTO, Readiness, TaskDTO, AiStatus } from '../../lib/types';
import { Button, Callout, PageHeader, Skeleton } from '../../components/ui/primitives';
import { LinkTabs } from '../../components/ui/overlays';
import { TaskProgressCard } from '../../components/domain/work';
import { cn } from '../../components/ui/cn';
import { BrainOverview } from './BrainOverview';
import { DocumentsTab, UploadDialog } from './DocumentsTab';
import { QuestionsTab } from './QuestionsTab';
import { PreferencesTab } from './PreferencesTab';

export interface BrainPayload {
  brain: CareerBrainDTO;
  readiness: Readiness;
  tasks: TaskDTO[];
  openQuestions: number;
}

export function ReadinessCard({ readiness, collapsible = true, defaultOpen }: { readiness: Readiness; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? !readiness.ready);
  const done = readiness.items.filter((i) => i.status === 'done').length;
  const next = readiness.items.find((i) => i.required && i.status !== 'done');
  const { path } = useLocation();
  const showNext = next && !readiness.ready && next.href !== path;
  const Header = collapsible ? 'button' : 'div';
  return (
    <section className="rounded-panel border border-rule bg-surface">
      <div className="flex items-center gap-4 px-5 py-4">
        <Header
          {...(collapsible ? { type: 'button', onClick: () => setOpen(!open), 'aria-expanded': open } : {})}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-ink">{readiness.headline}</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-ink/[0.07]">
                <div className="h-full rounded-full bg-jade" style={{ width: `${(done / readiness.items.length) * 100}%` }} />
              </div>
              <span className="text-[12.5px] text-graphite">
                {done} of {readiness.items.length} done
              </span>
            </div>
          </div>
        </Header>
        {showNext && (
          <Button variant="primary" size="sm" className="hidden sm:inline-flex" onClick={() => navigate(next.href)}>
            {next.label}
          </Button>
        )}
        {collapsible && (
          <button type="button" onClick={() => setOpen(!open)} className="rounded p-1 text-graphite hover:bg-ink/5" aria-label={open ? 'Hide checklist' : 'Show checklist'}>
            <LuChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        <ul className="grid gap-x-8 border-t border-rule px-5 py-3 sm:grid-cols-2">
          {readiness.items.map((i) => (
            <li key={i.key}>
              <Link to={i.href} className="group flex items-start gap-2.5 rounded-control py-2">
                {i.status === 'done' ? <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-jade" /> : <LuCircle className={cn('mt-0.5 size-4 shrink-0', i.required ? 'text-ochre' : 'text-rule-strong')} />}
                <span className="min-w-0">
                  <span className={cn('text-sm', i.status === 'done' ? 'text-graphite' : 'text-ink group-hover:underline')}>
                    {i.label}
                    {!i.required && i.status !== 'done' && <span className="ml-1.5 text-[12px] text-mist">recommended</span>}
                  </span>
                  <span className="block text-[12.5px] leading-snug text-graphite">{i.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BrainPage({ tab }: { tab: string }) {
  const { data, error, loading } = useQuery<BrainPayload>('/api/brain');
  const ai = useQuery<AiStatus>('/api/settings/ai');
  const [uploadOpen, setUploadOpen] = useState(false);
  const active = useTaskWatcher(data?.tasks, ['/api/brain', '/api/documents', '/api/dashboard', '/api/preferences']);

  if (error) return <Callout tone="brick">{error.message}</Callout>;
  if (loading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const { brain, readiness } = data;
  const empty = !brain.experiences.length && !brain.education.length && !brain.evidence.length;
  const tabs = [
    { key: 'overview', label: 'Overview', href: '/brain' },
    { key: 'documents', label: 'Documents', href: '/brain/documents' },
    {
      key: 'questions',
      label: 'Questions',
      href: '/brain/questions',
      badge: data.openQuestions ? <span className="rounded-full bg-ochre-tint px-1.5 text-[11.5px] font-medium text-ochre tabular">{data.openQuestions}</span> : null,
    },
    { key: 'preferences', label: 'Preferences', href: '/brain/preferences' },
  ];

  return (
    <div>
      <PageHeader
        title="Career Brain"
        description="Everything GetMeAJob knows about you. Every fact links back to the document or answer it came from, so nothing in an application is invented."
        actions={
          <Button variant="primary" icon={<LuUpload className="size-4" />} onClick={() => setUploadOpen(true)}>
            Upload documents
          </Button>
        }
      />
      {ai.data && !ai.data.configured && (
        <Callout
          tone="ochre"
          icon={<LuKeyRound />}
          className="mb-4"
          title="Connect an AI provider to analyze your documents"
          action={
            <Link to="/settings" className="text-sm font-medium text-cobalt hover:underline">
              Open settings
            </Link>
          }
        >
          You can upload now; analysis starts once a key is added.
        </Callout>
      )}
      {active.map((t) => (
        <div key={t.id} className="mb-4">
          <TaskProgressCard
            task={t}
            title={t.type === 'brain.ingest' ? 'Building your Career Brain' : t.type === 'brain.answer' ? 'Adding your answer' : 'Preparing questions'}
            onCancel={() => void api.post(`/api/tasks/${t.id}/cancel`)}
          />
        </div>
      ))}
      <div className="mb-6">
        <ReadinessCard readiness={readiness} defaultOpen={!readiness.ready && tab === 'overview'} />
      </div>
      <LinkTabs tabs={tabs} active={tab} />
      <div className="pt-6">
        {tab === 'documents' ? (
          <DocumentsTab onUpload={() => setUploadOpen(true)} />
        ) : tab === 'questions' ? (
          <QuestionsTab />
        ) : tab === 'preferences' ? (
          <PreferencesTab />
        ) : (
          <BrainOverview brain={brain} empty={empty} onUpload={() => setUploadOpen(true)} building={active.some((t) => t.type === 'brain.ingest')} />
        )}
      </div>
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
