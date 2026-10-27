import { useMemo, useState } from 'react';
import { LuEllipsis, LuExternalLink, LuMapPin, LuPlay, LuRefreshCw, LuTrash2, LuBuilding2, LuBanknote, LuTriangleAlert } from 'react-icons/lu';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { useTaskWatcher } from '../../lib/tasks';
import { useAction } from '../../lib/actions';
import { Link, navigate } from '../../lib/router';
import type { WorkspaceData } from '../../lib/types';
import { PIPELINE_STEPS, PIPELINE_STEP_LABEL, STAGES, STAGE_LABEL, WORK_MODEL_LABEL, type PipelineStep, type WorkModel } from '../../../shared/constants';
import { Button, Callout, Select, Skeleton } from '../../components/ui/primitives';
import { Dialog, Menu } from '../../components/ui/overlays';
import { StepIcon, TaskProgressCard } from '../../components/domain/work';
import { TierBadge } from '../../components/domain/provenance';
import { cn } from '../../components/ui/cn';
import { refreshKeys } from './workspace/shared';
import { OverviewTab } from './workspace/OverviewTab';
import { JobTab } from './workspace/JobTab';
import { ResearchTab } from './workspace/ResearchTab';
import { FitTab } from './workspace/FitTab';
import { StrategyTab } from './workspace/StrategyTab';
import { ResumeTab } from './workspace/ResumeTab';
import { CoverLetterTab } from './workspace/CoverLetterTab';
import { AnswersTab } from './workspace/AnswersTab';
import { ReviewTab } from './workspace/ReviewTab';
import { TrackingTab } from './workspace/TrackingTab';

const TAB_FOR_STEP: Record<PipelineStep, string> = {
  job: 'job',
  research: 'research',
  fit: 'fit',
  strategy: 'strategy',
  resume: 'resume',
  cover_letter: 'cover-letter',
  questions: 'questions',
  review: 'review',
};

function stepStatus(data: WorkspaceData, step: PipelineStep, runningStep: string | null): string {
  if (runningStep === step) return 'running';
  const a = data.artifacts;
  switch (step) {
    case 'job':
      return data.job.intelligence ? 'done' : 'pending';
    case 'research':
      return a.research ? 'done' : 'pending';
    case 'fit':
      return a.fit ? 'done' : 'pending';
    case 'strategy':
      return a.strategy ? 'done' : 'pending';
    case 'resume':
      return a.resume ? 'done' : 'pending';
    case 'cover_letter':
      return a.cover_letter ? 'done' : 'pending';
    case 'questions':
      return !data.questions.length ? 'skipped' : data.questions.every((q) => q.answer) ? 'done' : 'pending';
    case 'review':
      return a.review ? 'done' : 'pending';
  }
}

export function WorkspacePage({ id, tab }: { id: string; tab: string }) {
  const key = `/api/applications/${id}`;
  const { data, error, loading } = useQuery<WorkspaceData>(key);
  const active = useTaskWatcher(data?.tasks, refreshKeys(id));
  const { run, busy } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const runningTask = active[0] ?? null;
  const runningStep = runningTask?.progress.steps.find((s) => s.status === 'running')?.key ?? null;

  const lastFailed = useMemo(() => (data?.lastTask && data.lastTask.status === 'failed' && !active.length ? data.lastTask : null), [data, active.length]);

  if (error) return <Callout tone="brick">{error.message}</Callout>;
  if (loading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  const intel = data.job.intelligence;
  const title = intel?.title || data.job.title || 'Untitled role';
  const company = intel?.company || data.job.companyName || 'Company';
  const app = data.application;
  const busyNow = active.length > 0;
  const tabs: { key: string; label: string; step?: PipelineStep; n?: number }[] = [
    { key: 'overview', label: 'Overview' },
    ...PIPELINE_STEPS.map((s, i) => ({ key: TAB_FOR_STEP[s], label: PIPELINE_STEP_LABEL[s], step: s, n: i + 1 })),
    { key: 'tracking', label: 'Tracking' },
  ];
  const fitStopped = data.artifacts.fit?.content.finalTier === 'do_not_apply' && !data.artifacts.resume;

  return (
    <div>
      <header className="mb-5">
        <div className="mb-2 text-[13px] text-graphite">
          <Link to="/applications" className="hover:text-ink hover:underline">
            Applications
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-graphite">
              <span className="inline-flex items-center gap-1.5 text-ink-soft">
                <LuBuilding2 className="size-3.5" />
                {company}
              </span>
              {(intel?.location || data.job.location) && (
                <span className="inline-flex items-center gap-1.5">
                  <LuMapPin className="size-3.5" />
                  {intel?.location || data.job.location}
                  {intel && intel.workModel !== 'unknown' ? `, ${WORK_MODEL_LABEL[intel.workModel as WorkModel]}` : ''}
                </span>
              )}
              {(intel?.salary.text || data.job.salaryText) && (
                <span className="inline-flex items-center gap-1.5">
                  <LuBanknote className="size-3.5" />
                  {intel?.salary.text || data.job.salaryText}
                </span>
              )}
              {data.job.sourceUrl && (
                <a href={data.job.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-cobalt hover:underline">
                  Posting <LuExternalLink className="size-3" />
                </a>
              )}
              {app.tier && <TierBadge tier={app.tier} size="sm" />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="stage">
              Stage
            </label>
            <Select
              id="stage"
              className="w-48"
              value={app.stage}
              onChange={(e) => void run('stage', () => api.patch(`/api/applications/${id}`, { stage: e.target.value }), { refresh: refreshKeys(id) })}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
            <Menu
              button={
                <button type="button" aria-label="More actions" className="flex size-9 items-center justify-center rounded-control border border-rule-strong bg-surface text-graphite hover:text-ink">
                  <LuEllipsis className="size-4" />
                </button>
              }
              items={[
                {
                  label: 'Continue building',
                  icon: <LuPlay />,
                  disabled: busyNow,
                  onSelect: () => void run('build', () => api.post(`/api/applications/${id}/build`, { continueAnyway: true }), { refresh: refreshKeys(id) }),
                },
                {
                  label: 'Rebuild everything',
                  icon: <LuRefreshCw />,
                  disabled: busyNow,
                  onSelect: () => void run('build', () => api.post(`/api/applications/${id}/build`, { force: true, continueAnyway: true }), { refresh: refreshKeys(id) }),
                },
                'divider',
                { label: 'Delete application', icon: <LuTrash2 />, danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </div>
        </div>
      </header>

      <nav className="-mx-1 mb-6 flex gap-0.5 overflow-x-auto border-b border-rule px-1" aria-label="Workspace">
        {tabs.map((t) => {
          const status = t.step ? stepStatus(data, t.step, runningStep) : null;
          const isActive = tab === t.key;
          return (
            <Link
              key={t.key}
              to={t.key === 'overview' ? `/applications/${id}` : `/applications/${id}/${t.key}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[13.5px] transition-colors',
                isActive ? 'border-ink font-medium text-ink' : 'border-transparent text-graphite hover:text-ink',
              )}
            >
              {status && (status === 'pending' ? <span className="text-[11px] text-mist tabular">{t.n}</span> : <StepIcon status={status} />)}
              {t.label}
              {t.key === 'questions' && data.questions.length > 0 && <span className="text-[11.5px] text-mist tabular">{data.questions.length}</span>}
            </Link>
          );
        })}
      </nav>

      {runningTask && (
        <div className="mb-6">
          <TaskProgressCard
            task={runningTask}
            title={runningTask.type === 'application.build' ? 'Building your application' : runningTask.type === 'application.answer' ? 'Drafting the answer' : 'Updating this step'}
            onCancel={() => void api.post(`/api/tasks/${runningTask.id}/cancel`)}
          />
        </div>
      )}
      {lastFailed && (
        <Callout
          tone="brick"
          icon={<LuTriangleAlert />}
          className="mb-6"
          title="The last step did not finish"
          action={
            <Button size="sm" loading={busy === 'retry'} onClick={() => void run('retry', () => api.post(`/api/applications/${id}/build`, { continueAnyway: true }), { refresh: refreshKeys(id) })}>
              Retry
            </Button>
          }
        >
          {lastFailed.error}
        </Callout>
      )}
      {fitStopped && !runningTask && tab === 'overview' && (
        <Callout
          tone="brick"
          className="mb-6"
          title="GetMeAJob recommends not applying"
          action={
            <Button size="sm" onClick={() => void run('build', () => api.post(`/api/applications/${id}/build`, { from: 'strategy', continueAnyway: true }), { refresh: refreshKeys(id) })}>
              Build it anyway
            </Button>
          }
        >
          {data.artifacts.fit!.content.guardrails.find((g) => g.severity === 'blocker')?.message ?? data.artifacts.fit!.content.verdict.headline}
        </Callout>
      )}

      {tab === 'job' ? (
        <JobTab data={data} busy={busyNow} />
      ) : tab === 'research' ? (
        <ResearchTab data={data} busy={busyNow} />
      ) : tab === 'fit' ? (
        <FitTab data={data} busy={busyNow} />
      ) : tab === 'strategy' ? (
        <StrategyTab data={data} busy={busyNow} />
      ) : tab === 'resume' ? (
        <ResumeTab data={data} busy={busyNow} />
      ) : tab === 'cover-letter' ? (
        <CoverLetterTab data={data} busy={busyNow} />
      ) : tab === 'questions' ? (
        <AnswersTab data={data} busy={busyNow} />
      ) : tab === 'review' ? (
        <ReviewTab data={data} busy={busyNow} />
      ) : tab === 'tracking' ? (
        <TrackingTab data={data} />
      ) : (
        <OverviewTab data={data} busy={busyNow} />
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this application?"
        description="The job, research, every document version and the timeline are deleted. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              onClick={async () => {
                await run('delete', () => api.delete(`/api/applications/${id}`), { refresh: ['/api/applications', '/api/dashboard'] });
                navigate('/applications');
              }}
            >
              Delete application
            </Button>
          </>
        }
      />
    </div>
  );
}
